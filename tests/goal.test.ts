import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../src/run.js';
import type { RunConfig, RunDependencies } from '../src/types.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'goal-manager-'));
  const config: RunConfig = { goal: 'deliver', mode: 'goal', requiredChecks: ['integration'], workspace: root, runDir: join(root, 'run'), initialMs: 1000, repairMs: 1000, totalMs: 5000 };
  return config;
}

test('goal continues beyond two attempts until the required check passes', async () => {
  const config = await setup();
  let calls = 0;
  const state = await run(config, {
    worker: async request => { if (calls > 0) assert.equal(request.sessionId, 'original'); calls++; return { status: 'completed', sessionId: 'original', durationMs: 1, usage: [] }; },
    check: async () => ({ checks: [{ id: 'integration', status: calls < 4 ? 'fail' : 'pass', detail: 'integration result' }], artifacts: [] }),
  });
  assert.equal(calls, 4);
  assert.equal(state.status, 'checks_passed');
});

test('missing required check cannot be replaced by an unrelated pass', async () => {
  const config = await setup();
  const state = await run(config, {
    worker: async () => ({ status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }),
    check: async () => ({ checks: [{ id: 'irrelevant', status: 'pass', detail: '' }], artifacts: [] }),
  });
  assert.equal(state.status, 'unverified');
  assert.equal(state.attempts.length, 1);
});

test('cooperative pause resumes at a clean checkpoint without losing session or evidence', async () => {
  const config = await setup();
  let calls = 0;
  const deps: RunDependencies = {
    worker: async request => {
      calls++;
      if (calls === 1) await writeFile(join(config.runDir, 'pause.request'), 'pause');
      else assert.equal(request.sessionId, 'original');
      return { status: 'completed', sessionId: 'original', durationMs: 1, usage: [] };
    },
    check: async () => ({ checks: [{ id: 'integration', status: calls === 1 ? 'fail' : 'pass', detail: 'result' }], artifacts: [] }),
  };
  const paused = await run(config, deps);
  assert.equal(paused.status, 'paused');
  const before = await readFile(join(config.runDir, 'attempt-1', 'check.json'), 'utf8');
  const done = await run(config, deps, { resume: true });
  assert.equal(done.status, 'checks_passed');
  assert.equal(done.id, paused.id);
  assert.equal(done.attempts.length, 2);
  assert.equal(await readFile(join(config.runDir, 'attempt-1', 'check.json'), 'utf8'), before);
});

test('explicit attempt cap stops goal mode and cannot be bypassed with resume', async () => {
  const config = { ...await setup(), maxAttempts: 3 };
  const deps: RunDependencies = {
    worker: async () => ({ status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }),
    check: async () => ({ checks: [{ id: 'integration', status: 'fail', detail: '' }], artifacts: [] }),
  };
  const result = await run(config, deps);
  assert.equal(result.status, 'checks_failed');
  assert.equal(result.attempts.length, 3);
  await assert.rejects(run(config, deps, { resume: true }), /paused/);
});

test('a pause does not replenish the deadline, and config edits are rejected', async () => {
  const config = await setup();
  let calls = 0;
  const deps: RunDependencies = {
    worker: async () => { calls++; await writeFile(join(config.runDir, 'pause.request'), 'pause'); return { status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }; },
    check: async () => ({ checks: [{ id: 'integration', status: 'fail', detail: '' }], artifacts: [] }),
  };
  await run(config, deps);
  await assert.rejects(run({ ...config, goal: 'changed goal' }, deps, { resume: true }), /configuration/);
  const path = join(config.runDir, 'state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  saved.startedAt = new Date(Date.now() - 10_000).toISOString();
  await writeFile(path, JSON.stringify(saved));
  const result = await run(config, deps, { resume: true });
  assert.equal(result.status, 'timeout');
  assert.equal(calls, 1);
});

test('required not_checked evidence prevents completion even when another check passes', async () => {
  const config = await setup();
  const result = await run(config, {
    worker: async () => ({ status: 'completed', sessionId: 'one', durationMs: 1, usage: [] }),
    check: async () => ({ checks: [{ id: 'integration', status: 'not_checked', detail: '' }, { id: 'format', status: 'pass', detail: '' }], artifacts: [] }),
  });
  assert.equal(result.status, 'unverified');
});
