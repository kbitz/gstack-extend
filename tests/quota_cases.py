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

    def test_probe_honors_pool_and_network_gates(self):
        (self.dir/'state/config').write_text('quota_pools=codex\n')
        result=self.command('probe','claude','--raw')
        self.assertEqual(result.returncode,1)
        self.assertEqual(json.loads(result.stdout)['error']['code'],'disabled')
        (self.dir/'state/config').write_text('quota_pools=claude,codex\n')
        result=self.command('probe','claude','--raw','--pool','claude:other')
        self.assertEqual(json.loads(result.stdout)['error']['code'],'identity_unknown')

    def test_json_records_with_invalid_shapes_do_not_abort_scan(self):
        path=self.home/'.codex/sessions/malformed.jsonl'
        path.write_text(json.dumps(dict(type='event_msg',payload=['invalid']))+'\n')
        result=scan(self.store,self.context)
        self.assertFalse(result['complete'])
        self.assertEqual(self.store.all('file')[0]['reason'],'malformed_record')

    def test_activity_groups_excludes_own_children_from_concurrency(self):
        parent=self.store.digest('parent','session')
        child=self.store.digest('child','session')
        with self.store.transaction():
            self.store.put('source','parent',dict(session=parent,parent=None))
            self.store.put('source','child',dict(session=child,parent=parent))
        self.assertEqual(len(intervals.activity_groups(self.store,{parent,child})),1)

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
        for pool,value,model in [('claude:one',3,'model-a'),('codex:two',9,'model-b')]:
            ident=pool
            facts.append(dict(id=ident,model=model,tokens={key:value for key in usage.CLASSES}))
            rows.append(dict(session_id='one-run',started_at=now(),pool=pool,pool_kind=pool.split(':')[0],stage='build',agent='claude',model='requested',
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
        self.assertEqual(telemetry.route_for('cursor')[0],'unknown')
        os.environ['CURSOR_INVOKED_AS']='cursor-agent'
        self.assertEqual(telemetry.route_for('cursor')[0],'unknown')
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
        import argparse
        legacy_args=argparse.Namespace(session_id='run-a',phase='start',stage='implement',agent='codex',model='gpt-fixture',
                                       effort=None,route='conductor',auth='subscription',harness_session='legacy-codex-session')
        legacy_context=dict(self.context,auth='subscription')
        ledger.lifecycle(self.store,legacy_args,legacy_context)
        self.advance(30)
        state=self.store.get('state','run-a')
        pool=state['identities']['codex']['pool']
        session_hash=self.store.digest('legacy-codex-session','session')
        source=dict(key='legacy-codex:src',agent='codex',session=session_hash,parent=None,
                    cwd=self.context['cwd'],first=now()-20,last=now()-5,complete=True,reason=None)
        tokens=dict(input=12,cache_read=3,cache_write=0,output=5,reasoning=1)
        fact=dict(id='legacy-codex-event',agent='codex',session=session_hash,source_keys=['legacy-codex:src'],pool=pool,
                  ts=now()-10,start=now()-20,end=now()-5,model='gpt-fixture',tokens=tokens,
                  boundary=False,complete=True,why=[])
        with self.store.transaction():
            self.store.put('source',source['key'],source)
            self.store.put('usage',fact['id'],fact)
        finish_args=argparse.Namespace(session_id='run-a',phase='finish',stage=None,agent=None,model=None,
                                       effort=None,route=None,auth=None,harness_session=None)
        ledger.lifecycle(self.store,finish_args,self.context)
        runs_res=self.command('runs')
        self.assertEqual(runs_res.returncode,0,runs_res.stdout+runs_res.stderr)
        runs=json.loads(runs_res.stdout)['runs']
        self.assertEqual(len(runs),1)
        self.assertEqual(runs[0]['route'],'conductor')
        self.assertEqual(runs[0]['consumption'],[dict(model='gpt-fixture',**tokens,why={})])
        sum_res=self.command('summary','--by','route')
        self.assertEqual(sum_res.returncode,0,sum_res.stdout+sum_res.stderr)
        groups=json.loads(sum_res.stdout)['groups']
        group=next(g for g in groups if g['config']=={'route':'conductor'})
        self.assertEqual(group['run_count'],1)
        self.assertEqual(group['consumption']['input']['median'],12)
        self.assertEqual(group['consumption']['output']['median'],5)

    def test_removed_cursor_cli_surface_exits_usage(self):
        cases=[
            ('settle',),
            ('status','--cursor-projects-dir',str(self.home)),
            ('runs','--cursor-projects-dir',str(self.home)),
            ('sample','--session-id','run-c','--phase','start','--cursor-projects-dir',str(self.home)),
            ('sample','--session-id','run-c','--phase','start','--agent','cursor'),
            ('sample','--session-id','run-c','--phase','attach','--agent','cursor','--harness-session','s1'),
            ('runs','--agent','cursor'),
            ('summary','--agent','cursor'),
            ('status','--pool','cursor'),
            ('status','--pool','cursor:abc123456789'),
            ('sample','--pool','cursor'),
            ('sample','--pool','cursor:abc123456789'),
            ('runs','--pool','cursor'),
            ('runs','--pool','cursor:abc123456789'),
            ('summary','--pool','cursor'),
            ('summary','--pool','cursor:abc123456789'),
            ('intervals','--pool','cursor'),
            ('intervals','--pool','cursor:abc123456789'),
            ('doctor','--pool','cursor'),
            ('doctor','--pool','cursor:abc123456789'),
            ('probe','cursor','--raw'),
        ]
        for argv in cases:
            with self.subTest(argv=argv):
                res=self.command(*argv)
                self.assertEqual(res.returncode,2,res.stdout+res.stderr)
                self.assertEqual(json.loads(res.stdout)['error']['code'],'usage')

    def test_legacy_cursor_store_loads_verbatim_and_never_recomputes(self):
        from quota.samples import sample_one
        # Seed a real Claude run and two Claude samples.
        before_claude=sample_one(self.dir/'state','claude',self.context,'periodic')
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude(output=7,ident='claude-msg-1')
        self.write_claude(output=3,ident='claude-msg-2',session='claude-child')
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        sample_one(self.dir/'state','claude',self.context,'periodic',force=True)

        # Seed every retired Cursor kind into SQLite alongside a provenance file
        # that would otherwise try to backfill null fields on the stored Cursor run.
        t0=before_claude['observed_at']
        cursor_pool='cursor:deadbeefcafe'
        cursor_run=dict(
            v=1,session_id='legacy-cursor-run',pool_kind='cursor',pool=cursor_pool,
            started_at=t0,ended_at=t0+20,stage=None,agent='cursor',model=None,effort=None,
            route='cli',auth='subscription',sources=[],consumption=None,why=['no_usage'],
            attribution='unknown',settlement='provisional',revision=1,lifecycle='recorded',
            local_persisted_at=t0+21,settled_at=None,roots=[],complete=False,as_of=t0+21,
            observed_through=None,stale=False,paused=False,outcome='unknown',fixture=True,
            events=[dict(event_id='ce-1',charged_cents=5,attributable_cents=5,shared_turn=False,why=[])],
        )
        open_cursor_state=dict(
            session_id='legacy-cursor-open',started_at=t0,ended_at=None,lease_at=t0,
            start_metadata=dict(stage='implement',agent='cursor',model=None,effort=None,route='cli',auth='subscription',context=self.context),
            metadata=dict(stage='implement',agent='cursor',model=None,effort=None,route='cli',auth='subscription',context=self.context),
            attachments=[dict(agent='cursor',session=self.store.digest('c-open','session'),attached_at=t0)],
            identities={},fixture=True,
        )
        unmarked_cursor_state=dict(
            session_id='legacy-cursor-unmarked',started_at=t0,ended_at=None,lease_at=t0,
            start_metadata=dict(stage='implement',agent=None,model=None,effort=None,route=None,auth='subscription',context=self.context),
            metadata=dict(stage='implement',agent=None,model=None,effort=None,route=None,auth='subscription',context=self.context),
            attachments=[dict(agent='cursor',session=self.store.digest('c-unmarked','session'),attached_at=t0)],
            identities={},fixture=True,
        )
        finished_cursor_state=dict(open_cursor_state,session_id='legacy-cursor-run',ended_at=t0+20)
        pending_cursor_run=dict(cursor_run,pool='pending')
        api_cursor_run=dict(cursor_run,session_id='legacy-cursor-api',pool='api',pool_kind='api',auth='api')
        cursor_source=dict(
            key='legacy-cursor-src',agent='cursor',session=self.store.digest('c-src','session'),
            parent=None,native_sdk=True,cwd=self.context['cwd'],first=t0+1,last=t0+15,
            complete=True,reason=None,
        )
        cursor_usage=dict(
            id='legacy-cursor-usage',agent='cursor',session=cursor_source['session'],
            source_keys=['legacy-cursor-src'],pool=cursor_pool,ts=t0+10,model='composer-1',
            tokens=dict(input=10,cache_read=0,cache_write=0,output=4,reasoning=0),
        )
        with self.store.transaction():
            self.store.put('sample','cs-1',dict(v=1,sample_id='cs-1',ts=t0,observed_at=t0,pool=cursor_pool,pool_kind='cursor',source='cursor-api2',status='ok',reason=None,meters=[],trigger='periodic',session_id=None,identity=None,raw_shape_hash=None,unknown_fields=[],fixture=True))
            self.store.put('sample','cs-2',dict(v=1,sample_id='cs-2',ts=t0+30,observed_at=t0+30,pool=cursor_pool,pool_kind='cursor',source='cursor-api2',status='ok',reason=None,meters=[],trigger='periodic',session_id=None,identity=None,raw_shape_hash=None,unknown_fields=[],fixture=True))
            self.store.put('meter','cm-1',dict(pool=cursor_pool,pool_kind='cursor',observed_at=t0,absent=False,meter=dict(meter='cursor:included_cents',used=100,limit=1000,unit='cents',resets_at=None,window_s=2592000,label='included cents')))
            self.store.put('state','legacy-cursor-open',open_cursor_state)
            self.store.put('state','legacy-cursor-unmarked',unmarked_cursor_state)
            self.store.put('state','legacy-cursor-run',finished_cursor_state)
            self.store.put('run',json.dumps(['legacy-cursor-run','cursor',cursor_pool]),cursor_run)
            self.store.put('run',json.dumps(['legacy-cursor-run','cursor','pending']),pending_cursor_run)
            self.store.put('run',json.dumps(['legacy-cursor-api','api','api']),api_cursor_run)
            self.store.put('source','legacy-cursor-src',cursor_source)
            self.store.put('file','legacy-cursor-file',dict(key='legacy-cursor-file',path=str(self.home/'.cursor/projects/x.jsonl'),root=str(self.home/'.cursor/projects'),agent='cursor',malformed=2,complete=False))
            self.store.put('usage','legacy-cursor-usage',cursor_usage)
            self.store.put('cursor_event','ce-1',dict(id='ce-1',pool=cursor_pool,conversation_hash=cursor_source['session'],event_ts=t0+10,model='composer-1',charged_cents=5,tokens=cursor_usage['tokens'],ambiguous=False,complete=True))
            self.store.put('cursor_coverage','cc-1',dict(pool=cursor_pool,start=t0,end=t0+30,complete=True,observed_at=t0+30))
            self.store.put('cursor_identity','ci-1',dict(pool=cursor_pool))
            self.store.put('exchange','ex-1',dict(ts=t0))
            self.store.count('cursor_exchanges')

        analytics=self.dir/'state/analytics'
        analytics.mkdir(parents=True,exist_ok=True)
        (analytics/'stage-runs.jsonl').write_text(json.dumps(dict(session_id='legacy-cursor-run',stage='should-not-fill',agent='codex',model='should-not-fill',effort='high',route='sdk'))+'\n')

        for cmd in (('status',),('runs',),('runs','--active'),('summary',),('intervals',),('doctor',)):
            res=self.command(*cmd)
            self.assertEqual(res.returncode,0,f'{cmd}: {res.stdout}{res.stderr}')

        status_doc=json.loads(self.command('status').stdout)
        self.assertEqual([p['pool_kind'] for p in status_doc['pools']],['claude','codex'])

        runs_doc=json.loads(self.command('runs').stdout)
        from quota.cli import public
        cursor_rows=[r for r in runs_doc['runs'] if r['session_id'].startswith('legacy-cursor-')]
        self.assertCountEqual(cursor_rows,public([cursor_run,pending_cursor_run,api_cursor_run]))
        claude_rows=[r for r in runs_doc['runs'] if r['session_id']=='run-a']
        self.assertEqual(len(claude_rows),1)
        self.assertFalse(any(s['agent']=='cursor' for s in claude_rows[0]['sources']))

        active_doc=json.loads(self.command('runs','--active').stdout)
        self.assertEqual(active_doc['runs'],[])

        summary_doc=json.loads(self.command('summary').stdout)
        self.assertEqual(summary_doc['shared_events'],[])
        self.assertEqual(summary_doc['shared_cents'],0)
        self.assertEqual(len(summary_doc['groups']),1)
        self.assertEqual(summary_doc['groups'][0]['config']['agent'],'claude')
        self.assertEqual(summary_doc['groups'][0]['consumption']['output']['median'],7)
        self.assertEqual(summary_doc['groups'][0]['excluded']['ambiguous'],1)

        intervals_doc=json.loads(self.command('intervals').stdout)
        self.assertTrue(intervals_doc['intervals'])
        self.assertTrue(all(i['pool_kind'] in ('claude','codex') for i in intervals_doc['intervals']))

        doctor_doc=json.loads(self.command('doctor').stdout)
        self.assertEqual([p['pool_kind'] for p in doctor_doc['pools']],['claude','codex'])
        self.assertNotIn('unsettled_cursor_rows',doctor_doc)
        self.assertEqual(doctor_doc['open_runs'],0)
        self.assertEqual(doctor_doc['malformed_records'],0)
        self.assertNotIn('cursor_exchanges',[counter['name'] for counter in doctor_doc['counters']])

        saved_states=self.store.all('state')
        saved_runs=self.store.all('run')
        for sid in ('legacy-cursor-open','legacy-cursor-unmarked'):
            for phase in ('attach','finish','abandon'):
                with self.subTest(sid=sid,phase=phase):
                    res=self.command('sample','--session-id',sid,'--phase',phase,
                                     '--agent','claude','--harness-session','session-a')
                    self.assertEqual(res.returncode,1,res.stdout+res.stderr)
                    self.assertEqual(json.loads(res.stdout)['error']['code'],'conflict')
        self.assertEqual(self.store.all('state'),saved_states)
        self.assertEqual(self.store.all('run'),saved_runs)

    def test_start_replays_supported_state_with_retired_context_option(self):
        receipt=ledger.lifecycle(self.store,self.args,self.context)
        state=self.store.get('state','run-a')
        state['start_metadata']['context']['cursor_projects_dir']=str(self.home/'.cursor/projects')
        with self.store.transaction():
            self.store.put('state','run-a',state)
        self.assertEqual(ledger.lifecycle(self.store,self.args,self.context),receipt)

    def test_unknown_agent_cursor_state_and_api_run_are_read_only(self):
        sid='legacy-unknown-cursor'
        stamp=now()
        metadata=dict(agent='unknown',auth='api',context=self.context)
        state=dict(session_id=sid,started_at=stamp,ended_at=None,lease_at=stamp,
                   start_metadata=metadata,metadata=metadata,identities={},fixture=True,
                   attachments=[dict(agent='cursor',session='legacy-cursor-session',attached_at=stamp)])
        row=dict(v=1,session_id=sid,pool_kind='api',pool='pending',agent='unknown',
                 auth='api',started_at=stamp,ended_at=stamp,sources=[],attribution='unknown',
                 settlement='final',stage=None,model=None)
        with self.store.transaction():
            self.store.put('state',sid,state)
            self.store.put('run',json.dumps([sid,'api','pending']),row)
        analytics=self.dir/'state/analytics'
        analytics.mkdir(exist_ok=True)
        (analytics/'stage-runs.jsonl').write_text(json.dumps(dict(session_id=sid,stage='review',agent='claude',model='should-not-fill'))+'\n')

        active=json.loads(self.command('runs','--active').stdout)['runs']
        self.assertEqual(active,[])
        from quota.cli import public
        self.assertEqual(json.loads(self.command('runs').stdout)['runs'],public([row]))
        self.assertEqual(json.loads(self.command('summary').stdout)['groups'],[])
        result=self.command('sample','--session-id',sid,'--phase','finish')
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertEqual(json.loads(result.stdout)['error']['code'],'conflict')
        self.assertEqual(self.store.get('state',sid),state)

    def test_legacy_cursor_state_keeps_claude_api_facts_out_of_subscription(self):
        from quota.samples import sample_one
        before=sample_one(self.dir/'state','claude',self.context,'periodic')
        self.args.auth='api'
        ledger.lifecycle(self.store,self.args,self.context)
        self.write_claude(output=19)
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        after=sample_one(self.dir/'state','claude',self.context,'periodic',force=True)
        state=self.store.get('state','run-a')
        state['start_metadata']['agent']='cursor'
        state['attachments'].append(dict(agent='cursor',session='legacy-cursor-session',attached_at=state['started_at']))
        coverage=scan(self.store,self.context)
        self.assertEqual(len(self.store.usage_between(before['observed_at'],after['observed_at'])),1)
        for final_agent in ('claude','cursor'):
            with self.subTest(final_agent=final_agent):
                state['metadata']['agent']=final_agent
                with self.store.transaction():
                    self.store.put('state','run-a',state)
                bracket=intervals.interval(self.store,before,after,coverage)
                self.assertEqual(bracket['event_count'],0)
                self.assertEqual(bracket['consumption'],[])


        # An old finish can persist its terminal metadata before finalizing the
        # outer state. It still provides evidence for the supported attachment.
        pending=dict(state,ended_at=None,finishing=dict(state,metadata=dict(state['metadata'],agent='claude')))
        pending['metadata']=dict(state['metadata'],agent='cursor',auth='subscription')
        pending['attachments']=[dict(agent='cursor',session='legacy-cursor-session',attached_at=state['started_at'])]
        with self.store.transaction():
            self.store.put('state','run-a',pending)
        self.assertEqual(intervals.interval(self.store,before,after,coverage)['event_count'],0)

    def test_unmarked_cursor_api_row_is_preserved_without_state(self):
        from quota.cli import public
        sid='legacy-api-row'
        row=dict(v=1,session_id=sid,pool_kind='api',pool='api',agent=None,
                 auth='api',started_at=now(),ended_at=now(),attribution='exact',settlement='final',
                 sources=[dict(agent='cursor',attribution='exact',complete=True,event_ids=['old-fact'])])
        with self.store.transaction():
            self.store.put('run',json.dumps([sid,'api','api']),row)
            self.store.put('usage','old-fact',dict(id='old-fact',agent='cursor',ts=now(),pool='api',
                                                 model='legacy-model',tokens=dict(output=5)))
        self.assertEqual(json.loads(self.command('runs').stdout)['runs'],public([row]))
        self.assertEqual(json.loads(self.command('summary').stdout)['groups'],[])

    def test_late_supported_api_usage_replaces_retired_projection(self):
        self.args.auth='api'
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        with self.store.transaction():
            row=dict(self.store.all('run')[0],pool='api',
                     sources=[dict(agent='cursor',source='retired')])
            key=json.dumps(['run-a','api','api'])
            self.store.put('run',key,row)
        self.write_claude(output=17)

        result=self.command('runs','--agent','claude','--pool','api')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        rows=json.loads(result.stdout)['runs']
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['consumption'][0]['output'],17)
        self.assertEqual(self.store.get('run',key),row)

    def test_native_cursor_history_with_unknown_attachment_still_loads(self):
        from quota.cli import public
        sid='native-cursor'
        session=self.store.digest('native-cursor-source','session')
        t0=now()
        metadata=dict(agent=None,context=self.context,auth='subscription')
        state=dict(session_id=sid,started_at=t0,ended_at=t0+20,lease_at=t0+20,
                   metadata=metadata,start_metadata=metadata,identities={},fixture=True,
                   attachments=[dict(agent='unknown',session=session,attached_at=t0)])
        row=dict(v=1,session_id=sid,agent=None,pool_kind='cursor',pool='pending',
                 started_at=t0,ended_at=t0+20,sources=[],settlement='provisional',
                 attribution='unknown',stage=None)
        with self.store.transaction():
            self.store.put('state',sid,state)
            self.store.put('state',sid+'-open',dict(state,session_id=sid+'-open',ended_at=None))
            self.store.put('run',json.dumps([sid,'cursor','pending']),row)
            self.store.put('source','sdk-source',dict(key='sdk-source',agent='cursor',session=session,
                                                      native_sdk=True,complete=False,reason='malformed_record'))
            self.store.put('file','sdk-file',dict(key='sdk-file',agent='cursor-sdk',root=str(self.home/'legacy-sdk'),malformed=1))
            self.store.put('usage','sdk-fact',dict(id='sdk-fact',agent='cursor',session=session,pool='unresolved',
                                                  source_keys=['sdk-source'],ts=t0+4))

        for cmd in (('runs',),('runs','--active'),('summary',)):
            with self.subTest(command=cmd):
                result=self.command(*cmd)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn(public(row),json.loads(self.command('runs').stdout)['runs'])
        self.assertIsNone(self.store.get('state',sid+'-open')['ended_at'])
        with self.subTest('archived SDK facts'):
            for cmd in ('status','intervals'):
                result=json.loads(self.command(cmd).stdout)
                self.assertEqual(result['coverage']['unresolved_events'],0)
        with self.subTest('archived SDK files'):
            self.assertEqual(json.loads(self.command('doctor').stdout)['malformed_records'],0)

    def test_reused_root_indexes_supported_file_without_rewriting_legacy_inventory(self):
        root=self.home/'.claude/projects'
        transcript=self.write_claude()
        saved=[]
        for path, agent in ((root/'legacy.txt','cursor'),(transcript,'cursor'),(root/'legacy.ndjson','cursor-sdk')):
            if path!=transcript:
                path.write_text('not a Claude transcript\n')
            key=self.store.digest(str(path),'file')
            saved.append(dict(key=key,path=str(path),root=str(root),agent=agent,complete=False,
                              malformed=1,reason='malformed_record'))
        with self.store.transaction():
            for retired in saved:
                self.store.put('file',retired['key'],retired)
        coverage=scan(self.store,self.context)
        self.assertEqual([self.store.get('file',retired['key']) for retired in saved],saved)
        self.assertTrue(coverage['complete'])
        self.assertEqual([fact['agent'] for fact in self.store.all('usage')],['claude'])

    def test_cursor_modules_and_root_removed(self):
        self.assertFalse((ROOT/'bin/lib/quota/readers/cursor.py').exists())
        self.assertFalse((ROOT/'bin/lib/quota/cursor_cost.py').exists())
        planted=self.home/'.cursor/projects/proj/agent-transcripts/conv/conv.jsonl'
        planted.parent.mkdir(parents=True)
        planted.write_text(json.dumps(dict(role='assistant',message='fixture'))+'\n')
        coverage=scan(self.store,self.context)
        self.assertFalse(any(r['agent']=='cursor' or '.cursor' in r['root'] for r in coverage['roots']))
        self.assertFalse(any(f['agent']=='cursor' for f in self.store.all('file')))

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
