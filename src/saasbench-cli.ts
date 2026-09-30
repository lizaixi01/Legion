import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SaasBenchConfigSchema, applyProfile, defaultSaasBenchConfig, evaluateFrozenRun, readLifecycle, renderPrompt, runSaasBench, type SaasBenchProfile } from './saasbench.js';
import { applyRunDeadline } from './run-deadline.js';

const USAGE = `Legion x SaaSBench (task_kmasmnil)

  npm run saasbench -- run [--smoke | --full] [--minutes N] [--config <file>] [--prepare-only]
  npm run saasbench -- prompt [--config <file>]
  npm run saasbench -- evaluate <run-directory> [--config <file>]
  npm run saasbench -- status <run-directory>

  run        prepare the task environment, run exactly one Codex worker, freeze, then evaluate
  prompt     print the exact worker prompt and its input hashes without side effects
  evaluate   re-run the evaluator for an already frozen run (never starts the model again)
  status     show the lifecycle, worker and score recorded for a run

  --smoke    worker budget 20 minutes and a 200k token target (observational)
  --full     worker budget 180 minutes
  --minutes  explicit worker budget in minutes`;

interface Options { profile: SaasBenchProfile; minutes?: number; config?: string; prepareOnly: boolean; }

function parseArguments(argv: string[]): { action: string; target?: string; options: Options } {
  const [action, ...rest] = argv;
  const options: Options = { profile: 'smoke', prepareOnly: false };
  let target: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index]!;
    if (value === '--smoke') options.profile = 'smoke';
    else if (value === '--full') options.profile = 'full';
    else if (value === '--prepare-only') options.prepareOnly = true;
    else if (value === '--minutes') { const raw = rest[++index]; options.minutes = Number(raw); if (!Number.isFinite(options.minutes)) throw new Error('--minutes requires a number'); }
    else if (value === '--config') { options.config = rest[++index]; if (!options.config) throw new Error('--config requires a file path'); }
    else if (value.startsWith('--')) throw new Error(`Unknown option: ${value}`);
    else if (target === undefined) target = value;
    else throw new Error(`Unexpected argument: ${value}`);
  }
  if (!action) throw new Error(USAGE);
  return { action, target, options };
}

async function configuration(options: Options) {
  const base = options.config
    ? SaasBenchConfigSchema.parse(JSON.parse(await readFile(resolve(options.config), 'utf8')))
    : defaultSaasBenchConfig();
  return options.minutes === undefined && options.profile === 'full' ? applyProfile(base, 'full') : applyProfile(base, options.profile, options.minutes);
}

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
applyRunDeadline(controller, process.env.PROACTIVE_RUN_DEADLINE);

const { action, target, options } = parseArguments(process.argv.slice(2));

if (action === 'run') {
  const config = await configuration(options);
  const plan = [
    `task:      ${config.taskId}`,
    `policy:    ${config.policy} (one Codex worker, one attempt, no manager, no retry)`,
    `budget:    ${Math.round(config.attemptMs / 60_000)} min worker wall clock`,
    `evaluation: ${Math.round(config.evaluationMs / 60_000)} min after freeze`,
    `token cap: ${config.tokenTarget ? `${config.tokenTarget} (observational, not enforced)` : 'none'}`,
    `runs dir:  ${resolve(config.runsDir)}`,
  ];
  console.log(plan.join('\n'));
  const result = await runSaasBench(config, controller.signal, {}, { prepareOnly: options.prepareOnly });
  console.log(`run:       ${result.directory}`);
  console.log(`lifecycle: ${result.lifecycle.state}`);
  console.log(`status:    ${result.status}`);
  console.log(`usage:     ${result.usage.known ? `${JSON.stringify(result.usage.total)} (${result.usage.source})` : 'unknown'}`);
  if (result.summary) console.log(`score:     ${result.summary.totalScore}/${result.summary.totalMax} (${result.summary.percentage}%) — ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.skipped} skipped`);
  else console.log('score:     not evaluated');
  if (options.prepareOnly) console.log('note:      environment only; the model transport was stopped again');
  process.exitCode = ['evaluated', 'prepared'].includes(result.status) ? 0 : 1;
} else if (action === 'prompt') {
  const config = await configuration(options);
  const rendered = await renderPrompt(config);
  console.log(rendered.prompt);
  console.error(`\n[prompt] sha256=${rendered.sha256} bytes=${rendered.bytes}`);
  console.error(`[inputs] ${JSON.stringify(rendered.hashes)}`);
} else if (action === 'evaluate') {
  if (!target) throw new Error('evaluate requires a run directory');
  const config = await configuration(options);
  const summary = await evaluateFrozenRun(target, config, controller.signal);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = 0;
} else if (action === 'status') {
  if (!target) throw new Error('status requires a run directory');
  const root = resolve(target);
  const lifecycle = await readLifecycle(root);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  console.log(JSON.stringify({ lifecycle, status: manifest.status, worker: manifest.worker, submission: manifest.submission, usage: manifest.usage, errors: manifest.errors, evaluation: manifest.evaluation ?? null }, null, 2));
} else {
  throw new Error(USAGE);
}
