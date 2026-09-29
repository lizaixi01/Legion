import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { execute } from './process.js';
import type { WorkerRequest, WorkerResult } from './types.js';

const Event = z.object({ type: z.string(), thread_id: z.string().optional(), usage: z.unknown().optional(), message: z.unknown().optional(), error: z.object({ message: z.unknown().optional() }).partial().optional() });
export type CodexFailure = { kind: 'usage-limit' | 'provider-error'; message: string };
/** A usage/quota rejection is an infrastructure limit, not a failed attempt. */
export function classifyCodexFailure(message: string): CodexFailure['kind'] {
  return /usage limit|rate limit|quota|too many requests|\b429\b/i.test(message) ? 'usage-limit' : 'provider-error';
}
function failureText(event: z.infer<typeof Event>): string {
  const value = event.error?.message ?? event.message;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value !== undefined) return JSON.stringify(value).slice(0, 2000);
  return 'Codex reported a failure without a message';
}
export async function parseCodexLog(path: string): Promise<{ sessionId?: string; usage: unknown[]; completed: boolean; failed: boolean; failure?: CodexFailure }> {
  const result: { sessionId?: string; usage: unknown[]; completed: boolean; failed: boolean; failure?: CodexFailure } = { usage: [], completed: false, failed: false };
  let lastError: CodexFailure | undefined;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    // Invalid/truncated output must never become a successful attempt.
    const event = Event.parse(JSON.parse(line));
    if (event.type === 'thread.started') result.sessionId = event.thread_id;
    if (event.type === 'turn.completed') {
      result.completed = true;
      if (event.usage !== undefined) result.usage.push(event.usage);
    }
    // Only turn.failed is terminal. Codex emits retryable notices (e.g. "Reconnecting... N/5")
    // as `error` events; they must not discard a turn that later completes.
    if (event.type === 'turn.failed') {
      result.failed = true;
      const message = failureText(event);
      result.failure = { kind: classifyCodexFailure(message), message };
    }
    if (event.type === 'error') {
      const message = failureText(event);
      lastError = { kind: classifyCodexFailure(message), message };
    }
  }
  if (!result.completed && !result.failure && lastError) result.failure = lastError;
  return result;
}

export interface ExecutionOptions { permission: 'read-only' | 'workspace-write' | 'danger-full-access'; agents: 0 | 2 | 4 }
export function codexArguments(model: string, effort: string, sessionId?: string, platform: NodeJS.Platform = process.platform, options: ExecutionOptions = {permission:'workspace-write',agents:0}): string[] {
    const args = ['exec', '--ignore-user-config', '--ignore-rules', options.agents ? '--enable' : '--disable', 'multi_agent', '--disable', 'multi_agent_v2', '--sandbox', options.permission, '-c', 'approval_policy="never"', '-c', `model_reasoning_effort=${JSON.stringify(effort)}`];
    if(options.agents)args.push('-c',`agents.max_threads=${options.agents}`,'-c','agents.max_depth=1');
    // Ignoring personal config also removes the Windows sandbox implementation.
    // Select it explicitly so workspace-write does not become read-only.
    if (platform === 'win32') args.push('-c', 'windows.sandbox="elevated"');
    if (sessionId) args.push('resume', sessionId);
    args.push('--model', model, '--json', '--skip-git-repo-check', '-');
    return args;
}

export function codexWorker(command: string, model: string, effort: string, options?: ExecutionOptions) {
  return async (request: WorkerRequest): Promise<WorkerResult> => {
    const args = codexArguments(model, effort, request.sessionId, process.platform, options);
    await writeFile(join(request.attemptDir, 'prompt.txt'), request.prompt);
    await writeFile(join(request.attemptDir, 'invocation.json'), JSON.stringify({ command, args, cwd: request.workspace }, null, 2));
    const execution = await execute({ command, args, cwd: request.workspace, logDir: request.attemptDir, input: request.prompt, timeoutMs: request.timeoutMs, signal: request.signal });
    try {
      const log = await parseCodexLog(join(request.attemptDir, 'stdout.jsonl'));
      return { status: execution.status !== 'completed' ? execution.status : log.completed && !log.failed ? 'completed' : 'error', durationMs: execution.durationMs, sessionId: log.sessionId, usage: log.usage, detail: execution.detail ?? (log.failure ? `${log.failure.kind}: ${log.failure.message}` : !log.completed ? 'No successful terminal Codex event' : undefined) };
    } catch (error) {
      return { status: execution.status === 'completed' ? 'error' : execution.status, durationMs: execution.durationMs, usage: [], detail: `Cannot parse worker evidence: ${String(error)}` };
    }
  };
}
