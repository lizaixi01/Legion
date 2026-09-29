import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';
import type { CheckStatus } from '../src/types.js';

test('B1 repairs once in the original session and retains both checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-test-'));
  const requests: Array<{ sessionId?: string }> = [];
  let checks = 0;
  const result = await run({ goal: 'deliver', mode: 'B1', workspace: root, runDir: join(root, 'evidence'), initialMs: 1000, repairMs: 1000, totalMs: 3000 }, {
    worker: async (request) => {
      requests.push(request);
      return { status: 'completed', sessionId: 'original', durationMs: 1, usage: [] };
    },
    check: async () => ({ checks: [{ id: 'contract', status: ++checks === 1 ? 'fail' : 'pass', detail: 'fixture' }], artifacts: [] }),
  });
  assert.equal(result.status, 'checks_passed');
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.sessionId, 'original');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.check?.checks[0]?.status, 'fail');
  assert.equal(JSON.parse(await readFile(join(root, 'evidence', 'state.json'), 'utf8')).status, 'checks_passed');
});

for (const scenario of [
  { mode: 'B0', check: 'fail', expected: 'checks_failed' },
  { mode: 'B1', check: 'pass', expected: 'checks_passed' },
  { mode: 'B1', check: 'error', expected: 'error' },
  { mode: 'B1', check: 'not_checked', expected: 'unverified' },
] as const) {
  test(`${scenario.mode} ${scenario.check} stops without an extra attempt`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'manager-test-'));
    let calls = 0;
    const result = await run({ goal: 'deliver', mode: scenario.mode, workspace: root, runDir: join(root, 'evidence'), initialMs: 1000, repairMs: 1000, totalMs: 3000 }, {
      worker: async () => { calls++; return { status: 'completed', sessionId: 'session', durationMs: 1, usage: [] }; },
      check: async () => ({ checks: [{ id: 'check', status: scenario.check as CheckStatus, detail: '' }], artifacts: [] }),
    });
    assert.equal(result.status, scenario.expected);
    assert.equal(calls, 1);
  });
}

test('B1 cannot loop past two failed attempts and refuses an existing run directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-test-'));
  const config = { goal: 'deliver', mode: 'B1' as const, workspace: root, runDir: join(root, 'evidence'), initialMs: 1000, repairMs: 1000, totalMs: 3000 };
  let calls = 0;
  const deps = {
    worker: async () => { calls++; return { status: 'completed' as const, sessionId: 'session', durationMs: 1, usage: [] }; },
    check: async () => ({ checks: [{ id: 'check', status: 'fail' as const, detail: '' }], artifacts: [] }),
  };
  const result = await run(config, deps);
  assert.equal(result.status, 'checks_failed');
  assert.equal(calls, 2);
  await assert.rejects(run(config, deps), /EEXIST/);
  assert.equal(calls, 2);
});

test('worker timeout never triggers checker or repair', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-test-'));
  let checks = 0;
  const result = await run({ goal: 'deliver', mode: 'B1', workspace: root, runDir: join(root, 'evidence'), initialMs: 10, repairMs: 10, totalMs: 1000 }, {
    worker: async () => ({ status: 'timeout', durationMs: 10, usage: [] }),
    check: async () => { checks++; return { checks: [], artifacts: [] }; },
  });
  assert.equal(result.status, 'timeout');
  assert.equal(result.attempts.length, 1);
  assert.equal(checks, 0);
});

test('missing resume identity is an error, not a fresh retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-test-'));
  const result = await run({ goal: 'deliver', mode: 'B1', workspace: root, runDir: join(root, 'evidence'), initialMs: 10, repairMs: 10, totalMs: 1000 }, {
    worker: async () => ({ status: 'completed', durationMs: 1, usage: [] }),
    check: async () => ({ checks: [{ id: 'test', status: 'fail', detail: '' }], artifacts: [] }),
  });
  assert.equal(result.status, 'error');
  assert.equal(result.attempts.length, 1);
});

test('two managers cannot concurrently write the same workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-lock-'));
  const config = { goal: 'deliver', mode: 'B0' as const, workspace: root, runDir: join(root, 'one'), initialMs: 1000, repairMs: 1000, totalMs: 3000 };
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  const deps = {
    worker: async () => { started(); await paused; return { status: 'completed' as const, durationMs: 1, usage: [] }; },
    check: async () => ({ checks: [{ id: 'ok', status: 'pass' as const, detail: '' }], artifacts: [] }),
  };
  const first = run(config, deps);
  await entered;
  try { await assert.rejects(run({ ...config, runDir: join(root, 'two') }, deps), /Workspace is locked/); }
  finally { release(); await first; }
});
