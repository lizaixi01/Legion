import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

test('local UI protects launch endpoints and runs a fixture through to visible evidence', async t => {
  const probe = createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as { port: number }).port; await new Promise<void>(r => probe.close(() => r()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/ui-server.ts'], { env: { ...process.env, PROACTIVE_UI_PORT: String(port) }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  t.after(() => { child.kill(); });
  await new Promise<void>((resolve, reject) => { const timer=setTimeout(()=>reject(Error('UI startup timed out')),10000);child.once('error',reject);child.stdout.once('data',()=>{clearTimeout(timer);resolve();}); });
  const base = `http://127.0.0.1:${port}`;
  const html = await (await fetch(base)).text(); assert.match(html,/任务工作台/);
  const token = html.match(/name="ui-token" content="([a-f0-9]+)"/)![1]!;
  const headers = { 'X-UI-Token': token, 'Content-Type':'application/json' };
  assert.equal((await fetch(base+'/api/start',{method:'POST',body:'{"preset":"demo"}'})).status,403);
  assert.equal((await fetch(base+'/api/start',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:'{"preset":"demo"}'})).status,403);
  assert.equal((await fetch(base+'/api/start',{method:'POST',headers,body:'{"preset":"master"}'})).status,400);
  assert.equal((await fetch(base+'/api/run?id=../../package.json',{headers})).status,400);
  const launch = await (await fetch(base+'/api/start',{method:'POST',headers,body:'{"preset":"demo"}'})).json() as { id: string };
  let runId: string | undefined;
  for(let i=0;i<80;i++) {
    const listing = await (await fetch(base+'/api/runs',{headers})).json() as { launches:{id:string;status:string;runId?:string}[] };
    const current=listing.launches.find(l=>l.id===launch.id);
    if(current?.status==='completed'){runId=current.runId;break;}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(runId);
  const result=await(await fetch(base+'/api/run?id='+runId,{headers})).json() as {state:{status:string};events:{type:string}[]};
  assert.equal(result.state.status,'completed'); assert.ok(result.events.some(e=>e.type==='master_decision'));
});
