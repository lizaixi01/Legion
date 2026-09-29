// Public transport checker. No benchmark or domain-quality claim.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const [workspace, expectedText] = process.argv.slice(2);
const expected = Number(expectedText);
if (!workspace || !Number.isFinite(expected)) throw Error('Expected workspace and finite target');
let checks; const artifacts = [];
try {
  const bytes = await readFile(join(workspace, 'answer.json'));
  artifacts.push({ path: 'answer.json', sha256: createHash('sha256').update(bytes).digest('hex') });
  try {
    const answer = JSON.parse(bytes.toString());
    checks = [{ id: 'sum', status: answer.sum === expected ? 'pass' : 'fail', detail: `Expected sum=${expected}, received ${JSON.stringify(answer.sum)}` }];
  } catch { checks = [{ id: 'sum', status: 'fail', detail: 'answer.json must be valid JSON' }]; }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  checks = [{ id: 'sum', status: 'fail', detail: 'answer.json is missing' }];
}
checks.push({ id: 'domain_quality', status: 'not_checked', detail: 'Transport check only' });
console.log(JSON.stringify({ checks, artifacts }));
