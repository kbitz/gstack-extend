from .common import KINDS, now
from .usage import aggregate


def activity_groups(store,sessions):
    """Known children and attached sessions are one local activity family."""
    from .ledger import source_relationship
    sources=[s for s in store.all('source') if s.get('agent')!='cursor']
    states=store.all('state')
    parents={session:session for session in sessions if session}
    def find(value):
        parents.setdefault(value,value)
        while parents[value]!=value:
            value=parents[value]
        return value
    def join(left,right):
        if left and right:
            parents[find(left)]=find(right)
    for source in sources:
        join(source.get('session'),source.get('parent'))
    for state in states:
        attached=[a['session'] for a in state['attachments'] if a['agent']!='cursor']
        if not attached:
            continue
        for session in attached[1:]:
            join(session,attached[0])
        for source in sources:
            relationship=source_relationship(source,state,states,sources)
            if relationship and relationship[1]!='unknown':
                join(source.get('session'),attached[0])
    return {find(session) for session in sessions if session}


def meter_change(before,after,left,right):
    old,new=before.get('resets_at'),after.get('resets_at')
    moved=old is not None and new is not None and abs(new-old)>60
    rolled=(before['meter'].startswith('codex:') and before.get('window_s')==604800 and before['used']==after['used']==0 and
            moved and abs((new-old)-(right-left))<=60)
    reset=not rolled and (after['used']<before['used'] or moved or (old is not None and left<old<=right))
    change=after['used']-before['used']
    below=after.get('resolution') is not None and abs(change)<after['resolution']
    why=['window_rolled'] if rolled else ['reset_crossed'] if reset else ['below_resolution'] if below else []
    return dict(meter=after['meter'],change=None if reset or rolled else change,reset_crossed=reset,window_rolled=rolled,
                below_resolution=below,why=why,resolution=after.get('resolution'))


def interval(store,before,after,coverage):
    left,right=before['observed_at'],after['observed_at'] if after else now()
    pool=before['pool']
    all_events=[e for e in store.usage_between(left,right) if e.get('agent')!='cursor']
    from .ledger import uses_api_auth, source_parents
    sources=[s for s in store.all('source') if s.get('agent')!='cursor']
    parents=source_parents(sources)
    api_ids=set()
    for state in store.all('state'):
        if state.get('metadata',{}).get('auth')!='api':
            continue
        start,end=state['started_at'],state.get('ended_at') or right
        owned=[s['key'] for s in sources if uses_api_auth(s,state,sources,parents)]
        api_ids.update(e['id'] for e in all_events if start<=e.get('ts',start)<end and any(key in e.get('source_keys',[]) for key in owned))
    facts=[e for e in all_events if e.get('pool')==pool and e['id'] not in api_ids]
    unresolved=[e for e in all_events if e.get('pool') in ('unresolved','pending') and e['agent']==before['pool_kind'] and e['id'] not in api_ids]
    complete=coverage['complete'] and not unresolved and pool!='pending'
    previous={m['meter']:m for m in before['meters']}
    changes=[]
    if after:
        for meter in after['meters']:
            if meter['meter'] in previous:
                changes.append(meter_change(previous[meter['meter']],meter,left,right))
            else:
                changes.append(dict(meter=meter['meter'],change=None,why=['no_before_sample']))
    boundary=sum(bool(e.get('boundary') or (e.get('start') is not None and e['start']<left) or
                      (e.get('end') is not None and e['end']>right) or e.get('first_seen_at',right)>right or
                      e.get('revised_at',right)>right) for e in facts)
    why=[] if complete else ['incomplete']
    if unresolved:
        why.append('identity_unknown')
    if boundary:
        why.append('boundary')
    return dict(pool=pool,pool_kind=before['pool_kind'],before_sample_id=before['sample_id'],after_sample_id=after['sample_id'] if after else None,
                started_at=left,ended_at=right,meters=changes,consumption=aggregate(facts) if facts else [] if complete else None,
                event_count=len(facts) if complete or facts else None,
                charged_cents=None,
                observed_charged_cents=None,
                calibration_eligible=complete and not boundary and not any(m.get('reset_crossed') or m.get('window_rolled') for m in changes),
                complete=complete,why=why,as_of=now(),roots=coverage['roots'],uncovered_roots=coverage['uncovered_roots'],
                unresolved_events=len(unresolved),boundary_events=boundary,
                remote_unobservable=before['pool_kind'] in ('claude','codex'),concurrent=len(activity_groups(store,{e.get('session') for e in facts}))>1)


def intervals(store,coverage):
    previous={}
    result=[]
    for row in sorted(store.all('sample'),key=lambda r:r['observed_at']):
        if row['status']!='ok' or row['pool']=='pending' or row['pool_kind'] not in KINDS:
            continue
        if row['pool'] in previous:
            result.append(interval(store,previous[row['pool']],row,coverage))
        previous[row['pool']]=row
    return result
