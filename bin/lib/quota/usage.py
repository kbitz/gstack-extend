"""Streaming usage normalization. Parser state is checkpointable JSON."""
from .common import CLASSES, number, timestamp


def tokens(usage, agent):
    if not isinstance(usage,dict):
        return {key:None for key in CLASSES}
    if agent=='claude':
        return dict(input=number(usage.get('input_tokens')),cache_read=number(usage.get('cache_read_input_tokens')),
                    cache_write=number(usage.get('cache_creation_input_tokens')),output=number(usage.get('output_tokens')),
                    reasoning=number((usage.get('output_tokens_details') or {}).get('thinking_tokens')))
    if agent=='codex':
        incoming=number(usage.get('input_tokens'))
        read=number(usage.get('cached_input_tokens'))
        write=number(usage.get('cache_write_input_tokens'))
        return dict(input=max(0,incoming-(read or 0)-(write or 0)) if incoming is not None else None,
                    cache_read=read,cache_write=write,output=number(usage.get('output_tokens')),reasoning=number(usage.get('reasoning_output_tokens')))
    incoming=number(usage.get('inputTokens',usage.get('input_tokens')))
    read=number(usage.get('cacheReadTokens',usage.get('cached_input_tokens')))
    write=number(usage.get('cacheWriteTokens'))
    if agent=='cursor-sdk' and incoming is not None:
        incoming=max(0,incoming-(read or 0))
    return dict(input=incoming,cache_read=read,cache_write=write,output=number(usage.get('outputTokens',usage.get('output_tokens'))),
                reasoning=number(usage.get('reasoningTokens')))


def aggregate(events):
    groups={}
    for event in events:
        model=event.get('model') or 'unknown'
        values=event.get('tokens') or {}
        current=groups.setdefault(model,{key:[] for key in CLASSES})
        for key in CLASSES:
            current[key].append(values.get(key))
    return [dict(model=model,**{key:sum(values) if values and all(v is not None for v in values) else None
                                for key,values in classes.items()},
                 why={key:['not_reported'] for key,values in classes.items() if not values or any(v is None for v in values)})
            for model,classes in sorted(groups.items())]


def parse_record(store,agent,row,state,line_index):
    """Return zero/one usage fact; mutate only normalized parser context."""
    if not isinstance(row,dict):
        return None
    ts=timestamp(row.get('timestamp',row.get('ts')))
    payload=row.get('payload') or {}
    if agent=='codex':
        if line_index==0 and row.get('type')=='session_meta':
            state.update(session=store.digest(payload.get('id',''),'session'),parent=store.digest(payload['parent_thread_id'],'session') if payload.get('parent_thread_id') else None,
                         cwd=payload.get('cwd'),first=ts)
        if row.get('type')=='turn_context':
            state.update(model=payload.get('model'),effort=payload.get('effort'))
            return None
        if payload.get('type')!='token_count' or not isinstance(payload.get('info'),dict):
            return None
        info=payload['info']
        total=info.get('total_token_usage')
        if not isinstance(total,dict) or ts is None:
            state['partial']='ordering_unknown'
            return None
        signature=store.digest([ts,total,row.get('ordinal')],'counter')
        if signature in state.get('seen',[]):
            return None
        state['seen']=(state.get('seen',[])+[signature])[-2048:]
        ordinal=row.get('ordinal')
        if isinstance(ordinal,int):
            if ordinal<=state.get('ordinal',-1):
                return None
            state['ordinal']=ordinal
        previous=state.get('total',{})
        decreased=any(number(value) is not None and number(previous.get(key)) is not None and value<previous[key] for key,value in total.items())
        if decreased:
            state['epoch']=state.get('epoch',0)+1
            previous={}
        delta={key:max(0,value-(previous.get(key) or 0)) for key,value in total.items() if number(value) is not None}
        state['total']=total
        limits=payload.get('rate_limits')
        if limits:
            state.setdefault('percent',[]).append({'ts':ts,'limits':limits})
        if not any(delta.values()):
            return None
        ident=[state.get('session'),state.get('epoch',0),ordinal if ordinal is not None else line_index]
        usage=tokens(delta,'codex')
        model=state.get('model')
    elif agent=='claude':
        message=row.get('message') or {}
        if row.get('type')!='assistant' or not isinstance(message,dict) or not isinstance(message.get('usage'),dict):
            return None
        if message.get('model')=='<synthetic>':
            return None
        ident=message.get('id') or row.get('uuid')
        if not ident or ts is None:
            state['partial']='ordering_unknown'
            return None
        usage=tokens(message['usage'],'claude')
        model=message.get('model')
        if row.get('cwd'):
            state['cwd']=row['cwd']
    elif agent=='cursor-sdk':
        if not isinstance(row.get('usage'),dict):
            return None
        ts=timestamp(row.get('endedAt') or row.get('updatedAt'))
        ident=row.get('runId')
        state['session']=store.digest(row.get('agentId',''),'session')
        usage=tokens(row['usage'],'cursor-sdk')
        model=(row.get('model') or {}).get('id')
    elif agent=='grok':
        usage=row.get('usage') or payload.get('usage')
        if not isinstance(usage,dict):
            return None
        usage=tokens(usage,'grok')
        ident=row.get('id') or row.get('request_id') or [state.get('session'),line_index]
        model=row.get('model_id') or state.get('model')
    else:
        return None
    if ts is None:
        return None
    if not isinstance(model,str) or len(model)>200 or not model.isprintable():
        model=None
    start=timestamp(row.get('started_at',row.get('startedAt')))
    end=timestamp(row.get('ended_at',row.get('endedAt')))
    state['first']=min(state.get('first') or ts,ts)
    state['last']=max(state.get('last') or ts,ts)
    return dict(id=store.digest(ident,agent+'-usage'),ts=ts,agent='cursor' if agent=='cursor-sdk' else agent,
                session=state.get('session'),parent=state.get('parent'),model=model,tokens=usage,
                start=start,end=end,boundary=False,complete=not state.get('partial'),why=[state['partial']] if state.get('partial') else [],
                turn_evidence='cursor-sdk' if agent=='cursor-sdk' and start is not None and end is not None else None)


def prefer(existing,event):
    if existing and event.get('agent')=='claude':
        if (existing['tokens'].get('output') or 0)>(event['tokens'].get('output') or 0):
            return existing
    return event
