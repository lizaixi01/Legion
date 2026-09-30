import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  EXCLUDED_DIRS, SaasBenchConfigSchema, advanceLifecycle, applyProfile, assertNoEvaluatorLeak, buildWorkerPrompt,
  containerCodex, createSaasBenchAdapter, defaultSaasBenchConfig, evaluateFrozenRun, extractPromptSection, judgeCredentials, readEnvValue,
  loadPublicInputs, placeholderAuth, readLifecycle, recordUsage, redact, renderPrompt, resolveTaskPaths,
  runEvaluation, runSaasBench, saasBenchRunDir, singlePolicyDecision, startLifecycle, summarizeEvaluation,
  workspaceDigest, type ShellRunner,
} from '../src/saasbench.js';
import { hash } from '../src/provenance.js';
import { linuxPath } from '../src/programbench.js';
import type { ProcessRequest, ProcessResult } from '../src/process.js';

/* ------------------------------------------------------------------ fixtures */

const project = process.cwd();
const tsxCli = join(project, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const REPOSITORY = '/home/tester/benchmarks/SaaSBench';

const PROMPT_FOR_MODEL = `# SaaSBench Test Prompt — task_kmasmnil

> **How to use:** operator notes that must never reach the worker.

---

## Prompt

> **<!-- _BENCH_ANTI_CHEAT_BANNER -->Mandatory anti-cheat policy.** Implement the
> platform from scratch. Cloning an existing open-source codebase is forbidden.

You are a senior full-stack engineer. Build the platform inside \`xm_app\`.

---

## Tester Workflow

### Before testing: prepare the environment

\`\`\`bash
./prepare_workspace.sh
\`\`\`

Run ./test_model_output.sh afterwards.
`;

const TASK_SPEC = `# Experience Management Platform

## 1. Task Overview

Build a complete Experience Management platform listening on port 8024.
`;
const KNOWLEDGE_BASE = `{\n  "version": "1.0",\n  "task_id": "task_kmasmnil",\n  "clarifications": [\n    { "id": "KB-001", "answer": "All relations use onDelete: Cascade." }\n  ]\n}`;

const publicFiles = new Map<string, string>();
let lastWorkspacePath = `${REPOSITORY}/eval/task_kmasmnil/tasks/task_kmasmnil/docker/workspace`;
let lastEvaluatorPath = `${REPOSITORY}/eval/task_kmasmnil/check/task_kmasmnil_e`;

function lastWorkspace(): string { return lastWorkspacePath; }

/** A real directory tree with the official layout, so paths resolve to real files. */
async function fakeRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), 'saasbench-repo-'));
  const paths = resolveTaskPaths(repository);
  lastWorkspacePath = paths.workspace;
  lastEvaluatorPath = paths.hiddenDir;
  publicFiles.set(paths.publicPrompt, PROMPT_FOR_MODEL);
  publicFiles.set(paths.taskSpec, TASK_SPEC);
  publicFiles.set(paths.knowledgeBase, KNOWLEDGE_BASE);
  for (const [path, content] of publicFiles) {
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, content);
  }
  await mkdir(paths.workspace, { recursive: true });
  await writeFile(join(paths.workspace, 'package.json'), '{"name":"xm-platform"}');
  await writeFile(join(paths.workspace, 'server.js'), 'console.log("ready")');
  await mkdir(paths.evaluatorDir, { recursive: true });
  await writeFile(join(paths.evaluatorDir, 'dag.json'), '{"nodes":[]}');
  await writeFile(join(paths.evaluatorDir, 'scoring_config.json'), '{"total_maxScore":500}');
  return repository;
}

function configuration(repository: string, overrides: Record<string, unknown> = {}) {
  return SaasBenchConfigSchema.parse({
    repository,
    codex: '/home/tester/.cache/codex/bin/codex',
    auth: '/home/tester/.codex/auth.json',
    python: '/home/tester/benchmarks/SaaSBench/eval/.venv/bin/python',
    runsDir: join(tmpdir(), 'saasbench-runs'),
    ...overrides,
  });
}

interface HarnessOptions {
  workerStatus?: ProcessResult['status'];
  workerEvents?: unknown[];
  evaluator?: Record<string, unknown> | 'error';
  containerRunning?: string;
  workspaceEntries?: string;
  insideListeners?: string;
  hostPort?: string;
  mounts?: unknown[];
  gateway?: string;
  transportAlive?: string;
  transportReachable?: string;
  appCode?: string;
  onStep?: (step: string, request: ProcessRequest) => void;
}

interface Harness { run: ShellRunner; steps: { step: string; request: ProcessRequest; script: string }[]; }

/** Simulated WSL/container environment: no docker, no model and no network are involved. */
function harness(options: HarnessOptions = {}): Harness {
  const steps: Harness['steps'] = [];
  const run: ShellRunner = async (request: ProcessRequest) => {
    const script = await readFile(join(request.logDir, 'script.sh'), 'utf8').catch(() => '');
    const step = classify(script);
    steps.push({ step, request, script });
    options.onStep?.(step, request);
    await mkdir(request.logDir, { recursive: true });
    const stdout: string[] = [];
    let status: ProcessResult['status'] = 'completed';
    if (step === 'inputs') {
      for (const [path, content] of publicFiles) stdout.push(`<<<FILE ${linuxPath(path)}>>>`, Buffer.from(content, 'utf8').toString('base64'));
    } else if (step === 'verify') {
      stdout.push(
        `running=${options.containerRunning ?? 'true'}`,
        'containerId=abc123', 'image=shadetocloak/task_kmasmnil-app:model', 'imageId=sha256:deadbeef',
        'mounts=' + JSON.stringify(options.mounts ?? [{ Type: 'bind', Source: lastWorkspace(), Destination: '/app', Mode: 'rw', RW: true }]),
        'compose=task_kmasmnil-app-1_running_healthy;',
        `workspaceEntries=${options.workspaceEntries ?? '0'}`,
        `insideListeners=${options.insideListeners ?? '0'}`,
        `hostPort=${options.hostPort ?? '000'}`,
        `gateway=${options.gateway ?? '172.22.0.1'}`,
        'dockerVersion=Docker_version_29.1.3_build_abc',
      );
    } else if (step === 'agent') {
      stdout.push('codex=copied', 'version=codex-cli_0.157.1');
    } else if (step === 'transport') {
      stdout.push('pid=4242', `alive=${options.transportAlive ?? 'yes'}`, `reachable=${options.transportReachable ?? '403'}`);
    } else if (step === 'worker') {
      status = options.workerStatus ?? 'completed';
      for (const event of options.workerEvents ?? [{ type: 'thread.started', thread_id: 'thread-1' }, { type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 900, output_tokens: 50 } }]) {
        stdout.push(JSON.stringify(event));
      }
    } else if (step === 'freeze') {
      stdout.push('{"protected":"7","terminated":"","forced":"","remaining":""}');
    } else if (step === 'probe') {
      stdout.push(`code=${options.appCode ?? '000'}`);
    } else if (step === 'snapshot') {
      stdout.push('bytes=2048');
    } else if (step === 'evaluate') {
      if (options.evaluator === 'error') status = 'error';
      else {
        const artifact = resolveAfter(script, '--output');
        if (artifact) await writeFile(fromLinuxPath(artifact), JSON.stringify(options.evaluator ?? report()));
      }
    }
    await writeFile(join(request.logDir, 'stdout.jsonl'), `${stdout.join('\n')}\n`);
    await writeFile(join(request.logDir, 'stderr.log'), '');
    return { status, exitCode: status === 'completed' ? 0 : 1, durationMs: 5 };
  };
  return { run, steps };
}

function classify(script: string): string {
  if (script.includes('run_all.py')) return 'evaluate';
  if (script.includes('CODEX_HOME=/tmp/agent-home')) return 'worker';
  if (script.includes('model_proxy.py')) return 'transport';
  if (script.includes('SAASBENCH_APP_PORT=')) return 'freeze';
  if (script.includes('<<<FILE')) return 'inputs';
  if (script.includes('prepare_workspace.sh')) return 'official';
  if (script.includes('insideListeners=')) return 'verify';
  if (script.includes('/api/v2/health')) return 'probe';
  if (script.includes('mkdir -p /opt/agent-bin')) return 'agent';
  if (script.includes('tar czf')) return 'snapshot';
  return 'other';
}

function resolveAfter(script: string, flag: string): string | null {
  const at = script.indexOf(flag);
  if (at < 0) return null;
  const rest = script.slice(at + flag.length).trim();
  const quoted = /^'([^']*)'/.exec(rest);
  return quoted ? quoted[1]! : rest.split(/\s+/)[0]!;
}

function fromLinuxPath(path: string): string {
  const match = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(path);
  return match ? `${match[1]!.toUpperCase()}:\\${match[2]!.replaceAll('/', '\\')}` : path;
}

/** Shaped after the official reference artifact (453.7/500). */
function report() {
  return {
    total_score: 453.71,
    total_max: 500,
    percentage: 90.74,
    llm_judge_skipped_maxScore: 0,
    total_nodes: 127,
    passed: 124,
    failed: 3,
    skipped: 0,
    elapsed_seconds: 631.73,
    meta: { task_id: 'task_kmasmnil', total_nodes: 124 },
    categories: [{ category: 'API', total_score: 46.12, max_score: 60, percentage: 76.87, nodes: 14, passed: 13, failed: 1, skipped: 0 }],
    node_results: [
      { node_id: 'DEPLOY_HEALTH', status: 'PASSED', score: 3, maxScore: 3, category: 'Deployment', subcategory: 'HealthCheck', method: 'binary', message: 'ok', evidence: {} },
      { node_id: 'AUTH_LOGIN', status: 'PASSED', score: 9, maxScore: 9, category: 'Authentication', subcategory: 'Login', method: 'binary', message: 'ok', evidence: {} },
      { node_id: 'ARCH_DEEP', status: 'PASSED', score: 16, maxScore: 16, category: 'Architecture', subcategory: 'Depth', method: 'llm-judge', message: 'ok', evidence: {} },
      { node_id: 'API_BROKEN', status: 'FAILED', score: 26.71, maxScore: 40, category: 'API', subcategory: 'Boundary', method: 'weighted', message: 'pagination boundary wrong', evidence: {} },
      { node_id: 'API_SKIPPED', status: 'SKIPPED_DEPENDENCY', score: 0, maxScore: 4, category: 'API', subcategory: 'Cursor', method: 'binary', message: 'prerequisite failed', evidence: {} },
    ],
  };
}

async function withApiKey<T>(value: string | undefined, body: () => Promise<T>): Promise<T> {
  const previous = process.env.LLM_API_KEY;
  if (value === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = value;
  try { return await body(); } finally { if (previous === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = previous; }
}

/** Tests never touch a real judge credential. */
const TEST_KEY = 'sk-test-key-0000000000000000';

function runWith(config: ReturnType<typeof configuration>, signal: AbortSignal, deps: Parameters<typeof runSaasBench>[2], options?: Parameters<typeof runSaasBench>[3]) {
  return withApiKey(TEST_KEY, () => runSaasBench(config, signal, deps, options));
}

/* ------------------------------------------------------------------ 1. task path resolution */

test('task paths resolve for task_kmasmnil and keep the evaluator outside public inputs', () => {
  const paths = resolveTaskPaths(REPOSITORY, 'task_kmasmnil');
  assert.equal(paths.prepareScript, `${REPOSITORY}/eval/task_kmasmnil/check/task_kmasmnil/prepare_workspace.sh`);
  assert.equal(paths.workspace, `${REPOSITORY}/eval/task_kmasmnil/tasks/task_kmasmnil/docker/workspace`);
  assert.ok(paths.evaluatorDir.endsWith('/check/task_kmasmnil_e/evaluate'));
  for (const path of [paths.publicPrompt, paths.taskSpec, paths.knowledgeBase, paths.workspace, paths.prepareScript]) {
    assert.ok(!path.startsWith(paths.hiddenDir), `${path} must not live under the evaluator directory`);
  }
  assert.throws(() => resolveTaskPaths(REPOSITORY, '../etc/passwd'), /Invalid SaaSBench task id/);
  assert.throws(() => resolveTaskPaths(REPOSITORY, 'task_kmasmnil_e'), /Invalid SaaSBench task id/);
});

test('run directories are deterministic per run id and isolated from each other', () => {
  const first = saasBenchRunDir('experiments/saasbench', 'task_kmasmnil', '2026-01-01T00-00-00-000Z-aaaaaaaa');
  assert.equal(first, saasBenchRunDir('experiments/saasbench', 'task_kmasmnil', '2026-01-01T00-00-00-000Z-aaaaaaaa'));
  assert.notEqual(first, saasBenchRunDir('experiments/saasbench', 'task_kmasmnil', '2026-01-01T00-00-00-000Z-bbbbbbbb'));
  assert.ok(first.endsWith(join('task_kmasmnil', '2026-01-01T00-00-00-000Z-aaaaaaaa')));
  assert.throws(() => saasBenchRunDir('experiments/saasbench', 'task_kmasmnil', '../escape'), /safe path segment/);
});

/* ------------------------------------------------------------------ 2. public prompt construction */

test('the worker prompt is extracted from the official section and is byte reproducible', () => {
  const section = extractPromptSection(PROMPT_FOR_MODEL);
  assert.ok(section.startsWith('> **<!-- _BENCH_ANTI_CHEAT_BANNER -->'));
  assert.ok(section.includes('Build the platform inside `xm_app`'));
  assert.ok(!section.includes('## Tester Workflow'));
  assert.ok(!section.includes('operator notes'));
  assert.throws(() => extractPromptSection('# nothing here'), /missing its "## Prompt" section/);
  assert.throws(() => extractPromptSection('## Prompt\n\nhi\n'), /missing its "## Tester Workflow" boundary/);

  const inputs = { promptForModel: PROMPT_FOR_MODEL, taskSpec: TASK_SPEC, knowledgeBase: KNOWLEDGE_BASE, hashes: { promptForModel: hash(PROMPT_FOR_MODEL), taskSpec: hash(TASK_SPEC), knowledgeBase: hash(KNOWLEDGE_BASE) } };
  const prompt = buildWorkerPrompt(inputs);
  assert.equal(prompt, buildWorkerPrompt(inputs));
  assert.ok(prompt.includes('# Task specification (task.md)'));
  assert.ok(prompt.includes('# Clarifications (knowledge_base.json)'));
  assert.ok(prompt.includes('onDelete: Cascade'));
  assert.ok(!prompt.includes('## Tester Workflow'));
});

test('evaluator-only material is refused before a prompt can be sent', () => {
  assert.doesNotThrow(() => assertNoEvaluatorLeak('plain task material'));
  for (const marker of ['see check/task_kmasmnil_e/evaluate', 'read dag.json', 'scoring_config.json', 'the admission/ record', 'prepare_workspace.sh']) {
    assert.throws(() => assertNoEvaluatorLeak(`prefix ${marker} suffix`), /evaluator-only material/);
  }
});

/* ------------------------------------------------------------------ 3. evaluator files stay hidden */

test('public task inputs are exactly the three documents the worker may see', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-public-'));
  const paths = resolveTaskPaths(repository);
  const h = harness();
  const inputs = await loadPublicInputs(configuration(repository), paths, h.run, scratch);
  assert.equal(inputs.taskSpec, TASK_SPEC);
  assert.equal(inputs.knowledgeBase, KNOWLEDGE_BASE);
  assert.deepEqual(h.steps.map(step => step.step), ['inputs']);
  const requested = h.steps[0]!.script;
  for (const hidden of [paths.hiddenDir, paths.evaluatorDir, `${paths.evaluatorDir}/dag.json`, `${paths.evaluatorDir}/scoring_config.json`]) {
    assert.ok(!requested.includes(linuxPath(hidden)), `${hidden} must never be read for the worker`);
  }
  assert.ok(requested.includes(linuxPath(paths.publicPrompt)));
  const listed = [.../for f in (.*?); do/.exec(requested)![1]!.matchAll(/'([^']*)'/g)].map(match => match[1]!).sort();
  assert.deepEqual(listed, [linuxPath(paths.knowledgeBase), linuxPath(paths.publicPrompt), linuxPath(paths.taskSpec)].sort(), 'only the three public documents may be read');
  assert.deepEqual(Object.keys(inputs.hashes).sort(), ['knowledgeBase', 'promptForModel', 'taskSpec']);

  const rendered = await renderPrompt(configuration(repository), { run: h.run, scratch });
  assert.equal(rendered.sha256, hash(rendered.prompt));
  assert.equal(rendered.bytes, Buffer.byteLength(rendered.prompt));
  assert.ok(!rendered.prompt.includes('dag.json'));
});

/* ------------------------------------------------------------------ 4. workspace preparation */

test('preparation runs the official script and fails closed on an invalid environment', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-prepare-'));
  const h = harness();
  const result = await runWith(configuration(repository), new AbortController().signal, { run: h.run, scratch }, { prepareOnly: true });
  assert.deepEqual(h.steps.map(step => step.step).slice(0, 4), ['inputs', 'official', 'verify', 'agent']);
  assert.ok(h.steps.find(step => step.step === 'official')!.script.includes('prepare_workspace.sh'));
  assert.equal(result.status, 'prepared');
  assert.equal(result.lifecycle.state, 'RUNNING');
  const prepared = JSON.parse(await readFile(join(result.directory, 'prepare.json'), 'utf8'));
  assert.equal(prepared.container, 'xm_app');
  assert.equal(prepared.workspaceEntries, 0);
  assert.equal(prepared.appPort, 8024);
  assert.equal(prepared.agent, 'codex-cli_0.157.1');
  assert.equal(result.evidence.transport?.credentials, 'host only');
  assert.equal(prepared.gateway, '172.22.0.1');
  // The real credential is never copied into the container.
  const placeholder = await readFile(join(result.directory, 'adapter', 'auth.placeholder.json'), 'utf8');
  assert.equal(placeholder, placeholderAuth());
  assert.ok(!placeholder.includes('eval_admin'));
  // Every path handed to the Linux side must be a Linux path, and $HOME-relative
  // locations must stay expandable rather than being single-quoted.
  for (const step of h.steps) assert.ok(!/[A-Za-z]:\\/.test(step.script), `${step.step} script must not carry Windows paths`);
  assert.match(h.steps.find(step => step.step === 'transport')!.script, /mkdir -p "\$HOME\/\.cache\/legion-saasbench-[a-f0-9]{12}"/);
  assert.match(h.steps.find(step => step.step === 'agent')!.script, /docker cp '[^']*\/adapter\/stop\.sh' \$C:\/opt\/agent-bin\/stop\.sh/);

  const cases: [HarnessOptions, RegExp][] = [
    [{ containerRunning: 'false' }, /xm_app is not running/],
    [{ workspaceEntries: '2' }, /workspace is not empty/],
    [{ insideListeners: '1' }, /already in use inside the container/],
    [{ hostPort: '200' }, /already answers on the host/],
    [{ gateway: '' }, /gateway could not be resolved/],
    [{ mounts: [{ Type: 'bind', Source: '/tmp/other', Destination: '/app' }] }, /not mounted at \/app/],
    [{ mounts: [{ Type: 'bind', Source: lastWorkspace(), Destination: '/app' }, { Type: 'bind', Source: lastEvaluatorPath, Destination: '/evaluate' }] }, /exposes benchmark material/],
    [{ mounts: [{ Type: 'bind', Source: lastWorkspace(), Destination: '/app' }, { Type: 'bind', Source: lastEvaluatorPath.replace(/\/check\/.*$/, ''), Destination: '/benchmark' }] }, /exposes benchmark material/],
    [{ transportAlive: 'no' }, /transport process is not running/],
    [{ transportReachable: '000' }, /cannot reach the model transport/],
  ];
  for (const [override, expected] of cases) {
    const failing = harness(override);
    await assert.rejects(runWith(configuration(repository), new AbortController().signal, { run: failing.run, scratch }, { prepareOnly: true }), expected);
  }
});

/* ------------------------------------------------------------------ 5. timeout and cancellation */

test('a worker cut off by the budget is frozen, evaluated once, and never retried', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-timeout-'));
  const h = harness({ workerStatus: 'timeout', workerEvents: [], appCode: '000' });
  const result = await runWith(configuration(repository, { attemptMs: 60_000, totalMs: 60_000 }), new AbortController().signal, { run: h.run, scratch });
  assert.equal(h.steps.filter(step => step.step === 'worker').length, 1);
  assert.equal(result.evidence.worker?.status, 'timeout');
  assert.equal(result.status, 'evaluated');
  assert.ok(h.steps.findIndex(step => step.step === 'freeze') < h.steps.findIndex(step => step.step === 'evaluate'));
  const execution = JSON.parse(await readFile(join(result.directory, 'execution.json'), 'utf8'));
  assert.equal(execution.workerTimedOut, true);
});

test('cancellation during the worker attempt is preserved without evaluation or a second call', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-cancel-'));
  const controller = new AbortController();
  let workerCalls = 0;
  const h = harness({ workerStatus: 'cancelled', onStep: (step) => { if (step === 'worker') { workerCalls++; controller.abort(); } } });
  const result = await runWith(configuration(repository, { attemptMs: 60_000, totalMs: 60_000 }), controller.signal, { run: h.run, scratch });
  assert.equal(workerCalls, 1);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.evidence.worker?.status, 'cancelled');
  assert.equal(h.steps.filter(step => step.step === 'evaluate').length, 0);
});

/* ------------------------------------------------------------------ 6. secret redaction */

test('live secrets are stripped from logs, reports and error messages', async () => {
  const secret = 'sk-live-secret-value-1234567890';
  assert.equal(redact(`Authorization: Bearer ${secret}`, [secret]), 'Authorization: Bearer [REDACTED]');
  assert.equal(redact('key=xmk_evalTestSecretForSmoke2026', []), 'key=[REDACTED]');
  assert.equal(redact(`proxy_error ${secret} status 401`, [secret]), 'proxy_error [REDACTED] status 401');
  assert.equal(redact('nothing to hide', [secret]), 'nothing to hide');

  await withApiKey(secret, async () => {
    const repository = await fakeRepository();
    const root = await mkdtemp(join(tmpdir(), 'saasbench-redact-'));
    const leaky: ShellRunner = async (request) => {
      await mkdir(request.logDir, { recursive: true });
      await writeFile(join(request.logDir, 'stdout.jsonl'), `using ${secret}\n`);
      await writeFile(join(request.logDir, 'stderr.log'), `error with ${secret}\n`);
      const script = await readFile(join(request.logDir, 'script.sh'), 'utf8').catch(() => '');
      const artifact = resolveAfter(script, '--output');
      if (artifact) await writeFile(fromLinuxPath(artifact), JSON.stringify(report()));
      return { status: 'completed', exitCode: 0, durationMs: 1 };
    };
    await runEvaluation({ config: configuration(repository), paths: resolveTaskPaths(repository), root, deps: { run: leaky } });
    const evaluateDir = (await readdir(join(root, 'logs'))).find(name => name.endsWith('-evaluate'))!;
    assert.equal(await readFile(join(root, 'logs', evaluateDir, 'stdout.jsonl'), 'utf8'), 'using [REDACTED]\n');
    assert.equal(await readFile(join(root, 'logs', evaluateDir, 'stderr.log'), 'utf8'), 'error with [REDACTED]\n');
  });
});

test('the judge credential travels on stdin and never in a persisted command string', async () => {
  const secret = 'sk-live-secret-value-abcdefghij';
  await withApiKey(secret, async () => {
    const repository = await fakeRepository();
    const root = await mkdtemp(join(tmpdir(), 'saasbench-stdin-'));
    const seen: ProcessRequest[] = [];
    const h = harness({ onStep: (_step, request) => seen.push(request) });
    await runEvaluation({ config: configuration(repository), paths: resolveTaskPaths(repository), root, deps: { run: h.run } });
    const request = seen.at(-1)!;
    assert.equal(request.input, `${secret}\n`);
    assert.ok(!request.args.join(' ').includes(secret));
    assert.ok(!request.command.includes(secret));
    const script = await readFile(join(request.logDir, 'script.sh'), 'utf8');
    assert.ok(script.includes('IFS= read -r LLM_KEY'));
    assert.ok(script.includes('run_all.py --dag ./dag.json --with-llm'));
    assert.ok(!script.includes('test_model_output.sh'));
    assert.ok(!(await readFile(join(root, 'evaluation.json'), 'utf8')).includes(secret));
    assert.ok(!(await readFile(join(root, 'evaluation-summary.json'), 'utf8')).includes(secret));
  });
});

test('the judge credential may come from the git-ignored .env and the environment wins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saasbench-env-'));
  const saved = { key: process.env.LLM_API_KEY, base: process.env.LLM_API_BASE, model: process.env.LLM_MODEL };
  delete process.env.LLM_API_KEY; delete process.env.LLM_API_BASE; delete process.env.LLM_MODEL;
  try {
    assert.equal(await readEnvValue('LLM_API_KEY', root), undefined);
    await assert.rejects(judgeCredentials(root), /LLM_API_KEY is required/);
    await writeFile(join(root, '.env'), '# local judge configuration, never committed\nexport LLM_API_KEY="sk-from-env-file-000001"\nLLM_MODEL=deepseek-flash\nLLM_API_BASE=https://api.deepseek.com\n');
    assert.equal(await readEnvValue('LLM_API_KEY', root), 'sk-from-env-file-000001');
    const fromFile = await judgeCredentials(root);
    assert.equal(fromFile.key, 'sk-from-env-file-000001');
    assert.equal(fromFile.model, 'deepseek-flash');
    assert.equal(fromFile.base, 'https://api.deepseek.com');
    process.env.LLM_API_KEY = 'sk-from-the-process-environment';
    assert.equal((await judgeCredentials(root)).key, 'sk-from-the-process-environment');
  } finally {
    if (saved.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.LLM_API_BASE; else process.env.LLM_API_BASE = saved.base;
    if (saved.model === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = saved.model;
  }
});

/* ------------------------------------------------------------------ 7. usage */

test('missing token usage stays unknown instead of becoming zero', () => {
  const unknown = recordUsage([], null);
  assert.equal(unknown.known, false);
  assert.equal(unknown.source, 'none');
  assert.equal(unknown.total, null);
  assert.deepEqual(unknown.entries, []);

  const streamed = recordUsage([{ input_tokens: 10, output_tokens: 2 }, { input_tokens: 5 }], null);
  assert.equal(streamed.known, true);
  assert.equal(streamed.source, 'codex-stream');
  assert.equal(streamed.total?.input_tokens, 15);
  assert.equal(streamed.total?.output_tokens, 2);

  const traced = recordUsage([], { input_tokens: 7, output_tokens: 1 });
  assert.equal(traced.source, 'session-trace');
  assert.equal(traced.total?.input_tokens, 7);
});

test('a worker that reports no usage is persisted as unknown in the run artifacts', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-usage-'));
  const h = harness({ workerEvents: [{ type: 'thread.started', thread_id: 'thread-9' }, { type: 'turn.completed' }] });
  const result = await runWith(configuration(repository), new AbortController().signal, { run: h.run, scratch });
  assert.equal(result.usage.known, false);
  const stored = JSON.parse(await readFile(join(result.directory, 'usage.json'), 'utf8'));
  assert.equal(stored.known, false);
  assert.equal(stored.total, null);
  assert.notEqual(stored.total, 0);
});

test('reported usage is preserved per turn without inferring a cost', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-usage2-'));
  const h = harness();
  const result = await runWith(configuration(repository), new AbortController().signal, { run: h.run, scratch });
  assert.equal(result.usage.known, true);
  assert.equal(result.usage.source, 'codex-stream');
  assert.deepEqual(result.usage.total, { input_tokens: 1200, cached_input_tokens: 900, output_tokens: 50 });
});

/* ------------------------------------------------------------------ 8. freeze before evaluate */

test('the run is frozen, snapshotted and manifest-recorded before the evaluator starts', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-freeze-'));
  const h = harness({ appCode: '200' });
  const result = await runWith(configuration(repository), new AbortController().signal, { run: h.run, scratch });
  assert.equal(result.status, 'evaluated');
  assert.equal(result.lifecycle.state, 'COMPLETE');
  const order = h.steps.map(step => step.step);
  const evaluate = order.indexOf('evaluate');
  assert.ok(evaluate > 0 && order.indexOf('freeze') < evaluate, 'the workspace must be frozen before the evaluator runs');
  assert.equal(order.filter(step => step === 'evaluate').length, 1);

  const lifecycle = await readLifecycle(result.directory);
  assert.deepEqual(lifecycle.events.map(event => event.state), ['RUNNING', 'FROZEN', 'EVALUATING', 'COMPLETE']);
  const manifest = JSON.parse(await readFile(join(result.directory, 'workspace-manifest.json'), 'utf8'));
  assert.match(manifest.digest, /^[a-f0-9]{64}$/);
  assert.equal(manifest.files, 2);
  assert.equal(manifest.workerTermination.remaining, 'none');
  assert.equal(manifest.applicationResponding, true);
  assert.deepEqual(manifest.snapshot, { path: 'workspace-snapshot.tar.gz', bytes: 2048 });
  const submission = JSON.parse(await readFile(join(result.directory, 'submission.json'), 'utf8'));
  assert.equal(submission.digest, manifest.digest);
  const selection = JSON.parse(await readFile(join(result.directory, 'selection.json'), 'utf8'));
  assert.equal(selection.sha256, hash(await readFile(join(result.directory, 'submission.json'))));
  assert.equal(result.summary?.totalScore, 453.71);
  assert.equal(result.summary?.percentage, 90.74);
  const execution = JSON.parse(await readFile(join(result.directory, 'execution.json'), 'utf8'));
  assert.equal(execution.status, 'evaluated');
  assert.equal(execution.publicChecksPassed, false);
});

/* ------------------------------------------------------------------ 9. evaluator gated on FROZEN */

test('the evaluator cannot start while the run is RUNNING', async () => {
  const repository = await fakeRepository();
  const root = await mkdtemp(join(tmpdir(), 'saasbench-lifecycle-'));
  await mkdir(join(root, 'adapter'), { recursive: true });
  await writeFile(join(root, 'adapter', 'stop.sh'), '# stub');
  await startLifecycle(root);
  const adapter = createSaasBenchAdapter({ config: configuration(repository), paths: resolveTaskPaths(repository), prompt: 'p', runId: 'r', root, deps: { run: harness().run } });
  await assert.rejects(adapter.grade({ path: join(root, 'submission.json'), sha256: 'x' }, new AbortController().signal), /run state is RUNNING/);
  await assert.rejects(advanceLifecycle(root, 'EVALUATING'), /Illegal run transition RUNNING -> EVALUATING/);
  await assert.rejects(advanceLifecycle(root, 'COMPLETE'), /Illegal run transition RUNNING -> COMPLETE/);
  await advanceLifecycle(root, 'FROZEN');
  await assert.rejects(advanceLifecycle(root, 'COMPLETE'), /Illegal run transition FROZEN -> COMPLETE/);

  const running = await mkdtemp(join(tmpdir(), 'saasbench-running-'));
  await startLifecycle(running);
  await assert.rejects(withApiKey(undefined, () => evaluateFrozenRun(running, configuration(repository), new AbortController().signal, { run: harness().run })), /still RUNNING/);

  const frozen = await mkdtemp(join(tmpdir(), 'saasbench-manual-'));
  await startLifecycle(frozen);
  await advanceLifecycle(frozen, 'FROZEN');
  await assert.rejects(withApiKey(undefined, () => evaluateFrozenRun(frozen, configuration(repository), new AbortController().signal, { run: harness().run })), /LLM_API_KEY is required/);
});

test('manual evaluation of a frozen run records a score without starting the model', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-manual2-'));
  const h = harness({ appCode: '200' });
  const result = await runWith(configuration(repository), new AbortController().signal, { run: h.run, scratch });
  const frozen = await mkdtemp(join(tmpdir(), 'saasbench-refreeze-'));
  await startLifecycle(frozen);
  await advanceLifecycle(frozen, 'FROZEN');
  const again = harness();
  const summary = await withApiKey('sk-release-smoke-key-0001', () => runEvaluation2(repository, frozen, again));
  assert.equal(summary.totalScore, 453.71);
  assert.equal(again.steps.filter(step => step.step === 'worker').length, 0);
  assert.ok(result.directory.length > 0);
});

async function runEvaluation2(repository: string, root: string, h: Harness) {
  const { summary } = await runEvaluation({ config: configuration(repository), paths: resolveTaskPaths(repository), root, deps: { run: h.run } });
  return summary;
}

/* ------------------------------------------------------------------ 10. evaluator result parsing */

test('the official evaluator artifact is preserved raw and summarized without re-scoring', async () => {
  const raw = report();
  const summary = summarizeEvaluation(raw);
  assert.equal(summary.totalScore, 453.71);
  assert.equal(summary.totalMax, 500);
  assert.equal(summary.percentage, 90.74);
  assert.equal(summary.passed, 124);
  assert.equal(summary.failed, 3);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.categories[0]!.category, 'API');
  assert.equal(summary.deterministic.score, 38.71);
  assert.equal(summary.deterministic.max, 56);
  assert.equal(summary.deterministic.nodes, 4);
  assert.equal(summary.llmJudge.score, 16);
  assert.equal(summary.llmJudge.max, 16);
  assert.equal(summary.llmJudge.nodes, 1);
  assert.deepEqual(summary.statuses, { PASSED: 3, FAILED: 1, SKIPPED_DEPENDENCY: 1 });
  assert.deepEqual(summary.failedNodes.map(node => node.nodeId), ['API_BROKEN']);
  assert.throws(() => summarizeEvaluation({ total_score: 1 }));

  // Category-filtered official runs mark every other node as outside the target
  // category; those must not inflate Legion's node counters.
  const filtered = report();
  filtered.node_results.push({ node_id: 'OTHER_CAT', status: 'PASSED', score: 0, maxScore: 0, category: 'Authentication', subcategory: '', method: 'binary', message: 'Node is outside target category', evidence: {} } as never);
  const filteredSummary = summarizeEvaluation(filtered);
  assert.equal(filteredSummary.statuses.OTHER_CAT, undefined);
  assert.equal(filteredSummary.llmJudge.nodes, 1);

  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-parse-'));
  const h = harness({ appCode: '200', evaluator: raw });
  const result = await runWith(configuration(repository), new AbortController().signal, { run: h.run, scratch });
  assert.deepEqual(JSON.parse(await readFile(join(result.directory, 'evaluation.json'), 'utf8')), raw);
  const normalized = JSON.parse(await readFile(join(result.directory, 'evaluation-summary.json'), 'utf8'));
  assert.equal(normalized.totalScore, 453.71);
  assert.equal(normalized.deterministic.nodes, 4);
  assert.equal(normalized.llmJudge.nodes, 1);
});

/* ------------------------------------------------------------------ 11. infrastructure failure */

test('an infrastructure failure is preserved, never retried and never graded', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-infra-'));
  const h = harness({ workerStatus: 'error' });
  const result = await runWith(configuration(repository, { attemptMs: 60_000, totalMs: 60_000 }), new AbortController().signal, { run: h.run, scratch });
  assert.equal(result.status, 'incomplete');
  assert.equal(h.steps.filter(step => step.step === 'worker').length, 1);
  assert.equal(h.steps.filter(step => step.step === 'evaluate').length, 0);
  assert.equal(result.summary, null);
  const manifest = JSON.parse(await readFile(join(result.directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'incomplete');
  assert.equal(manifest.evaluation, null);
  for (const artifact of ['execution.json', 'usage.json', 'trajectory.jsonl', 'prompt.txt', 'lifecycle.json']) {
    assert.ok(existsSync(join(result.directory, artifact)), `${artifact} must be preserved`);
  }
  assert.equal(hash(await readFile(join(result.directory, 'prompt.txt'), 'utf8')), result.evidence.promptSha256);
});

test('a failed evaluator fails closed instead of publishing a score', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-evalfail-'));
  const h = harness({ appCode: '200', evaluator: 'error' });
  const result = await runWith(configuration(repository), new AbortController().signal, { run: h.run, scratch });
  assert.equal(result.status, 'error');
  assert.equal(result.summary, null);
  assert.equal(JSON.parse(await readFile(join(result.directory, 'manifest.json'), 'utf8')).evaluation, null);
  assert.ok(existsSync(join(result.directory, 'logs')));
});

test('a run without a judge credential stops before the worker is ever started', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-nokey-'));
  const h = harness();
  await withApiKey(undefined, async () => {
    // The ambient environment and the git-ignored .env are both absent in this test,
    // so the run must refuse before any model budget is committed.
    await assert.rejects(runSaasBench(configuration(repository), new AbortController().signal, { run: h.run, scratch }), /LLM_API_KEY is required/);
  });
  assert.equal(h.steps.filter(step => step.step === 'worker').length, 0);
  assert.equal(h.steps.filter(step => step.step === 'official').length, 0);
});

/* ------------------------------------------------------------------ worker configuration */

test('exactly one Codex worker is configured against the host transport', () => {
  const argv = containerCodex(configuration(REPOSITORY, { model: 'gpt-6-sol', effort: 'high' }), '172.22.0.1');
  assert.equal(argv[0], '/opt/agent-bin/codex');
  assert.equal(argv[1], 'exec');
  assert.equal(argv.at(-1), '-');
  assert.ok(argv.includes('--json'));
  assert.ok(!argv.includes('--enable'), 'sub-agents must not be enabled');
  assert.equal(argv[argv.indexOf('multi_agent') - 1], '--disable');
  assert.equal(argv[argv.indexOf('multi_agent_v2') - 1], '--disable');
  assert.ok(!argv.join(' ').includes('api.openai.com'), 'the worker must not use a provider API key');
  assert.ok(argv.join(' ').includes('http://172.22.0.1:8099/backend-api/codex'));
  assert.ok(argv.join(' ').includes('SAASBENCH_MODEL_TOKEN'));
  assert.ok(argv.join(' ').includes('web_search="disabled"'));
  assert.equal(argv[argv.indexOf('--model') + 1], 'gpt-6-sol');
  assert.ok(argv.includes('model_reasoning_effort="high"'));
  assert.equal(singlePolicyDecision().action, 'stop');
});

test('the smoke profile is a 20 minute single-worker budget with an observational token target', () => {
  const smoke = applyProfile(configuration(REPOSITORY), 'smoke');
  assert.equal(smoke.attemptMs, 20 * 60_000);
  assert.equal(smoke.totalMs, 20 * 60_000);
  assert.equal(smoke.tokenTarget, 200_000);
  const full = applyProfile(configuration(REPOSITORY), 'full');
  assert.equal(full.attemptMs, 180 * 60_000);
  assert.equal(full.tokenTarget, undefined);
  assert.equal(applyProfile(configuration(REPOSITORY), 'smoke', 5).tokenTarget, undefined);
  assert.throws(() => applyProfile(configuration(REPOSITORY), 'smoke', 0.1), /between 1 and 35791 minutes/);
});

test('the workspace digest ignores dependency and build caches but tracks source changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saasbench-digest-'));
  await writeFile(join(root, 'package.json'), '{"name":"app"}');
  await writeFile(join(root, 'server.js'), 'console.log(1)');
  await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1');
  await mkdir(join(root, '.next'), { recursive: true });
  await writeFile(join(root, '.next', 'build.js'), 'noise');
  const digest = await workspaceDigest(root);
  assert.equal(digest.files, 2);
  assert.deepEqual(digest.excluded.sort(), ['.next', 'node_modules']);
  assert.ok(EXCLUDED_DIRS.has('node_modules'));
  await writeFile(join(root, 'server.js'), 'console.log(2)');
  assert.notEqual((await workspaceDigest(root)).sha256, digest.sha256);
});

/* ------------------------------------------------------------------ 12. isolation */

test('two runs never share a directory and the second does not overwrite the first', async () => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-isolation-'));
  const runs = join(scratch, 'runs');
  const first = await runWith(configuration(repository, { runsDir: runs }), new AbortController().signal, { run: harness({ appCode: '200' }).run, scratch });
  const second = await runWith(configuration(repository, { runsDir: runs }), new AbortController().signal, { run: harness({ appCode: '200' }).run, scratch });
  assert.notEqual(first.directory, second.directory);
  assert.equal((await readdir(join(runs, 'task_kmasmnil'))).length, 2);
  assert.ok(existsSync(join(first.directory, 'manifest.json')));
  assert.ok(existsSync(join(second.directory, 'manifest.json')));
  assert.equal(hash(await readFile(join(first.directory, 'prompt.txt'), 'utf8')), first.evidence.promptSha256);
  const events = (await readFile(join(first.directory, 'trajectory.jsonl'), 'utf8')).split('\n').filter(Boolean);
  assert.ok(events.length > 0);
  assert.ok(events.every(line => ['legion-team', 'codex'].includes(JSON.parse(line).stream)));
  assert.ok(events.some(line => JSON.parse(line).stream === 'codex'));
});

test('the default configuration points at the verified local install without embedding credentials', () => {
  const config = defaultSaasBenchConfig();
  assert.equal(config.container, 'xm_app');
  assert.equal(config.appPort, 8024);
  assert.ok(config.auth.endsWith('/.codex/auth.json'));
  const serialized = JSON.stringify(config).toLowerCase();
  assert.ok(!serialized.includes('apikey') && !serialized.includes('api_key'));
});

/* ------------------------------------------------------------------ CLI surface */

test('the saasbench CLI reports status and refuses unknown actions with a non-zero exit code', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-cli-'));
  const runDir = join(scratch, 'run');
  await mkdir(runDir, { recursive: true });
  await startLifecycle(runDir);
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ status: 'incomplete', worker: { status: 'timeout' }, submission: null, usage: { known: false, total: null }, errors: [] }));
  const status = await runCli(['status', runDir]);
  assert.equal(status.code, 0, status.err);
  const parsed = JSON.parse(status.out);
  assert.equal(parsed.lifecycle.state, 'RUNNING');
  assert.equal(parsed.usage.total, null);
  assert.equal(parsed.status, 'incomplete');
  const broken = await runCli(['nonsense']);
  assert.equal(broken.code, 1);
  const missing = await runCli(['evaluate']);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /evaluate requires a run directory/);
  assert.equal((await runCli(['status', join(scratch, 'absent')])).code, 1);
});

function runCli(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [tsxCli, join(project, 'src', 'saasbench-cli.ts'), ...args], { cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk.toString(); });
    child.stderr.on('data', chunk => { err += chunk.toString(); });
    child.once('error', rejectRun);
    child.once('close', code => resolveRun({ code, out, err }));
  });
}

test('the run lifecycle leaves no benchmark workspace data inside the repository', async (t) => {
  const repository = await fakeRepository();
  const scratch = await mkdtemp(join(tmpdir(), 'saasbench-clean-'));
  const runs = join(scratch, 'runs');
  const result = await runWith(configuration(repository, { runsDir: runs }), new AbortController().signal, { run: harness({ appCode: '200' }).run, scratch });
  t.after(() => rm(scratch, { recursive: true, force: true }));
  assert.ok(result.directory.startsWith(runs), 'run artifacts live under the configured runs directory');
  assert.equal(await readFile(join(repository, 'eval', 'task_kmasmnil', 'tasks', 'task_kmasmnil', 'docker', 'workspace', 'package.json'), 'utf8'), '{"name":"xm-platform"}');
});
