import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { execute, type ProcessRequest, type ProcessResult } from './process.js';
import { hash } from './provenance.js';
import { parseCodexLog } from './codex.js';
import { runAdapter, type ExecutionAdapter } from './execution-adapter.js';
import { linuxPath } from './wsl-path.js';
import type { CheckReport, WorkerRequest, WorkerResult } from './types.js';

/* ------------------------------------------------------------------ configuration */

const ms = z.number().int().positive().max(2_147_483_647);
export const SaasBenchConfigSchema = z.object({
  taskId: z.literal('task_kmasmnil').default('task_kmasmnil'),
  policy: z.literal('single').default('single'),
  distro: z.string().min(1).default('Ubuntu-24.04'),
  repository: z.string().min(1),
  codex: z.string().min(1),
  auth: z.string().min(1),
  python: z.string().min(1),
  container: z.string().min(1).default('xm_app'),
  appPort: z.number().int().min(1).max(65535).default(8024),
  transportPort: z.number().int().min(1).max(65535).default(8099),
  egressProxy: z.string().url().optional(),
  model: z.string().min(1).default('gpt-6-sol'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).default('high'),
  attemptMs: ms.default(1_200_000),
  totalMs: ms.default(1_200_000),
  evaluationMs: ms.default(5_400_000),
  tokenTarget: z.number().int().positive().optional(),
  runsDir: z.string().min(1).default('experiments/saasbench'),
}).strict();
export type SaasBenchConfig = z.infer<typeof SaasBenchConfigSchema>;

/** Verified paths on this workstation; every field can be overridden by a config file. */
export function defaultSaasBenchConfig(): SaasBenchConfig {
  return SaasBenchConfigSchema.parse({
    repository: '/home/zaixi/benchmarks/SaaSBench',
    codex: '/home/zaixi/.cache/proactive-pb-tools/package/vendor/x86_64-unknown-linux-musl/bin/codex',
    auth: '/home/zaixi/.codex/auth.json',
    python: '/home/zaixi/benchmarks/SaaSBench/eval/.venv/bin/python',
    egressProxy: 'http://172.21.112.1:7897',
  });
}

export type SaasBenchProfile = 'smoke' | 'full';
/** Smoke and full share one policy; only the worker budget differs. */
export function applyProfile(config: SaasBenchConfig, profile: SaasBenchProfile, minutes?: number): SaasBenchConfig {
  const budget = (minutes ?? (profile === 'smoke' ? 20 : 180)) * 60_000;
  if (!Number.isSafeInteger(budget) || budget < 60_000 || budget > 2_147_483_647) throw new Error('Worker budget must be between 1 and 35791 minutes');
  return { ...config, attemptMs: budget, totalMs: budget, tokenTarget: profile === 'smoke' && minutes === undefined ? 200_000 : undefined };
}

/* ------------------------------------------------------------------ task paths */

export interface SaasBenchPaths {
  repository: string;
  taskId: string;
  evalDir: string;
  checkDir: string;
  prepareScript: string;
  publicPrompt: string;
  evaluatorDir: string;
  hiddenDir: string;
  taskSpec: string;
  knowledgeBase: string;
  workspace: string;
}

/** Public inputs are the only task material the worker may receive. */
export function resolveTaskPaths(repository: string, taskId = 'task_kmasmnil'): SaasBenchPaths {
  if (!/^task_[a-z]{8}$/.test(taskId)) throw new Error('Invalid SaaSBench task id');
  const evalDir = `${repository.replace(/\/+$/, '')}/eval`;
  const checkDir = `${evalDir}/${taskId}/check/${taskId}`;
  return {
    repository,
    taskId,
    evalDir,
    checkDir,
    prepareScript: `${checkDir}/prepare_workspace.sh`,
    publicPrompt: `${checkDir}/prompt_for_model.md`,
    evaluatorDir: `${evalDir}/${taskId}/check/${taskId}_e/evaluate`,
    hiddenDir: `${evalDir}/${taskId}/check/${taskId}_e`,
    taskSpec: `${evalDir}/${taskId}/tasks/${taskId}/task/task.md`,
    knowledgeBase: `${evalDir}/${taskId}/tasks/${taskId}/kb/knowledge_base.json`,
    workspace: `${evalDir}/${taskId}/tasks/${taskId}/docker/workspace`,
  };
}

export function saasBenchRunDir(runsDir: string, taskId: string, runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId) || runId.includes('..')) throw new Error('Run id must be a safe path segment');
  return resolve(runsDir, taskId, runId);
}

export function newRunId(now = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

/* ------------------------------------------------------------------ public task input */

export interface PublicTaskInputs {
  promptForModel: string;
  taskSpec: string;
  knowledgeBase: string;
  hashes: { promptForModel: string; taskSpec: string; knowledgeBase: string };
}

const PROMPT_START = '## Prompt';
const PROMPT_END = '## Tester Workflow';

/** Operator notes wrap the official prompt; only the model-facing section is extracted. */
export function extractPromptSection(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === PROMPT_START);
  if (start < 0) throw new Error(`Public prompt is missing its "${PROMPT_START}" section`);
  const end = lines.findIndex((line, index) => index > start && line.trim() === PROMPT_END);
  if (end < 0) throw new Error(`Public prompt is missing its "${PROMPT_END}" boundary`);
  let body = lines.slice(start + 1, end);
  while (body.length && (!body.at(-1)!.trim() || /^-{3,}$/.test(body.at(-1)!.trim()))) body = body.slice(0, -1);
  const section = body.join('\n').trim();
  if (!section) throw new Error('Public prompt section is empty');
  return section;
}

/** Byte-reproducible worker prompt: official prompt section, then the public task material. */
export function buildWorkerPrompt(inputs: PublicTaskInputs): string {
  return [
    extractPromptSection(inputs.promptForModel),
    '',
    '---',
    '',
    '# Task specification (task.md)',
    '',
    inputs.taskSpec.trim(),
    '',
    '---',
    '',
    '# Clarifications (knowledge_base.json)',
    '',
    '```json',
    inputs.knowledgeBase.trim(),
    '```',
    '',
  ].join('\n');
}

const LEAK_MARKERS = ['task_kmasmnil_e', 'scoring_config', 'dag.json', 'admission/', 'negative-control', 'reference-result', 'prepare_workspace.sh', 'test_model_output.sh'];

/** Fail closed when evaluator-only material would reach the worker. */
export function assertNoEvaluatorLeak(prompt: string): void {
  const found = LEAK_MARKERS.filter(marker => prompt.includes(marker));
  if (found.length) throw new Error(`Worker prompt references evaluator-only material: ${found.join(', ')}`);
}

/* ------------------------------------------------------------------ secrets */

/** Remove any occurrence of a live secret before it can reach a log or a report. */
export function redact(text: string, secrets: readonly string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    output = output.split(secret).join('[REDACTED]');
  }
  return output.replace(/\b(?:sk|fk|xmk)[-_][A-Za-z0-9_-]{12,}/g, '[REDACTED]');
}

/** Read one value from the git-ignored local `.env`; the key is never written back. */
export async function readEnvValue(name: string, root = projectRoot()): Promise<string | undefined> {
  try {
    for (const line of (await readFile(join(root, '.env'), 'utf8')).split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && match[1] === name) return match[2]!.trim().replace(/^["']|["']$/g, '') || undefined;
    }
  } catch { /* no local env file */ }
  return undefined;
}

export interface JudgeCredentials { key: string; base: string; model: string; }

/** Fixed judge configuration for these experiments; the key never leaves the host process. */
export async function judgeCredentials(root = projectRoot()): Promise<JudgeCredentials> {
  const key = process.env.LLM_API_KEY ?? await readEnvValue('LLM_API_KEY', root);
  if (!key) throw new Error('LLM_API_KEY is required to run the LLM judge; export it or put it in the git-ignored .env file');
  return {
    key,
    base: process.env.LLM_API_BASE ?? await readEnvValue('LLM_API_BASE', root) ?? 'https://api.deepseek.com',
    model: process.env.LLM_MODEL ?? await readEnvValue('LLM_MODEL', root) ?? 'deepseek-flash',
  };
}

/* ------------------------------------------------------------------ usage */

export interface UsageRecord {
  known: boolean;
  source: 'codex-stream' | 'session-trace' | 'none';
  entries: unknown[];
  total: Record<string, number> | null;
}

function sumUsage(entries: unknown[]): Record<string, number> | null {
  const total: Record<string, number> = {};
  let seen = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      total[key] = (total[key] ?? 0) + value;
      seen = true;
    }
  }
  return seen ? total : null;
}

/** Missing usage stays unknown; it is never rewritten as zero. */
export function recordUsage(entries: unknown[], fallback: unknown): UsageRecord {
  if (entries.length) return { known: true, source: 'codex-stream', entries, total: sumUsage(entries) };
  if (fallback && typeof fallback === 'object') return { known: true, source: 'session-trace', entries: [fallback], total: sumUsage([fallback]) };
  return { known: false, source: 'none', entries: [], total: null };
}

/** Last cumulative token_count from a Codex session trace; used when a run is cut short. */
export async function readSessionUsage(directory: string): Promise<unknown> {
  let files: string[] = [];
  try { files = await readdir(directory, { recursive: true, encoding: 'utf8' }); }
  catch { return null; }
  let usage: unknown = null;
  for (const file of files.filter(name => name.endsWith('.jsonl')).sort()) {
    let lines: string[];
    try { lines = (await readFile(join(directory, file), 'utf8')).split('\n'); }
    catch { continue; }
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { payload?: { type?: string; info?: { total_token_usage?: unknown } } };
        if (event.payload?.type === 'token_count' && event.payload.info?.total_token_usage) usage = event.payload.info.total_token_usage;
      } catch { /* truncated session lines are ignored */ }
    }
  }
  return usage;
}

/* ------------------------------------------------------------------ evaluation parsing */

const NodeResultSchema = z.object({
  node_id: z.string(),
  status: z.string(),
  score: z.number(),
  maxScore: z.number(),
  category: z.string().default(''),
  subcategory: z.string().default(''),
  method: z.string().default('binary'),
  message: z.string().default(''),
}).loose();

export const EvaluationSchema = z.object({
  total_score: z.number(),
  total_max: z.number(),
  percentage: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  total_nodes: z.number(),
  llm_judge_skipped_maxScore: z.number().default(0),
  categories: z.array(z.object({
    category: z.string(), total_score: z.number(), max_score: z.number(),
    percentage: z.number(), nodes: z.number(), passed: z.number(), failed: z.number(), skipped: z.number(),
  }).loose()),
  node_results: z.array(NodeResultSchema),
  elapsed_seconds: z.number().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).loose();
export type RawEvaluation = z.infer<typeof EvaluationSchema>;

export interface EvaluationSummary {
  taskId: string;
  totalScore: number;
  totalMax: number;
  percentage: number;
  passed: number;
  failed: number;
  skipped: number;
  totalNodes: number;
  statuses: Record<string, number>;
  categories: RawEvaluation['categories'];
  deterministic: { score: number; max: number; nodes: number };
  llmJudge: { score: number; max: number; nodes: number; skippedMaxScore: number };
  failedNodes: { nodeId: string; category: string; score: number; maxScore: number; method: string; message: string }[];
  elapsedSeconds: number | null;
}

/**
 * Normalized view of the official report. The raw evaluator artifact is preserved
 * unchanged beside it; nothing here re-scores or filters nodes.
 */
export function summarizeEvaluation(raw: unknown, taskId = 'task_kmasmnil'): EvaluationSummary {
  const report = EvaluationSchema.parse(raw);
  const statuses: Record<string, number> = {};
  const deterministic = { score: 0, max: 0, nodes: 0 };
  const llmJudge = { score: 0, max: 0, nodes: 0, skippedMaxScore: report.llm_judge_skipped_maxScore };
  for (const node of report.node_results) {
    // Same exclusion the official aggregator applies to category-filtered runs.
    if (node.maxScore === 0 && node.message.includes('outside target category')) continue;
    statuses[node.status] = (statuses[node.status] ?? 0) + 1;
    const bucket = node.method === 'llm-judge' ? llmJudge : deterministic;
    bucket.nodes++;
    bucket.max += node.maxScore;
    if (node.status !== 'SKIPPED_LLM') bucket.score += node.score;
  }
  return {
    taskId,
    totalScore: report.total_score,
    totalMax: report.total_max,
    percentage: report.percentage,
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped,
    totalNodes: report.total_nodes,
    statuses,
    categories: report.categories,
    deterministic: { score: round(deterministic.score), max: round(deterministic.max), nodes: deterministic.nodes },
    llmJudge: { score: round(llmJudge.score), max: round(llmJudge.max), nodes: llmJudge.nodes, skippedMaxScore: llmJudge.skippedMaxScore },
    failedNodes: report.node_results
      .filter(node => node.status === 'FAILED' || node.status === 'ERROR')
      .map(node => ({ nodeId: node.node_id, category: node.category, score: node.score, maxScore: node.maxScore, method: node.method, message: node.message.slice(0, 400) })),
    elapsedSeconds: report.elapsed_seconds ?? null,
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/* ------------------------------------------------------------------ workspace digest */

export const EXCLUDED_DIRS = new Set(['node_modules', '.next', '.turbo', '.git', '.cache', 'dist', 'build', '__pycache__', '.venv']);

export interface WorkspaceDigest { sha256: string; files: number; bytes: number; excluded: string[]; }

function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('end', () => resolveHash(digest.digest('hex')));
    stream.on('error', reject);
  });
}

/** Content digest of the submitted source tree; dependency and build caches are excluded. */
export async function workspaceDigest(root: string): Promise<WorkspaceDigest> {
  const excluded: string[] = [];
  const entries: string[] = [];
  let bytes = 0;
  async function walk(directory: string, prefix: string): Promise<void> {
    let items;
    try { items = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (EXCLUDED_DIRS.has(item.name)) { excluded.push(name); continue; }
        await walk(join(directory, item.name), name);
      } else if (item.isFile()) {
        const info = await stat(join(directory, item.name)).catch(() => null);
        if (!info) continue;
        bytes += info.size;
        entries.push(`${name}\u0000${await hashFile(join(directory, item.name))}`);
      }
    }
  }
  await walk(root, '');
  return { sha256: hash(entries.join('\n')), files: entries.length, bytes, excluded };
}

/* ------------------------------------------------------------------ lifecycle */

export type LifecycleState = 'RUNNING' | 'FROZEN' | 'EVALUATING' | 'COMPLETE';
const TRANSITIONS: Record<LifecycleState, LifecycleState[]> = { RUNNING: ['FROZEN'], FROZEN: ['EVALUATING'], EVALUATING: ['COMPLETE'], COMPLETE: [] };

export interface Lifecycle { state: LifecycleState; events: { state: LifecycleState; at: string; detail?: string }[]; }

export async function readLifecycle(root: string): Promise<Lifecycle> {
  const parsed = JSON.parse(await readFile(join(root, 'lifecycle.json'), 'utf8')) as Lifecycle;
  if (!TRANSITIONS[parsed.state]) throw new Error('Unknown lifecycle state in run directory');
  return parsed;
}

/** Explicit state machine; illegal transitions and skips are refused. */
export async function advanceLifecycle(root: string, to: LifecycleState, detail?: string): Promise<Lifecycle> {
  const before = await readLifecycle(root);
  if (before.state === to) return before;
  if (!TRANSITIONS[before.state].includes(to)) throw new Error(`Illegal run transition ${before.state} -> ${to}`);
  const after: Lifecycle = { state: to, events: [...before.events, { state: to, at: new Date().toISOString(), ...(detail ? { detail } : {}) }] };
  await writeFile(join(root, 'lifecycle.tmp'), JSON.stringify(after, null, 2));
  await rename(join(root, 'lifecycle.tmp'), join(root, 'lifecycle.json'));
  return after;
}

export async function startLifecycle(root: string): Promise<Lifecycle> {
  const initial: Lifecycle = { state: 'RUNNING', events: [{ state: 'RUNNING', at: new Date().toISOString() }] };
  await writeFile(join(root, 'lifecycle.json'), JSON.stringify(initial, null, 2), { flag: 'wx' });
  return initial;
}

/* ------------------------------------------------------------------ shell helpers */

export type ShellRunner = (request: ProcessRequest) => Promise<ProcessResult>;
export interface SaasBenchDeps { run?: ShellRunner; now?: () => Date; scratch?: string; }

export function shellQuote(value: string): string {
  if (/[\u0000-\u001f]/.test(value)) throw new Error('Shell argument contains a control character');
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Double-quote a path that must keep shell expansion on the Linux side (a `$HOME`
 * relative location). Only the literal `$HOME` prefix is permitted to expand.
 */
export function shellExpand(value: string): string {
  const rest = value.startsWith('$HOME') ? value.slice('$HOME'.length) : value;
  if (!/^[A-Za-z0-9._\-/]*$/.test(rest)) throw new Error('Expanding shell argument contains unsupported characters');
  return `"${value}"`;
}

export interface ShellOutcome { logs: string; result: ProcessResult; stdout: string; stderr: string; }

/**
 * Run a shell script inside WSL.
 *
 * The script is written to disk and executed as a file because `wsl.exe` passes its
 * arguments through a shell on the Linux side: any `$` in an inline command line would be
 * expanded before the intended shell ever sees it. Keeping the script on disk also
 * preserves the exact command as run evidence.
 */
export async function runScript(runner: ShellRunner, config: SaasBenchConfig, logDir: string, script: string, settings: { timeoutMs: number; cwd: string; signal?: AbortSignal; input?: string }): Promise<ShellOutcome> {
  await mkdir(logDir, { recursive: true });
  const path = join(logDir, 'script.sh');
  await writeFile(path, script);
  const result = await runner({
    command: 'wsl.exe',
    args: ['-d', config.distro, '--', 'bash', '-l', linuxPath(path)],
    cwd: settings.cwd, logDir, timeoutMs: settings.timeoutMs, signal: settings.signal, input: settings.input,
  });
  const read = (name: string) => readFile(join(logDir, name), 'utf8').catch(() => '');
  return { logs: logDir, result, stdout: await read('stdout.jsonl'), stderr: await read('stderr.log') };
}

export function projectRoot(): string {
  const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return join(base, 'package.json') && base;
}

/* ------------------------------------------------------------------ adapter */

export interface SaasBenchEvidence {
  runId: string;
  taskId: string;
  policy: string;
  promptPath?: string;
  promptSha256?: string;
  inputHashes?: PublicTaskInputs['hashes'];
  prepared?: Record<string, unknown>;
  submission?: { path: string; digest: string; files: number; bytes: number };
  worker?: { status: string; durationMs: number; sessionId?: string | null; detail?: string; attempts: number };
  usage?: UsageRecord;
  frozen?: { at: string; digest: string; files: number; bytes: number; protected: string; terminated: string; remaining: string; appResponding: boolean; snapshot: string | null };
  evaluation?: { at: string; artifact: string; summary: EvaluationSummary; workspaceStable: boolean };
  transport?: { port: number; gateway: string; credentials: string };
  errors: string[];
}

export interface SaasBenchAdapterOptions {
  config: SaasBenchConfig;
  paths: SaasBenchPaths;
  prompt: string;
  runId: string;
  root: string;
  provenance?: Record<string, unknown>;
  deps?: SaasBenchDeps;
}

export function createSaasBenchAdapter(options: SaasBenchAdapterOptions): ExecutionAdapter & { evidence: SaasBenchEvidence; close: () => Promise<void> } {
  const { config, paths, prompt, runId, root } = options;
  const run = options.deps?.run ?? execute;
  const now = options.deps?.now ?? (() => new Date());
  const secrets = [process.env.LLM_API_KEY ?? ''].filter(Boolean);
  let secretsLoaded = false;
  /** The judge credential may also live in the git-ignored .env; scrub it too. */
  async function ensureSecrets(): Promise<void> {
    if (secretsLoaded) return;
    secretsLoaded = true;
    const value = await readEnvValue('LLM_API_KEY');
    if (value && !secrets.includes(value)) secrets.push(value);
  }
  const evidence: SaasBenchEvidence = { runId, taskId: config.taskId, policy: config.policy, errors: [] };
  let sequence = 0;
  let transport: { privateDir: string; pidFile: string; gateway: string } | undefined;

  async function shell(step: string, script: string, settings: { timeoutMs: number; signal?: AbortSignal; input?: string }): Promise<ShellOutcome> {
    await ensureSecrets();
    const logs = join(root, 'logs', `${String(++sequence).padStart(2, '0')}-${step}`);
    const outcome = await runScript(run, config, logs, script, { timeoutMs: settings.timeoutMs, cwd: root, signal: settings.signal, input: settings.input });
    await scrub(logs);
    return outcome;
  }

  /** Rewrite every artifact under a log directory with live secrets removed. */
  async function scrub(directory: string): Promise<void> {
    for (const name of await readdir(directory).catch(() => [])) {
      const path = join(directory, name);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() || info.size > 32 * 1024 * 1024) continue;
      const content = await readFile(path, 'utf8').catch(() => null);
      if (content === null) continue;
      const clean = redact(content, secrets);
      if (clean !== content) await writeFile(path, clean);
    }
  }

  function fields(text: string): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const at = line.indexOf('=');
      if (at > 0) parsed[line.slice(0, at)] = line.slice(at + 1);
    }
    return parsed;
  }

  /** Kill the container-side worker and report what survived. */
  async function terminateWorker(): Promise<{ protected: string; terminated: string; remaining: string }> {
    const empty = { protected: '', terminated: '', remaining: 'unknown' };
    try {
      const outcome = await shell('freeze-container', `
set -u
docker cp ${shellQuote(linuxPath(join(root, 'adapter', 'stop.sh')))} ${shellQuote(config.container)}:/opt/agent-bin/stop.sh > /dev/null 2>&1 || true
docker exec -e SAASBENCH_APP_PORT=${shellQuote(String(config.appPort))} ${shellQuote(config.container)} sh /opt/agent-bin/stop.sh 2>/dev/null || echo '{"protected":"","terminated":"","remaining":"unknown"}'
`, { timeoutMs: 180_000 });
      const line = outcome.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
      const parsed = (() => { try { return JSON.parse(line) as Record<string, string>; } catch { return {}; } })();
      return { protected: parsed.protected ?? '', terminated: `${parsed.terminated ?? ''} ${parsed.forced ?? ''}`.trim(), remaining: parsed.remaining ?? 'unknown' };
    } catch (error) {
      evidence.errors.push(`Container worker termination failed: ${redact(String(error), secrets)}`);
      return empty;
    }
  }

  async function appResponds(signal?: AbortSignal): Promise<boolean> {
    try {
      const probe = `curl -sS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:${config.appPort}/api/v2/health 2>/dev/null || echo 000`;
      const outcome = await shell('app-probe', `
code=$(docker exec ${shellQuote(config.container)} sh -c ${shellQuote(probe)} 2>/dev/null || echo 000)
echo "code=$code"
`, { timeoutMs: 90_000, signal });
      return /^(200|204|304)$/.test(fields(outcome.stdout).code ?? '000');
    } catch { return false; }
  }

  async function stopTransport(): Promise<void> {
    if (!transport) return;
    const { pidFile, privateDir } = transport;
    transport = undefined;
    await shell('transport-stop', `
pid=$(cat ${shellExpand(pidFile)} 2>/dev/null || echo '')
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill -15 "$pid" 2>/dev/null || true; fi
rm -f ${shellExpand(pidFile)}
rm -rf ${shellExpand(privateDir)}
echo "stopped=$pid"
`, { timeoutMs: 60_000 }).catch(() => undefined);
  }

  async function prepare(signal: AbortSignal): Promise<Record<string, unknown>> {
    // The run directory itself is created by the adapter driver; these artifacts are
    // written first so a crash before the first model call still leaves evidence.
    await mkdir(join(root, 'logs'), { recursive: true });
    await writeFile(join(root, 'prompt.txt'), prompt, { flag: 'wx' });
    await startLifecycle(root);
    if (options.provenance) await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...options.provenance, status: 'preparing' }, null, 2));
    await mkdir(join(root, 'adapter'), { recursive: true });
    for (const file of ['stop.sh', 'model_proxy.py']) await copyFile(resolve(projectRoot(), 'scripts', 'saasbench', file), join(root, 'adapter', file));
    await writeFile(join(root, 'adapter', 'auth.placeholder.json'), placeholderAuth(), { flag: 'wx' }).catch(() => undefined);

    const official = await shell('prepare-official', `
set -e
cd ${shellQuote(linuxPath(paths.checkDir))}
bash ./prepare_workspace.sh
`, { timeoutMs: 900_000, signal });
    if (official.result.status !== 'completed') {
      throw new Error(`Official prepare_workspace.sh failed (${official.result.status}): ${redact(official.stderr.trim().slice(-1500), secrets)}`);
    }

    const composeFile = linuxPath(`${paths.checkDir}/../../tasks/${paths.taskId}/docker/docker-compose.yml`);
    const inspected = await shell('prepare-verify', `
set -u
C=${shellQuote(config.container)}
P=${shellQuote(String(config.appPort))}
W=${shellQuote(linuxPath(paths.workspace))}
hex=$(awk -v p=$P 'BEGIN{printf "%04X", p + 0}')
echo "running=$(docker inspect -f '{{.State.Running}}' $C 2>/dev/null || echo false)"
echo "containerId=$(docker inspect -f '{{.Id}}' $C 2>/dev/null || echo '')"
echo "image=$(docker inspect -f '{{.Config.Image}}' $C 2>/dev/null || echo '')"
echo "imageId=$(docker inspect -f '{{.Image}}' $C 2>/dev/null || echo '')"
echo "mounts=$(docker inspect -f '{{json .Mounts}}' $C 2>/dev/null || echo '[]')"
echo "compose=$(docker compose -f ${shellQuote(composeFile)} ps --format '{{.Name}} {{.State}} {{.Health}}' 2>/dev/null | tr '\\n' ';')"
echo "workspaceEntries=$(find $W -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)"
echo "insideListeners=$(docker exec $C sh -c 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null' | awk -v h="$hex" 'NR>1 && $4=="0A" {n=split($2,a,":"); if (toupper(a[n])==h) c++} END{print c+0}')"
echo "hostPort=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:$P/api/v2/health 2>/dev/null || true)"
echo "gateway=$(docker network inspect $(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' $C 2>/dev/null) --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo '')"
echo "dockerVersion=$(docker --version 2>/dev/null | tr ' ' '_')"
`, { timeoutMs: 300_000, signal });
    if (inspected.result.status !== 'completed') throw new Error(`Container inspection failed: ${redact(inspected.stderr.slice(-800), secrets)}`);
    const facts = fields(inspected.stdout);
    const fail = (reason: string): never => { throw new Error(`Preparation is not valid: ${reason}`); };
    if (facts.running !== 'true') fail(`${config.container} is not running`);
    if (facts.workspaceEntries !== '0') fail(`/app workspace is not empty (${facts.workspaceEntries} entries)`);
    if (facts.insideListeners !== '0') fail(`port ${config.appPort} is already in use inside the container`);
    if (!/^000/.test(facts.hostPort ?? '000')) fail(`port ${config.appPort} already answers on the host (${facts.hostPort})`);
    if (!facts.gateway) fail('the container network gateway could not be resolved');

    // The task workspace is expected to be mounted at /app; nothing may expose the
    // evaluator or the benchmark tree around it.
    const mounts = (() => { try { return JSON.parse(facts.mounts ?? '[]') as { Source?: string; Destination?: string }[]; } catch { return null; } })();
    if (!mounts) fail('the container mount list could not be read');
    const appMount = mounts!.find(mount => mount.Destination === '/app');
    if (!appMount || appMount.Source !== paths.workspace) fail('the task workspace is not mounted at /app as the official compose file declares');
    const exposed = mounts!.filter(mount => {
      const source = (mount.Source ?? '').replace(/\/+$/, '');
      return source === paths.repository || source === paths.evalDir || source === paths.hiddenDir || paths.hiddenDir.startsWith(`${source}/`);
    });
    if (exposed.length) fail(`the container exposes benchmark material outside the workspace: ${exposed.map(mount => `${mount.Source}->${mount.Destination}`).join(', ')}`);

    const arming = await shell('prepare-agent', `
set -e
C=${shellQuote(config.container)}
docker exec $C mkdir -p /opt/agent-bin /tmp/agent-home
if docker exec $C test -x /opt/agent-bin/codex 2>/dev/null; then echo "codex=present"; else docker cp ${shellQuote(dirname(config.codex))}/. $C:/opt/agent-bin/; echo "codex=copied"; fi
docker cp ${shellQuote(linuxPath(join(root, 'adapter', 'stop.sh')))} $C:/opt/agent-bin/stop.sh
docker cp ${shellQuote(linuxPath(join(root, 'adapter', 'auth.placeholder.json')))} $C:/tmp/agent-home/auth.json
docker exec $C chmod +x /opt/agent-bin/codex /opt/agent-bin/stop.sh
echo "version=$(docker exec $C /opt/agent-bin/codex --version 2>/dev/null | tr -d '\\r' | tr ' ' '_')"
`, { timeoutMs: 600_000, signal });
    if (arming.result.status !== 'completed') throw new Error(`Installing the agent toolchain into the container failed: ${redact(arming.stderr.slice(-800), secrets)}`);
    const agentFacts = fields(arming.stdout);
    if (!agentFacts.version) fail('the agent CLI is not executable inside the container');

    const privateDir = `$HOME/.cache/legion-saasbench-${hash(`${config.distro}:${config.container}`).slice(0, 12)}`;
    const pidFile = `${privateDir}/transport.pid`;
    const proxyScript = linuxPath(join(root, 'adapter', 'model_proxy.py'));
    const proxyEnv = config.egressProxy ? `export HTTPS_PROXY=${shellQuote(config.egressProxy)}\nexport HTTP_PROXY=${shellQuote(config.egressProxy)}` : '';
    const started = await shell('transport-start', `
set -u
mkdir -p ${shellExpand(privateDir)}
rm -f ${shellExpand(pidFile)}
${proxyEnv}
export NO_PROXY='localhost,127.0.0.1'
setsid nohup ${shellQuote(config.python)} ${shellQuote(proxyScript)} ${shellQuote(config.auth)} ${shellQuote(String(config.transportPort))} ${shellQuote(facts.gateway!)} >> ${shellExpand(`${privateDir}/transport.log`)} 2>&1 < /dev/null &
hex=$(awk -v p=${shellQuote(String(config.transportPort))} 'BEGIN{printf "%04X", p + 0}')
for i in $(seq 1 80); do
  if awk -v h="$hex" 'NR>1 && $4=="0A" {n=split($2,a,":"); if (toupper(a[n])==h) f=1} END{exit !f}' /proc/net/tcp /proc/net/tcp6; then break; fi
  sleep 0.25
done
pid=$(pgrep -f ${shellQuote(proxyScript)} | head -1)
echo "$pid" > ${shellExpand(pidFile)}
echo "pid=$pid"
echo "alive=$(kill -0 $pid 2>/dev/null && echo yes || echo no)"
echo "reachable=$(docker exec ${shellQuote(config.container)} sh -c 'curl -sS -m 10 -o /dev/null -w "%{http_code}" http://${facts.gateway}:${config.transportPort}/healthz 2>/dev/null || echo 000')"
`, { timeoutMs: 300_000, signal });
    if (started.result.status !== 'completed') throw new Error(`Model transport failed to start: ${redact(started.stderr.slice(-800), secrets)}`);
    const transportFacts = fields(started.stdout);
    if (transportFacts.alive !== 'yes') fail('the model transport process is not running');
    // Anything outside the model API answers 403: reachability without a model call.
    if (transportFacts.reachable !== '403') fail(`the container cannot reach the model transport (got ${transportFacts.reachable})`);
    transport = { privateDir, pidFile, gateway: facts.gateway! };
    const transportLog = await shell('transport-log', `cat ${shellExpand(`${privateDir}/transport.log`)} 2>/dev/null | tail -c 65536 || true`, { timeoutMs: 60_000 });
    await writeFile(join(root, 'agent-transport.log'), redact(transportLog.stdout, secrets));

    evidence.transport = { port: config.transportPort, gateway: facts.gateway!, credentials: 'host only' };
    evidence.prepared = {
      at: now().toISOString(),
      container: config.container,
      containerId: facts.containerId,
      image: facts.image,
      imageId: facts.imageId,
      compose: facts.compose,
      workspace: linuxPath(paths.workspace),
      workspaceEntries: 0,
      appPort: config.appPort,
      hostPortBefore: facts.hostPort,
      gateway: facts.gateway,
      dockerVersion: facts.dockerVersion,
      agent: agentFacts.version,
      codexSource: config.codex,
    };
    await writeFile(join(root, 'prepare.json'), JSON.stringify(evidence.prepared, null, 2));
    return evidence.prepared;
  }

  async function worker(request: WorkerRequest): Promise<WorkerResult> {
    if (!transport) throw new Error('Model transport is not running; preparation must succeed first');
    await mkdir(join(request.attemptDir, 'exec'), { recursive: true });
    await writeFile(join(request.attemptDir, 'prompt.txt'), prompt);
    // The scheduler prompt is management metadata; the worker receives the frozen
    // benchmark prompt byte for byte and nothing else.
    const argv = containerCodex(config, transport.gateway);
    await writeFile(join(request.attemptDir, 'invocation.json'), JSON.stringify({
      container: config.container, cwd: '/app', argv,
      transport: `host model proxy on ${transport.gateway}:${config.transportPort}`,
      model: config.model, effort: config.effort, promptSha256: hash(prompt), promptBytes: Buffer.byteLength(prompt),
    }, null, 2));
    const outcome = await shell('worker', `
docker exec -i -w /app -e CODEX_HOME=/tmp/agent-home -e SAASBENCH_MODEL_TOKEN=local-transport ${shellQuote(config.container)} ${argv.map(shellQuote).join(' ')}
`, { timeoutMs: request.timeoutMs, signal: request.signal, input: prompt });
    await copyFile(join(outcome.logs, 'stdout.jsonl'), join(request.attemptDir, 'stdout.jsonl')).catch(() => undefined);
    await copyFile(join(outcome.logs, 'stderr.log'), join(request.attemptDir, 'stderr.log')).catch(() => undefined);
    const parsed = await parseCodexLog(join(outcome.logs, 'stdout.jsonl')).catch(() => ({ usage: [] as unknown[], completed: false, failed: true, sessionId: undefined, failure: undefined }));
    evidence.usage = recordUsage(parsed.usage, null);
    // Terminate the container worker on every exit path: a timed-out docker exec client
    // does not stop the process it started.
    const facts = await terminateWorker();
    const status = outcome.result.status !== 'completed' ? outcome.result.status : parsed.completed && !parsed.failed ? 'completed' : 'error';
    evidence.worker = {
      status,
      durationMs: outcome.result.durationMs,
      sessionId: parsed.sessionId ?? null,
      detail: parsed.failure ? `${parsed.failure.kind}: ${parsed.failure.message}` : outcome.result.detail,
      attempts: 1,
    };
    if (facts.remaining && facts.remaining !== 'unknown') evidence.errors.push(`container worker processes survived termination: ${facts.remaining}`);
    return {
      status,
      sessionId: parsed.sessionId,
      durationMs: outcome.result.durationMs,
      usage: parsed.usage,
      detail: parsed.failure ? `${parsed.failure.kind}: ${parsed.failure.message}` : outcome.result.detail ?? (!parsed.completed ? 'No successful terminal Codex event' : undefined),
    };
  }

  async function check(workspace: string): Promise<CheckReport> {
    const responding = await appResponds();
    const digest = await workspaceDigest(workspace);
    return {
      checks: [
        { id: 'app-health', status: responding ? 'pass' : 'fail', detail: responding ? `Application answers on port ${config.appPort}` : `No response on port ${config.appPort}` },
        { id: 'workspace-submission', status: digest.files ? 'pass' : 'fail', detail: `${digest.files} source files present` },
        { id: 'hidden-evaluator', status: 'not_checked', detail: 'The official SaaSBench evaluation runs only after the workspace is frozen' },
      ],
      artifacts: [],
    };
  }

  async function collect(): Promise<{ path: string; sha256: string }> {
    const digest = await workspaceDigest(paths.workspace);
    const path = join(root, 'submission.json');
    await writeFile(path, JSON.stringify({
      runId, taskId: config.taskId, policy: config.policy,
      workspace: linuxPath(paths.workspace), digest: digest.sha256,
      files: digest.files, bytes: digest.bytes, capturedAt: now().toISOString(),
    }, null, 2), { flag: 'wx' });
    evidence.submission = { path, digest: digest.sha256, files: digest.files, bytes: digest.bytes };
    return { path, sha256: hash(await readFile(path)) };
  }

  async function stop(): Promise<void> {
    const lifecycle = await readLifecycle(root).catch(() => null);
    if (!lifecycle || lifecycle.state !== 'RUNNING') { await stopTransport(); return; }
    try {
      const facts = await terminateWorker();
      if (evidence.worker && facts.remaining !== 'unknown' && facts.remaining.length) {
        throw new Error(`Container worker could not be terminated; the evaluator must not start: ${facts.remaining}`);
      }
      const traceDir = join(root, 'logs', 'codex-home');
      await shell('codex-home', `
mkdir -p ${shellQuote(linuxPath(traceDir))}
rm -rf ${shellQuote(`${linuxPath(traceDir)}/sessions`)}
docker cp ${shellQuote(config.container)}:/tmp/agent-home/sessions ${shellQuote(`${linuxPath(traceDir)}/sessions`)} > /dev/null 2>&1 || true
echo "copied=$(test -d ${shellQuote(`${linuxPath(traceDir)}/sessions`)} && echo yes || echo no)"
`, { timeoutMs: 180_000 }).catch(() => undefined);

      const digest = await workspaceDigest(paths.workspace);
      if (evidence.submission && evidence.submission.digest !== digest.sha256) throw new Error('Workspace changed after the submission was captured; refusing to freeze');
      const snapshot = join(root, 'workspace-snapshot.tar.gz');
      const archived = await shell('freeze-snapshot', `
set -u
cd ${shellQuote(linuxPath(paths.workspace))} 2>/dev/null || exit 1
tar czf ${shellQuote(linuxPath(snapshot))} --exclude=node_modules --exclude=.next --exclude=.turbo --exclude=.git --exclude=.cache --exclude=dist --exclude=build --exclude=__pycache__ . 2>/dev/null
echo "bytes=$(stat -c %s ${shellQuote(linuxPath(snapshot))} 2>/dev/null || echo 0)"
`, { timeoutMs: 900_000 }).catch(() => undefined);
      const responding = await appResponds();
      const at = now().toISOString();
      const manifest = {
        runId, taskId: config.taskId, policy: config.policy, at,
        workspace: linuxPath(paths.workspace),
        digest: digest.sha256, files: digest.files, bytes: digest.bytes,
        excludedDirectories: digest.excluded,
        workerTermination: { protected: facts.protected, terminated: facts.terminated, remaining: facts.remaining || 'none' },
        applicationResponding: responding,
        snapshot: archived?.result.status === 'completed' ? { path: 'workspace-snapshot.tar.gz', bytes: Number(fields(archived.stdout).bytes ?? 0) } : null,
      };
      await writeFile(join(root, 'workspace-manifest.json'), JSON.stringify(manifest, null, 2));
      evidence.frozen = { at, digest: digest.sha256, files: digest.files, bytes: digest.bytes, protected: facts.protected, terminated: facts.terminated, remaining: facts.remaining, appResponding: responding, snapshot: manifest.snapshot ? manifest.snapshot.path : null };
      await advanceLifecycle(root, 'FROZEN', `workspace digest ${digest.sha256.slice(0, 16)}, worker processes remaining: ${facts.remaining || 'none'}`);
    } finally {
      await stopTransport();
    }
  }

  async function grade(selected: { path: string; sha256: string }, signal: AbortSignal): Promise<unknown> {
    const lifecycle = await readLifecycle(root);
    if (lifecycle.state !== 'FROZEN') throw new Error(`Evaluator refused: run state is ${lifecycle.state}; the workspace must be frozen first`);
    await advanceLifecycle(root, 'EVALUATING', 'official evaluator started');
    const before = await workspaceDigest(paths.workspace);
    const result = await runEvaluation({ config, paths, root, signal, deps: options.deps });
    const after = await workspaceDigest(paths.workspace);
    evidence.evaluation = { at: now().toISOString(), artifact: 'evaluation.json', summary: result.summary, workspaceStable: before.sha256 === after.sha256 };
    if (before.sha256 !== after.sha256) throw new Error('Workspace changed during evaluation; the score does not describe the frozen submission');
    if (selected.sha256 !== hash(await readFile(selected.path))) throw new Error('Submission descriptor changed during evaluation');
    return { taskId: config.taskId, raw: 'evaluation.json', summary: 'evaluation-summary.json', total: result.summary.totalScore, percentage: result.summary.percentage };
  }

  return { prepare, worker, check: (workspace: string) => check(workspace), collect: () => collect(), stop, grade, close: stopTransport, evidence };
}

/* ------------------------------------------------------------------ container codex invocation */

/** Codex argv for the container: same CLI and account as the host, container-scoped tools. */
export function containerCodex(config: SaasBenchConfig, gateway: string): string[] {
  return [
    '/opt/agent-bin/codex', 'exec',
    '--ignore-user-config', '--ignore-rules',
    '--disable', 'multi_agent', '--disable', 'multi_agent_v2',
    '--disable', 'apps', '--disable', 'plugins', '--disable', 'remote_plugin',
    '--disable', 'skill_search', '--disable', 'image_generation',
    '--disable', 'browser_use', '--disable', 'computer_use',
    '--disable', 'enable_request_compression',
    '--sandbox', 'danger-full-access',
    '-c', 'approval_policy="never"',
    '-c', 'web_search="disabled"',
    '-c', 'model_provider="saasbench"',
    '-c', 'model_providers.saasbench.name="SaaSBench host model transport"',
    '-c', `model_providers.saasbench.base_url="http://${gateway}:${config.transportPort}/backend-api/codex"`,
    '-c', 'model_providers.saasbench.env_key="SAASBENCH_MODEL_TOKEN"',
    '-c', 'model_providers.saasbench.wire_api="responses"',
    '-c', `model_reasoning_effort=${JSON.stringify(config.effort)}`,
    '--model', config.model,
    '--json', '--skip-git-repo-check', '-',
  ];
}

/** Credential-free placeholder: the host transport attaches the real bearer token. */
export function placeholderAuth(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none' })}.${encode({ exp: 4102444800, 'https://api.openai.com/auth': { chatgpt_account_id: 'local-transport', chatgpt_plan_type: 'pro' } })}.x`;
  return JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: token, access_token: token, refresh_token: 'unused', account_id: 'local-transport' }, last_refresh: new Date(0).toISOString() });
}

/* ------------------------------------------------------------------ evaluation */

export interface EvaluationOptions { config: SaasBenchConfig; paths: SaasBenchPaths; root: string; signal?: AbortSignal; deps?: SaasBenchDeps; }

export async function runEvaluation(options: EvaluationOptions): Promise<{ summary: EvaluationSummary; raw: RawEvaluation; logs: string; outcome: ShellOutcome }> {
  const { config, paths, root } = options;
  const run = options.deps?.run ?? execute;
  const { key, base, model } = await judgeCredentials();
  const secrets = [...new Set([key, process.env.LLM_API_KEY ?? ''].filter(Boolean))];
  const logs = join(root, 'logs', `${String(++evaluationCounter).padStart(2, '0')}-evaluate`);
  // The credential arrives on stdin so it cannot appear in a persisted command string.
  const script = `
set -u
cd ${shellQuote(linuxPath(paths.evaluatorDir))} || exit 1
IFS= read -r LLM_KEY || true
export LLM_API_KEY="$LLM_KEY"
export OPENAI_API_KEY="$LLM_KEY"
export HARNESS_LLM_JUDGE_API_KEY="$LLM_KEY"
export LLM_API_BASE=${shellQuote(base)}
export OPENAI_BASE_URL=${shellQuote(base)}
export HARNESS_LLM_JUDGE_API_BASE=${shellQuote(base)}
export LLM_MODEL=${shellQuote(model)}
export HARNESS_LLM_JUDGE_MODEL=${shellQuote(model)}
export WORKSPACE_DIR=${shellQuote(linuxPath(paths.workspace))}
exec ${shellQuote(config.python)} run_all.py --dag ./dag.json --with-llm --output ${shellQuote(linuxPath(join(root, 'evaluation.json')))}
`;
  const outcome = await runScript(run, config, logs, script, { timeoutMs: config.evaluationMs, cwd: root, signal: options.signal, input: `${key}\n` });
  for (const name of await readdir(logs).catch(() => [])) {
    const path = join(logs, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > 32 * 1024 * 1024) continue;
    const content = await readFile(path, 'utf8').catch(() => null);
    if (content === null) continue;
    const clean = redact(content, secrets);
    if (clean !== content) await writeFile(path, clean);
  }
  if (outcome.result.status !== 'completed') {
    throw new Error(`Evaluator did not complete (${outcome.result.status}): ${redact(await readFile(join(logs, 'stderr.log'), 'utf8').catch(() => ''), secrets).slice(-1200)}`);
  }
  const artifact = join(root, 'evaluation.json');
  const original = await readFile(artifact, 'utf8');
  const rawText = redact(original, secrets);
  if (rawText !== original) await writeFile(artifact, rawText);
  const raw = EvaluationSchema.parse(JSON.parse(rawText));
  const summary = summarizeEvaluation(raw, config.taskId);
  await writeFile(join(root, 'evaluation-summary.json'), JSON.stringify(summary, null, 2));
  return { summary, raw, logs, outcome };
}

let evaluationCounter = 0;

/* ------------------------------------------------------------------ orchestration */

async function gitRevision(directory: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)('git', ['-C', directory, 'rev-parse', 'HEAD'], { windowsHide: true, timeout: 20_000 });
    return stdout.trim();
  } catch { return 'unknown'; }
}

export interface SaasBenchRunResult {
  runId: string;
  directory: string;
  status: string;
  lifecycle: Lifecycle;
  submission: { path: string; sha256: string } | null;
  summary: EvaluationSummary | null;
  usage: UsageRecord;
  evidence: SaasBenchEvidence;
}

function teamConfig(config: SaasBenchConfig, root: string) {
  return {
    runDir: join(root, 'team'),
    tasks: [{
      id: 'deliver',
      goal: `Deliver the ${config.taskId} experience-management platform inside the prepared benchmark container. One agent, one attempt; the frozen external evaluator decides acceptance.`,
      dependsOn: [],
      routes: [config.policy],
      requiredChecks: ['app-health'],
      outputs: ['package.json'],
    }],
    concurrency: 1,
    maxAttempts: 1,
    attemptMs: config.attemptMs,
    totalMs: config.totalMs,
  };
}

/** Single policy: one worker call, then stop. No manager, no retry, no second candidate. */
export function singlePolicyDecision(): { action: 'stop'; reason: string } {
  return { action: 'stop', reason: 'Single policy: one worker call; acceptance is decided by the frozen benchmark evaluator' };
}

export async function loadPublicInputs(config: SaasBenchConfig, paths: SaasBenchPaths, runner: ShellRunner, scratchRoot?: string): Promise<PublicTaskInputs> {
  const files = [paths.publicPrompt, paths.taskSpec, paths.knowledgeBase].map(linuxPath);
  const script = `for f in ${files.map(shellQuote).join(' ')}; do printf '<<<FILE %s>>>\\n' "$f"; base64 -w0 "$f" 2>/dev/null || echo ''; printf '\\n'; done`;
  const scratch = join(scratchRoot ?? tmpdir(), `saasbench-inputs-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
  const outcome = await runScript(runner, config, scratch, script, { timeoutMs: 120_000, cwd: scratch });
  if (outcome.result.status !== 'completed') throw new Error(`Cannot read the public task inputs (${outcome.result.status})`);
  const sections = new Map<string, string>();
  let current: string | null = null;
  for (const line of (await readFile(join(scratch, 'stdout.jsonl'), 'utf8')).split('\n')) {
    const marker = /^<<<FILE (.*)>>>$/.exec(line);
    if (marker) { current = marker[1]!; sections.set(current, ''); continue; }
    if (current !== null) sections.set(current, `${sections.get(current)}${line}`);
  }
  const decode = (path: string) => {
    const value = sections.get(linuxPath(path));
    if (value === undefined) throw new Error(`Public task input is missing: ${path}`);
    const text = Buffer.from(value.trim(), 'base64').toString('utf8');
    if (!text.trim()) throw new Error(`Public task input is empty: ${path}`);
    return text;
  };
  const promptForModel = decode(paths.publicPrompt);
  const taskSpec = decode(paths.taskSpec);
  const knowledgeBase = decode(paths.knowledgeBase);
  return { promptForModel, taskSpec, knowledgeBase, hashes: { promptForModel: hash(promptForModel), taskSpec: hash(taskSpec), knowledgeBase: hash(knowledgeBase) } };
}

export interface RenderedPrompt { prompt: string; sha256: string; bytes: number; hashes: PublicTaskInputs['hashes']; }

/** Build the worker prompt and read its public inputs without touching the environment. */
export async function renderPrompt(config: SaasBenchConfig, deps: SaasBenchDeps = {}): Promise<RenderedPrompt> {
  const paths = resolveTaskPaths(config.repository, config.taskId);
  const inputs = await loadPublicInputs(config, paths, deps.run ?? execute, deps.scratch);
  const prompt = buildWorkerPrompt(inputs);
  assertNoEvaluatorLeak(prompt);
  return { prompt, sha256: hash(prompt), bytes: Buffer.byteLength(prompt), hashes: inputs.hashes };
}

export interface SaasBenchRunOptions { prepareOnly?: boolean; }

export async function runSaasBench(input: unknown, signal: AbortSignal, deps: SaasBenchDeps = {}, runOptions: SaasBenchRunOptions = {}): Promise<SaasBenchRunResult> {
  const config = SaasBenchConfigSchema.parse(input);
  if (config.policy !== 'single') throw new Error('Only the Single policy is implemented');
  const paths = resolveTaskPaths(config.repository, config.taskId);
  const inputs = await loadPublicInputs(config, paths, deps.run ?? execute, deps.scratch);
  const prompt = buildWorkerPrompt(inputs);
  assertNoEvaluatorLeak(prompt);
  const runId = newRunId(deps.now?.() ?? new Date());
  const root = saasBenchRunDir(config.runsDir, config.taskId, runId);

  const provenance = {
    runId,
    taskId: config.taskId,
    policy: config.policy,
    benchmark: { repository: config.repository, revision: await gitRevision(linuxPath(config.repository)) },
    legion: { revision: await gitRevision(projectRoot()) },
    worker: { model: config.model, effort: config.effort, cli: 'codex exec (host-installed Linux build, executed inside the task container)' },
    promptSha256: hash(prompt),
    inputs: inputs.hashes,
    isolation: 'the worker runs inside the task container; the benchmark repository is not mounted into it',
  };
  const base = { ...provenance, startedAt: new Date().toISOString(), budget: { attemptMs: config.attemptMs, totalMs: config.totalMs, evaluationMs: config.evaluationMs, tokenTarget: config.tokenTarget ?? null, tokenEnforcement: 'observational' } };

  const adapter = createSaasBenchAdapter({ config, paths, prompt, runId, root, provenance: base, deps });
  adapter.evidence.promptPath = join(root, 'prompt.txt');
  adapter.evidence.promptSha256 = hash(prompt);
  adapter.evidence.inputHashes = inputs.hashes;
  adapter.evidence.usage = recordUsage([], null);

  if (runOptions.prepareOnly) {
    await mkdir(join(root, 'logs'), { recursive: true });
    try {
      const prepared = await adapter.prepare(signal);
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...base, status: 'prepared', prepared }, null, 2));
      return { runId, directory: root, status: 'prepared', lifecycle: await readLifecycle(root), submission: null, summary: null, usage: adapter.evidence.usage, evidence: adapter.evidence };
    } finally {
      // A validation run leaves nothing behind, including the model transport.
      await adapter.close();
    }
  }

  let state: Record<string, unknown>;
  try {
    // Fail before spending the worker budget if the judge credential is unavailable.
    await judgeCredentials();
    // The adapter driver creates the run directory itself; only its parent must exist.
    await mkdir(dirname(root), { recursive: true });
    state = await runAdapter(root, teamConfig(config, root), adapter, signal, { gradeCompletedBaseline: true, policy: { decide: singlePolicyDecision } }) as unknown as Record<string, unknown>;
  } finally {
    await writeFile(join(root, 'usage.json'), JSON.stringify(adapter.evidence.usage ?? recordUsage([], null), null, 2)).catch(() => undefined);
  }

  const usage = recordUsage(adapter.evidence.usage?.entries ?? [], await readSessionUsage(join(root, 'logs', 'codex-home', 'sessions')));
  adapter.evidence.usage = usage;
  await writeFile(join(root, 'usage.json'), JSON.stringify(usage, null, 2));

  const lifecycle = await readLifecycle(root);
  if (lifecycle.state === 'EVALUATING') await advanceLifecycle(root, 'COMPLETE', `run ${String(state.status)}`);
  const team = await readFile(join(root, 'team', 'events.jsonl'), 'utf8').catch(() => '');
  const workerStream = await readFile(join(root, 'team', 'tasks', 'deliver', 'attempt-1', 'stdout.jsonl'), 'utf8').catch(() => '');
  const lines = [
    ...team.split('\n').filter(Boolean).map(line => `{"stream":"legion-team","event":${line}}`),
    ...workerStream.split('\n').filter(Boolean).map(line => `{"stream":"codex","event":${line}}`),
  ];
  await writeFile(join(root, 'trajectory.jsonl'), `${lines.join('\n')}${lines.length ? '\n' : ''}`);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({
    ...base,
    endedAt: new Date().toISOString(),
    status: state.status,
    lifecycle: (await readLifecycle(root)).state,
    prompt: { path: 'prompt.txt', sha256: hash(prompt), bytes: Buffer.byteLength(prompt) },
    worker: adapter.evidence.worker ?? null,
    submission: adapter.evidence.submission ?? null,
    usage,
    submitted: adapter.evidence.submission ? { digest: adapter.evidence.submission.digest, files: adapter.evidence.submission.files, bytes: adapter.evidence.submission.bytes } : null,
    frozen: adapter.evidence.frozen ?? null,
    evaluation: adapter.evidence.evaluation ?? null,
    transport: adapter.evidence.transport ?? null,
    artifacts: {
      execution: 'execution.json', lifecycle: 'lifecycle.json', prompt: 'prompt.txt', usage: 'usage.json',
      trajectory: 'trajectory.jsonl', workspace: 'workspace-manifest.json', evaluation: 'evaluation.json',
      evaluationSummary: 'evaluation-summary.json', submission: 'submission.json', logs: 'logs/',
    },
    errors: adapter.evidence.errors,
  }, null, 2));

  return {
    runId,
    directory: root,
    status: String(state.status),
    lifecycle: await readLifecycle(root),
    submission: adapter.evidence.submission ? { path: adapter.evidence.submission.path, sha256: adapter.evidence.submission.digest } : null,
    summary: adapter.evidence.evaluation?.summary ?? null,
    usage,
    evidence: adapter.evidence,
  };
}

/** Re-run the evaluator for an already frozen run; the model is never started again. */
export async function evaluateFrozenRun(runDir: string, config: SaasBenchConfig, signal: AbortSignal, deps: SaasBenchDeps = {}): Promise<EvaluationSummary> {
  const root = resolve(runDir);
  const paths = resolveTaskPaths(config.repository, config.taskId);
  const lifecycle = await readLifecycle(root);
  if (lifecycle.state === 'RUNNING') throw new Error('Evaluator refused: the run is still RUNNING; freeze it first');
  if (lifecycle.state === 'FROZEN') await advanceLifecycle(root, 'EVALUATING', 'manual re-evaluation');
  const { summary } = await runEvaluation({ config, paths, root, signal, deps });
  return summary;
}
