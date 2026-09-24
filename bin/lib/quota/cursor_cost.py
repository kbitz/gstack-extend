"""Canonical Cursor facts; query-time containment never uses polling timestamps."""
import json
import time
from .common import QuotaError, budget, now, number, timestamp, config_value
from .identity import identity
from .readers import cursor
from .usage import tokens, aggregate


def record_coverage(store,pool,start,end,complete,reason=None):
    if pool not in (None,'pending','unresolved'):
        with store.transaction():
            key=store.digest([pool,start,end],'cursor-coverage')
            store.put('cursor_coverage',key,dict(pool=pool,start=start,end=end,complete=complete,reason=reason,observed_at=now()))


def ingest(store,records,complete=True):
    normalized={}
    for record in records:
        if not isinstance(record,dict):
            continue
        stamp=timestamp(record.get('timestamp'))
        charge=number(record.get('chargedCents'))
        conversation=record.get('conversationId')
        model=record.get('model')
        if stamp is None or charge is None or not isinstance(conversation,str) or not isinstance(model,str):
            continue
        pool=store.pool('cursor',record.get('owningUser'))
        session=store.digest(conversation,'session')
        provider=record.get('id') or record.get('eventId') or record.get('usageEventId')
        ident=store.digest([pool,provider] if provider else [pool,session,stamp,model],'cursor-event')
        fact=dict(id=ident,pool=pool,conversation_hash=session,event_ts=stamp,model=model,charged_cents=charge,
                  tokens=tokens(record.get('tokenUsage'),'cursor'),ambiguous=False,
                  turn_start=timestamp(record.get('turnStartedAt')),turn_end=timestamp(record.get('turnEndedAt')),
                  evidence='provider' if record.get('turnStartedAt') and record.get('turnEndedAt') else None)
        if ident in normalized and normalized[ident]!=fact:
            fact['ambiguous']=True
        normalized[ident]=fact
    with store.transaction():
        for ident,fact in normalized.items():
            old=store.get('cursor_event',ident)
            # A later page containing only one collider cannot disambiguate the
            # earlier response. Preserve that uncertainty across polling cadence.
            fact['ambiguous']=fact['ambiguous'] or bool((old or {}).get('ambiguous'))
            changed=old is None or any(old.get(k)!=v for k,v in fact.items())
            fact.update(revision=(old or {}).get('revision',0)+int(changed),last_changed_at=now() if changed else old['last_changed_at'],
                        last_read_at=now(),stable_reads=1 if changed else old.get('stable_reads',1)+1,complete=complete)
            store.put('cursor_event',ident,fact)
        store.put('cursor_coverage','latest',dict(complete=complete,observed_at=now()))
    return len(normalized)


def boundaries(store,fact):
    if fact.get('evidence'):
        return fact['turn_start'],fact['turn_end'],fact['evidence']
    candidates=[e for e in store.usage_for_session(fact['conversation_hash']) if e.get('agent')=='cursor' and
                e.get('turn_evidence') and e.get('start') is not None and e.get('end') is not None and e['start']<=fact['event_ts']<=e['end']]
    if len(candidates)==1:
        return candidates[0]['start'],candidates[0]['end'],candidates[0]['turn_evidence']
    return None,None,None


def relationships(store,states=None):
    states=states or store.all('state')
    sources=store.all('source')
    runs=store.all('run')
    from .ledger import source_relationship, source_parents, uses_api_auth
    parents=source_parents(sources)
    output=[]
    for fact in store.all('cursor_event'):
        start,end,evidence=boundaries(store,fact)
        matches=[]
        for state in states:
            sessions={a['session'] for a in state['attachments'] if a['agent']=='cursor' and state['metadata'].get('auth')!='api'}
            # Local child evidence, not presence in the account-wide feed.
            sessions.update(s['session'] for s in sources if s.get('agent')=='cursor' and
                            (relationship:=source_relationship(s,state,states,sources)) and relationship[1]!='unknown' and
                            not uses_api_auth(s,state,sources,parents))
            if fact['conversation_hash'] not in sessions:
                continue
            left,right=state['started_at'],state.get('ended_at') or now()
            overlaps=(start<right and (end is None or end>left)) if start is not None else left-6*3600<=fact['event_ts']<right+600
            if overlaps:
                matches.append(state)
        for state in matches:
            why=[]
            if fact.get('ambiguous'):
                why.append('ambiguous')
            if start is None or end is None:
                why.append('boundary_unknown')
            shared=len(matches)>1 or (start is not None and start<state['started_at']) or (end is not None and end>(state.get('ended_at') or now()))
            if shared:
                why.append('shared_turn')
            expired=state.get('ended_at') is not None and now()-state['ended_at']>=48*3600
            prior_final=any(r['session_id']==state['session_id'] and r.get('settlement')=='final' for r in runs)
            grace_ends=(state.get('ended_at') or 0)+300
            observed_after_grace=fact.get('last_read_at',0)>=grace_ends
            final=state.get('ended_at') is not None and end is not None and observed_after_grace and (fact['stable_reads']>=2 or (fact['revision']>1 and (expired or prior_final)))
            settlement='final' if final else 'expired' if expired else 'provisional'
            if settlement!='final':
                why.append('pending_settlement' if settlement=='provisional' else 'expired')
            output.append(dict(event_id=fact['id'],session_id=state['session_id'],pool=fact['pool'],model=fact['model'],
                               charged_cents=fact['charged_cents'],attributable_cents=fact['charged_cents'] if not why else None,
                               shared_cents=fact['charged_cents'] if shared and not fact['ambiguous'] else None,shared_turn=shared,
                               other_session_ids=[s['session_id'] for s in matches if s is not state],why=why,
                               turn_start=start,turn_end=end,evidence=evidence,revision=fact['revision'],settlement=settlement,
                               assumed_stable=not final and fact['stable_reads']>=2))
    return output


def decorate(store,rows):
    links=relationships(store)
    sources=store.all('source')
    expanded=[]
    existing={(r['session_id'],r['pool']) for r in rows if r['pool_kind']=='cursor'}
    added=set()
    for row in rows:
        if row['pool_kind']=='cursor':
            missing={x['pool'] for x in links if x['session_id']==row['session_id'] and x['pool']!='pending' and
                     (row['session_id'],x['pool']) not in existing|added}
            for pool in sorted(missing):
                expanded.append(dict(row,pool=pool,resolves_pending=row['pool']=='pending',sources=[],consumption=None))
                added.add((row['session_id'],pool))
        if row['pool_kind']=='cursor' and row['pool']=='pending':
            pools=sorted({x['pool'] for x in links if x['session_id']==row['session_id'] and x['pool']!='pending'})
            if pools:
                continue
        expanded.append(row)
    covered={r['session_id'] for r in expanded if r.get('pool_kind')=='cursor'}
    templates={}
    for row in rows:
        templates.setdefault(row['session_id'],row)
    for session_id,template in templates.items():
        if session_id in covered:
            continue
        for pool in sorted({x['pool'] for x in links if x['session_id']==session_id and x['pool']!='pending'}):
            expanded.append(dict(template,pool_kind='cursor',pool=pool,sources=[],consumption=None,why=[],settlement='provisional'))
    for row in expanded:
        if row['pool_kind']!='cursor':
            continue
        relevant=[link for link in links if link['session_id']==row['session_id'] and (row['pool']=='pending' or link['pool']==row['pool'])]
        row['events']=relevant
        facts={fact['id']:fact for fact in store.get_many('cursor_event',[link['event_id'] for link in relevant])}
        api_sessions={fact['conversation_hash'] for fact in facts.values()}
        # API facts replace SDK estimates for the same conversation; unavailable
        # API conversations retain their local token fallback.
        row['sources']=[s for s in row['sources'] if s.get('source')!='cursor-api2' and s.get('harness_session') not in api_sessions]
        for link in relevant:
            fact=facts[link['event_id']]
            state=store.get('state',row['session_id'])
            own={a['session'] for a in state['attachments']} if state else set()
            matching=next((s for s in sources if s.get('session')==fact['conversation_hash']),None)
            source_kind='own' if fact['conversation_hash'] in own else 'subagent' if matching and matching.get('parent') in own else 'child'
            row['sources'].append(dict(source='cursor-api2',agent='cursor',kind=source_kind,harness_session=fact['conversation_hash'],
                model=fact['model'],attribution='unknown' if fact['ambiguous'] else 'turn',
                status='ok' if not link['why'] else 'partial',reason=link['why'][0] if link['why'] else None,
                why=link['why'],consumption=aggregate([fact]),event_ids=[fact['id']],observed_through=fact['event_ts'],
                complete=fact['complete'] and not fact['ambiguous'],outlived_stage=link['shared_turn']))
        native=store.get_many('usage',{ident for s in row['sources'] if s['source']!='cursor-api2' for ident in s['event_ids']})
        usable=[fact for fact in facts.values() if not fact['ambiguous']]
        row['consumption']=aggregate(native+usable) if native or usable else None
        strengths={'exact':3,'turn':2,'window':1,'unknown':0}
        row['attribution']=min((s['attribution'] for s in row['sources']),key=lambda a:strengths[a],default='unknown')
        row['attributable_cents']=sum(x['attributable_cents'] for x in relevant if x['attributable_cents'] is not None) if any(x['attributable_cents'] is not None for x in relevant) else None
        row['shared_cents']=sum(x['shared_cents'] for x in relevant if x['shared_cents'] is not None) if any(x['shared_cents'] is not None for x in relevant) else None
        row['revision']=max((x['revision'] for x in relevant),default=row.get('revision',1))
        expired=row.get('ended_at') is not None and now()-row['ended_at']>=48*3600
        row['settlement']='final' if relevant and all(x['settlement']=='final' for x in relevant) else 'expired' if expired and (not relevant or any(x['settlement']!='final' for x in relevant)) else 'provisional'
        if row['settlement']=='final':
            row['lifecycle']='settled'
            row['settled_at']=max((f['last_read_at'] for f in facts.values()),default=None)
        elif row['settlement']=='expired':
            row['lifecycle']='expired'
            row['settled_at']=None
        else:
            row['settled_at']=None
        row['why']=sorted(set([why for why in row.get('why',[]) if why not in ('expired','pending_settlement') and (why!='no_usage' or not facts)]+[why for x in relevant for why in x['why']]+(['expired'] if row['settlement']=='expired' else [])))
    return expanded


def settle(store,context,pool=None,since=None):
    if pool and pool.split(':')[0]!='cursor':
        return dict(v=1,updated=0,complete=True)
    evidence=identity(store,'cursor',context)
    if pool and ':' in pool and evidence['pool']!=pool:
        return dict(v=1,updated=0,complete=False,reason='identity_unknown')
    states=store.all('state')
    sources=store.all('source')
    from .ledger import source_relationship
    def cursor_linked(state):
        if any(a['agent']=='cursor' for a in state['attachments']):
            return True
        return any(s.get('agent')=='cursor' and source_relationship(s,state,states,sources) for s in sources)
    states=[s for s in states if cursor_linked(s)]
    if since is not None:
        states=[s for s in states if (s.get('ended_at') or now())>=since]
    left=min((s['started_at'] for s in states),default=now())-6*3600
    right=max((s.get('ended_at') or now() for s in states),default=now())+600
    deadline=time.monotonic()+budget(60)
    try:
        with store.lock('sample:cursor',deadline):
            if 'cursor' not in [p.strip() for p in config_value(store.root,'quota_pools','claude,codex,cursor').split(',')]:
                raise QuotaError('disabled')
            if context.get('sandboxed'):
                raise QuotaError('sandboxed')
            backoff=store.get('backoff',evidence['fingerprint'],{})
            if backoff.get('retry_at',0)>now():
                raise QuotaError('http_429',retry_at=backoff['retry_at'])
            records,complete,_=cursor.events(store,deadline,left,right)
            if pool and ':' in pool:
                records=[r for r in records if store.pool('cursor',r.get('owningUser'))==pool]
            count=ingest(store,records,complete)
            pools={store.pool('cursor',r.get('owningUser')) for r in records if isinstance(r,dict)} or {evidence['pool']}
            for observed_pool in pools:
                record_coverage(store,observed_pool,left,right,complete)
    except QuotaError as error:
        record_coverage(store,evidence['pool'],left,right,False,error.code)
        if error.code=='http_429':
            with store.transaction():
                store.put('backoff',evidence['fingerprint'],dict(retry_at=error.retry_at or now()+300))
        return dict(v=1,updated=0,complete=False,reason=error.code)
    rows=decorate(store,store.all('run'))
    with store.transaction():
        for row in rows:
            if row['pool_kind']=='cursor':
                row['settled_at']=now() if row['settlement']=='final' else row.get('settled_at')
                store.put('run',json.dumps([row['session_id'],row['pool_kind'],row['pool']]),row)
    return dict(v=1,updated=count,complete=complete)
