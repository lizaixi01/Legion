import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexArguments, parseCodexLog } from '../src/codex.js';

test('Windows workers retain explicit sandbox configuration on initial and resumed calls', () => {
  for (const session of [undefined, 'saved-session']) {
    const args = codexArguments('gpt-6-sol', 'high', session, 'win32');
    const boundary = session ? args.indexOf('resume') : args.length;
    const global = args.slice(0, boundary);
    assert.equal(global[global.indexOf('--sandbox') + 1], 'workspace-write');
    assert.ok(global.includes('windows.sandbox="elevated"'));
    assert.ok(global.includes('approval_policy="never"'));
    assert.ok(!args.some(arg => arg.includes('danger-full-access')));
    if (session) assert.equal(args[boundary + 1], session);
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-sol');
  }
});

test('non-Windows workers do not receive Windows sandbox configuration', () => {
  assert.ok(!codexArguments('gpt-6-sol', 'high', undefined, 'linux').some(arg => arg.startsWith('windows.')));
});

test('usage-limit rejections are retained and classified as infrastructure, not task outcomes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-codex-'));
  const log = join(root, 'codex.jsonl');
  const message = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 4th, 2026 8:34 AM.";
  await writeFile(log, [JSON.stringify({ type: 'thread.started', thread_id: 'one' }), JSON.stringify({ type: 'error', message }), JSON.stringify({ type: 'turn.failed', error: { message } })].join('\n'));
  const parsed = await parseCodexLog(log);
  assert.equal(parsed.completed, false);
  assert.equal(parsed.failed, true);
  assert.equal(parsed.failure?.kind, 'usage-limit');
  assert.match(parsed.failure!.message, /usage limit/);
});

test('a transient reconnect notice does not fail a turn that later completes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-codex-'));
  const log = join(root, 'codex.jsonl');
  const notice = 'Reconnecting... 1/5 (unexpected status 502 Bad Gateway: Model transport failed, url: http://127.0.0.1:8091/backend-api/codex/responses)';
  await writeFile(log, [JSON.stringify({ type: 'thread.started', thread_id: 'one' }), JSON.stringify({ type: 'error', message: notice }), JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } })].join('\n'));
  const parsed = await parseCodexLog(log);
  assert.equal(parsed.completed, true);
  assert.equal(parsed.failed, false);
  assert.equal(parsed.failure, undefined);
});

test('an error notice without a completed turn still surfaces as the failure reason', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-codex-'));
  const log = join(root, 'codex.jsonl');
  await writeFile(log, [JSON.stringify({ type: 'thread.started', thread_id: 'one' }), JSON.stringify({ type: 'error', message: 'Reconnecting... 5/5 (unexpected status 502 Bad Gateway)' })].join('\n'));
  const parsed = await parseCodexLog(log);
  assert.equal(parsed.completed, false);
  assert.equal(parsed.failed, false);
  assert.equal(parsed.failure?.kind, 'provider-error');
});

test('other provider failures stay generic and a completed turn stays successful', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-codex-'));
  const log = join(root, 'codex.jsonl');
  await writeFile(log, JSON.stringify({ type: 'error', message: 'internal server error' }));
  assert.equal((await parseCodexLog(log)).failure?.kind, 'provider-error');
  await writeFile(log, JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
  const ok = await parseCodexLog(log);
  assert.equal(ok.completed, true);
  assert.equal(ok.failure, undefined);
});
