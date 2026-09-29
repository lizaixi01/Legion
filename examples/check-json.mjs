// A small public contract for transport smoke testing, not a benchmark.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const workspace = process.argv[2];
const checks = [];
const artifacts = [];
try {
  const bytes = await readFile(join(workspace, 'answer.json'));
  artifacts.push({ path: 'answer.json', sha256: createHash('sha256').update(bytes).digest('hex') });
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); }
  catch { checks.push({ id: 'json', status: 'fail', detail: 'answer.json must be valid JSON' }); }
  if (data !== undefined) {
    checks.push({ id: 'sum', status: data?.sum === 42 ? 'pass' : 'fail', detail: 'sum must equal 19 + 23 = 42' });
    checks.push({ id: 'sorted', status: JSON.stringify(data?.sorted) === '[1,2,3]' ? 'pass' : 'fail', detail: 'sorted must equal [1, 2, 3]' });
  }
} catch (error) {
  checks.push({ id: 'artifact', status: error.code === 'ENOENT' ? 'fail' : 'error', detail: error.code === 'ENOENT' ? 'answer.json is missing' : error.message });
}
checks.push({ id: 'domain_quality', status: 'not_checked', detail: 'This is a small CLI transport check, not a domain evaluation.' });
console.log(JSON.stringify({ checks, artifacts }));
