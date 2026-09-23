"""Synchronous lifecycle and query-time event attribution."""
import json
import os
import stat
from pathlib import Path
from .common import QuotaError, fixture_dir, now, valid_session, model_vendor
from .identity import identity, bind
from .usage import aggregate

FIELDS=('stage','agent','model','effort','route','auth')


def version(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            return None
        return os.read(fd, 40).decode(errors='replace').strip()[:40]
    except OSError:
        return None
    finally:
        os.close(fd)


def metadata(args,context):
    values={field:getattr(args,field,None) for field in FIELDS}
    values['auth']=values['auth'] or context.get('auth','unknown')
    values.update(context=context,model_vendor=model_vendor(values.get('model')),
                  gstack_extend_version=version(Path(__file__).resolve().parents[3]/'VERSION'),
                  gstack_version=version(Path.home()/'.claude/skills/gstack/VERSION'))
    return values


def attach_identity(store,state,args):
    session=getattr(args,'harness_session',None)
    if not session:
        return
    if not valid_session(session):
        raise QuotaError('usage','Invalid harness session ID.',2)
    agent=getattr(args,'agent',None) or state['metadata'].get('agent') or 'unknown'
    hashed=store.digest(session,'session')
    item=dict(agent=agent,session=hashed,attached_at=now())
    if not any(a['agent']==agent and a['session']==hashed for a in state['attachments']):
        state['attachments'].append(item)


def lifecycle(store,args,context):
    sid=args.session_id
    if not valid_session(sid):
        raise QuotaError('usage','Invalid session ID.',2)
    phase=args.phase
    with store.lock('run:'+sid):
        receipt=store.get('receipt',sid+':'+phase)
        state=store.get('state',sid)
        incoming=metadata(args,context)
        incoming['initial_harness_session']=store.digest(args.harness_session,'session') if args.harness_session else None
        if phase=='start':
            if state:
                if state['start_metadata']!=incoming:
                    raise QuotaError('conflict','The session ID already has different start metadata.')
                with store.transaction():
                    state['lease_at']=now()
                    store.put('state',sid,state)
                return receipt or dict(v=1,session_id=sid,lifecycle='open')
            state=dict(session_id=sid,started_at=now(),ended_at=None,lease_at=now(),start_metadata=incoming,
                       metadata=incoming,attachments=[],identities={},fixture=bool(fixture_dir()))
            attach_identity(store,state,args)
            with store.transaction():
                for kind in ('claude','codex','cursor'):
                    evidence=identity(store,kind,context)
                    state['identities'][kind]=evidence
                    bind(store,kind,context,evidence)
                store.put('state',sid,state)
                receipt=dict(v=1,session_id=sid,lifecycle='open',started_at=state['started_at'])
                store.put('receipt',sid+':start',receipt)
            return receipt
        if not state:
            raise QuotaError('no_start_state','Start this session before attaching or finishing.')
        if phase=='attach':
            if state['ended_at'] is not None or state.get('finishing'):
                raise QuotaError('run_finished','This run is already finished.')
            if not getattr(args,'harness_session',None):
                raise QuotaError('usage','Attach requires --harness-session.',2)
            attach_key=sid+':attach:'+store.digest([getattr(args,'agent',None),args.harness_session],'attach')
            receipt=store.get('receipt',attach_key)
            if receipt:
                with store.transaction():
                    state['lease_at']=now()
                    store.put('state',sid,state)
                return receipt
            attach_identity(store,state,args)
            if not state['metadata'].get('agent') and getattr(args,'agent',None):
                state['metadata']['agent']=args.agent
            if getattr(args,'auth',None):
                state['metadata']['auth']=args.auth
                state['metadata']['context']['auth']=args.auth
            with store.transaction():
                state['lease_at']=now()
                store.put('state',sid,state)
                receipt=dict(v=1,session_id=sid,lifecycle='open',attached=len(state['attachments']))
                store.put('receipt',attach_key,receipt)
            return receipt
        if receipt:
            return receipt
        if state['ended_at'] is not None:
            # Retrying an alternate terminal phase must not change the outcome.
            return store.get('receipt',sid+':finish') or store.get('receipt',sid+':abandon')
        if state.get('finishing'):
            state=state['finishing']
        else:
            original=json.loads(json.dumps(state))
            attach_identity(store,state,args)
            conflicts={}
            for field in FIELDS:
                value=getattr(args,field,None)
                if value is not None:
                    if state['metadata'].get(field) not in (None,value):
                        conflicts[field]=state['metadata'][field]
                    state['metadata'][field]=value
            state['metadata_conflicts']=conflicts
            for field in ('cwd','repo_root','claude_config_dir','codex_home','cursor_projects_dir','conductor_store','auth'):
                value=getattr(args,field,None)
                if value is not None:
                    state['metadata']['context'][field]=value
            state['metadata']['model_vendor']=model_vendor(state['metadata'].get('model'))
            state['ended_at']=now()
            state['lease_at']=now()
            state['identities_at_finish']={kind:identity(store,kind,state['metadata']['context']) for kind in ('claude','codex','cursor')}
            state['outcome']='interrupted' if phase=='abandon' else 'unknown'
            # An immutable terminal timestamp survives a failed scan/commit.
            # This is lifecycle state, not a queue or background request.
            original['finishing']=state
            with store.transaction():
                store.put('state',sid,original)
        # Consumption and its receipt are committed together. Retried finishes
        # retain the first end timestamp; no acknowledgement precedes commit.
        from .index import scan
        coverage=scan(store,state['metadata']['context'])
        rows=run_rows(store,state,coverage)
        stamp=now()
        receipt=dict(v=1,session_id=sid,lifecycle='interrupted' if phase=='abandon' else 'recorded',local_persisted_at=stamp,
                     ended_at=state['ended_at'],rows=len(rows),complete=coverage['complete'])
        with store.transaction():
            store.put('state',sid,state)
            for row in rows:
                row['local_persisted_at']=stamp
                row['lifecycle']=receipt['lifecycle']
                store.put('run',json.dumps([sid,row['pool_kind'],row['pool']]),row)
            store.put('receipt',sid+':'+phase,receipt)
        return receipt


def inside(path,root):
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
        return True
    except (ValueError,TypeError,OSError):
        return False


def source_relationship(source,state,all_states,all_sources=None):
    own={a['session'] for a in state['attachments']}
    start,end=state['started_at'],state.get('ended_at') or now()
    if source.get('session') in own:
        return 'own','exact',[]
    if not own and state['metadata'].get('agent')=='cursor' and source.get('native_sdk'):
        candidates=[s for s in (all_sources or []) if s.get('native_sdk') and s.get('cwd')==state['metadata']['context']['cwd'] and
                    s.get('first') is not None and s['first']<end and (s.get('last') or end)>=start]
        if source in candidates:
            return 'own','turn' if len(candidates)==1 else 'unknown',[] if len(candidates)==1 else ['ambiguous']
    parent=source.get('parent')
    seen=set()
    while parent and parent not in own and parent not in seen:
        seen.add(parent)
        candidates=[s.get('parent') for s in (all_sources or []) if s.get('session')==parent]
        parent=candidates[0] if len(set(candidates))==1 and candidates else None
    if parent in own:
        return ('subagent' if source.get('agent')=='claude' else 'child'), 'window' if (source.get('first') or start)<start else 'exact',[]
    if source.get('first') is None or not start<=source['first']<end or not inside(source.get('cwd'),state['metadata']['context']['repo_root']):
        return None
    eligible=[s for s in all_states if s['started_at']<=source['first']<(s.get('ended_at') or now()) and
              inside(source.get('cwd'),s['metadata']['context']['repo_root'])]
    return 'child','window' if len(eligible)==1 else 'unknown', [] if len(eligible)==1 else ['ambiguous']


def run_rows(store,state,coverage):
    sid=state['session_id']
    start,end=state['started_at'],state.get('ended_at') or now()
    groups={}
    all_states=store.all('state')
    if not any(s['session_id']==sid for s in all_states):
        all_states.append(state)
    events=store.usage_between(start,end)
    all_sources=store.all('source')
    for source in all_sources:
        relation=source_relationship(source,state,all_states,all_sources)
        if not relation:
            continue
        kind,attribution,why=relation
        facts=[e for e in events if source['key'] in e.get('source_keys',[]) and start<=e['ts']<end]
        if not facts:
            continue
        agent=source.get('agent','unknown')
        if agent=='grok' and attribution=='exact':
            attribution='window'
        pool_kind=agent
        original=state['identities'].get(agent,{})
        current=state.get('identities_at_finish',{}).get(agent) or (identity(store,agent,state['metadata']['context']) if agent in ('claude','codex','cursor') else {})
        changed=original.get('pool')!=current.get('pool')
        auth=state['metadata'].get('auth') or 'unknown'
        if auth=='api' and kind=='own':
            # Keep measured tokens on an API row. Subscription intervals exclude
            # these events by source ownership, so the row must not look pending.
            pool_kind,pool='api','api'
        elif changed:
            pool='pending'
            why.append('identity_changed')
        else:
            pools={e.get('pool') for e in facts if e.get('pool') not in (None,'pending','unresolved')}
            pool=next(iter(pools)) if len(pools)==1 else original.get('pool','pending') if kind=='own' and auth=='subscription' else 'pending'
        if pool=='pending':
            why.append('identity_unknown')
        if not source.get('complete'):
            why.append(source.get('reason') or 'source_unreadable')
        if kind=='child' and state.get('ended_at') is not None and (source.get('last') or end)>end:
            why.append('outlived_stage')
        if any(e.get('boundary') or (e.get('start') is not None and e['start']<start) or (e.get('end') is not None and e['end']>end) or
               (state.get('ended_at') is not None and e.get('revised_at',end)>end) for e in facts):
            attribution='window'
            why.append('boundary')
        if len({a['session'] for a in state['attachments'] if a['agent']==agent})>1:
            attribution='window'
        entry=dict(source=source['key'],agent=agent,kind=kind,harness_session=source.get('session'),model=source.get('model'),
                   attribution=attribution,status='partial' if why or not source.get('complete') else 'ok',reason=why[0] if why else None,
                   why=why,consumption=aggregate(facts),event_ids=[e['id'] for e in facts],observed_through=max(e['ts'] for e in facts),
                   complete=source.get('complete',False),outlived_stage=(source.get('last') or end)>end,identity_evidence=source.get('identity_evidence'))
        if state.get('metadata_conflicts'):
            entry['start_metadata']=state['metadata_conflicts']
        # Each established account gets its own row, even within one session.
        fact_pools=sorted({e.get('pool') for e in facts if e.get('pool') not in (None,'pending','unresolved')})
        if len(fact_pools)>1 and not changed and auth!='api':
            for fact_pool in fact_pools:
                subset=[e for e in facts if e.get('pool')==fact_pool]
                groups.setdefault((pool_kind,fact_pool),[]).append(dict(entry,consumption=aggregate(subset),event_ids=[e['id'] for e in subset]))
        else:
            groups.setdefault((pool_kind,pool),[]).append(entry)
    agent=state['metadata'].get('agent') or 'unknown'
    if not groups:
        pool=state['identities'].get(agent,{}).get('pool','pending') if state['metadata'].get('auth')=='subscription' else 'pending'
        groups[(agent if state['metadata'].get('auth')!='api' else 'api',pool)]=[]
    rows=[]
    strengths={'exact':3,'turn':2,'window':1,'unknown':0}
    for (kind,pool),sources in groups.items():
        ids={ident for s in sources for ident in s['event_ids']}
        facts=[e for e in events if e['id'] in ids]
        row=dict(v=1,session_id=sid,pool_kind=kind,pool=pool,started_at=start,ended_at=state.get('ended_at'),
                 **{k:v for k,v in state['metadata'].items() if k not in ('context','initial_harness_session')},sources=sources,
                 consumption=aggregate(facts) if facts else None,why=[] if facts else ['no_usage'],
                 attribution=min((s['attribution'] for s in sources),key=lambda a:strengths[a],default='unknown'),
                 settlement='provisional' if kind=='cursor' else 'final',revision=1,lifecycle='open' if not state.get('ended_at') else 'recorded',
                 local_persisted_at=None,settled_at=None,
                 roots=coverage['roots'],complete=coverage['complete'] and bool(sources) and all(s['complete'] for s in sources),
                 as_of=now(),observed_through=max((s['observed_through'] for s in sources),default=None),
                 stale=now()-max(state['lease_at'],max((s['observed_through'] for s in sources),default=0))>48*3600,
                 paused=len(state['attachments'])>1,outcome=state.get('outcome'),fixture=state['fixture'])
        row['model_vendor']=model_vendor(row.get('model'))
        row['metadata_conflicts']=state.get('metadata_conflicts',{})
        row['codex_percent']=[]
        if kind=='codex':
            from .readers.codex import parse
            by_meter={}
            for source in all_sources:
                if source['key'] not in {s['source'] for s in sources}:
                    continue
                for observation in source.get('percent',[]):
                    if not start<=observation['ts']<end:
                        continue
                    try:
                        parsed,_=parse(observation['limits'])
                    except QuotaError:
                        continue
                    for meter in parsed:
                        by_meter.setdefault(meter['meter'],[]).append((observation['ts'],meter))
            from .intervals import meter_change
            for meter,observations in by_meter.items():
                observations.sort(key=lambda item:item[0])
                first,last=observations[0],observations[-1]
                row['codex_percent'].append(dict(meter=meter,window_minutes=first[1]['window_s']/60,
                    first=dict(used_percent=first[1]['used'],ts=first[0]),last=dict(used_percent=last[1]['used'],ts=last[0]),
                    flags=meter_change(first[1],last[1],first[0],last[0])))
        rows.append(row)
    return rows
