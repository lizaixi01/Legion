import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigSchema, loadConfig } from '../src/config.js';
import { commandChecker } from '../src/checker.js';
import { fingerprint } from '../src/provenance.js';

test('config rejects non-finite/zero budgets and unknown keys', () => {
  const base = { goal: 'work', workspace: '.', checker: { command: 'node', args: [] } };
  assert.equal(ConfigSchema.safeParse({ ...base, initialMs: 0 }).success, false);
  assert.equal(ConfigSchema.safeParse({ ...base, totalMs: Infinity }).success, false);
  assert.equal(ConfigSchema.safeParse({ ...base, modle: 'typo' }).success, false);
});

test('evidence cannot live inside the worker workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-config-'));
  await mkdir(join(root, 'work'));
  const file = join(root, 'task.json');
  await writeFile(file, JSON.stringify({ goal: 'work', workspace: './work', output: './work/evidence', checker: { command: 'node', args: [] } }));
  await assert.rejects(loadConfig(file), /outside/);
});

test('modified checker cannot produce a trusted pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-config-'));
  const file = join(root, 'check.mjs');
  await writeFile(file, 'console.log("original")');
  const checker = { command: '$node', args: [file], timeoutMs: 1000 };
  const expected = await fingerprint(checker.command, checker.args);
  await writeFile(file, 'console.log("modified")');
  const report = await commandChecker(checker, expected)(root, root);
  assert.equal(report.checks[0]?.status, 'error');
  assert.match(report.checks[0]?.detail ?? '', /changed/);
});

test('dot-prefixed directories and symlink aliases cannot bypass evidence separation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manager-config-'));
  await mkdir(join(root, 'work'));
  await symlink(join(root, 'work'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const file = join(root, 'task.json');
  for (const output of ['./work/..evidence', './alias/evidence']) {
    await writeFile(file, JSON.stringify({ goal: 'work', workspace: './work', output, checker: { command: 'node', args: [] } }));
    await assert.rejects(loadConfig(file), /outside/);
  }
});
