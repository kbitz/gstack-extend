"""Incremental inventory and usage index with explicit scan coverage."""
import json
import os
from pathlib import Path
import re
import stat
import time
from .common import budget, now
from .identity import identity, bind
from .usage import parse_record, prefer

BYTE_BUDGET=50 << 20
FILE_CAP=512 << 20


def roots(context):
    return [('claude',str(Path(context['claude_config_dir'])/'projects')),
            ('codex',str(Path(context['codex_home'])/'sessions')),
            ('cursor',context['cursor_projects_dir']),('cursor-sdk',context['conductor_store']),
            ('grok',str(Path(context['grok_home'])/'sessions'))]


def discover(store,context):
    deadline=time.monotonic()+budget(.5)
    reports=[]
    operations=0
    for agent,root in roots(context):
        key=store.digest([agent,root],'root')
        inventory=store.get('inventory',key,{'root':root,'agent':agent,'queue':[root],'complete':False})
        if inventory.get('complete'):
            inventory['queue']=[root]
        pending=inventory['queue']
        failed=[]
        while pending and time.monotonic()<deadline and operations<5000:
            item=pending.pop(0)
            directory=item['path'] if isinstance(item,dict) else item
            skip=item.get('offset',0) if isinstance(item,dict) else 0
            try:
                info=os.stat(directory,follow_symlinks=False)
                if not stat.S_ISDIR(info.st_mode) or not info.st_mode & 0o444:
                    raise OSError('unreadable')
                with os.scandir(directory) as entries:
                    for position,entry in enumerate(entries):
                        if position<skip:
                            continue
                        if operations>=5000 or time.monotonic()>=deadline:
                            pending.insert(0,dict(path=directory,offset=position))
                            break
                        operations+=1
                        if entry.is_symlink():
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            pending.append(entry.path)
                        elif entry.is_file(follow_symlinks=False) and (entry.name.endswith('.jsonl') or entry.name=='runs.ndjson' or
                                (agent=='cursor' and entry.name.endswith('.txt') and 'agent-transcripts' in Path(entry.path).parts)):
                            filekey=store.digest(entry.path,'file')
                            previous=store.get('file',filekey,{})
                            previous.update(key=filekey,path=entry.path,root=root,agent=agent,discovered_at=previous.get('discovered_at',now()))
                            store.put('file',filekey,previous)
            except OSError:
                failed.append(directory)
        inventory.update(queue=pending,complete=not pending and not failed,uncovered=failed or ([root] if pending else []),as_of=now())
        if failed:
            inventory['queue'].extend(failed)
        store.put('inventory',key,inventory)
        reports.append(dict(root=root,agent=agent,complete=inventory['complete'],why=['source_unreadable'] if failed else ['scan_budget'] if pending else []))
    return reports,operations


def source_state(store,file,context):
    path=Path(file['path'])
    agent=file['agent']
    state=dict(file.get('parser') or {})
    if not state:
        if agent=='claude':
            parent=path.parent.parent.name if path.parent.name=='subagents' else None
            session=path.stem
        elif agent=='cursor':
            session=path.stem.removeprefix('agent-') if path.parent.name in ('agent-transcripts','subagents') else path.parent.name
            parent=path.parent.parent.name if path.parent.name=='subagents' else None
        elif agent=='grok':
            session,parent=path.parent.name,None
        else:
            session,parent=None,None
        state.update(session=store.digest(session,'session') if session else None,parent=store.digest(parent,'session') if parent else None)
        if agent=='cursor':
            slug=re.sub(r'[^a-zA-Z0-9]','-',context['cwd']).strip('-')
            if slug in path.parts:
                state['cwd']=context['cwd']
    return state


def paying_pool(history,stamp):
    for period in reversed(history.get('periods',[])):
        if period['start']<=stamp and (period['end'] is None or stamp<period['end']):
            return period['pool'] if period['pool']!='pending' else 'unresolved'
    return 'unresolved'


def scan(store,context):
    histories={}
    with store.transaction():
        for kind in ('claude','codex','cursor'):
            histories[kind]=bind(store,kind,context,identity(store,kind,context))
        reports,operations=discover(store,context)
    deadline=time.monotonic()+budget(2)
    read_bytes,malformed=0,0
    active_roots={r['root'] for r in reports}
    files=sorted((f for f in store.all('file') if f['root'] in active_roots),key=lambda f:f.get('checked_at',0))
    for file in files:
        if time.monotonic()>=deadline or read_bytes>=BYTE_BUDGET:
            break
        path=Path(file['path'])
        try:
            fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o444:
                os.close(fd)
                raise OSError('unreadable')
            generation=[info.st_dev,info.st_ino]
            if file.get('identity')!=generation or info.st_size<file.get('offset',0):
                file.update(offset=0,line=0,parser={},identity=generation,malformed=0,skip_line=False)
            state=source_state(store,file,context)
            identity_kind='cursor' if file['agent']=='cursor-sdk' else file['agent']
            if identity_kind in ('claude','codex','cursor'):
                state['identity_evidence']=identity(store,identity_kind,context)
            sdk_agents={}
            if file['agent']=='cursor-sdk':
                agents=path.with_name('agents.ndjson')
                try:
                    afd=os.open(agents, os.O_RDONLY|os.O_NOFOLLOW)
                    try:
                        ainfo=os.fstat(afd)
                        if stat.S_ISREG(ainfo.st_mode) and ainfo.st_nlink==1 and ainfo.st_size<=1 << 20:
                            for raw in os.read(afd, ainfo.st_size).splitlines():
                                try:
                                    record=json.loads(raw)
                                    if record.get('agentId') and record.get('cwd'):
                                        sdk_agents[store.digest(record['agentId'],'session')]=record['cwd']
                                except (ValueError,AttributeError):
                                    continue
                    finally:
                        os.close(afd)
                except OSError:
                    pass
            if not state.get('first') and file['agent']=='cursor':
                state['first']=getattr(info,'st_birthtime',info.st_mtime)
            offset,line=file.get('offset',0),file.get('line',0)
            facts={}
            with os.fdopen(fd,'rb') as stream:
                stream.seek(offset)
                while stream.tell()<min(info.st_size,FILE_CAP) and time.monotonic()<deadline and read_bytes<BYTE_BUDGET:
                    if file['agent']=='cursor' and path.suffix=='.txt':
                        # Text transcripts establish local identity/creation,
                        # but contain no structured token or turn-end evidence.
                        raw=stream.read(min(1 << 20,BYTE_BUDGET-read_bytes,FILE_CAP-stream.tell()))
                        read_bytes+=len(raw)
                        offset=stream.tell()
                        continue
                    if file.get('skip_line'):
                        if stream.tell()>=info.st_size or stream.tell()>=FILE_CAP:
                            file['skip_line']=False
                            offset=stream.tell()
                            malformed+=1
                            file['malformed']=file.get('malformed',0)+1
                            line+=1
                            continue
                        found=False
                        while stream.tell()<min(info.st_size,FILE_CAP) and read_bytes<BYTE_BUDGET and time.monotonic()<deadline:
                            room=BYTE_BUDGET-read_bytes
                            more=stream.read(min(1 << 20, room))
                            read_bytes+=len(more)
                            if not more:
                                break
                            newline=more.find(b'\n')
                            if newline>=0:
                                overshoot=len(more)-newline-1
                                if overshoot:
                                    stream.seek(stream.tell()-overshoot)
                                found=True
                                break
                        offset=stream.tell()
                        if not found:
                            break
                        file['skip_line']=False
                        malformed+=1
                        file['malformed']=file.get('malformed',0)+1
                        line+=1
                        continue
                    raw=stream.readline(min(1 << 20,max(0,BYTE_BUDGET-read_bytes)))
                    read_bytes+=len(raw)
                    if not raw.endswith(b'\n'):
                        # A short read is an incomplete tail. Only a full 1 MiB
                        # chunk without a newline is an oversized record.
                        if len(raw)<1 << 20 or stream.tell()>=info.st_size or stream.tell()>=FILE_CAP:
                            break
                        file['skip_line']=True
                        offset=stream.tell()
                        continue
                    offset=stream.tell()
                    try:
                        record=json.loads(raw)
                    except ValueError:
                        malformed+=1
                        file['malformed']=file.get('malformed',0)+1
                        line+=1
                        continue
                    try:
                        fact=parse_record(store,file['agent'],record,state,line)
                    except (TypeError,ValueError,AttributeError,KeyError):
                        malformed+=1
                        file['malformed']=file.get('malformed',0)+1
                        line+=1
                        continue
                    line+=1
                    if fact:
                        if file['agent']=='cursor-sdk':
                            state['cwd']=sdk_agents.get(fact['session'])
                            start_at=fact.get('start') or fact['ts']
                            end_at=fact.get('end') or fact['ts']
                            bounds=state.setdefault('bounds',{})
                            slot=bounds.setdefault(fact['session'],{})
                            slot['first']=start_at if slot.get('first') is None else min(slot['first'],start_at)
                            slot['last']=end_at if slot.get('last') is None else max(slot['last'],end_at)
                            state['first'],state['last']=slot['first'],slot['last']
                        kind='cursor' if file['agent']=='cursor-sdk' else file['agent']
                        fact['pool']=paying_pool(histories.get(kind,{}),fact['ts'])
                        sourcekey=file['key']+(':'+str(fact['session']) if file['agent']=='cursor-sdk' else '')
                        old=facts[fact['id']][0] if fact['id'] in facts else store.get('usage',fact['id'])
                        fact['source_keys']=sorted(set((old or {}).get('source_keys',[])+[sourcekey]))
                        selected=prefer(old,fact)
                        selected['source_keys']=fact['source_keys']
                        selected['first_seen_at']=(old or {}).get('first_seen_at',now())
                        changed=not old or old.get('tokens')!=selected.get('tokens')
                        selected['revised_at']=now() if changed else old.get('revised_at',now())
                        snapshot={k:v for k,v in state.items() if k!='bounds'}
                        facts[fact['id']]=(selected,sourcekey,snapshot)
            file.update(offset=offset,line=line,parser=state,size=info.st_size,checked_at=now(),
                        complete=offset>=info.st_size and info.st_size<=FILE_CAP and not file.get('malformed') and not state.get('partial'))
            reason='log_too_large' if info.st_size>FILE_CAP else 'malformed_record' if file.get('malformed') else 'scan_budget' if offset<info.st_size else state.get('partial')
            if file['agent']=='cursor' and path.suffix=='.txt' and reason is None:
                file['complete']=False
                reason='not_reported'
            file['reason']=reason
            with store.transaction():
                for fact,sourcekey,metadata in facts.values():
                    store.put('usage',fact['id'],fact)
                    source=dict(metadata,key=sourcekey,agent='cursor' if file['agent']=='cursor-sdk' else file['agent'],
                                root=file['root'],complete=file['complete'],reason=reason,native_sdk=file['agent']=='cursor-sdk')
                    store.put('source',sourcekey,source)
                if file['agent']!='cursor-sdk':
                    store.put('source',file['key'],dict(state,key=file['key'],agent=file['agent'],root=file['root'],complete=file['complete'],reason=reason))
                else:
                    prefix=file['key']+':'
                    for existing in store.all('source'):
                        if str(existing.get('key','')).startswith(prefix):
                            existing['complete']=file['complete']
                            existing['reason']=reason
                            store.put('source',existing['key'],existing)
                store.put('file',file['key'],file)
        except OSError:
            file.update(complete=False,reason='source_unreadable',checked_at=now())
            with store.transaction():
                store.put('file',file['key'],file)
    indexed=[f for f in store.all('file') if f['root'] in active_roots]
    for report in reports:
        bad=[f for f in indexed if f['root']==report['root'] and not f.get('complete')]
        if bad:
            report['complete']=False
            report['why']=sorted(set(report['why']+[f.get('reason') or 'scan_budget' for f in bad]))
    unresolved=store.unresolved_count()
    return dict(complete=all(r['complete'] for r in reports),roots=reports,bytes_read=read_bytes,discovery_operations=operations,
                uncovered_roots=[r['root'] for r in reports if not r['complete']],unresolved_events=unresolved,as_of=now())
