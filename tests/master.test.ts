import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedActions, parseMasterDecision, codexMaster } from '../src/master.js';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DecisionInput } from '../src/team.js';

const input = (status: 'pass' | 'fail' | 'error' | 'not_checked'): DecisionInput => ({ task: { id: 'a', goal: 'deliver', routes: ['one', 'two'], dependsOn: [], requiredChecks: ['ok'], outputs: ['result.txt'] }, route: 0, routeAttempts: 1, report: { checks: [{ id: 'ok', status, detail: 'evidence' }], artifacts: [] }, verified: false, canVerify: true, remainingAttempts: 2, remainingMs: 1000, history: [] });
test('Master legal actions follow evidence and remaining budget', () => {
  assert.deepEqual(allowedActions(input('fail')), ['resume', 'switch', 'stop']);
  assert.deepEqual(allowedActions(input('pass')), ['accept', 'stop']);
  assert.deepEqual(allowedActions(input('error')), ['stop']);
  assert.deepEqual(allowedActions(input('not_checked')), ['verify', 'stop']);
  assert.deepEqual(allowedActions({ ...input('fail'), remainingAttempts: 0 }), ['stop']);
});

test('Master transport uses read-only scope, bounded time and retains separate usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'master-'));
  const decide = codexMaster({ command: 'codex', model: 'gpt-6-sol', effort: 'high', timeoutMs: 10000 }, async request => {
    assert.equal(request.args[request.args.indexOf('--sandbox') + 1], 'read-only');
    assert.equal(request.timeoutMs, 500);
    assert.ok(request.input?.includes('untrusted data'));
    const response = request.args[request.args.indexOf('--output-last-message') + 1]!;
    await writeFile(response, JSON.stringify({ action: 'resume', reason: 'Fix explicit failure', guidance: 'Correct result' }));
    await writeFile(join(request.logDir, 'stdout.jsonl'), '{"type":"thread.started","thread_id":"master-only"}\n{"type":"turn.completed","usage":{"output_tokens":12}}\n');
    return { status: 'completed', durationMs: 10, exitCode: 0 };
  });
  const decision = await decide(input('fail'), { evidenceDir: join(root, 'evidence'), signal: new AbortController().signal, remainingMs: 500 });
  assert.equal(decision.action, 'resume');
  assert.equal(JSON.parse(await readFile(join(root, 'evidence', 'usage.json'), 'utf8')).sessionId, 'master-only');
});

test('Master process failure is not replaced by an unlogged rule decision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'master-'));
  const decide = codexMaster({ command: 'codex', model: 'gpt-6-sol', effort: 'high', timeoutMs: 1000 }, async () => ({ status: 'timeout', exitCode: null, durationMs: 1000 }));
  await assert.rejects(async () => decide(input('fail'), { evidenceDir: join(root, 'evidence'), signal: new AbortController().signal, remainingMs: 1000 }), /Master process timeout/);
});
test('structured Master output rejects invented actions and acceptance without evidence', () => {
  assert.throws(() => parseMasterDecision('{"action":"accept","reason":"Trust me","guidance":null}', input('fail')));
  assert.throws(() => parseMasterDecision('{"action":"change_goal","reason":"easier","guidance":null}', input('fail')));
  assert.throws(() => parseMasterDecision('```json\n{}\n```', input('fail')));
  assert.deepEqual(parseMasterDecision('{"action":"resume","reason":"Specific counterexample","guidance":"Fix full flag"}', input('fail')), { action: 'resume', reason: 'Specific counterexample', guidance: 'Fix full flag' });
});
