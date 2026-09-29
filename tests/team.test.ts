import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTeam, evidencePolicy, type TeamTask } from '../src/team.js';
import { hash } from '../src/provenance.js';

const task = (id: string, dependsOn: string[] = []): TeamTask => ({ id, goal: id, dependsOn, routes: ['first', 'alternative'], requiredChecks: ['ok'], outputs: ['result.txt'] });
const report = (status: 'pass' | 'fail' | 'not_checked') => ({ checks: [{ id: 'ok', status, detail: status }], artifacts: [] });
const root = async () => join(await mkdtemp(join(tmpdir(), 'team-')), 'run');

test('parallel independent sessions hand off only verified snapshots to dependent work', async () => {
  const seen = new Set<string>(); let active = 0; let peak = 0;
  const state = await runTeam({ runDir: await root(), tasks: [task('a'), task('b'), task('c', ['a', 'b'])], concurrency: 2, maxAttempts: 4, attemptMs: 2000, totalMs: 10000 }, {
    worker: async (request, unit) => {
      assert.ok(!seen.has(request.workspace)); seen.add(request.workspace);
      active++; peak = Math.max(peak, active);
      if (unit.id === 'c') for (const id of ['a', 'b']) assert.equal(await readFile(join(request.workspace, 'inputs', id, 'result.txt'), 'utf8'), id);
      await new Promise(resolve => setTimeout(resolve, 20));
      await writeFile(join(request.workspace, 'result.txt'), unit.id); active--;
      return { status: 'completed', sessionId: unit.id, durationMs: 1, usage: [] };
    }, check: async () => report('pass'),
  });
  assert.equal(state.status, 'completed'); assert.equal(peak, 2);
  assert.equal(state.tasks.a?.artifacts[0]?.sha256, hash('a'));
});

test('evidence policy resumes once then switches to a fresh route and session', async () => {
  const workspaces: string[] = []; const sessions: (string | undefined)[] = []; let calls = 0;
  const state = await runTeam({ runDir: await root(), tasks: [task('a')], concurrency: 1, maxAttempts: 4, attemptMs: 2000, totalMs: 10000 }, {
    worker: async r => { calls++; workspaces.push(r.workspace); sessions.push(r.sessionId); await writeFile(join(r.workspace, 'result.txt'), 'ok'); return { status: 'completed', sessionId: calls < 3 ? 'one' : 'two', durationMs: 1, usage: [] }; },
    check: async () => report(calls < 3 ? 'fail' : 'pass'),
  });
  assert.equal(state.status, 'completed'); assert.deepEqual(sessions, [undefined, 'one', undefined]);
  assert.equal(workspaces[0], workspaces[1]); assert.notEqual(workspaces[1], workspaces[2]);
});

test('missing evidence invokes verifier without rerunning worker; failures block dependents', async () => {
  let calls = 0; let verifies = 0;
  const state = await runTeam({ runDir: await root(), tasks: [task('a'), task('b', ['a'])], concurrency: 1, maxAttempts: 2, attemptMs: 2000, totalMs: 10000 }, {
    worker: async () => { calls++; return { status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }; },
    check: async () => report('not_checked'), verify: async () => { verifies++; return report('not_checked'); },
  });
  assert.equal(calls, 1); assert.equal(verifies, 1); assert.equal(state.tasks.a?.status, 'unverified'); assert.equal(state.tasks.b?.status, 'blocked');
});

test('passing checks cannot hand off missing declared artifacts', async () => {
  const state = await runTeam({ runDir: await root(), tasks: [task('a'), task('b', ['a'])], concurrency: 1, maxAttempts: 2, attemptMs: 2000, totalMs: 10000 }, {
    worker: async () => ({ status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }), check: async () => report('pass'),
  });
  assert.equal(state.tasks.a?.status, 'error'); assert.equal(state.tasks.b?.status, 'blocked');
});

test('cycles and escaping output paths are rejected before execution', async () => {
  const deps = { worker: async () => { throw Error('must not execute'); }, check: async () => report('pass') };
  for (const tasks of [[task('a', ['b']), task('b', ['a'])], [{ ...task('a'), outputs: ['../secret'] }]]) {
    await assert.rejects(runTeam({ runDir: await root(), tasks, concurrency: 1, maxAttempts: 2, attemptMs: 1000, totalMs: 5000 }, deps));
  }
  assert.equal(typeof evidencePolicy, 'function');
});

test('Master cannot override a failing checker with acceptance', async () => {
  const state = await runTeam({ runDir: await root(), tasks: [task('a')], concurrency: 1, maxAttempts: 2, attemptMs: 1000, totalMs: 5000 }, {
    worker: async () => ({ status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }), check: async () => report('fail'),
    decide: () => ({ action: 'accept', reason: 'Trust me' }),
  });
  assert.equal(state.tasks.a?.status, 'error'); assert.match(state.tasks.a?.reason ?? '', /cannot accept/);
});

test('supplementary verification cannot conceal a newly found failure', async () => {
  const unit = { ...task('a'), requiredChecks: ['ok', 'more'] }; let calls = 0;
  const state = await runTeam({ runDir: await root(), tasks: [unit], concurrency: 1, maxAttempts: 1, attemptMs: 1000, totalMs: 5000 }, {
    worker: async () => { calls++; return { status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }; }, check: async () => report('pass'),
    verify: async () => ({ checks: [{ id: 'ok', status: 'fail', detail: 'Counterexample' }, { id: 'more', status: 'pass', detail: 'Covered' }], artifacts: [] }),
  });
  assert.equal(calls, 1); assert.equal(state.tasks.a?.status, 'failed');
});

test('artifact digest mismatch refuses handoff and blocks reversed dependency chains', async () => {
  const state = await runTeam({ runDir: await root(), tasks: [task('c', ['b']), task('b', ['a']), task('a')], concurrency: 1, maxAttempts: 2, attemptMs: 1000, totalMs: 5000 }, {
    worker: async r => { await writeFile(join(r.workspace, 'result.txt'), 'different'); return { status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }; },
    check: async () => ({ ...report('pass'), artifacts: [{ path: 'result.txt', sha256: hash('checked version') }] }),
  });
  assert.equal(state.tasks.a?.status, 'error'); assert.equal(state.tasks.b?.status, 'blocked'); assert.equal(state.tasks.c?.status, 'blocked');
});

test('checker infrastructure errors stop without spending another attempt', async () => {
  let calls = 0;
  const state = await runTeam({ runDir: await root(), tasks: [task('a')], concurrency: 1, maxAttempts: 4, attemptMs: 1000, totalMs: 5000 }, {
    worker: async () => { calls++; return { status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }; },
    check: async () => ({ checks: [{ id: 'runtime', status: 'error', detail: 'tool unavailable' }], artifacts: [] }),
  });
  assert.equal(calls, 1); assert.equal(state.tasks.a?.status, 'error');
});

test('cancellation propagates to active workers and prevents queued starts', async () => {
  const controller = new AbortController(); let calls = 0;
  const state = await runTeam({ runDir: await root(), tasks: [task('a'), task('b')], concurrency: 1, maxAttempts: 2, attemptMs: 1000, totalMs: 5000 }, {
    signal: controller.signal,
    worker: async r => { calls++; controller.abort(); assert.equal(r.signal?.aborted, true); return { status: 'cancelled', durationMs: 1, usage: [] }; },
    check: async () => { throw Error('Must not check a cancelled worker'); },
  });
  assert.equal(calls, 1); assert.equal(state.tasks.a?.status, 'cancelled'); assert.equal(state.tasks.b?.status, 'cancelled');
});

test('evidence persistence failure cancels a running sibling before returning', async () => {
  let stopped = false;
  await assert.rejects(runTeam({ runDir: await root(), tasks: [task('a'), task('b')], concurrency: 2, maxAttempts: 1, attemptMs: 1000, totalMs: 5000 }, {
    worker: async (r, unit) => {
      if (unit.id === 'a') {
        await new Promise<void>(resolve => { if (r.signal!.aborted) resolve(); else r.signal!.addEventListener('abort', () => resolve(), { once: true }); });
        stopped = true; return { status: 'cancelled', durationMs: 1, usage: [] };
      }
      return { status: 'completed', sessionId: 'b', durationMs: 1, usage: [] };
    }, check: async () => report('pass'),
    onEvent: e => { if (e.type === 'check_started') throw Error('evidence unavailable'); },
  }), /evidence unavailable/);
  assert.equal(stopped, true);
});

test('Master receives history and budget, and guidance reaches only the next worker call', async () => {
  let calls = 0;
  const state = await runTeam({ runDir: await root(), tasks: [task('a')], concurrency: 1, maxAttempts: 2, attemptMs: 1000, totalMs: 5000 }, {
    worker: async r => {
      calls++; if (calls === 2) { assert.match(r.prompt, /Fix the counterexample/); assert.equal(r.sessionId, 'one'); }
      await writeFile(join(r.workspace, 'result.txt'), 'ok'); return { status: 'completed', sessionId: 'one', durationMs: 1, usage: [] };
    }, check: async () => report(calls === 1 ? 'fail' : 'pass'),
    decide: (input, context) => {
      assert.equal(input.history?.length, calls); assert.equal(input.remainingAttempts, 2 - calls); assert.ok(context.remainingMs > 0);
      return calls === 1 ? { action: 'resume', reason: 'Explicit failure', guidance: 'Fix the counterexample' } : { action: 'accept', reason: 'Passed' };
    },
  });
  assert.equal(state.status, 'completed');
});

test('cancellation during Master reasoning prevents accepting a passed artifact', async () => {
  const controller = new AbortController();
  const state = await runTeam({ runDir: await root(), tasks: [task('a')], concurrency: 1, maxAttempts: 2, attemptMs: 1000, totalMs: 5000 }, {
    signal: controller.signal,
    worker: async r => { await writeFile(join(r.workspace, 'result.txt'), 'ok'); return { status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }; },
    check: async () => report('pass'), decide: (_input, context) => { controller.abort(); assert.equal(context.signal.aborted, true); return { action: 'accept', reason: 'Late response' }; },
  });
  assert.equal(state.tasks.a?.status, 'cancelled'); assert.deepEqual(state.tasks.a?.artifacts, []);
});

test('competition replays candidates before selection and rejects stale passing evidence',async()=>{
 let checks=0;
 const state=await runTeam({runDir:await root(),tasks:[task('a')],competition:2,concurrency:1,maxAttempts:2,attemptMs:2000,totalMs:10000},{
  worker:async request=>{await writeFile(join(request.workspace,'result.txt'),'ok');return {status:'completed',sessionId:request.workspace,durationMs:1,usage:[]};},
  check:async(_workspace,evidence)=>{checks++;return report(evidence.includes('selection-')?'fail':'pass');}
 });
 assert.equal(checks,4);assert.equal(state.status,'incomplete');assert.equal(state.tasks.a?.selectedCandidate,undefined);
 assert.equal(state.tasks.a?.candidates?.['candidate-1']?.status,'accepted');
});

test('competition cancellation reaches both candidates and blocks delivery',async()=>{
 const controller=new AbortController();let calls=0;
 const state=await runTeam({runDir:await root(),tasks:[task('a')],competition:2,concurrency:1,maxAttempts:2,attemptMs:2000,totalMs:10000},{signal:controller.signal,
  worker:async request=>{calls++;if(calls===2)controller.abort();await new Promise<void>(resolve=>{if(request.signal!.aborted)resolve();else request.signal!.addEventListener('abort',()=>resolve(),{once:true});});return {status:'cancelled',durationMs:1,usage:[]};},
  check:async()=>{throw Error('Must not check cancelled candidate');}
 });
 assert.equal(calls,2);assert.equal(state.tasks.a?.status,'cancelled');assert.equal(state.status,'incomplete');
});

test('competition preserves dependency handoff and uses declared order when both candidates pass',async()=>{
 const state=await runTeam({runDir:await root(),tasks:[task('a'),task('b',['a'])],competition:2,concurrency:1,maxAttempts:2,attemptMs:2000,totalMs:10000},{
  worker:async(request,unit)=>{if(unit.id==='b')assert.equal(await readFile(join(request.workspace,'inputs','a','result.txt'),'utf8'),'a');await writeFile(join(request.workspace,'result.txt'),unit.id);return {status:'completed',sessionId:request.workspace,durationMs:1,usage:[]};},
  check:async(workspace,_evidence,_signal,unit)=>{if(unit.id==='b')assert.equal(await readFile(join(workspace,'inputs','a','result.txt'),'utf8'),'a');return report('pass');}
 });
 assert.equal(state.status,'completed');assert.equal(state.tasks.a?.selectedCandidate,'candidate-1');assert.equal(state.tasks.b?.selectedCandidate,'candidate-1');
});
test('checker without artifact hashes cannot certify bytes changed during verification',async()=>{
 const state=await runTeam({runDir:await root(),tasks:[task('a')],concurrency:1,maxAttempts:1,attemptMs:2000,totalMs:10000},{worker:async r=>{await writeFile(join(r.workspace,'result.txt'),'original');return {status:'completed',sessionId:'a',durationMs:1,usage:[]};},check:async workspace=>{await writeFile(join(workspace,'result.txt'),'changed');return report('pass');}});
 assert.notEqual(state.tasks.a?.status,'accepted');assert.match(state.tasks.a?.reason??'',/changed/);
});
test('downstream cannot silently change the pinned dependency copy',async()=>{
 const state=await runTeam({runDir:await root(),tasks:[task('a'),task('b',['a'])],concurrency:1,maxAttempts:1,attemptMs:2000,totalMs:10000},{worker:async(r,t)=>{if(t.id==='b')await writeFile(join(r.workspace,'inputs','a','result.txt'),'changed dependency');await writeFile(join(r.workspace,'result.txt'),'output');return {status:'completed',sessionId:t.id,durationMs:1,usage:[]};},check:async()=>report('pass')});assert.notEqual(state.tasks.b?.status,'accepted');
});
