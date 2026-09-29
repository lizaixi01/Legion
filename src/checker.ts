import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { execute } from './process.js';
import type { CheckReport } from './types.js';
import { fingerprint } from './provenance.js';

export const ReportSchema = z.object({
  checks: z.array(z.object({ id: z.string().min(1), status: z.enum(['pass', 'fail', 'not_checked', 'error']), detail: z.string() }).strict()),
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
}).strict().superRefine((report, ctx) => {
  if (new Set(report.checks.map(c => c.id)).size !== report.checks.length) ctx.addIssue({ code: 'custom', message: 'Duplicate check IDs' });
});

export function commandChecker(config: { command: string; args: string[]; timeoutMs: number }, expectedFiles?: Record<string, string>) {
  return async (workspace: string, attemptDir: string, signal?: AbortSignal): Promise<CheckReport> => {
    const error = (detail: string): CheckReport => ({ checks: [{ id: 'checker_runtime', status: 'error', detail }], artifacts: [] });
    if (expectedFiles) {
      const current = await fingerprint(config.command, config.args);
      if (JSON.stringify(current) !== JSON.stringify(expectedFiles)) return error('Checker files changed since the run started; verification refused');
    }
    const logDir = join(attemptDir, 'verifier');
    await mkdir(logDir);
    const execution = await execute({ command: config.command === '$node' ? process.execPath : config.command, args: config.args.map(arg => arg.replaceAll('{workspace}', workspace)), cwd: workspace, logDir, timeoutMs: config.timeoutMs, signal });
    if (execution.status !== 'completed') return error(`Checker process ${execution.status}: ${execution.detail ?? ''}`);
    const path = join(logDir, 'stdout.jsonl');
    if ((await stat(path)).size > 4 * 1024 * 1024) return error('Checker report exceeds 4 MiB');
    try { return ReportSchema.parse(JSON.parse(await readFile(path, 'utf8'))); }
    catch (failure) { return error(`Invalid checker report: ${String(failure)}`); }
  };
}
