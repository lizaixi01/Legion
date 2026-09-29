import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { z } from 'zod';

async function canonicalOutput(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await canonicalOutput(parent), relative(parent, path));
  }
}

const ms = z.number().int().positive().max(2_147_483_647);
export const ConfigSchema = z.object({
  goal: z.string().min(1), mode: z.enum(['B0', 'B1', 'goal']).default('B1'),
  requiredChecks: z.array(z.string().min(1)).min(1).optional(),
  maxAttempts: z.number().int().positive().optional(),
  workspace: z.string().min(1), output: z.string().default('.runs'),
  codex: z.string().default('codex'), model: z.string().default('gpt-6-sol'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).default('high'),
  initialMs: ms.default(18_000_000), repairMs: ms.default(7_200_000), totalMs: ms.default(28_800_000),
  checker: z.object({ command: z.string().min(1), args: z.array(z.string()), timeoutMs: ms.default(600_000) }).strict(),
}).strict().superRefine((config, ctx) => {
  if (config.mode === 'goal' && !config.requiredChecks?.length) ctx.addIssue({ code: 'custom', message: 'goal mode requires explicit requiredChecks' });
  if (config.requiredChecks && new Set(config.requiredChecks).size !== config.requiredChecks.length) ctx.addIssue({ code: 'custom', message: 'requiredChecks must be unique' });
});

export async function loadConfig(file: string) {
  const base = dirname(resolve(file));
  const config = ConfigSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  config.workspace = await realpath(resolve(base, config.workspace));
  if (!(await stat(config.workspace)).isDirectory()) throw new Error('Workspace must be a directory');
  config.output = await canonicalOutput(resolve(base, config.output));
  const rel = relative(config.workspace, config.output);
  if (rel === '' || (!/^\.\.([\\/]|$)/.test(rel) && !isAbsolute(rel))) throw new Error('Evidence output must be outside the worker workspace');
  return config;
}
