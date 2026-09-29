import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopService } from '../src/desktop-service.js';
import { hash } from '../src/provenance.js';

test('desktop runs a fixture and exposes accepted evidence without an HTTP server', async t => {
  const service = createDesktopService(process.cwd(), process.execPath);
  t.after(() => service.stop());
  await assert.rejects(service.start({preset:'master'}), /确认/);
  await assert.rejects(service.start({preset:'constructor'}), /配置/);
  const launch = await service.start({preset:'demo'});
  await assert.rejects(service.start({preset:'demo'}), /正在执行/);
  for (let i=0; i<150 && service.isActive(); i++) await new Promise(r=>setTimeout(r,100));
  assert.equal(launch.status,'completed'); assert.ok(launch.runId);
  const result=await service.detail(launch.runId);
  assert.equal(result.state.status,'completed');
  assert.ok(result.events.some(e=>e.type==='master_decision'));
  assert.equal((await service.artifact(launch.runId,'integrate','result.txt')).text,'verified');
  assert.ok((await service.list()).runs.some(r=>r.id===launch.runId && r.accepted===3));
});

test('desktop rejects unaccepted, changed and out-of-scope artifacts', async () => {
  const root=await mkdtemp(join(tmpdir(),'desktop-'));
  const id='team-11111111-1111-1111-1111-111111111111';
  const dir=join(root,'.runs',id); await mkdir(join(dir,'accepted','design'),{recursive:true});
  const state={status:'running',tasks:{design:{status:'accepted',artifacts:[{path:'result.txt',sha256:hash('verified')}]}}};
  await writeFile(join(dir,'state.json'),JSON.stringify(state));
  await writeFile(join(dir,'accepted','design','result.txt'),'changed');
  const service=createDesktopService(root,process.execPath);
  assert.equal((await service.detail(id)).state.status,'unconfirmed');
  await assert.rejects(service.detail('../outside'), /无效/);
  await assert.rejects(service.artifact(id,'design','../state.json'), /无效/);
  await assert.rejects(service.artifact(id,'design','other.txt'), /尚未验收/);
  await assert.rejects(service.artifact(id,'design','result.txt'), /哈希/);
  state.tasks.design.status='failed';
  await writeFile(join(dir,'state.json'),JSON.stringify(state));
  await assert.rejects(service.artifact(id,'design','result.txt'), /尚未验收/);
});
