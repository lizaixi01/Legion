import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ReportSchema } from './checker.js';
import type { RunState } from './types.js';

const StateSchema = z.object({
  id: z.string(), startedAt: z.string().datetime(), endedAt: z.string().datetime().optional(),
  durationMs: z.number().nonnegative().optional(),
  config: z.object({
    goal: z.string(), mode: z.enum(['B0', 'B1', 'goal']), workspace: z.string(), runDir: z.string(),
    initialMs: z.number().positive(), repairMs: z.number().positive(), totalMs: z.number().positive(),
    requiredChecks: z.array(z.string()).optional(), maxAttempts: z.number().int().positive().optional(), provenance: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
  status: z.enum(['running', 'checking', 'paused', 'checks_passed', 'checks_failed', 'unverified', 'error', 'timeout', 'cancelled']),
  reason: z.string().optional(), finalGrade: z.null(), actualCost: z.null(),
  attempts: z.array(z.object({ number: z.number().int().positive(),
    worker: z.object({ status: z.enum(['completed', 'error', 'timeout', 'cancelled']), sessionId: z.string().optional(), durationMs: z.number().nonnegative(), usage: z.array(z.unknown()), detail: z.string().optional() }).optional(),
    check: ReportSchema.optional(),
  })),
});

export async function readCheckpoint(runDir: string): Promise<RunState> {
  return StateSchema.parse(JSON.parse(await readFile(join(runDir, 'state.json'), 'utf8')));
}
