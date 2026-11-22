"""Quota scenarios. This process must never inherit a live credential."""
import copy
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'bin/lib'))
from quota.common import QuotaError, context_from, vendor_binary, now
from quota.cli import parser
from quota.store import Store
from quota import usage, ledger, intervals
from quota.index import scan
from quota.readers import claude, codex
from telemetry import harness_ancestor, claude_logs, codex_logs, grok_logs, parse_ts, valid_session, which, executable, config_enabled, config_value

assert os.environ.get('GSTACK_EXTEND_QUOTA_FIXTURES'), 'Fixture mode required'
for binary in ('claude','codex','security'):
    try:
        resolved=vendor_binary(binary)
        assert Path(resolved).parent==Path(os.environ['GSTACK_EXTEND_QUOTA_FIXTURES'])/'bin'
    except QuotaError as error:
        assert error.code=='missing_executable'


class QuotaTests(unittest.TestCase):
    def setUp(self):
        self.dir=Path(tempfile.mkdtemp(prefix='quota-case-'))
        self.old=dict(os.environ)
        self.home=self.dir/'home'
        self.home.mkdir()
        self.fixtures=self.dir/'fixtures'
        shutil.copytree(ROOT/'tests/fixtures/quota',self.fixtures)
        (self.fixtures/'bin').mkdir()
        os.environ.update(HOME=str(self.home),GSTACK_EXTEND_STATE_DIR=str(self.dir/'state'),GSTACK_EXTEND_QUOTA_FIXTURES=str(self.fixtures),GSTACK_EXTEND_QUOTA_NOW='2026-09-23T12:00:00Z')
        for path in ('.claude/projects','.codex/sessions','.grok/sessions'):
            (self.home/path).mkdir(parents=True,exist_ok=True)
        self.store=Store(self.dir/'state')
        self.args=parser().parse_args(['sample','--session-id','run-a','--phase','start','--agent','claude','--auth','subscription','--harness-session','session-a'])
        self.context=context_from(self.args)

    def tearDown(self):
        self.store.close()
        os.environ.clear()
        os.environ.update(self.old)
        shutil.rmtree(self.dir)

    def advance(self,seconds):
        os.environ['GSTACK_EXTEND_QUOTA_NOW']=str(now()+seconds)

    def command(self,*args):
        return subprocess.run([str(ROOT/'bin/gstack-extend'),'quota',*args,'--json'],capture_output=True,text=True,timeout=10)

    def write_claude(self,output=3,ident='message-a',stamp='2026-09-23T12:00:10Z',session='session-a'):
        path=self.home/'.claude/projects/project'/f'{session}.jsonl'
        path.parent.mkdir(parents=True,exist_ok=True)
        row=dict(type='assistant',timestamp=stamp,cwd=self.context['cwd'],message=dict(id=ident,model='claude-fixture',usage=dict(input_tokens=10,cache_read_input_tokens=20,cache_creation_input_tokens=2,output_tokens=output)))
        with path.open('a') as stream:
            stream.write(json.dumps(row)+'\n')
        return path

    def test_lifecycle_receipts_and_conflicts(self):
        started=ledger.lifecycle(self.store,self.args,self.context)
        self.assertEqual(started,ledger.lifecycle(self.store,self.args,self.context))
        self.args.model='different'
        with self.assertRaisesRegex(QuotaError,'different'):
            ledger.lifecycle(self.store,self.args,self.context)
        self.args.model=None
        self.args.phase='attach'
        self.assertEqual(ledger.lifecycle(self.store,self.args,self.context),ledger.lifecycle(self.store,self.args,self.context))
        self.write_claude()
        self.advance(30)
        self.args.phase='finish'
        done=ledger.lifecycle(self.store,self.args,self.context)
        self.advance(60)
        self.assertEqual(done,ledger.lifecycle(self.store,self.args,self.context))
        self.assertEqual(len(self.store.all('run')),1)
        self.args.phase='attach'
        with self.assertRaisesRegex(QuotaError,'finished'):
            ledger.lifecycle(self.store,self.args,self.context)

    def test_streaming_max_output_and_resume_dedupe(self):
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude(3)
        path=self.write_claude(391)
        self.advance(30)
        first=scan(self.store,self.context)
        self.assertTrue(first['complete'])
        facts=self.store.all('usage')
        self.assertEqual(len(facts),1)
        self.assertEqual(facts[0]['tokens']['output'],391)
        self.assertEqual(scan(self.store,self.context)['bytes_read'],0)
        shutil.copyfile(path,path.with_name('session-copy.jsonl'))
        scan(self.store,self.context)
        self.assertEqual(len(self.store.all('usage')),1)

    def test_codex_epochs_identical_requests_model_and_replay(self):
        state={'session':'session'}
        def record(total,ordinal,model=None):
            if model:
                usage.parse_record(self.store,'codex',{'type':'turn_context','payload':{'model':model}},state,ordinal)
            row={'timestamp':f'2026-09-23T12:00:{ordinal:02d}Z','ordinal':ordinal,'payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':total,'cached_input_tokens':total//2,'cache_write_input_tokens':total//5,'output_tokens':total//10}}}}
            return usage.parse_record(self.store,'codex',row,state,ordinal),row
        first,_=record(100,1,'gpt-fixture')
        second,replay=record(200,2)
        self.assertEqual(first['tokens'],second['tokens'])
        self.assertIsNone(usage.parse_record(self.store,'codex',replay,state,3))
        reset,_=record(100,4,'gpt-other')
        self.assertEqual(reset['model'],'gpt-other')
        self.assertEqual(reset['tokens']['input'],30)
        self.assertNotEqual(first['id'],reset['id'])

    def test_non_overlapping_token_classes(self):
        values=usage.tokens({'input_tokens':100,'cached_input_tokens':50,'cache_write_input_tokens':20,'output_tokens':10,'reasoning_output_tokens':3},'codex')
        self.assertEqual(values,dict(input=30,cache_read=50,cache_write=20,output=10,reasoning=3))
        self.assertIsNone(usage.tokens({'inputTokens':5,'outputTokens':2},'grok')['cache_write'])

    def test_capacity_shapes_and_failures(self):
        for module,name in ((claude,'claude-usage'),(codex,'codex-rate-limits')):
            body=json.loads((self.fixtures/(name+'.json')).read_text())['body']
            meters,partial=module.parse(body)
            self.assertTrue(meters)
            self.assertFalse(partial)
            with self.assertRaises(QuotaError):
                module.parse({})

    def test_ancestry_argv0_and_helpers(self):
        table={10:(20,'/tools/codex','node'),20:(1,'/tools/claude','node')}
        self.assertEqual(harness_ancestor({'claude','codex'},table,10),'codex')
        table[10]=(20,'/tools/claude','node')
        table[20]=(1,'/tools/codex','node')
        self.assertEqual(harness_ancestor({'claude','codex'},table,10),'claude')
        self.assertTrue(valid_session('a:1'))
        self.assertFalse(valid_session('../a'))

    def test_intervals_reset_and_rolled_window(self):
        meter=dict(meter='codex:codex:primary',used=0,resets_at=1000000,window_s=604800,resolution=1)
        result=intervals.meter_change(meter,dict(meter,resets_at=1000300),0,300)
        self.assertTrue(result['window_rolled'])
        self.assertFalse(result['reset_crossed'])
        result=intervals.meter_change(dict(meter,used=10),dict(meter,used=0),0,300)
        self.assertTrue(result['reset_crossed'])
        result=intervals.meter_change(dict(meter,resets_at=None),dict(meter,resets_at=None),0,300)
        self.assertFalse(result['reset_crossed'])

    def test_zero_requires_all_roots_and_old_logs_unresolved(self):
        self.write_claude(stamp='2026-09-22T12:00:10Z')
        coverage=scan(self.store,self.context)
        self.assertEqual(coverage['unresolved_events'],1)
        (self.home/'.grok/sessions').rmdir()
        coverage=scan(self.store,self.context)
        self.assertFalse(coverage['complete'])
        self.assertIn(str(self.home/'.grok/sessions'),coverage['uncovered_roots'])

    def test_late_record_and_rotation_update_index(self):
        ledger.lifecycle(self.store,self.args,self.context)
        path=self.write_claude(3)
        self.advance(30)
        scan(self.store,self.context)
        self.write_claude(30)
        scan(self.store,self.context)
        self.assertEqual(self.store.all('usage')[0]['tokens']['output'],30)
        path.rename(path.with_suffix('.old'))
        self.write_claude(5,ident='message-b')
        scan(self.store,self.context)
        self.assertEqual(len(self.store.all('usage')),2)

    def test_store_private_hmac_and_rollback(self):
        ident=self.store.pool('claude','test-account')
        self.store.close()
        self.store=Store(self.dir/'state')
        self.assertEqual(ident,self.store.pool('claude','test-account'))
        with self.assertRaises(RuntimeError):
            with self.store.transaction():
                self.store.put('test','key',{'value':1})
                raise RuntimeError()
        self.assertIsNone(self.store.get('test','key'))
        self.assertEqual(self.store.path.stat().st_mode & 0o777,0o600)

    def test_old_run_stays_finishable_and_abandon_is_explicit(self):
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(49*3600)
        self.args.phase='attach'
        ledger.lifecycle(self.store,self.args,self.context)
        self.args.phase='finish'
        self.assertEqual(ledger.lifecycle(self.store,self.args,self.context)['lifecycle'],'recorded')
        self.args.session_id='abandoned'
        self.args.phase='start'
        ledger.lifecycle(self.store,self.args,self.context)
        self.args.phase='abandon'
        self.assertEqual(ledger.lifecycle(self.store,self.args,self.context)['lifecycle'],'interrupted')

    def test_disabled_commands_have_no_side_effects(self):
        (self.dir/'state/config').write_text('quota=off\n')
        before=self.store.path.stat().st_mtime_ns
        for command in ('status','runs','summary','sample','intervals','doctor'):
            result=self.command(command)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout),{'v':1,'disabled':True})
        self.assertEqual(before,self.store.path.stat().st_mtime_ns)

    def test_status_refresh_throttle_and_json(self):
        empty=json.loads(self.command('status','--pool','claude').stdout)
        self.assertEqual(empty['pools'][0]['reason'],'no_sample')
        first=self.command('status','--refresh')
        self.assertEqual(first.returncode,0,first.stdout+first.stderr)
        result=json.loads(first.stdout)
        self.assertEqual(len(result['pools']),2)
        self.assertTrue(all(p['status']=='ok' for p in result['pools']),result)
        second=json.loads(self.command('status','--refresh').stdout)
        self.assertTrue(all(p['reused_sample'] for p in second['pools']),second)

    def test_reason_registry_matches_normative_spec(self):
        from quota.common import REASONS
        doc=(ROOT/'docs/quota-ledger.md').read_text().split('<!-- quota-reasons:start -->')[1].split('<!-- quota-reasons:end -->')[0]
        for code,(cause,fix) in REASONS.items():
            self.assertIn(f'| {code} | {cause} | {fix} |',doc)
        self.assertEqual(len([line for line in doc.splitlines() if line.startswith('| ')])-1,len(REASONS))

    def test_finish_failure_preserves_terminal_timestamp(self):
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(30)
        terminal=now()
        self.args.phase='finish'
        with mock.patch('quota.ledger.run_rows',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                ledger.lifecycle(self.store,self.args,self.context)
        self.assertIsNone(self.store.get('receipt','run-a:finish'))
        self.advance(300)
        result=ledger.lifecycle(self.store,self.args,self.context)
        self.assertEqual(result['ended_at'],terminal)

    def test_sqlite_full_rolls_back_without_receipt(self):
        page_count=self.store.db.execute('PRAGMA page_count').fetchone()[0]
        self.store.db.execute('PRAGMA max_page_count='+str(page_count))
        with self.assertRaises(sqlite3.Error):
            with self.store.transaction():
                self.store.put('receipt','never-ack',{'data':'x'*(256 << 10)})
        self.assertIsNone(self.store.get('receipt','never-ack'))

    def test_concurrent_lifecycle_writers_and_readonly_doctor(self):
        args=[str(ROOT/'bin/gstack-extend'),'quota','sample','--session-id','parallel','--phase','start','--agent','unknown','--json']
        children=[subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ)) for _ in range(4)]
        results=[]
        for child in children:
            out,err=child.communicate(timeout=10)
            self.assertEqual(child.returncode,0,out+err)
            results.append(json.loads(out))
        self.assertTrue(all(r==results[0] for r in results))
        self.assertEqual(len([r for r in self.store.all('state') if r['session_id']=='parallel']),1)
        before={p.name:p.stat().st_mtime_ns for p in self.store.directory.iterdir() if p.is_file()}
        result=self.command('doctor')
        self.assertEqual(result.returncode,0,result.stdout)
        after={p.name:p.stat().st_mtime_ns for p in self.store.directory.iterdir() if p.is_file()}
        self.assertEqual(before,after)

    def test_private_store_rejects_links_fifo_and_counts_refusals(self):
        for kind in ('symlink','hardlink','fifo'):
            root=self.dir/kind
            (root/'quota').mkdir(parents=True)
            target=self.dir/(kind+'-target')
            target.write_text('untouched')
            path=root/'quota/quota.sqlite3'
            if kind=='symlink': path.symlink_to(target)
            elif kind=='hardlink': os.link(target,path)
            else: os.mkfifo(path)
            with self.assertRaises(QuotaError) as caught:
                Store(root)
            self.assertEqual(caught.exception.code,'store_refused')
            self.assertEqual(target.read_text(),'untouched')

    def test_codex_expired_token_never_spawns(self):
        stub=self.fixtures/'bin/codex'
        stub.write_text('#!/bin/sh\nexit 77\n')
        stub.chmod(0o755)
        with mock.patch('quota.readers.codex.run_vendor') as spawn:
            with self.assertRaises(QuotaError) as caught:
                codex.read(self.store,self.context,time.monotonic()+2)
            self.assertEqual(caught.exception.code,'auth_expired')
            spawn.assert_not_called()

    def test_vendor_hang_kills_process_group_and_strips_markers(self):
        from quota.common import run_vendor
        stub=self.fixtures/'bin/claude'
        stub.write_text('#!/usr/bin/python3\nimport os,signal,time\nassert not any(k.startswith("CLAUDE_CODE_") or k in ("CLAUDECODE","GSTACK_EXTEND_WORKSPACE_OWNER") for k in os.environ)\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nprint("ready",flush=True)\ntime.sleep(30)\n')
        stub.chmod(0o755)
        os.environ.update(CLAUDECODE='1',CLAUDE_CODE_SESSION_ID='outer',GSTACK_EXTEND_WORKSPACE_OWNER='outer')
        with self.assertRaises(QuotaError) as caught:
            run_vendor('claude',[],self.context,time.monotonic()+.15)
        self.assertEqual(caught.exception.code,'timeout')

    def test_api_auth_custom_roots_and_large_claude_identity(self):
        self.args.auth='api'
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude()
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        self.assertEqual(self.store.all('run')[0]['pool_kind'],'api')
        from quota.identity import identity
        with mock.patch('quota.identity.fixture_dir',return_value=None):
            data={'oauthAccount':{'organizationUuid':'large-org'},'filler':'x'*(2 << 20)}
            (self.home/'.claude.json').write_text(json.dumps(data))
            self.assertNotEqual(identity(self.store,'claude',self.context)['pool'],'pending')
            with (self.home/'.claude.json').open('w') as output:
                output.write('x'*(17 << 20))
            self.assertEqual(identity(self.store,'claude',self.context)['pool'],'pending')

    def test_api_subagents_do_not_charge_subscription_intervals(self):
        self.args.auth='api'
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude()
        self.write_claude(7,'child-message',session='child-session')
        self.write_claude(11,'grandchild-message',session='grandchild-session')
        self.advance(30)
        coverage=scan(self.store,self.context)
        parent=self.store.digest('session-a','session')
        with self.store.transaction():
            for source in self.store.all('source'):
                if source['session']==self.store.digest('child-session','session'):
                    source['parent']=parent
                    self.store.put('source',source['key'],source)
                elif source['session']==self.store.digest('grandchild-session','session'):
                    source['parent']=self.store.digest('child-session','session')
                    self.store.put('source',source['key'],source)
        state=self.store.get('state','run-a')
        rows=ledger.run_rows(self.store,state,coverage)
        self.assertEqual({row['pool_kind'] for row in rows},{'api'})
        self.assertEqual(rows[0]['consumption'][0]['output'],21)
        before=dict(pool=state['identities']['claude']['pool'],pool_kind='claude',observed_at=state['started_at'],sample_id='before',meters=[])
        interval=intervals.interval(self.store,before,None,coverage)
        self.assertEqual(interval['consumption'],[])
        self.assertEqual(interval['event_count'],0)
        foreign=dict(agent='codex',session='foreign',parent=parent)
        self.assertFalse(ledger.uses_api_auth(foreign,state,self.store.all('source')))
        grandchild=dict(agent='claude',session='grandchild',parent='child')
        conflicting=[dict(agent='claude',session='child',parent=parent),dict(agent='claude',session='child',parent='other')]
        self.assertFalse(ledger.uses_api_auth(grandchild,state,conflicting))
        cycle=[dict(agent='claude',session='child',parent='grandchild'),grandchild]
        self.assertFalse(ledger.uses_api_auth(grandchild,state,cycle))

    def test_unattached_active_run_keeps_ambient_consumption_unknown(self):
        self.args.harness_session=None
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude()
        self.advance(30)
        result=json.loads(self.command('runs','--active','--session-id','run-a').stdout)
        row=result['runs'][0]
        self.assertIsNone(row['consumption'])
        self.assertEqual(row['attribution'],'unknown')
        self.args.phase='attach'
        self.args.harness_session='session-a'
        ledger.lifecycle(self.store,self.args,self.context)
        attached=json.loads(self.command('runs','--active','--session-id','run-a').stdout)
        self.assertEqual(attached['runs'][0]['consumption'][0]['output'],3)

    def test_explicit_api_auth_without_optional_agent(self):
        self.args.agent=None
        self.args.auth='api'
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude()
        self.advance(30)
        coverage=scan(self.store,self.context)
        state=self.store.get('state','run-a')
        rows=ledger.run_rows(self.store,state,coverage)
        self.assertEqual({row['pool_kind'] for row in rows},{'api'})
        self.assertEqual(rows[0]['consumption'][0]['output'],3)
        before=dict(pool=state['identities']['claude']['pool'],pool_kind='claude',observed_at=state['started_at'],sample_id='before',meters=[])
        self.assertEqual(intervals.interval(self.store,before,None,coverage)['event_count'],0)

    def test_lifecycle_sampling_uses_current_sandbox(self):
        from quota.cli import main
        for started_sandboxed in (False,True):
            session='sandbox-'+str(started_sandboxed)
            if started_sandboxed:
                os.environ['CODEX_SANDBOX']='seatbelt'
            else:
                os.environ.pop('CODEX_SANDBOX',None)
            with mock.patch('quota.cli.refresh'),mock.patch('builtins.print'):
                self.assertEqual(main(['sample','--phase','start','--session-id',session,'--agent','claude','--auth','subscription','--json']),0)
            if started_sandboxed:
                os.environ.pop('CODEX_SANDBOX',None)
            else:
                os.environ['CODEX_SANDBOX']='seatbelt'
            for phase in ('attach','finish'):
                with mock.patch('quota.cli.refresh',return_value=[]) as refresh,mock.patch('builtins.print'):
                    self.assertEqual(main(['sample','--phase',phase,'--session-id',session,'--harness-session','session-a','--json']),0)
                    self.assertEqual(refresh.call_args.args[2]['sandboxed'],not started_sandboxed)

    def test_vendor_closed_stdout_timeout_is_an_unavailable_sample(self):
        from quota.samples import refresh
        stub=self.fixtures/'bin/claude'
        stub.write_text('#!/usr/bin/python3\nimport os,time\nos.close(1)\ntime.sleep(30)\n')
        stub.chmod(0o755)
        with mock.patch('quota.readers.claude.fixture_dir',return_value=None),mock.patch('quota.samples.budget',return_value=.15):
            rows=refresh(self.dir/'state',['claude','codex'],self.context,force=True)
        self.assertEqual(len(rows),2)
        failed=next(row for row in rows if row['pool_kind']=='claude')
        self.assertEqual((failed['status'],failed['reason']),('unavailable','timeout'))
        self.assertEqual(next(row for row in rows if row['pool_kind']=='codex')['status'],'ok')

    def test_claude_environment_preserves_custom_root_only(self):
        from quota.common import vendor_env
        os.environ['CLAUDE_CONFIG_DIR']=str(self.home/'.claude')
        self.assertNotIn('CLAUDE_CONFIG_DIR',vendor_env(self.context,'claude'))
        custom=str(self.home/'custom-claude')
        self.assertEqual(vendor_env(dict(self.context,claude_config_dir=custom),'claude')['CLAUDE_CONFIG_DIR'],custom)

    def test_backoff_force_schema_drift_and_clock_skew(self):
        from quota.samples import sample_one,drift
        sample=sample_one(self.dir/'state','claude',self.context,'periodic')
        endpoint=self.fixtures/'claude-usage.json'
        original=endpoint.read_text()
        endpoint.write_text(json.dumps({'status':429,'retry_after':30,'body':{}}))
        denied=sample_one(self.dir/'state','claude',self.context,'refresh',force=True)
        self.assertEqual(denied['reason'],'http_429')
        endpoint.write_text(original)
        self.assertEqual(sample_one(self.dir/'state','claude',self.context,'refresh',force=True)['reason'],'http_429')
        hashes,counts=drift('codex',{'rateLimitsByLimitId':{'secret-account':{}},'private-new-field':1})
        self.assertEqual(len(hashes),1)
        self.assertNotIn('private',hashes[0])
        self.assertEqual(counts,{'rateLimitsByLimitId':1})
        self.advance(-20)
        result=json.loads(self.command('status').stdout)
        meters=result['pools'][0]['meters']
        self.assertTrue(all(m['clock_skew'] and m['age_s']==0 for m in meters))

    def test_partial_trailing_record_recovers_and_parse_budget(self):
        ledger.lifecycle(self.store,self.args,self.context)
        path=self.write_claude()
        with path.open('ab') as out:
            out.write(b'{"type":')
        self.advance(30)
        first=scan(self.store,self.context)
        self.assertFalse(first['complete'])
        with path.open('ab') as out:
            out.write(b'"ignored"}\n')
        self.assertTrue(scan(self.store,self.context)['complete'])
        with path.open('a') as out:
            for _ in range(1000): out.write('{"ignored":"padding-padding-padding"}\n')
        with mock.patch('quota.index.BYTE_BUDGET',1024):
            bounded=scan(self.store,self.context)
        self.assertLessEqual(bounded['bytes_read'],1024)
        self.assertFalse(bounded['complete'])
        self.assertTrue(scan(self.store,self.context)['complete'])

    def test_cross_harness_child_and_ambiguous_parents(self):
        ledger.lifecycle(self.store,self.args,self.context)
        source=dict(key='child',agent='codex',session='child-session',parent=None,first=now()+1,last=now()+100,cwd=self.context['cwd'])
        parent=self.store.get('state','run-a')
        self.advance(10)
        self.assertEqual(ledger.source_relationship(source,parent,[parent])[1],'window')
        second=copy.deepcopy(parent)
        second['session_id']='run-b'
        self.assertEqual(ledger.source_relationship(source,parent,[parent,second])[1],'unknown')
        source['cwd']=str(self.dir/'elsewhere')
        self.assertIsNone(ledger.source_relationship(source,parent,[parent]))

    def test_golden_public_contracts(self):
        import re
        def normalize(value,key=''):
            if isinstance(value,dict): return {k:normalize(v,k) for k,v in value.items()}
            if isinstance(value,list): return [normalize(v,key) for v in value]
            if isinstance(value,str):
                value=value.replace(str(self.home),'$HOME').replace(str(ROOT),'$REPO')
                value=re.sub(r'(?<=:)[a-f0-9]{12}\b','POOL',value)
                value=re.sub(r'\b[a-f0-9]{64}\b','HASH',value)
                if key.endswith('sample_id'): value='SAMPLE'
            if key in ('bytes_read','discovery_operations'): return 'MEASURED'
            return value
        commands={'status':['status','--refresh'],'runs':['runs'],'summary':['summary'],
                  'sample':['sample','--session-id','golden-run','--phase','start','--agent','unknown']}
        for name,args in commands.items():
            result=self.command(*args)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            document=normalize(json.loads(result.stdout))
            path=ROOT/'tests/fixtures/quota'/('golden-'+name+'.json')
            if os.environ.get('UPDATE_QUOTA_GOLDENS')=='1':
                path.write_text(json.dumps(document,indent=2,sort_keys=True)+'\n')
            self.assertEqual(document,json.loads(path.read_text()))

    def test_sandbox_disables_network_and_pool_switch_keeps_usage(self):
        from quota.samples import sample_one
        context=dict(self.context,sandboxed=True)
        for kind in ('claude','codex'):
            row=sample_one(self.dir/'state',kind,context,'periodic')
            self.assertEqual(row['reason'],'sandboxed')
        (self.dir/'state/config').write_text('quota_pools=codex\n')
        row=sample_one(self.dir/'state','claude',self.context,'periodic',force=True)
        self.assertEqual(row['reason'],'disabled')
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude()
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        self.assertEqual(self.store.all('run')[0]['consumption'][0]['output'],3)

    def test_active_observed_through_and_final_late_revision(self):
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude(3)
        self.advance(30)
        first=json.loads(self.command('runs','--active','--session-id','run-a').stdout)['runs'][0]
        self.advance(60)
        second=json.loads(self.command('runs','--active','--session-id','run-a').stdout)['runs'][0]
        self.assertEqual(first['observed_through'],second['observed_through'])
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(10)
        self.write_claude(391)
        recorded=json.loads(self.command('runs','--session-id','run-a').stdout)['runs'][0]
        self.assertEqual(recorded['consumption'][0]['output'],391)
        self.assertEqual(recorded['attribution'],'window')

    def test_partial_and_absent_meters_and_reset_status(self):
        from quota.samples import sample_one
        first=sample_one(self.dir/'state','claude',self.context,'periodic')
        partial=dict(first,sample_id='partial',observed_at=now()+1,status='partial',meters=first['meters'][:1])
        with self.store.transaction(): self.store.put('sample','partial',partial)
        self.assertFalse(any(m['absent'] for m in self.store.all('meter')))
        complete=dict(partial,sample_id='next',observed_at=now()+2,status='ok')
        with self.store.transaction(): self.store.put('sample','next',complete)
        self.assertTrue(any(m['absent'] for m in self.store.all('meter')))
        self.advance(7*3600)
        report=json.loads(self.command('status','--pool','claude').stdout)
        self.assertTrue(all(m['used'] is None for m in report['pools'][0]['meters']))

    def test_account_switch_does_not_assign_historical_logs_to_current_pool(self):
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude(3)
        self.advance(30)
        scan(self.store,self.context)
        ids=json.loads((self.fixtures/'identities.json').read_text())
        ids['claude']['id']='second-org'
        (self.fixtures/'identities.json').write_text(json.dumps(ids))
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        row=self.store.all('run')[0]
        self.assertEqual(row['pool'],'pending')
        self.assertIn('identity_changed',row['sources'][0]['why'])
        self.write_claude(10,'historical','2026-09-22T12:00:10Z','old-session')
        scan(self.store,self.context)
        historical=next(e for e in self.store.all('usage') if e['tokens']['output']==10)
        self.assertEqual(historical['pool'],'unresolved')

    def test_interval_late_records_and_revised_charge(self):
        from quota.samples import sample_one
        before=sample_one(self.dir/'state','claude',self.context,'periodic')
        self.write_claude(3)
        self.advance(30)
        after=sample_one(self.dir/'state','claude',self.context,'periodic',force=True)
        coverage=scan(self.store,self.context)
        first=intervals.interval(self.store,before,after,coverage)
        self.write_claude(391)
        coverage=scan(self.store,self.context)
        revised=intervals.interval(self.store,before,after,coverage)
        self.assertEqual(first['consumption'][0]['output'],3)
        self.assertEqual(revised['consumption'][0]['output'],391)

    def test_codex_line_one_metadata_and_linked_child_strength(self):
        state={}
        row=dict(type='session_meta',timestamp='2026-09-23T12:00:00Z',payload={'id':'child','parent_thread_id':'session-a','cwd':self.context['cwd']})
        usage.parse_record(self.store,'codex',row,state,0)
        usage.parse_record(self.store,'codex',dict(row,payload={'id':'copied-parent','cwd':'/elsewhere'}),state,1)
        self.assertEqual(state['session'],self.store.digest('child','session'))
        self.assertEqual(state['cwd'],self.context['cwd'])
        ledger.lifecycle(self.store,self.args,self.context)
        parent=self.store.get('state','run-a')
        source=dict(state,first=now()-20,key='child',agent='codex')
        self.assertEqual(ledger.source_relationship(source,parent,[parent])[1],'window')
        grandchild=dict(source,parent=source['session'],session='grandchild',first=now()+1)
        self.advance(10)
        self.assertEqual(ledger.source_relationship(grandchild,parent,[parent],[source,grandchild])[1],'exact')

    def test_multiple_attached_sessions_and_finish_overrides(self):
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude(3)
        self.advance(20)
        self.args.phase='attach'
        self.args.harness_session='session-b'
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude(4,'message-b','2026-09-23T12:00:25Z','session-b')
        self.advance(20)
        self.args.phase='finish'
        self.args.model='claude-finish'
        ledger.lifecycle(self.store,self.args,self.context)
        row=self.store.all('run')[0]
        self.assertTrue(row['paused'])
        self.assertEqual(row['attribution'],'window')
        self.assertEqual(row['consumption'][0]['output'],7)
        self.assertEqual(row['model'],'claude-finish')

    def test_historical_intervals_load_cursor_coverage_once(self):
        pool=self.store.pool('cursor','fixture-owner')
        start=now()
        root=str(self.home/'.cursor/projects')
        with self.store.transaction():
            for i in range(25):
                row=dict(sample_id=str(i),pool=pool,pool_kind='cursor',status='ok',observed_at=start+i,meters=[])
                self.store.put('sample',str(i),row)
        self.advance(30)
        with self.store.transaction():
            self.store.put('inventory','cursor-root',dict(agent='cursor',root=root,complete=True,as_of=now(),queue=[]))
            self.store.put('cursor_coverage','cov-1',dict(pool=pool,start=start,end=now(),observed_at=now(),complete=True,reason=None))
        with mock.patch.object(self.store,'all',wraps=self.store.all) as reads:
            rows=intervals.intervals(self.store,dict(complete=True,roots=[],uncovered_roots=[]))
        self.assertEqual(len(rows),24)
        self.assertTrue(all(row['complete'] for row in rows))
        self.assertEqual(sum(call.args==('cursor_coverage',) for call in reads.call_args_list),1)
        self.advance(10)
        with self.store.transaction():
            self.store.put('cursor_coverage','cov-2',dict(pool=pool,start=start+4,end=start+12,observed_at=now(),complete=False,reason='http_5xx'))
        self.advance(10)
        with self.store.transaction():
            self.store.put('cursor_coverage','cov-3',dict(pool=pool,start=start+8,end=start+18,observed_at=now(),complete=True,reason=None))
        coverage=dict(complete=True,roots=[],uncovered_roots=[])
        batched=intervals.intervals(self.store,coverage)
        samples=sorted(self.store.all('sample'),key=lambda row:row['observed_at'])
        individually=[intervals.interval(self.store,left,right,coverage) for left,right in zip(samples,samples[1:])]
        self.assertEqual(batched,individually)

    def test_historical_cursor_interval_requires_saved_local_coverage(self):
        start=now()
        end=start+60
        pool=self.store.pool('cursor','partial-owner')
        root=str(self.home/'.cursor/projects')
        self.advance(90)
        with self.store.transaction():
            for key,stamp in [('before',start),('after',end)]:
                self.store.put('sample',key,dict(sample_id=key,pool=pool,pool_kind='cursor',status='ok',observed_at=stamp,meters=[]))
            self.store.put('cursor_coverage','account',dict(pool=pool,start=start,end=end,observed_at=now(),complete=True))

        for inventory in (None,dict(agent='cursor',root=root,complete=False,as_of=now(),queue=[root]),
                          dict(agent='cursor',root=root,complete=True,as_of=start,queue=[])):
            if inventory is not None:
                with self.store.transaction():
                    self.store.put('inventory','cursor-root',inventory)
            result=self.command('intervals')
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            row,=json.loads(result.stdout)['intervals']
            self.assertFalse(row['complete'])
            self.assertFalse(row['calibration_eligible'])
            self.assertIsNone(row['event_count'])
            self.assertIsNone(row['consumption'])

        # Discovery can commit a newer root inventory before parsing its files.
        with self.store.transaction():
            self.store.put('inventory','cursor-root',dict(agent='cursor',root=root,complete=True,as_of=now(),queue=[]))
            self.store.put('file','cursor-file',dict(agent='cursor',root=root,complete=True,checked_at=start))
        result=self.command('intervals')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        row,=json.loads(result.stdout)['intervals']
        self.assertFalse(row['complete'])
        self.assertIsNone(row['event_count'])

    def test_historical_cursor_raw_events_remain_visible_in_run_and_summary(self):
        from quota.cli import get_runs

        start=now()
        end=start+60
        pool=self.store.pool('cursor','stored-owner')
        conversation=self.store.digest('stored-conversation','session')
        metadata=dict(agent='cursor',auth='subscription',context=self.context,stage='implement',model='composer-fixture',route='cli')
        lifecycle=dict(session_id='historical-run',started_at=start,ended_at=end,lease_at=end,metadata=metadata,
                       attachments=[dict(agent='cursor',session=conversation,attached_at=start)],
                       identities={'cursor':{'pool':pool}},fixture=True)
        self.advance(380)
        with self.store.transaction():
            self.store.put('state','historical-run',lifecycle)
            row,=ledger.run_rows(self.store,lifecycle,dict(roots=[],complete=True))
            key=json.dumps(['historical-run','cursor',pool])
            self.store.put('run',key,row)
            self.store.put('cursor_event','history-charge',dict(
                id='history-charge',pool=pool,conversation_hash=conversation,event_ts=start+20,turn_start=start+10,
                turn_end=start+30,evidence='provider',model='composer-fixture',charged_cents=15,ambiguous=False,
                stable_reads=2,complete=True,revision=1,last_read_at=end+310,
                tokens=dict(input=100,cache_read=20,cache_write=0,output=40,reasoning=5)))

        result=self.command('runs')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        projected,=json.loads(result.stdout)['runs']
        self.assertEqual(projected.get('attributable_cents'),15)
        self.assertEqual(projected['settlement'],'final')
        self.assertEqual(projected['events'][0]['event_id'],'history-charge')
        self.assertEqual(projected['sources'][0]['source'],'cursor-api2')
        summary=self.command('summary','--by','agent')
        self.assertEqual(summary.returncode,0,summary.stdout+summary.stderr)
        group,=json.loads(summary.stdout)['groups']
        self.assertEqual(group['attributable_cents'],15)
        self.assertEqual(group['consumption']['input']['median'],100)
        self.assertEqual(self.store.get('run',key),row)

        args=parser().parse_args(['runs'])
        projected,=get_runs(self.store,args,self.context)['runs']
        with self.store.transaction():
            self.store.put('run',key,projected)
            fact=self.store.get('cursor_event','history-charge')
            self.store.put('cursor_event','later-charge',dict(fact,id='later-charge',charged_cents=3))
        summary=self.command('summary','--by','agent')
        self.assertEqual(summary.returncode,0,summary.stdout+summary.stderr)
        group,=json.loads(summary.stdout)['groups']
        self.assertEqual(group['attributable_cents'],18)
        self.assertEqual(self.store.get('run',key),projected)

        # A second stage can have attached after the first snapshot was finalized.
        settled,=get_runs(self.store,args,self.context)['runs']
        other=dict(lifecycle,session_id='other-run')
        with self.store.transaction():
            self.store.put('run',key,settled)
            self.store.put('state','other-run',other)
        result=self.command('runs')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        runs=json.loads(result.stdout)['runs']
        self.assertEqual(len(runs),2)
        for row in runs:
            self.assertIsNone(row['attributable_cents'])
            self.assertEqual(row['shared_cents'],18)

        # A saved provider revision can move a previously exclusive charge.
        self.advance(150)
        with self.store.transaction():
            self.store.put('state','other-run',dict(other,started_at=start+120,ended_at=start+180,lease_at=start+180))
            self.store.put('cursor_event','history-charge',dict(fact,revision=2,event_ts=start+140,turn_start=start+130,
                                                               turn_end=start+150,last_read_at=start+500,charged_cents=25))
        result=self.command('runs')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        runs={row['session_id']:row for row in json.loads(result.stdout)['runs']}
        self.assertEqual([event['event_id'] for event in runs['historical-run']['events']],['later-charge'])
        self.assertEqual(runs['historical-run']['attributable_cents'],3)
        self.assertEqual(runs['other-run']['attributable_cents'],25)
        self.assertEqual(self.store.get('run',key),settled)

    def test_transport_reason_mapping_and_schema_failures(self):
        from quota.readers.transport import response
        endpoint=self.fixtures/'failure.json'
        cases=[(401,'http_401'),(403,'http_403'),(429,'http_429'),(404,'http_4xx'),(500,'http_5xx')]
        for code,reason in cases:
            endpoint.write_text(json.dumps({'status':code,'body':{}}))
            with self.assertRaises(QuotaError) as caught:
                response('failure','',time.monotonic()+1)
            self.assertEqual(caught.exception.code,reason)
        for failure in ('dns','tls','reset','timeout'):
            endpoint.write_text(json.dumps({'status':200,'error':failure,'body':{}}))
            with self.assertRaises(QuotaError) as caught:
                response('failure','',time.monotonic()+1)
            self.assertEqual(caught.exception.code,'timeout' if failure=='timeout' else 'network_error')
        from quota.samples import sample_one
        (self.fixtures/'claude-usage.json').write_text(json.dumps({'status':200,'body':{'usage_report':{'rate_limits':None}}}))
        row=sample_one(self.dir/'state','claude',self.context,'periodic',force=True)
        self.assertEqual(row['status'],'unavailable')
        self.assertEqual(row['reason'],'schema_changed')
        self.assertEqual(row['meters'],[])

    def test_pool_lock_timeout_is_a_sample_not_a_stall(self):
        with self.store.lock('sample:claude'):
            result=subprocess.run([str(ROOT/'bin/gstack-extend'),'quota','status','--refresh','--pool','claude','--json'],
                                  capture_output=True,text=True,timeout=3,env=dict(os.environ,GSTACK_EXTEND_QUOTA_BUDGET_SCALE='.01'))
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        pool=json.loads(result.stdout)['pools'][0]
        self.assertEqual(pool['status'],'unavailable')
        self.assertEqual(pool['reason'],'timeout')
        self.assertEqual(pool['meters'],[])

    def test_claude_stub_malformed_output_and_stderr_are_not_exposed(self):
        from quota.samples import sample_one
        stub=self.fixtures/'bin/claude'
        stub.write_text('#!/usr/bin/python3\nimport sys\nprint("fixture-private-stderr",file=sys.stderr)\nprint("not-json")\n')
        stub.chmod(0o755)
        row=sample_one(self.dir/'state','claude',self.context,'periodic')
        self.assertEqual(row['reason'],'schema_changed')
        self.assertNotIn('fixture-private',json.dumps(row))

    def test_probe_honors_pool_gates_and_cursor_cli_is_rejected(self):
        (self.dir/'state/config').write_text('quota_pools=claude\n')
        result=self.command('probe','codex','--raw')
        self.assertEqual(result.returncode,1)
        self.assertEqual(json.loads(result.stdout)['error']['code'],'disabled')
        result=self.command('probe','claude','--raw','--pool','claude:other')
        self.assertEqual(json.loads(result.stdout)['error']['code'],'identity_unknown')
        for rejected in (
            ('settle',),
            ('probe','cursor','--raw'),
            ('runs','--agent','cursor'),
            ('runs','--pool','cursor'),
            ('runs','--pool','cursor:abc'),
            ('status','--cursor-projects-dir','/tmp/x'),
        ):
            with self.subTest(rejected=rejected):
                res=self.command(*rejected)
                self.assertEqual(res.returncode,2,res.stdout+res.stderr)
                self.assertEqual(json.loads(res.stdout)['error']['code'],'usage')

    def test_json_records_with_invalid_shapes_do_not_abort_scan(self):
        path=self.home/'.codex/sessions/malformed.jsonl'
        path.write_text(json.dumps(dict(type='event_msg',payload=['invalid']))+'\n')
        result=scan(self.store,self.context)
        self.assertFalse(result['complete'])
        self.assertEqual(self.store.all('file')[0]['reason'],'malformed_record')

    def test_disable_and_backoff_override_a_recent_ok_sample(self):
        from quota.samples import sample_one
        from quota.identity import identity
        sample_one(self.dir/'state','claude',self.context,'periodic')
        (self.dir/'state/config').write_text('quota_pools=codex\n')
        self.assertEqual(sample_one(self.dir/'state','claude',self.context,'periodic')['reason'],'disabled')
        (self.dir/'state/config').write_text('quota_pools=claude\n')
        with self.store.transaction():
            self.store.put('backoff',identity(self.store,'claude',self.context)['fingerprint'],dict(retry_at=now()+300))
        self.assertEqual(sample_one(self.dir/'state','claude',self.context,'periodic')['reason'],'http_429')

    def test_process_death_rolls_back_output_and_receipt(self):
        code='\n'.join(['import os,sys',f'sys.path.insert(0,{str(ROOT / "bin/lib")!r})',
                       'from quota.store import Store',f'store=Store({str(self.dir / "state")!r})',
                       'with store.transaction():',"    store.put('run','interrupted',{'v':1})",
                       "    store.put('receipt','interrupted:finish',{'v':1})",'    os._exit(17)'])
        result=subprocess.run([sys.executable,'-B','-E','-s','-c',code],capture_output=True,env=dict(os.environ),timeout=3)
        self.assertEqual(result.returncode,17)
        self.assertIsNone(self.store.get('run','interrupted'))
        self.assertIsNone(self.store.get('receipt','interrupted:finish'))
        for name in ('quota.sqlite3','quota.sqlite3-wal','quota.sqlite3-shm','identity.key'):
            self.assertEqual((self.store.directory/name).stat().st_mode & 0o777,0o600)

    def test_grok_and_unknown_harness_have_no_capacity_assumption(self):
        self.args.agent='grok'
        self.args.harness_session='grok-session'
        self.args.auth='unknown'
        ledger.lifecycle(self.store,self.args,self.context)
        path=self.home/'.grok/sessions/grok-session/events.jsonl'
        path.parent.mkdir()
        path.write_text(json.dumps(dict(id='grok-message',timestamp=now()+10,model_id='grok-fixture',
                                        usage=dict(input_tokens=12,output_tokens=4)))+'\n')
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        row=self.store.all('run')[0]
        self.assertEqual(row['pool_kind'],'grok')
        self.assertEqual(row['pool'],'pending')
        self.assertEqual(row['attribution'],'window')
        self.assertEqual(row['consumption'][0]['output'],4)
        self.args.session_id='unknown-run'
        self.args.phase='start'
        self.args.agent=None
        self.args.harness_session=None
        ledger.lifecycle(self.store,self.args,self.context)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        row=next(r for r in self.store.all('run') if r['session_id']=='unknown-run')
        self.assertEqual(row['pool_kind'],'unknown')
        self.assertIsNone(row['consumption'])

    def test_summary_combines_pool_rows_and_keeps_billed_models(self):
        from quota.cli import summary
        facts=[]
        rows=[]
        for pool,value,model in [('claude:one',3,'model-a'),('cursor:two',9,'model-b')]:
            ident=pool
            facts.append(dict(id=ident,model=model,tokens={key:value for key in usage.CLASSES}))
            rows.append(dict(session_id='one-run',started_at=now(),pool=pool,stage='build',agent='claude',model='requested',
                             attribution='exact',settlement='final',sources=[dict(why=[],complete=True,attribution='exact',event_ids=[ident])]))
        with self.store.transaction():
            for fact in facts:
                self.store.put('usage',fact['id'],fact)
        args=parser().parse_args(['summary'])
        with mock.patch('quota.cli.get_runs',return_value=dict(runs=rows)):
            result=summary(self.store,args,self.context)
        group=result['groups'][0]
        self.assertEqual(group['run_count'],1)
        self.assertEqual(group['consumption']['output']['median'],12)
        self.assertEqual(group['consumption']['output']['n'],1)
        self.assertEqual({g['model'] for g in group['by_billed_model']},{'model-a','model-b'})

    def test_adjacent_windows_never_both_count_boundary_record(self):
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude(stamp='2026-09-23T12:00:30Z')
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        self.args.session_id='next-run'
        self.args.phase='start'
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        rows=self.store.all('run')
        self.assertIsNone(next(r for r in rows if r['session_id']=='run-a')['consumption'])
        self.assertEqual(next(r for r in rows if r['session_id']=='next-run')['consumption'][0]['output'],3)

    def test_claude_returned_account_disagreement_is_pending(self):
        from quota.samples import sample_one
        path=self.fixtures/'claude-usage.json'
        fixture=json.loads(path.read_text())
        fixture['body']['account']={'organizationUuid':'different-account'}
        path.write_text(json.dumps(fixture))
        row=sample_one(self.dir/'state','claude',self.context,'periodic')
        self.assertEqual(row['pool'],'pending')
        self.assertEqual(row['reason'],'identity_changed')

    def test_native_sdk_match_requires_one_workspace_candidate(self):
        self.args.agent='cursor'
        self.args.harness_session=None
        ledger.lifecycle(self.store,self.args,self.context)
        state=self.store.get('state','run-a')
        self.advance(20)
        source=dict(session='first',native_sdk=True,cwd=self.context['cwd'],first=now()-10,last=now()-5)
        self.assertEqual(ledger.source_relationship(source,state,[state],[source])[1],'turn')
        other=dict(source,session='second')
        self.assertEqual(ledger.source_relationship(source,state,[state],[source,other])[1],'unknown')
        self.assertIsNone(ledger.source_relationship(dict(source,cwd='/elsewhere'),state,[state],[source]))

    def test_concurrent_samplers_share_one_read(self):
        command=[str(ROOT/'bin/gstack-extend'),'quota','status','--refresh','--pool','claude','--json']
        children=[subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=dict(os.environ)) for _ in range(2)]
        for child in children:
            child.communicate(timeout=5)
            self.assertEqual(child.returncode,0)
        samples=[row for row in self.store.all('sample') if row['pool_kind']=='claude']
        self.assertEqual(len(samples),1)

    def test_since_human_and_stale_doctor(self):
        from quota import cli
        with self.assertRaises(QuotaError):
            cli.since(parser().parse_args(['status','--days','-1']))
        self.assertAlmostEqual(cli.since(parser().parse_args(['status','--since','7d'])),now()-7*86400,delta=1)
        self.assertAlmostEqual(cli.since(parser().parse_args(['status','--since','12h'])),now()-12*3600,delta=1)
        with self.assertRaises(QuotaError):
            cli.since(parser().parse_args(['status','--since','nope']))
        text=cli.human(cli.status(self.store,parser().parse_args(['status']),self.context,[]))
        self.assertIn('Claude',text)
        self.store.put('state','stale-run',{'ended_at':None,'lease_at':now()-49*3600,'session_id':'stale-run'})
        doctor=cli.doctor(self.store,self.context,[],parser().parse_args(['doctor']))
        self.assertEqual(doctor['stale_runs'],1)
        self.assertIn('stale 1',cli.human(doctor))

    def test_sample_gates_pool_mismatch_and_probe_blocks(self):
        from io import StringIO
        import contextlib
        from quota.cli import main
        from quota.identity import identity as account
        captured=StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertEqual(main(['sample','--phase','start','--json']),2)
        self.assertIn('session-id',captured.getvalue())
        captured=StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertEqual(main(['status','--pool','nope','--json']),2)
        self.assertEqual(json.loads(captured.getvalue())['error']['code'],'usage')
        captured=StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertEqual(main(['sample','--pool','claude','--json']),0)
        self.assertIn('samples',json.loads(captured.getvalue()))
        captured=StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertEqual(main(['sample','--pool','claude:not-this-pool','--json']),0)
        self.assertEqual(json.loads(captured.getvalue())['reason'],'identity_unknown')
        os.environ['CODEX_SANDBOX']='seatbelt'
        captured=StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertNotEqual(main(['probe','claude','--raw','--json']),0)
        self.assertEqual(json.loads(captured.getvalue())['error']['code'],'sandboxed')
        del os.environ['CODEX_SANDBOX']
        fingerprint=account(self.store,'claude',self.context)['fingerprint']
        self.store.put('backoff',fingerprint,{'retry_at':now()+60})
        self.store.db.commit()
        captured=StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertNotEqual(main(['probe','claude','--raw','--json']),0)
        body=json.loads(captured.getvalue())
        self.assertEqual(body['error']['code'],'http_429')
        self.assertTrue(str(body['error']['retry_at']).endswith('Z'))
        captured=StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertEqual(main(['doctor','--since','nope','--json']),2)
        self.assertEqual(json.loads(captured.getvalue())['error']['code'],'usage')

    def test_inferred_auth_token_and_account_switch(self):
        from quota.identity import bind, fresh_codex_token
        import base64
        os.environ['CLAUDE_CODE_SESSION_ID']='sess-a'
        os.environ['ANTHROPIC_API_KEY']='fixture-key'
        args=parser().parse_args(['sample','--session-id','run-a','--phase','start','--agent','claude','--harness-session','sess-a'])
        self.assertEqual(context_from(args)['auth'],'api')
        del os.environ['ANTHROPIC_API_KEY']
        self.assertEqual(context_from(args)['auth'],'subscription')
        payload=base64.urlsafe_b64encode(json.dumps({'exp':now()+1000}).encode()).decode().rstrip('=')
        path=Path(self.context['codex_home'])/'auth.json'
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps({'tokens':{'access_token':'header.'+payload+'.sig'}}))
        self.assertTrue(fresh_codex_token(self.context))
        path.write_text(json.dumps({'tokens':{'access_token':'not-a-jwt'}}))
        self.assertFalse(fresh_codex_token(self.context))
        history=bind(self.store,'claude',self.context,{'pool':'pool-a','fingerprint':'f'})
        history=bind(self.store,'claude',self.context,{'pool':'pool-b','fingerprint':'f'})
        self.assertIsNotNone(history['periods'][0]['end'])
        self.assertEqual(history['periods'][-1]['pool'],'pool-b')

    def test_resolution_retry_cap_and_usage_edges(self):
        from quota.readers.transport import http_error, response
        before={'meter':'claude:five_hour','used':10,'resets_at':now()+1000,'window_s':18000}
        after=dict(before,used=10.2,resolution=1)
        self.assertTrue(intervals.meter_change(before,after,now()-10,now())['below_resolution'])
        self.assertEqual(usage.tokens({'inputTokens':10,'cacheReadTokens':4},'grok')['input'],10)
        state={}
        row={'type':'assistant','timestamp':'2026-09-23T12:00:00Z','message':{'model':'<synthetic>','usage':{'input_tokens':1}}}
        self.assertIsNone(usage.parse_record(self.store,'claude',row,state,1))
        state={}
        row={'type':'assistant','message':{'id':'msg','model':'claude-fixture','usage':{'input_tokens':1}}}
        self.assertIsNone(usage.parse_record(self.store,'claude',row,state,1))
        self.assertEqual(state['partial'],'ordering_unknown')
        capped=http_error(429,'999999999')
        self.assertLessEqual(capped.retry_at,now()+86400+1)
        dated=http_error(429,'Wed, 21 Oct 2015 07:28:00 GMT')
        self.assertIsNotNone(dated.retry_at)
        (self.fixtures/'slow.json').write_text(json.dumps({'delay_ms':100000,'body':{}}))
        with self.assertRaises(QuotaError) as timeout:
            response('slow','http://127.0.0.1',time.monotonic()+1)
        self.assertEqual(timeout.exception.code,'timeout')
        with self.assertRaises(QuotaError) as missing:
            response('absent-fixture','http://127.0.0.1',time.monotonic()+5)
        self.assertEqual(missing.exception.code,'no_credentials')

    def test_route_ancestor_and_argv0_fallbacks(self):
        import telemetry
        os.environ['CLAUDE_CODE_ENTRYPOINT']='sdk-ts'
        os.environ['CONDUCTOR_SESSION_ID']='conductor-a'
        self.assertEqual(telemetry.route_for('claude')[0],'sdk')
        del os.environ['CONDUCTOR_SESSION_ID']
        self.assertEqual(telemetry.route_for('claude')[0],'sdk')
        os.environ.pop('CLAUDE_CODE_ENTRYPOINT',None)
        self.assertEqual(telemetry.route_for('cursor'),('unknown',None))
        os.environ['CURSOR_INVOKED_AS']='cursor-agent'
        self.assertEqual(telemetry.route_for('cursor'),('unknown',None))
        for name in ('CLAUDECODE','CURSOR_AGENT','CURSOR_INVOKED_AS','GROK_AGENT','CONDUCTOR_SESSION_ID','CODEX_THREAD_ID'):
            os.environ.pop(name,None)
        self.assertEqual(telemetry.route_for('codex')[0],'unknown')
        os.environ['CONDUCTOR_SESSION_ID']='conductor-a'
        self.assertEqual(telemetry.route_for('codex')[0],'unknown')
        self.assertEqual(telemetry.harness_ancestor({'claude'},{10:(0,'','claude')},pid=10),'claude')
        with mock.patch.object(telemetry.subprocess,'run',side_effect=OSError('ps failed')):
            self.assertIsNone(telemetry.harness_ancestor({'claude'}))
        self.assertIsNone(telemetry.process_argv0(-1))

    def test_conductor_store_is_not_read(self):
        former=self.home/'Library/Application Support/com.conductor.app/cursor-sdk-store'
        shard=former/'shard-a'
        shard.mkdir(parents=True)
        (shard/'agents.ndjson').write_text(json.dumps(dict(agentId='agent-a',cwd=self.context['cwd']))+'\n')
        (shard/'runs.ndjson').write_text(json.dumps(dict(runId='run-1',agentId='agent-a',startedAt='2026-09-23T12:00:05Z',endedAt='2026-09-23T12:00:10Z',
                                                         model=dict(id='composer-fixture'),usage=dict(inputTokens=10,cacheReadTokens=2,outputTokens=4)))+'\n')
        self.assertNotIn('conductor_store',context_from(self.args))
        coverage=scan(self.store,self.context)
        self.assertFalse(any(r['agent']=='cursor-sdk' or str(r['root']).startswith(str(former)) for r in coverage['roots']))
        self.assertEqual(self.store.all('source'),[])
        self.assertEqual(self.store.all('usage'),[])
        with self.assertRaises(QuotaError) as caught:
            parser().parse_args(['status','--conductor-store',str(former)])
        self.assertEqual(caught.exception.code,'usage')
        with self.assertRaises(QuotaError) as caught:
            parser().parse_args(['sample','--session-id','run-a','--phase','start','--route','conductor'])
        self.assertEqual(caught.exception.code,'usage')
        result=self.command('runs','--route','conductor')
        self.assertEqual(result.returncode,2)
        self.assertEqual(json.loads(result.stdout)['error']['code'],'usage')

    def test_legacy_conductor_route_rows_stay_readable(self):
        start=now()
        pool=self.store.pool('cursor','legacy-owner')
        legacy_context=dict(self.context,auth='subscription',conductor_store=str(self.home/'Library/Application Support/com.conductor.app/cursor-sdk-store'))
        legacy_meta=dict(stage='implement',agent='cursor',model='composer-fixture',effort=None,route='conductor',auth='subscription',
                         context=legacy_context,model_vendor='cursor',gstack_extend_version='0.108.0',gstack_version=None,initial_harness_session=None)
        self.advance(30)
        end=now()
        legacy_state=dict(session_id='run-a',started_at=start,ended_at=end,lease_at=end,start_metadata=legacy_meta,metadata=legacy_meta,
                          attachments=[],identities={'cursor':{'pool':pool}},identities_at_finish={'cursor':{'pool':pool}},
                          outcome='unknown',fixture=True)
        source=dict(key='legacy-sdk:native',agent='cursor',session='native',parent=None,native_sdk=True,
                    cwd=self.context['cwd'],first=end-20,last=end-5,complete=True,reason=None)
        tokens=dict(input=12,cache_read=3,cache_write=0,output=5,reasoning=1)
        fact=dict(id='legacy-sdk-event',agent='cursor',session='native',source_keys=['legacy-sdk:native'],pool=pool,
                  ts=end-10,start=end-20,end=end-5,model='composer-fixture',tokens=tokens,
                  boundary=False,complete=True,why=[],turn_evidence='cursor-sdk')
        with self.store.transaction():
            self.store.put('state','run-a',legacy_state)
            placeholder,=ledger.run_rows(self.store,legacy_state,dict(roots=[],complete=True))
            self.store.put('run',json.dumps(['run-a','cursor',pool]),placeholder)
            self.store.put('source',source['key'],source)
            self.store.put('usage',fact['id'],fact)
        runs_res=self.command('runs')
        self.assertEqual(runs_res.returncode,0,runs_res.stdout+runs_res.stderr)
        runs=json.loads(runs_res.stdout)['runs']
        self.assertEqual(len(runs),1)
        self.assertEqual(runs[0]['route'],'conductor')
        self.assertEqual(runs[0]['consumption'],[dict(model='composer-fixture',**tokens,why={})])
        sum_res=self.command('summary','--by','route')
        self.assertEqual(sum_res.returncode,0,sum_res.stdout+sum_res.stderr)
        groups=json.loads(sum_res.stdout)['groups']
        group=next(g for g in groups if g['config']=={'route':'conductor'})
        self.assertEqual(group['run_count'],1)
        self.assertEqual(group['consumption']['input']['median'],12)
        self.assertEqual(group['consumption']['output']['median'],5)

    def test_stored_cursor_records_stay_readable_and_cursor_dirs_are_not_scanned(self):
        import importlib.util
        self.assertIsNone(importlib.util.find_spec('quota.cursor_cost'))
        self.assertIsNone(importlib.util.find_spec('quota.readers.cursor'))
        planted=self.home/'.cursor/projects/workspace-project/agent-transcripts/conv-planted/conv-planted.txt'
        planted.parent.mkdir(parents=True)
        planted.write_text('user:\nplanted cursor transcript\n')
        legacy_file=dict(agent='cursor',root=str(self.home/'.cursor/projects'),path=str(planted),key='legacy-file')
        with self.store.transaction():
            self.store.put('file','legacy-file',legacy_file)
        coverage=scan(self.store,self.context)
        self.assertFalse(any(r['agent']=='cursor' for r in coverage['roots']))
        self.assertEqual(self.store.all('source'),[])
        # A supported host can explicitly reuse the same root path.
        scan(self.store,dict(self.context,claude_config_dir=str(self.home/'.cursor')))
        self.assertEqual(self.store.get('file','legacy-file'),legacy_file)
        self.assertEqual(self.store.all('source'),[])
        start=now()
        pool=self.store.pool('cursor','stored-owner')
        conv_hash=self.store.digest('conv-stored','session')
        end=start+60
        self.advance(60)
        tokens=dict(input=100,cache_read=20,cache_write=0,output=40,reasoning=5)
        cursor_event=dict(id='ce-1',pool=pool,conversation_hash=conv_hash,event_ts=start+20,turn_start=start+10,turn_end=start+30,
                          evidence='cursor-api2',model='composer-fixture',tokens=tokens,charged_cents=15,ambiguous=False,
                          stable_reads=2,complete=True,revision=1)
        stored_meta=dict(stage='implement',agent='cursor',model='composer-fixture',effort=None,route='cli',auth='subscription',
                         context=self.context,model_vendor='cursor',gstack_extend_version='0.108.0',gstack_version=None,initial_harness_session=None)
        stored_state=dict(session_id='cursor-hist-1',started_at=start,ended_at=end,lease_at=end,start_metadata=stored_meta,metadata=stored_meta,
                          attachments=[dict(agent='cursor',session=conv_hash,attached_at=start)],
                          identities={'cursor':{'pool':pool}},identities_at_finish={'cursor':{'pool':pool}},outcome='unknown',fixture=True)
        stored_run=dict(v=1,session_id='cursor-hist-1',pool_kind='cursor',pool=pool,started_at=start,ended_at=end,
                        stage='implement',agent='cursor',model='composer-fixture',model_vendor='cursor',effort=None,route='cli',auth='subscription',
                        sources=[dict(source='cursor-api2',agent='cursor',kind='own',harness_session=conv_hash,model='composer-fixture',
                                      attribution='turn',status='ok',reason=None,why=[],consumption=[dict(model='composer-fixture',**tokens,why={})],
                                      event_ids=['ce-1'],observed_through=start+30,complete=True,outlived_stage=False,identity_evidence={'pool':pool})],
                        events=[dict(event_id='ce-1',charged_cents=15,attributable_cents=15,shared_turn=False,why=[])],
                        attributable_cents=15,shared_cents=0,consumption=[dict(model='composer-fixture',**tokens,why={})],why=[],
                        attribution='turn',settlement='final',revision=1,lifecycle='recorded',local_persisted_at=end,settled_at=end+300,
                        roots=[],complete=True,as_of=end,observed_through=start+30,stale=False,paused=False,outcome='unknown',fixture=True)
        native_source=dict(key='legacy-native',agent='cursor',session='native-conv',parent=None,native_sdk=True,
                           cwd=self.context['cwd'],first=start+5,last=start+25,complete=True,reason=None)
        native_fact=dict(id='legacy-native-u',agent='cursor',session='native-conv',source_keys=['legacy-native'],pool=pool,
                         ts=start+15,start=start+5,end=start+25,model='composer-fixture',tokens=tokens,boundary=False,complete=True,why=[])
        before_sample=dict(sample_id='cur-s1',pool=pool,pool_kind='cursor',status='ok',observed_at=start,meters=[])
        after_sample=dict(sample_id='cur-s2',pool=pool,pool_kind='cursor',status='ok',observed_at=end,meters=[])
        with self.store.transaction():
            self.store.put('state','cursor-hist-1',stored_state)
            self.store.put('run',json.dumps(['cursor-hist-1','cursor',pool]),stored_run)
            self.store.put('cursor_event','ce-1',cursor_event)
            self.store.put('cursor_coverage','cov-hist',dict(pool=pool,start=start,end=end,observed_at=end+10,complete=True,reason=None))
            self.store.put('source','legacy-native',native_source)
            self.store.put('usage','legacy-native-u',native_fact)
            self.store.put('sample','cur-s1',before_sample)
            self.store.put('sample','cur-s2',after_sample)
        runs_res=self.command('runs')
        self.assertEqual(runs_res.returncode,0,runs_res.stdout+runs_res.stderr)
        runs=json.loads(runs_res.stdout)['runs']
        row=next(r for r in runs if r['session_id']=='cursor-hist-1')
        self.assertEqual(row['attributable_cents'],15)
        self.assertEqual(row['shared_cents'],0)
        self.assertEqual(row['settlement'],'final')
        self.assertIsNotNone(row['settled_at'])
        self.assertEqual(row['events'][0]['event_id'],'ce-1')
        self.assertEqual(row['sources'][0]['source'],'cursor-api2')
        sum_res=self.command('summary','--by','agent')
        self.assertEqual(sum_res.returncode,0,sum_res.stdout+sum_res.stderr)
        groups=json.loads(sum_res.stdout)['groups']
        cur_group=next(g for g in groups if g['config']=={'agent':'cursor'})
        self.assertEqual(cur_group['attributable_cents'],15)
        self.assertEqual(cur_group['consumption']['input']['median'],100)
        self.assertEqual(cur_group['consumption']['output']['median'],40)
        int_res=self.command('intervals')
        self.assertEqual(int_res.returncode,0,int_res.stdout+int_res.stderr)
        cur_intervals=[i for i in json.loads(int_res.stdout)['intervals'] if i['pool_kind']=='cursor']
        self.assertEqual(len(cur_intervals),1)
        self.assertEqual(cur_intervals[0]['charged_cents'],15)
        doc_res=self.command('doctor')
        self.assertEqual(doc_res.returncode,0,doc_res.stdout+doc_res.stderr)
        doc=json.loads(doc_res.stdout)
        self.assertIn('unsettled_cursor_rows',doc)
        self.assertEqual(doc['unsettled_cursor_rows'],0)

    @unittest.skipUnless(os.environ.get('EVALS_ALL')=='1','real-time timing is opt-in')
    def test_real_time_active_budget(self):
        ledger.lifecycle(self.store,self.args,self.context)
        path=self.write_claude()
        with path.open('a') as output:
            for _ in range(10000): output.write('{"ignored":"'+('x'*4900)+'"}\n')
        self.advance(30)
        started=time.monotonic()
        self.command('runs','--active','--session-id','run-a')
        self.assertLess(time.monotonic()-started,2)


if __name__=='__main__':
    unittest.main(verbosity=2)
