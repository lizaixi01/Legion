import { mkdir, writeFile, unlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hash } from './provenance.js';

export async function lockWorkspace(workspace: string, runDir: string): Promise<() => Promise<void>> {
  const canonical = await realpath(workspace);
  const root = join(tmpdir(), 'legion-workspace-locks');
  await mkdir(root, { recursive: true });
  const path = join(root, `${hash(process.platform === 'win32' ? canonical.toLowerCase() : canonical)}.json`);
  try {
    await writeFile(path, JSON.stringify({ managerPid: process.pid, workspace: canonical, runDir, startedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Workspace is locked. Inspect ${path} and its run's process.json; do not restart until previous workers are stopped.`);
    throw error;
  }
  // A crash intentionally leaves this lock. PID reuse makes automatic stale-lock removal unsafe.
  return () => unlink(path);
}
