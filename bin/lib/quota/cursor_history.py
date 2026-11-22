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
    for state in states:
        attached = {a['session'] for a in state['attachments']}
        known = set()
        if state['metadata'].get('auth') != 'api':
            known = {a['session'] for a in state['attachments'] if a['agent'] == 'cursor'}
            for session in known:
                owners[session].append((state, 'own'))
        for source in cursor_sources:
            session = source.get('session')
            if not session or session in known:
                continue
            relationship = source_relationship(source, state, states, sources)
            if relationship and relationship[1] != 'unknown' and not uses_api_auth(source, state, sources, parents):
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
    return links


def _project(store, row, observed):
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
    final = all(event['settlement'] == 'final' for event in events)
    expired = any(event['settlement'] == 'expired' for event in events)
    why = set(row.get('why', [])) - {'expired', 'pending_settlement', 'no_usage'}
    why.update(reason for event in events for reason in event['why'])
    strengths = {'exact': 3, 'turn': 2, 'window': 1, 'unknown': 0}
    attributable = [event['attributable_cents'] for event in events if event['attributable_cents'] is not None]
    shared = [event['shared_cents'] for event in events if event['shared_cents'] is not None]
    return dict(row, events=events, sources=sources, consumption=aggregate(facts) if facts else None,
                attribution=min((source['attribution'] for source in sources), key=strengths.__getitem__),
                attributable_cents=sum(attributable) if attributable else None, shared_cents=sum(shared) if shared else None,
                revision=max(event['revision'] for event in events),
                settlement='final' if final else 'expired' if expired else 'provisional',
                lifecycle='settled' if final else 'expired' if expired else row['lifecycle'],
                settled_at=max((fact.get('last_read_at', 0) for fact, _, _ in observed)) if final else None,
                why=sorted(why))


def project_runs(store, rows):
    at = now()
    facts = store.all('cursor_event')
    links = _relationships(store, facts, store.all('source'), at) if facts else {}
    cursor_rows = {(row['session_id'], row['pool']): row for row in rows if row['pool_kind'] == 'cursor'}
    templates = {}
    for row in rows:
        template = templates.setdefault(row['session_id'], row)
        if row['pool_kind'] == 'cursor' and (template['pool_kind'] != 'cursor' or row['pool'] == 'pending'):
            templates[row['session_id']] = row
    projected = {}
    for (sid, pool), observed in links.items():
        if sid not in templates:
            continue
        previous = cursor_rows.get((sid, pool))
        if previous and previous.get('settlement') == 'final':
            # Preserve the settled snapshot unless the stored facts can explain
            # every old event and also contain an addition or later revision.
            recorded = {event['event_id']: event for event in previous.get('events', [])}
            current = {link['event_id']: link for _, link, _ in observed}
            if not recorded.keys() <= current.keys() or not any(
                    event_id not in recorded or event['revision'] > recorded[event_id].get('revision', event['revision'])
                    for event_id, event in current.items()):
                continue
        if pool == 'pending' and not previous:
            continue
        template = templates[sid]
        projected[sid, pool] = _project(store, previous or dict(
            template, pool_kind='cursor', pool=pool, sources=[], why=[], resolves_pending=template['pool'] == 'pending'), observed)

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
