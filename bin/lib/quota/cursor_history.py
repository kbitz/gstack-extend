"""Read-only projection of Cursor facts already saved in the quota store."""
from collections import defaultdict

from .common import now
from .ledger import source_parents, source_relationship, uses_api_auth
from .usage import aggregate


def boundaries(store, fact):
    if fact.get('evidence'):
        return fact['turn_start'], fact['turn_end'], fact['evidence']
    candidates = [event for event in store.usage_for_session(fact['conversation_hash'])
                  if event.get('agent') == 'cursor' and event.get('turn_evidence')
                  and event.get('start') is not None and event.get('end') is not None
                  and event['start'] <= fact['event_ts'] <= event['end']]
    if len(candidates) == 1:
        event = candidates[0]
        return event['start'], event['end'], event['turn_evidence']
    return None, None, None


def _expired(row, at):
    return row.get('ended_at') is not None and at - row['ended_at'] >= 48 * 3600


def _relationships(store, facts, sources, at):
    states = store.all('state')
    parents = source_parents(sources)
    cursor_sources = [source for source in sources if source.get('agent') == 'cursor']
    owners = defaultdict(list)
    excluded = set()
    for state in states:
        sid = state['session_id']
        attached = {a['session'] for a in state['attachments']}
        cursor_attached = {a['session'] for a in state['attachments'] if a['agent'] == 'cursor'}
        known = set()
        if state['metadata'].get('auth') == 'api':
            excluded.update((sid, session) for session in cursor_attached)
        else:
            known = cursor_attached
            for session in known:
                owners[session].append((state, 'own'))
        for source in cursor_sources:
            session = source.get('session')
            if not session or session in known:
                continue
            relationship = source_relationship(source, state, states, sources)
            if not relationship:
                continue
            if relationship[1] == 'unknown' or uses_api_auth(source, state, sources, parents):
                excluded.add((sid, session))
                continue
            kind = 'own' if session in attached else 'subagent' if source.get('parent') in attached else 'child'
            owners[session].append((state, kind))
            known.add(session)

    final_sessions = {row['session_id'] for row in store.all('run') if row.get('settlement') == 'final'}
    links = defaultdict(list)
    for fact in facts:
        candidates = owners.get(fact['conversation_hash'], ())
        if not candidates:
            continue
        start, end, evidence = boundaries(store, fact)
        matches = []
        for state, kind in candidates:
            left, right = state['started_at'], state.get('ended_at') or at
            overlaps = (start < right and (end is None or end > left)) if start is not None else (
                left - 6 * 3600 <= fact['event_ts'] < right + 600)
            if overlaps:
                matches.append((state, kind, left, right))
        for state, kind, left, right in matches:
            sid = state['session_id']
            shared = len(matches) > 1 or (start is not None and start < left) or (end is not None and end > right)
            stable = fact['stable_reads'] >= 2
            expired = _expired(state, at)
            revised = fact['revision'] > 1 and (expired or sid in final_sessions)
            final = state.get('ended_at') is not None and end is not None and fact.get('last_read_at', 0) >= right + 300 and (stable or revised)
            settlement = 'final' if final else 'expired' if expired else 'provisional'
            why = []
            if fact['ambiguous']:
                why.append('ambiguous')
            if start is None or end is None:
                why.append('boundary_unknown')
            if shared:
                why.append('shared_turn')
            if not final:
                why.append('expired' if expired else 'pending_settlement')
            charge = fact['charged_cents']
            link = dict(event_id=fact['id'], session_id=sid, pool=fact['pool'], model=fact['model'], charged_cents=charge,
                        attributable_cents=charge if not why else None,
                        shared_cents=charge if shared and not fact['ambiguous'] else None, shared_turn=shared,
                        other_session_ids=[peer['session_id'] for peer, *_ in matches if peer is not state], why=why,
                        turn_start=start, turn_end=end, evidence=evidence, revision=fact['revision'],
                        settlement=settlement, assumed_stable=not final and stable)
            links[sid, fact['pool']].append((fact, link, kind))
    return links, excluded


def _project(store, row, observed, at):
    events = [link for _, link, _ in observed]
    sessions = {fact['conversation_hash'] for fact, _, _ in observed}
    sources = [source for source in row['sources'] if source.get('source') != 'cursor-api2'
               and source.get('harness_session') not in sessions]
    native_ids = {event_id for source in sources for event_id in source['event_ids']}
    facts = store.get_many('usage', native_ids) + [fact for fact, _, _ in observed if not fact['ambiguous']]
    for fact, link, kind in observed:
        why = link['why']
        sources.append(dict(source='cursor-api2', agent='cursor', kind=kind, harness_session=fact['conversation_hash'],
                            model=fact['model'], attribution='unknown' if fact['ambiguous'] else 'turn',
                            status='partial' if why else 'ok', reason=why[0] if why else None, why=why,
                            consumption=aggregate([fact]), event_ids=[fact['id']], observed_through=fact['event_ts'],
                            complete=fact['complete'] and not fact['ambiguous'], outlived_stage=link['shared_turn']))
    final = bool(events) and all(event['settlement'] == 'final' for event in events)
    expired = _expired(row, at)
    why = set(row.get('why', [])) - {'expired', 'pending_settlement', 'no_usage'}
    why.update(reason for event in events for reason in event['why'])
    if not sources:
        why.add('no_usage')
    if expired and not final:
        why.add('expired')
    strengths = {'exact': 3, 'turn': 2, 'window': 1, 'unknown': 0}
    attributable = [event['attributable_cents'] for event in events if event['attributable_cents'] is not None]
    shared = [event['shared_cents'] for event in events if event['shared_cents'] is not None]
    lifecycle = row['lifecycle']
    if lifecycle == 'settled':
        lifecycle = 'interrupted' if row.get('outcome') == 'interrupted' else 'recorded'
    return dict(row, events=events, sources=sources, consumption=aggregate(facts) if facts else None,
                attribution=min((source['attribution'] for source in sources), key=strengths.__getitem__, default='unknown'),
                attributable_cents=sum(attributable) if attributable else None, shared_cents=sum(shared) if shared else None,
                revision=max((event['revision'] for event in events), default=row.get('revision', 1)),
                settlement='final' if final else 'expired' if expired else 'provisional',
                lifecycle='settled' if final else 'expired' if expired else lifecycle,
                settled_at=max((fact.get('last_read_at', 0) for fact, _, _ in observed)) if final else None,
                why=sorted(why))


def _retain_unlinked(store, row, native, observed, facts, excluded, at):
    linked = {link['event_id'] for _, link, _ in observed}
    sources = {event_id: source for source in row['sources'] if source.get('source') == 'cursor-api2'
               for event_id in source['event_ids']}
    retained = list(observed)
    window = native or row
    for event in row.get('events', []):
        event_id = event['event_id']
        if event_id in linked:
            continue
        fact = facts.get(event_id)
        if not fact:
            return None  # The saved row remains readable even if its raw facts are missing.
        if fact['ambiguous'] or (row['session_id'], fact['conversation_hash']) in excluded:
            continue
        if fact['revision'] > event.get('revision', fact['revision']):
            start, end, _ = boundaries(store, fact)
            if start is not None and end is not None and (end <= window['started_at'] or start >= (window.get('ended_at') or at)):
                continue
        retained.append((fact, event, sources.get(event_id, {}).get('kind', 'own')))
    return retained


def _keep_snapshot(row, native, observed):
    saved = {event['event_id']: event for event in row.get('events', [])}
    if not saved:
        return not observed
    linked = {link['event_id'] for _, link, _ in observed}
    if row['settlement'] != 'final' or saved.keys() != linked:
        return False
    completeness = {event_id: source.get('complete') for source in row['sources'] if source.get('source') == 'cursor-api2'
                    for event_id in source['event_ids']}
    for fact, link, _ in observed:
        event_id = link['event_id']
        earlier = saved[event_id]
        if (any(earlier[field] != link[field] for field in earlier.keys() & link.keys())
                or (fact['complete'] and not fact['ambiguous']) != completeness.get(event_id)):
            return False
    billed = {fact['conversation_hash'] for fact, _, _ in observed}
    return not native or all(source in row['sources'] for source in native['sources']
                             if source.get('harness_session') not in billed)


def project_runs(store, rows, native_rows):
    at = now()
    facts = store.all('cursor_event')
    links, excluded = _relationships(store, facts, store.all('source'), at) if facts else ({}, set())
    by_id = {fact['id']: fact for fact in facts}
    cursor_rows = {(row['session_id'], row['pool']): row for row in rows if row['pool_kind'] == 'cursor'}
    templates = {}
    for row in rows:
        template = templates.setdefault(row['session_id'], row)
        if row['pool_kind'] == 'cursor' and (template['pool_kind'] != 'cursor' or row['pool'] == 'pending'):
            templates[row['session_id']] = row
    projected = {}
    for sid, pool in dict.fromkeys((*links, *cursor_rows)):
        if sid not in templates:
            continue
        key = sid, pool
        observed = links.get(key, ())
        previous = cursor_rows.get(key)
        native = native_rows.get(key)
        if previous:
            observed = _retain_unlinked(store, previous, native, observed, by_id, excluded, at)
            if observed is None or _keep_snapshot(previous, native, observed):
                continue
        if pool == 'pending' and not previous:
            continue
        template = templates[sid]
        base = native or previous or dict(
            template, pool_kind='cursor', pool=pool, sources=[], why=[],
            resolves_pending=template['pool_kind'] == 'cursor' and template['pool'] == 'pending')
        row = _project(store, base, observed, at)
        if previous and previous['settlement'] == row['settlement'] == 'final':
            revisions = {event['event_id']: event.get('revision') for event in previous.get('events', [])}
            if revisions == {event['event_id']: event['revision'] for event in row['events']}:
                row['settled_at'] = previous.get('settled_at') or row['settled_at']
        projected[key] = row

    result = []
    for row in rows:
        if row['pool_kind'] == 'cursor':
            key = (row['session_id'], row['pool'])
            row = projected.pop(key, row)
            if row['settlement'] == 'provisional' and _expired(row, at):
                row = dict(row, settlement='expired', lifecycle='expired', settled_at=None,
                           why=sorted((set(row.get('why', [])) - {'pending_settlement'}) | {'expired'}))
        result.append(row)
    return result + list(projected.values())
