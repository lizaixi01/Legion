import { spawn } from 'node:child_process';
import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export interface ProcessRequest {
  command: string; args: string[]; cwd: string; logDir: string;
  input?: string; timeoutMs: number; signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}
export interface ProcessResult {
  status: 'completed' | 'error' | 'timeout' | 'cancelled';
  exitCode: number | null; durationMs: number; detail?: string;
  started?: boolean; pid?: number; signal?: NodeJS.Signals | null;
}

export async function execute(request: ProcessRequest): Promise<ProcessResult> {
  if (request.signal?.aborted) return { status: 'cancelled', exitCode: null, durationMs: 0 };
  const stdout = await open(join(request.logDir, 'stdout.jsonl'), 'wx');
  const stderr = await open(join(request.logDir, 'stderr.log'), 'wx');
  const start = performance.now();
  try {
    return await new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd, env: request.env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', stdout.fd, stderr.fd],
      });
      let stopped: 'timeout' | 'cancelled' | undefined;
      let spawnError: string | undefined;
      let killJob: Promise<void> | undefined;
      function terminate(kind: 'timeout' | 'cancelled') {
        if (stopped) return;
        stopped = kind;
        if (!child.pid) return;
        const pid = child.pid;
        killJob = new Promise<void>((done, fail) => {
          if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
            killer.once('error', error => fail(new Error('Process-tree termination failed; inspect process.json before restarting', { cause: error })));
            killer.once('close', code => code === 0 || child.exitCode !== null ? done() : fail(new Error('Process-tree termination failed; inspect process.json before restarting')));
          } else {
            try { process.kill(-pid, 'SIGKILL'); done(); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') done(); else fail(error); }
          }
        });
        // Observe immediately; completion is awaited by the close handler below.
        void killJob.catch(reject);
      }
      const timer = setTimeout(() => terminate('timeout'), request.timeoutMs);
      const abort = () => terminate('cancelled');
      request.signal?.addEventListener('abort', abort, { once: true });
      child.once('error', error => { spawnError = error.message; });
      child.stdin?.on('error', () => { /* Early child exit is recorded by close. */ });
      child.once('spawn', () => {
        void writeFile(join(request.logDir, 'process.json'), JSON.stringify({ pid: child.pid, managerPid: process.pid, startedAt: new Date().toISOString(), command: request.command }, null, 2)).catch(error => { spawnError = String(error); terminate('cancelled'); });
      });
      child.once('close', (exitCode, exitSignal) => {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
        void (async () => {
          if (killJob) await killJob;
          resolve({ status: stopped ?? (spawnError || exitCode !== 0 ? 'error' : 'completed'), started: child.pid !== undefined, pid: child.pid, signal: exitSignal, exitCode, durationMs: Math.round(performance.now() - start), detail: spawnError ?? (exitCode !== 0 ? `Exit ${exitCode}; signal ${exitSignal}` : undefined) });
        })().catch(reject);
      });
      child.stdin?.end(request.input ?? '');
      if (request.signal?.aborted) abort();
    });
  } finally {
    await stdout.close();
    await stderr.close();
  }
}
