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
from quota import usage, ledger, cursor_cost, intervals
from quota.index import scan
from quota.readers import claude, codex, cursor
from telemetry import harness_ancestor, claude_logs, codex_logs, grok_logs, parse_ts, valid_session, which, executable, config_enabled, config_value

assert 'CURSOR_API_KEY' not in os.environ, 'Quota tests inherited a live credential'
assert os.environ.get('GSTACK_EXTEND_QUOTA_FIXTURES'), 'Fixture mode required'
for binary in ('claude','codex','security','cursor-agent'):
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
        for path in ('.claude/projects','.codex/sessions','.cursor/projects','.grok/sessions','Library/Application Support/com.conductor.app/cursor-sdk-store'):
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
        self.assertIsNone(usage.tokens({'inputTokens':5,'outputTokens':2},'cursor')['cache_write'])

    def test_capacity_shapes_and_failures(self):
        for module,name in ((claude,'claude-usage'),(codex,'codex-rate-limits'),(cursor,'cursor-period')):
            body=json.loads((self.fixtures/(name+'.json')).read_text())['body']
            meters,partial=module.parse(body)
            self.assertTrue(meters)
            self.assertFalse(partial)
            with self.assertRaises(QuotaError):
                module.parse({})

    def test_ancestry_argv0_and_helpers(self):
        table={10:(20,'/tools/cursor-agent','node'),20:(1,'/tools/claude','node')}
        self.assertEqual(harness_ancestor({'claude','cursor'},table,10),'cursor')
        table[10]=(20,'/tools/claude','node')
        table[20]=(1,'/tools/cursor-agent','node')
        self.assertEqual(harness_ancestor({'claude','cursor'},table,10),'claude')
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

    def test_cursor_identity_collision_and_unknown_boundary(self):
        record=json.loads((self.fixtures/'cursor-events.json').read_text())['body']['usageEventsDisplay'][0]
        cursor_cost.ingest(self.store,[dict(record,id='first'),dict(record,id='second')])
        self.assertEqual(len(self.store.all('cursor_event')),2)
        self.args.agent='cursor'
        self.args.harness_session=record['conversationId']
        ledger.lifecycle(self.store,self.args,self.context)
        facts=cursor_cost.relationships(self.store)
        self.assertTrue(all(f['attributable_cents'] is None for f in facts))
        cursor_cost.ingest(self.store,[dict(record,chargedCents=1),dict(record,chargedCents=2)])
        self.assertTrue(any(f['ambiguous'] for f in self.store.all('cursor_event')))

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
        for command in ('status','runs','summary','sample','settle','intervals','doctor'):
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
        self.assertEqual(len(result['pools']),3)
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
        stub.write_text('#!/usr/bin/python3\nimport os,signal,time\nassert not any(k.startswith(("CLAUDE_CODE_","CONDUCTOR_")) or k=="CLAUDECODE" for k in os.environ)\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nprint("ready",flush=True)\ntime.sleep(30)\n')
        stub.chmod(0o755)
        os.environ.update(CLAUDECODE='1',CLAUDE_CODE_SESSION_ID='outer',CONDUCTOR_SESSION_ID='outer')
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

    def test_api_cursor_attachment_without_local_source_is_not_subscription(self):
        self.args.auth='api'
        ledger.lifecycle(self.store,self.args,self.context)
        self.args.phase='attach'
        self.args.agent='cursor'
        self.args.harness_session='cursor-attachment'
        ledger.lifecycle(self.store,self.args,self.context)
        state=self.store.get('state','run-a')
        self.advance(30)
        cursor_cost.ingest(self.store,[dict(id='attached-bill',timestamp=now()-10,conversationId='cursor-attachment',owningUser='fixture-owner',model='fixture',chargedCents=25)])
        self.assertEqual(cursor_cost.relationships(self.store),[])
        pool=self.store.all('cursor_event')[0]['pool']
        before=dict(pool=pool,pool_kind='cursor',observed_at=state['started_at'],sample_id='before',meters=[])
        cursor_cost.record_coverage(self.store,pool,state['started_at'],now(),True)
        interval=intervals.interval(self.store,before,None,dict(complete=True,roots=[],uncovered_roots=[]))
        self.assertEqual(interval['event_count'],0)
        self.assertIsNone(interval['charged_cents'])

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
            rows=refresh(self.dir/'state',['claude','cursor'],self.context,force=True)
        self.assertEqual(len(rows),2)
        failed=next(row for row in rows if row['pool_kind']=='claude')
        self.assertEqual((failed['status'],failed['reason']),('unavailable','timeout'))
        self.assertEqual(next(row for row in rows if row['pool_kind']=='cursor')['status'],'ok')

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

    def test_cursor_shared_turn_cadence_and_late_revision(self):
        self.args.agent='cursor'
        self.args.harness_session='conversation-a'
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(10)
        self.args.session_id='run-b'
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(40)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        self.args.session_id='run-a'
        ledger.lifecycle(self.store,self.args,self.context)
        record=dict(id='event-a',timestamp=(now()-30)*1000,conversationId='conversation-a',owningUser='owner',model='grok-fixture',chargedCents=3,
                    turnStartedAt=(now()-45)*1000,turnEndedAt=(now()-5)*1000)
        cursor_cost.ingest(self.store,[record])
        before=cursor_cost.relationships(self.store)
        self.advance(600)
        cursor_cost.ingest(self.store,[record])
        after=cursor_cost.relationships(self.store)
        self.assertTrue(all(link['shared_turn'] for link in after))
        self.assertEqual([(x['session_id'],x['shared_turn'],x['turn_end']) for x in before],[(x['session_id'],x['shared_turn'],x['turn_end']) for x in after])
        self.advance(49*3600)
        cursor_cost.ingest(self.store,[dict(record,chargedCents=9)])
        revised=cursor_cost.relationships(self.store)
        self.assertTrue(all(x['settlement']=='final' and x['revision']==2 for x in revised))
        result=json.loads(self.command('summary').stdout)
        self.assertEqual(result['shared_cents'],9)

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

    def test_cursor_exchange_budget_across_store_connections(self):
        with mock.patch('quota.readers.cursor.fixture_dir',return_value=None), mock.patch('quota.readers.cursor.credential_key',return_value='fixture-exchange-key'), mock.patch('quota.readers.cursor.response',return_value={'accessToken':'fixture-access'}):
            cursor.token(self.store,time.monotonic()+1)
            other=Store(self.dir/'state')
            try:
                with self.assertRaises(QuotaError) as caught:
                    cursor.token(other,time.monotonic()+1)
                self.assertEqual(caught.exception.code,'exchange_throttled')
                self.advance(61)
                cursor.token(other,time.monotonic()+1)
                self.assertEqual(other.get('counter','cursor_exchanges')['count'],2)
            finally:
                other.close()

    def test_sandbox_disables_network_and_pool_switch_keeps_usage(self):
        from quota.samples import sample_one
        context=dict(self.context,sandboxed=True)
        for kind in ('claude','cursor','codex'):
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

    def test_cursor_distinct_accounts_and_pending_resolution(self):
        self.args.agent='cursor'
        self.args.auth='unknown'
        self.args.harness_session='conversation-a'
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        record=dict(timestamp=(now()-10)*1000,conversationId='conversation-a',model='grok-fixture',chargedCents=2)
        cursor_cost.ingest(self.store,[dict(record,id='a',owningUser='one'),dict(record,id='b',owningUser='two')])
        rows=json.loads(self.command('runs','--session-id','run-a').stdout)['runs']
        self.assertEqual(len(rows),2)
        self.assertEqual(len({r['pool'] for r in rows}),2)
        self.assertNotIn('pending',{r['pool'] for r in rows})
        self.assertTrue(all(r['resolves_pending'] for r in rows))

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

    def test_cursor_subagent_events_are_own_consumption(self):
        self.args.agent='cursor'
        self.args.harness_session='parent-conversation'
        ledger.lifecycle(self.store,self.args,self.context)
        child=self.store.digest('child-conversation','session')
        with self.store.transaction():
            self.store.put('source','subagent',dict(key='subagent',agent='cursor',session=child,parent=self.store.digest('parent-conversation','session'),first=now()+1,last=now()+20,complete=True))
        self.advance(30)
        record=dict(id='child-event',timestamp=(now()-10)*1000,conversationId='child-conversation',owningUser='fixture-owner',model='grok-fixture',chargedCents=2)
        cursor_cost.ingest(self.store,[record])
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        rows=cursor_cost.decorate(self.store,self.store.all('run'))
        self.assertTrue(any(s['kind']=='subagent' for r in rows for s in r['sources']))

    def test_cursor_expired_then_new_boundary_evidence_is_final(self):
        self.args.agent='cursor'
        self.args.harness_session='conversation-a'
        ledger.lifecycle(self.store,self.args,self.context)
        start=now()
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        record=dict(id='event-a',timestamp=(start+10)*1000,conversationId='conversation-a',owningUser='fixture-owner',model='grok-fixture',chargedCents=2)
        cursor_cost.ingest(self.store,[record])
        self.advance(49*3600)
        self.assertEqual(cursor_cost.relationships(self.store)[0]['settlement'],'expired')
        cursor_cost.ingest(self.store,[dict(record,chargedCents=3,turnStartedAt=(start+5)*1000,turnEndedAt=(start+20)*1000)])
        self.assertEqual(cursor_cost.relationships(self.store)[0]['settlement'],'final')

    def test_cursor_without_events_expires_and_late_events_recover(self):
        self.args.agent='cursor'
        self.args.harness_session='conversation-a'
        ledger.lifecycle(self.store,self.args,self.context)
        start=now()
        self.advance(30)
        self.args.phase='finish'
        ledger.lifecycle(self.store,self.args,self.context)
        original=self.store.all('run')
        self.assertEqual(cursor_cost.decorate(self.store,copy.deepcopy(original))[0]['settlement'],'provisional')
        self.advance(48*3600)
        expired=cursor_cost.decorate(self.store,copy.deepcopy(original))[0]
        self.assertEqual((expired['settlement'],expired['lifecycle']),('expired','expired'))
        self.assertIn('expired',expired['why'])
        self.assertIsNone(expired['attributable_cents'])
        record=dict(id='late-event',timestamp=(start+10)*1000,conversationId='conversation-a',owningUser='fixture-owner',model='grok-fixture',chargedCents=2,
                    turnStartedAt=(start+5)*1000,turnEndedAt=(start+20)*1000)
        cursor_cost.ingest(self.store,[record])
        self.advance(61)
        cursor_cost.ingest(self.store,[record])
        recovered=cursor_cost.decorate(self.store,[expired])[0]
        self.assertEqual(recovered['settlement'],'final')
        self.assertEqual(recovered['attributable_cents'],2)
        self.assertNotIn('expired',recovered['why'])

    def test_cursor_intervals_require_account_and_range_event_coverage(self):
        from quota.samples import sample_one
        before=sample_one(self.dir/'state','cursor',self.context,'periodic')
        self.advance(120)
        after=sample_one(self.dir/'state','cursor',self.context,'periodic',force=True)
        coverage=dict(complete=True,roots=[],uncovered_roots=[])
        result=intervals.interval(self.store,before,after,coverage)
        self.assertTrue(result['complete'])
        endpoint=self.fixtures/'cursor-events.json'
        original=endpoint.read_text()
        endpoint.write_text(json.dumps(dict(status=500,body={})))
        self.advance(120)
        failed=sample_one(self.dir/'state','cursor',self.context,'periodic',force=True)
        self.assertEqual(failed['status'],'ok')  # Capacity still works.
        result=intervals.interval(self.store,before,failed,coverage)
        self.assertFalse(result['complete'])
        self.assertFalse(result['calibration_eligible'])
        self.assertIn('http_5xx',result['why'])
        endpoint.write_text(original)
        self.advance(120)
        recovered=sample_one(self.dir/'state','cursor',self.context,'periodic',force=True)
        self.assertTrue(intervals.interval(self.store,before,recovered,coverage)['complete'])
        self.advance(7*3600)
        sample_one(self.dir/'state','cursor',self.context,'periodic',force=True)
        self.assertTrue(intervals.interval(self.store,before,recovered,coverage)['complete'])
        self.assertFalse(intervals.interval(self.store,dict(before,pool='cursor:other'),recovered,coverage)['complete'])
        self.assertFalse(intervals.interval(self.store,dict(before,observed_at=before['observed_at']-7*3600),recovered,coverage)['complete'])
        cursor_cost.record_coverage(self.store,recovered['pool'],before['observed_at'],recovered['observed_at'],False)
        self.assertFalse(intervals.interval(self.store,before,recovered,coverage)['complete'])

    def test_cursor_settle_records_complete_and_failed_event_coverage(self):
        from quota.samples import sample_one
        before=sample_one(self.dir/'state','cursor',self.context,'periodic')
        self.args.agent='cursor'
        self.args.harness_session='fixture-conversation'
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(120)
        after=dict(before,sample_id='after',observed_at=now())
        coverage=dict(complete=True,roots=[],uncovered_roots=[])
        result=cursor_cost.settle(self.store,self.context)
        self.assertTrue(result['complete'])
        self.assertTrue(intervals.interval(self.store,before,after,coverage)['complete'])
        # Match the fixture credential identity to the previously observed pool.
        identities=self.fixtures/'identities.json'
        data=json.loads(identities.read_text())
        data['cursor']['id']='fixture-owner'
        identities.write_text(json.dumps(data))
        (self.fixtures/'cursor-events.json').write_text(json.dumps(dict(status=500,body={})))
        result=cursor_cost.settle(self.store,self.context)
        self.assertEqual(result['reason'],'http_5xx')
        interval=intervals.interval(self.store,before,after,coverage)
        self.assertFalse(interval['complete'])
        self.assertIn('http_5xx',interval['why'])

    def test_cursor_cwd_slug_collapses_adjacent_punctuation(self):
        cwd=str(self.home/'work trees'/'...punctuation--project')
        slug='-'.join(part for part in __import__('re').split(r'[^a-zA-Z0-9]+',cwd) if part)
        path=self.home/'.cursor/projects'/slug/'agent-transcripts'/'native-conversation'/'native-conversation.txt'
        path.parent.mkdir(parents=True)
        path.write_text('user:\nfixture prompt\nassistant:\nfixture answer\n')
        scan(self.store,dict(self.context,cwd=cwd,repo_root=cwd))
        source=next(source for source in self.store.all('source') if source.get('agent')=='cursor')
        self.assertEqual(source['cwd'],cwd)
        self.assertEqual(source['session'],self.store.digest('native-conversation','session'))
        self.assertEqual(source['reason'],'not_reported')
        with self.store.transaction():
            for file in self.store.all('file'):
                file['parser'].pop('cwd',None)
                self.store.put('file',file['key'],file)
        scan(self.store,dict(self.context,cwd=cwd,repo_root=cwd))
        self.assertEqual(self.store.all('source')[0]['cwd'],cwd)

    def test_native_cursor_api_auth_stays_out_of_subscription_interval(self):
        self.args.agent='cursor'
        self.args.auth='api'
        self.args.harness_session=None
        ledger.lifecycle(self.store,self.args,self.context)
        self.advance(30)
        state=self.store.get('state','run-a')
        pool=state['identities']['cursor']['pool']
        source=dict(key='sdk',agent='cursor',session='native',parent=None,native_sdk=True,cwd=self.context['cwd'],first=now()-20,last=now()-5,complete=True)
        ambiguous=[source,dict(source,key='other',session='another-native')]
        self.assertFalse(ledger.uses_api_auth(source,state,ambiguous))
        fact=dict(id='sdk-event',agent='cursor',session='native',source_keys=['sdk'],pool=pool,ts=now()-10,model='fixture',tokens={key:1 for key in usage.CLASSES})
        with self.store.transaction():
            self.store.put('source','sdk',source)
            self.store.put('usage',fact['id'],fact)
        coverage=dict(complete=True,roots=[],uncovered_roots=[])
        rows=ledger.run_rows(self.store,state,coverage)
        self.assertEqual({row['pool_kind'] for row in rows},{'api'})
        cursor_cost.ingest(self.store,[dict(id='native-bill',timestamp=now()-10,conversationId='native',owningUser='fixture-owner',model='fixture',chargedCents=2)])
        # Bind the synthetic event to the same already-hashed native session.
        with self.store.transaction():
            for event in self.store.all('cursor_event'):
                event.update(conversation_hash='native',pool=pool)
                self.store.put('cursor_event',event['id'],event)
        self.assertEqual(cursor_cost.relationships(self.store),[])
        self.assertEqual({row['pool_kind'] for row in cursor_cost.decorate(self.store,rows)},{'api'})
        before=dict(pool=pool,pool_kind='cursor',observed_at=state['started_at'],sample_id='before',meters=[])
        cursor_cost.record_coverage(self.store,pool,state['started_at'],now(),True)
        self.assertEqual(intervals.interval(self.store,before,None,coverage)['event_count'],0)

    def test_historical_intervals_load_cursor_coverage_once(self):
        pool=self.store.pool('cursor','fixture-owner')
        start=now()
        with self.store.transaction():
            for i in range(25):
                row=dict(sample_id=str(i),pool=pool,pool_kind='cursor',status='ok',observed_at=start+i,meters=[])
                self.store.put('sample',str(i),row)
        self.advance(30)
        cursor_cost.record_coverage(self.store,pool,start,now(),True)
        with mock.patch.object(self.store,'all',wraps=self.store.all) as reads:
            rows=intervals.intervals(self.store,dict(complete=True,roots=[],uncovered_roots=[]))
        self.assertEqual(len(rows),24)
        self.assertTrue(all(row['complete'] for row in rows))
        self.assertEqual(sum(call.args==('cursor_coverage',) for call in reads.call_args_list),1)
        self.advance(10)
        cursor_cost.record_coverage(self.store,pool,start+4,start+12,False,'http_5xx')
        self.advance(10)
        cursor_cost.record_coverage(self.store,pool,start+8,start+18,True)
        coverage=dict(complete=True,roots=[],uncovered_roots=[])
        batched=intervals.intervals(self.store,coverage)
        samples=sorted(self.store.all('sample'),key=lambda row:row['observed_at'])
        individually=[intervals.interval(self.store,left,right,coverage) for left,right in zip(samples,samples[1:])]
        self.assertEqual(batched,individually)

    def test_cursor_paging_budget_is_independent_from_snapshot(self):
        calls=[]
        def page(name,url,deadline,token,body):
            calls.append(body['page'])
            return {'usageEventsDisplay':[{}]*1000,'totalUsageEventsCount':21000}
        with mock.patch('quota.readers.cursor.response',side_effect=page):
            rows,complete,_=cursor.events(self.store,time.monotonic()+1,now()-100,now())
        self.assertEqual(len(rows),20000)
        self.assertFalse(complete)
        self.assertEqual(calls,list(range(1,21)))

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

    def test_cursor_fallback_identity_keeps_models_distinct(self):
        record=dict(timestamp=now()*1000,conversationId='conversation',owningUser='owner',model='one',chargedCents=1)
        cursor_cost.ingest(self.store,[record,dict(record,model='two')])
        self.assertEqual(len(self.store.all('cursor_event')),2)

    def test_cursor_collision_survives_a_later_single_page(self):
        record=dict(timestamp=now(),conversationId='collision',model='model',owningUser='account',chargedCents=3)
        cursor_cost.ingest(self.store,[record,dict(record,chargedCents=9)])
        self.assertTrue(self.store.all('cursor_event')[0]['ambiguous'])
        cursor_cost.ingest(self.store,[record])
        self.assertTrue(self.store.all('cursor_event')[0]['ambiguous'])

    def test_settle_and_probe_honor_pool_and_network_gates(self):
        with mock.patch.object(cursor,'events',side_effect=AssertionError('must not fetch')):
            result=cursor_cost.settle(self.store,self.context,'claude')
            self.assertTrue(result['complete'])
            self.assertEqual(cursor_cost.settle(self.store,self.context,'cursor:other')['reason'],'identity_unknown')
            self.assertEqual(cursor_cost.settle(self.store,dict(self.context,sandboxed=True))['reason'],'sandboxed')
            (self.dir/'state/config').write_text('quota_pools=claude\n')
            self.assertEqual(cursor_cost.settle(self.store,self.context)['reason'],'disabled')
        result=self.command('probe','cursor','--raw')
        self.assertEqual(result.returncode,1)
        self.assertEqual(json.loads(result.stdout)['error']['code'],'disabled')
        result=self.command('probe','claude','--raw','--pool','claude:other')
        self.assertEqual(json.loads(result.stdout)['error']['code'],'identity_unknown')

    def test_cursor_text_is_identity_evidence_but_not_zero_tokens(self):
        import re
        slug=re.sub(r'[^a-zA-Z0-9]','-',self.context['cwd']).strip('-')
        transcript=self.home/'.cursor/projects'/slug/'agent-transcripts/conversation/conversation.txt'
        transcript.parent.mkdir(parents=True)
        transcript.write_text('user:\nA fixture conversation with no usage fields.\n')
        result=scan(self.store,self.context)
        self.assertFalse(result['complete'])
        source=self.store.all('source')[0]
        self.assertEqual(source['session'],self.store.digest('conversation','session'))
        self.assertEqual(source['cwd'],self.context['cwd'])
        self.assertEqual(source['reason'],'not_reported')
        self.assertEqual(scan(self.store,self.context)['bytes_read'],0)

    def test_json_records_with_invalid_shapes_do_not_abort_scan(self):
        path=self.home/'.codex/sessions/malformed.jsonl'
        path.write_text(json.dumps(dict(type='event_msg',payload=['invalid']))+'\n')
        result=scan(self.store,self.context)
        self.assertFalse(result['complete'])
        self.assertEqual(self.store.all('file')[0]['reason'],'malformed_record')

    def test_interval_revises_cursor_cents_and_excludes_own_children_from_concurrency(self):
        from quota.samples import sample_one
        before=sample_one(self.dir/'state','cursor',self.context,'periodic')
        parent=self.store.digest('parent','session')
        child=self.store.digest('child','session')
        with self.store.transaction():
            self.store.put('source','parent',dict(session=parent,parent=None))
            self.store.put('source','child',dict(session=child,parent=parent))
        event=dict(id='billing-event',owningUser='fixture-cursor-owner',conversationId='child',timestamp=now()+10,
                   model='billed-model',chargedCents=3,turnStartedAt=now()+5,turnEndedAt=now()+15)
        cursor_cost.ingest(self.store,[event])
        event_pool=self.store.pool('cursor',event['owningUser'])
        before=dict(before,pool=event_pool)
        self.advance(30)
        after=dict(before,sample_id='after',observed_at=now())
        coverage=dict(complete=True,roots=[],uncovered_roots=[])
        first=intervals.interval(self.store,before,after,coverage)
        self.assertEqual(first['charged_cents'],3)
        cursor_cost.ingest(self.store,[dict(event,chargedCents=9)])
        second=intervals.interval(self.store,before,after,coverage)
        self.assertEqual(second['charged_cents'],9)
        self.assertFalse(second['calibration_eligible'])
        self.assertEqual(len(intervals.activity_groups(self.store,{parent,child})),1)

    def test_disable_and_backoff_override_a_recent_ok_sample(self):
        from quota.samples import sample_one
        from quota.identity import identity
        sample_one(self.dir/'state','claude',self.context,'periodic')
        (self.dir/'state/config').write_text('quota_pools=cursor\n')
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
