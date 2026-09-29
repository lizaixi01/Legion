import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
export async function fingerprint(command: string, args: string[]) {
  const files: Record<string, string> = {};
  for (const file of [command, ...args]) {
    if (isAbsolute(file) && await stat(file).then(s => s.isFile(), () => false)) files[file] = hash(await readFile(file));
  }
  return files;
}
export async function codexIdentity(command: string) {
  const { stdout } = await promisify(execFile)(command, ['--version'], { timeout: 10_000, windowsHide: true, maxBuffer: 64 * 1024 });
  return { version: stdout.trim(), files: await fingerprint(command, []) };
}
