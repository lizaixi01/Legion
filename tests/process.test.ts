import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../src/process.js';
import { commandChecker } from '../src/checker.js';
import { parseCodexLog } from '../src/codex.js';

test('process captures stdin and raw output without shell interpolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-process-'));
  const text = 'spaces; $(not a command) `literal`';
  const result = await execute({ command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], cwd: root, logDir: root, input: text, timeoutMs: 2000 });
  assert.equal(result.status, 'completed');
  assert.equal(await readFile(join(root, 'stdout.jsonl'), 'utf8'), text);
});

test('timeout terminates the process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-process-'));
  const result = await execute({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: root, logDir: root, timeoutMs: 100 });
  assert.equal(result.status, 'timeout');
  assert.ok(result.durationMs < 5000);
});

test('external cancellation stops a running process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-process-'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    const result = await execute({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: root, logDir: root, timeoutMs: 5000, signal: controller.signal });
    assert.equal(result.status, 'cancelled');
  } finally { clearTimeout(timer); }
});

test('malformed checker output is an infrastructure error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-process-'));
  const report = await commandChecker({ command: '$node', args: ['-e', 'console.log("not-json")'], timeoutMs: 2000 })(root, root);
  assert.equal(report.checks[0]?.status, 'error');
});

test('Codex parser retains raw usage and requires a completed turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-process-'));
  const log = join(root, 'codex.jsonl');
  const usage = { input_tokens: 10, cached_input_tokens: 5, output_tokens: 2 };
  await writeFile(log, [JSON.stringify({ type: 'thread.started', thread_id: 'one' }), JSON.stringify({ type: 'turn.completed', usage })].join('\n'));
  assert.deepEqual(await parseCodexLog(log), { sessionId: 'one', completed: true, failed: false, usage: [usage] });
  await writeFile(log, '{"type":"turn.started"}\n');
  assert.equal((await parseCodexLog(log)).completed, false);
});
