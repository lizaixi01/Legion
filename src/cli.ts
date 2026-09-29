import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { run } from './run.js';
import { codexWorker } from './codex.js';
import { commandChecker } from './checker.js';
import { loadConfig, ConfigSchema } from './config.js';
import { readCheckpoint } from './checkpoint.js';
import { isDeepStrictEqual } from 'node:util';
import type { RunDependencies } from './types.js';
import { codexIdentity, fingerprint, hash } from './provenance.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const [command, argument] = process.argv.slice(2);
const onEvent: RunDependencies['onEvent'] = event => console.log(`${event.at} ${event.type} ${JSON.stringify(event.data)}`);

try {
  if (command === 'demo' || command === 'demo-goal') {
    const goalDemo = command === 'demo-goal';
    const output = resolve('.runs');
    await mkdir(output, { recursive: true });
    const workspace = join(output, `demo-workspace-${randomUUID()}`);
    await mkdir(workspace);
    const runDir = join(output, `demo-${randomUUID()}`);
    console.log('Deterministic fixture demo — no model, no benchmark score.');
    let fixtureAttempt = 0;
    const result = await run({ goal: 'Fixture must contain 42', mode: goalDemo ? 'goal' : 'B1', requiredChecks: goalDemo ? ['answer'] : undefined, workspace, runDir, initialMs: 1000, repairMs: 1000, totalMs: 5000 }, {
      signal: controller.signal, onEvent,
      worker: async request => {
        fixtureAttempt++;
        await writeFile(join(workspace, 'result.txt'), goalDemo ? String(Math.min(42, 38 + fixtureAttempt)) : request.sessionId ? '42' : '41');
        await writeFile(join(request.attemptDir, 'fixture.json'), JSON.stringify({ simulated: true, resumed: Boolean(request.sessionId) }));
        return { status: 'completed', sessionId: 'fixture-session', durationMs: 0, usage: [] };
      },
      check: async () => {
        const value = await readFile(join(workspace, 'result.txt'), 'utf8');
        return { checks: [{ id: 'answer', status: value === '42' ? 'pass' : 'fail', detail: `Expected 42, received ${value}` }], artifacts: [{ path: 'result.txt', sha256: createHash('sha256').update(value).digest('hex') }] };
      },
    });
    console.log(`Evidence: ${join(runDir, 'report.md')}`);
    process.exitCode = result.status === 'checks_passed' ? 0 : 1;
  } else if (command === 'run' && argument) {
    const config = await loadConfig(argument);
    const identity = await codexIdentity(config.codex);
    const checkerFiles = await fingerprint(config.checker.command, config.checker.args);
    await mkdir(config.output, { recursive: true });
    const runDir = join(config.output, `run-${randomUUID()}`);
    console.log(`Run directory: ${runDir}`);
    const result = await run({ ...config, runDir, provenance: { codex: identity, checkerFiles, goalSha256: hash(config.goal), node: process.version, isolation: 'local-workspace-sandbox; not benchmark-isolated', usageAggregation: 'unverified; raw only' } }, { worker: codexWorker(config.codex, config.model, config.effort), check: commandChecker(config.checker, checkerFiles), signal: controller.signal, onEvent });
    console.log(`Evidence: ${join(runDir, 'report.md')}`);
    process.exitCode = result.status === 'checks_passed' || result.status === 'paused' ? 0 : 1;
  } else if (command === 'pause' && argument) {
    const runDir = resolve(argument);
    const state = await readCheckpoint(runDir);
    if (state.config.mode !== 'goal' || !['running', 'checking'].includes(state.status)) throw new Error('Only an active goal run can be paused');
    await writeFile(join(runDir, 'pause.request'), 'Pause at next clean checkpoint.\n');
    console.log('Pause requested. The current worker and its check will finish first; successful completion takes precedence.');
  } else if (command === 'resume' && argument) {
    const runDir = resolve(argument);
    const state = await readCheckpoint(runDir);
    if (state.status !== 'paused') throw new Error('Only cleanly paused runs can resume. Crash recovery requires process inspection.');
    if (resolve(state.config.runDir) !== runDir) throw new Error('Run directory moved; automatic resume refused');
    const { runDir: _storedRunDir, provenance, ...saved } = state.config;
    const config = ConfigSchema.parse(saved);
    const identity = await codexIdentity(config.codex);
    const checkerFiles = await fingerprint(config.checker.command, config.checker.args);
    if (!isDeepStrictEqual(identity, provenance?.codex) || !isDeepStrictEqual(checkerFiles, provenance?.checkerFiles)) throw new Error('Worker or checker identity changed; resume refused');
    const result = await run(state.config, { worker: codexWorker(config.codex, config.model, config.effort), check: commandChecker(config.checker, checkerFiles), signal: controller.signal, onEvent }, { resume: true });
    console.log(`Evidence: ${join(runDir, 'report.md')}`);
    process.exitCode = result.status === 'checks_passed' || result.status === 'paused' ? 0 : 1;
  } else if (command === 'status' && argument) {
    console.log(await readFile(join(resolve(argument), 'state.json'), 'utf8'));
  } else {
    console.log('Usage: npm start -- run <config.json> | status/pause/resume <run-directory> | demo | demo-goal');
    if (command && command !== '--help' && command !== '-h') process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
