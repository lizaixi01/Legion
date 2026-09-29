import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TeamConfigSchema, TeamTaskSchema, runTeam, type TeamDependencies } from './team.js';
import { codexWorker } from './codex.js';
import { commandChecker } from './checker.js';
import { codexIdentity, fingerprint } from './provenance.js';
import { codexMaster } from './master.js';

const checker = z.object({ command: z.string(), args: z.array(z.string()), timeoutMs: z.number().int().positive().max(2147483647).default(60000) }).strict();
const schema = TeamConfigSchema.omit({ runDir: true, tasks: true }).extend({
  output: z.string().default('.runs'), codex: z.string().default('codex'), model: z.string().default('gpt-6-sol'), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).default('high'),
  tasks: z.array(TeamTaskSchema.extend({ checker, verifier: checker.optional() })).min(1),
  master: z.object({ policy: z.enum(['rules', 'codex']).default('rules'), timeoutMs: z.number().int().positive().max(2147483647).default(60000) }).strict().default({ policy: 'rules', timeoutMs: 60000 }),
});
const [command, file] = process.argv.slice(2);
const controller = new AbortController();
process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
const onEvent: TeamDependencies['onEvent'] = e => console.log(`${e.at} ${e.type} ${JSON.stringify(e.data)}`);
try {
  if (command === 'status' && file) {
    const state = JSON.parse(await readFile(join(resolve(file), 'state.json'), 'utf8'));
    console.log(JSON.stringify({ status: state.status, tasks: state.tasks }, null, 2));
  } else if (command === 'run' && file) {
    const config = schema.parse(JSON.parse(await readFile(resolve(file), 'utf8')));
    const base = dirname(resolve(file));
    const resolveExplicit = (value: string) => /^(\.\.?)[\\/]/.test(value) ? resolve(base, value) : value;
    config.codex = resolveExplicit(config.codex);
    for (const task of config.tasks) for (const tool of [task.checker, task.verifier]) if (tool) {
      tool.command = resolveExplicit(tool.command); tool.args = tool.args.map(resolveExplicit);
    }
    const output = resolve(dirname(resolve(file)), config.output); await mkdir(output, { recursive: true });
    const runDir = join(output, `team-${randomUUID()}`);
    const identity = await codexIdentity(config.codex);
    const checks = new Map<string, ReturnType<typeof commandChecker>>(); const verifiers = new Map<string, ReturnType<typeof commandChecker>>();
    const fingerprints: Record<string, unknown> = {};
    for (const task of config.tasks) {
      const files = await fingerprint(task.checker.command, task.checker.args); fingerprints[task.id] = { checker: files };
      checks.set(task.id, commandChecker(task.checker, files));
      if (task.verifier) {
        const files = await fingerprint(task.verifier.command, task.verifier.args);
        fingerprints[task.id] = { ...fingerprints[task.id] as object, verifier: files };
        verifiers.set(task.id, commandChecker(task.verifier, files));
      }
    }
    console.log(`Team directory: ${runDir}`);
    const result = await runTeam({ runDir, concurrency: config.concurrency, maxAttempts: config.maxAttempts, attemptMs: config.attemptMs, totalMs: config.totalMs, tasks: config.tasks.map(({ checker: _checker, verifier: _verifier, ...task }) => task) }, {
      worker: codexWorker(config.codex, config.model, config.effort),
      decide: config.master.policy === 'codex' ? codexMaster({ command: config.codex, model: config.model, effort: config.effort, timeoutMs: config.master.timeoutMs }) : undefined,
      canVerify: task => verifiers.has(task.id),
      check: (workspace, dir, signal, task) => checks.get(task.id)!(workspace, dir, signal),
      verify: verifiers.size ? (workspace, dir, signal, task) => verifiers.get(task.id)?.(workspace, dir, signal) ?? Promise.resolve({ checks: task.requiredChecks.map(id => ({ id, status: 'not_checked' as const, detail: 'No supplementary verifier configured for this task' })), artifacts: [] }) : undefined,
      signal: controller.signal, onEvent: async e => {
        if (e.type === 'team_started') await writeFile(join(runDir, 'provenance.json'), JSON.stringify({ codex: identity, model: config.model, effort: config.effort, fingerprints, policy: config.master.policy === 'codex' ? 'codex-master-v1' : 'evidence-v1', master: config.master, isolation: 'workspace-write; not benchmark-isolated' }, null, 2));
        await onEvent(e);
      },
    });
    console.log(`Evidence: ${join(runDir, 'report.md')}`); process.exitCode = result.status === 'completed' ? 0 : 1;
  } else if (command === 'demo') {
    const output = resolve('.runs'); await mkdir(output, { recursive: true }); const runDir = join(output, `team-demo-${randomUUID()}`);
    console.log('Deterministic team fixture; no model calls and no benchmark score.');
    const counts = new Map<string, number>();
    const result = await runTeam({ runDir, concurrency: 2, maxAttempts: 4, attemptMs: 1000, totalMs: 10000, tasks: [
      { id: 'design', goal: 'Design', dependsOn: [], routes: ['initial approach', 'alternative approach'], requiredChecks: ['contract'], outputs: ['result.txt'] },
      { id: 'testplan', goal: 'Test plan', dependsOn: [], routes: ['prepare tests'], requiredChecks: ['contract'], outputs: ['result.txt'] },
      { id: 'integrate', goal: 'Integrate', dependsOn: ['design', 'testplan'], routes: ['combine verified inputs'], requiredChecks: ['contract'], outputs: ['result.txt'] },
    ] }, {
      worker: async (r, task) => {
        const count = (counts.get(task.id) ?? 0) + 1; counts.set(task.id, count);
        if (task.id === 'integrate') for (const id of task.dependsOn) await readFile(join(r.workspace, 'inputs', id, 'result.txt'));
        await writeFile(join(r.workspace, 'result.txt'), task.id === 'design' && count < 3 ? 'wrong' : 'verified');
        return { status: 'completed', sessionId: r.sessionId ?? randomUUID(), durationMs: 0, usage: [] };
      },
      check: async (workspace, _dir, _signal, task) => ({ checks: [{ id: 'contract', status: task.id === 'testplan' ? 'not_checked' : (await readFile(join(workspace, 'result.txt'), 'utf8')) === 'verified' ? 'pass' : 'fail', detail: 'Fixture contract' }], artifacts: [] }),
      verify: async workspace => ({ checks: [{ id: 'contract', status: (await readFile(join(workspace, 'result.txt'), 'utf8')) === 'verified' ? 'pass' : 'fail', detail: 'Supplementary fixture check' }], artifacts: [] }),
      signal: controller.signal, onEvent,
    });
    console.log(`Evidence: ${join(runDir, 'report.md')}`); process.exitCode = result.status === 'completed' ? 0 : 1;
  } else {
    console.log('Usage: npm run team -- run <config.json> | status <team-directory> | demo');
    if (command !== '--help' && command !== '-h' && command) process.exitCode = 2;
  }
} catch (error) { console.error(String(error)); process.exitCode = 1; }
