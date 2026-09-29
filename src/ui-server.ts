import { createServer } from 'node:http';
import { readFile, readdir, mkdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { execute } from './process.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runs = join(root, '.runs');
const token = randomBytes(32).toString('hex');
const port = Number(process.env.PROACTIVE_UI_PORT ?? 4318);
type Launch = { id: string; preset: string; status: string; runId?: string; detail?: string };
const launches: Launch[] = [];
let active: { launch: Launch; controller: AbortController } | undefined;
const presets = {
  demo: { args: ['demo'], timeout: 60000 },
  rules: { args: ['run', join(root, 'examples/team.json')], timeout: 420000 },
  master: { args: ['run', join(root, 'examples/team-master.json')], timeout: 720000 },
};
async function safeRun(id: string) {
  if (!/^team-(?:demo-)?[a-f0-9-]{36}$/.test(id)) throw Error('无效的运行编号');
  const path = join(runs, id);
  if ((await lstat(path)).isSymbolicLink()) throw Error('不读取链接目录');
  return path;
}
async function read(path: string, fallback: string) {
  try { if ((await lstat(path)).isSymbolicLink()) throw Error('不读取链接文件'); return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
async function listRuns() {
  await mkdir(runs, { recursive: true });
  const items = await readdir(runs, { withFileTypes: true });
  const results = await Promise.all(items.filter(i => i.isDirectory() && /^team-(?:demo-)?[a-f0-9-]{36}$/.test(i.name)).map(async i => {
    try {
      const state = JSON.parse(await read(join(await safeRun(i.name), 'state.json'), '{}'));
      if (!state.tasks) return null;
      const tasks = Object.values(state.tasks) as { status: string }[];
      return { id: i.name, status: state.status === 'running' && active?.launch.runId !== i.name ? 'unconfirmed' : state.status, startedAt: state.startedAt, total: tasks.length, accepted: tasks.filter(t => t.status === 'accepted').length, demo: i.name.startsWith('team-demo-') };
    } catch { return null; }
  }));
  return results.filter(i => i !== null).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100);
}
async function start(preset: keyof typeof presets) {
  if (active) throw Error('已有任务正在运行，请等待完成或先停止');
  const launch: Launch = { id: randomUUID(), preset, status: 'running' };
  const controller = new AbortController(); active = { launch, controller }; launches.unshift(launch);
  const logDir = join(root, '.local', 'ui-launches', launch.id);
  try { await mkdir(logDir, { recursive: true }); } catch (error) { active = undefined; launch.status = 'error'; throw error; }
  const detect = async () => {
    const log = await read(join(logDir, 'stdout.jsonl'), '');
    const match = log.match(/team-(?:demo-)?[a-f0-9-]{36}/);
    if (match) launch.runId = match[0];
  };
  const poll = setInterval(() => { void detect().catch(() => {}); }, 400);
  void (async () => {
    try {
      const result = await execute({ command: process.execPath, args: ['--import', 'tsx', join(root, 'src/team-cli.ts'), ...presets[preset].args], cwd: root, logDir, timeoutMs: presets[preset].timeout, signal: controller.signal });
      await detect(); launch.status = result.status;
      if (result.status !== 'completed') launch.detail = (await read(join(logDir, 'stderr.log'), '')).slice(-4000) || result.detail || result.status;
    } catch (error) { launch.status = 'error'; launch.detail = String(error); }
    finally { clearInterval(poll); if (active?.launch === launch) active = undefined; }
  })();
  return launch;
}
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  try {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return json({ error: 'Invalid host' }, 403);
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const content = (await readFile(join(root, 'ui', name), 'utf8')).replace('__TOKEN__', token);
      res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' }); res.end(content); return;
    }
    if (req.headers['x-ui-token'] !== token) return json({ error: '请刷新页面后重试' }, 403);
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json({ error: 'Invalid origin' }, 403);
    if (req.method === 'GET' && url.pathname === '/api/runs') return json({ runs: await listRuns(), launches: launches.slice(0, 20), active: active?.launch ?? null });
    if (req.method === 'GET' && url.pathname === '/api/run') {
      const dir = await safeRun(url.searchParams.get('id') ?? '');
      const [state, events, report, provenance] = await Promise.all([read(join(dir, 'state.json'), '{}'), read(join(dir, 'events.jsonl'), ''), read(join(dir, 'report.md'), ''), read(join(dir, 'provenance.json'), '{}')]);
      const saved = JSON.parse(state);
      if (saved.status === 'running' && active?.launch.runId !== url.searchParams.get('id')) saved.status = 'unconfirmed';
      return json({ state: saved, events: events.trim().split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).slice(-150), report, provenance: JSON.parse(provenance) });
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) throw Error('请求过长'); }
      const input = JSON.parse(body);
      if (!Object.hasOwn(presets, input.preset)) throw Error('请选择已有示例');
      if (input.preset !== 'demo' && input.confirmCost !== true) throw Error('请先确认本次运行会消耗 Codex 额度');
      return json(await start(input.preset));
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      active?.controller.abort(); return json({ message: '停止请求已发送；正在终止执行进程。历史状态可能保留最后检查点。' });
    }
    json({ error: 'Not found' }, 404);
  } catch (error) { json({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
server.listen(port, '127.0.0.1', () => console.log(`Legion: http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { active?.controller.abort(); server.close(); });
