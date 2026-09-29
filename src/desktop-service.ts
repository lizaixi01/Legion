import { readFile, readdir, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execute } from './process.js';
import { hash } from './provenance.js';

export function createDesktopService(root: string, node: string) {
  const runs = join(root, '.runs');
  type Launch = { id: string; preset: string; status: string; runId?: string; detail?: string };
  const launches: Launch[] = [];
  let active: { launch: Launch; controller: AbortController; done?: Promise<void> } | undefined;
  const presets = {
    demo: { args: ['demo'], timeout: 60000 },
    rules: { args: ['run', join(root, 'examples/team.json')], timeout: 420000 },
    master: { args: ['run', join(root, 'examples/team-master.json')], timeout: 720000 },
  };
  async function read(path: string, fallback: string) {
    try { if ((await lstat(path)).isSymbolicLink()) throw Error('不读取链接文件'); return await readFile(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
  }
  async function runPath(id: string) {
    if (!/^team-(?:demo-)?[a-f0-9-]{36}$/.test(id)) throw Error('无效的运行编号');
    const path = join(runs, id); if ((await lstat(path)).isSymbolicLink()) throw Error('不读取链接目录'); return path;
  }
  async function detail(id: string) {
    const dir = await runPath(id);
    const [state, events, report, provenance] = await Promise.all([read(join(dir,'state.json'),'{}'),read(join(dir,'events.jsonl'),''),read(join(dir,'report.md'),''),read(join(dir,'provenance.json'),'{}')]);
    const saved = JSON.parse(state);
    if (saved.status === 'running' && active?.launch.runId !== id) saved.status = 'unconfirmed';
    return { state: saved, events: events.trim().split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).slice(-200), report, provenance: JSON.parse(provenance) };
  }
  async function list() {
    await mkdir(runs, { recursive:true });
    const directories = (await readdir(runs, { withFileTypes:true })).filter(i=>i.isDirectory() && /^team-(?:demo-)?[a-f0-9-]{36}$/.test(i.name));
    const records = await Promise.all(directories.map(async d=>{try { const {state,provenance} = await detail(d.name); if(!state.tasks)return null;const tasks=Object.values(state.tasks) as {status:string}[];return {id:d.name,status:state.status,startedAt:state.startedAt,total:tasks.length,accepted:tasks.filter(t=>t.status==='accepted').length,policy:provenance.policy,demo:d.name.startsWith('team-demo-')};} catch{return null;}}));
    return { runs:records.filter(r=>r!==null).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,100), launches:launches.slice(0,20), active:active?.launch??null };
  }
  async function start(input: { preset: string; confirmCost?: boolean }) {
    if (!input || !Object.hasOwn(presets,input.preset)) throw Error('请选择已有运行配置');
    if (input.preset!=='demo' && input.confirmCost!==true) throw Error('请确认真实运行会消耗 Codex 额度');
    if (active) throw Error('已有运行正在执行');
    const preset = presets[input.preset as keyof typeof presets];
    const launch:Launch={id:randomUUID(),preset:input.preset,status:'running'};
    const record={launch,controller:new AbortController(),done:undefined as Promise<void>|undefined}; active=record;launches.unshift(launch);
    const logDir=join(root,'.local','desktop-launches',launch.id);
    try { await mkdir(logDir,{recursive:true}); } catch(error){active=undefined;launch.status='error';throw error;}
    const detect=async()=>{const text=await read(join(logDir,'stdout.jsonl'),'');const match=text.match(/team-(?:demo-)?[a-f0-9-]{36}/);if(match)launch.runId=match[0];};
    const timer=setInterval(()=>{void detect().catch(()=>{});},300);
    record.done=(async()=>{try {
      const result=await execute({command:node,args:['--import','tsx',join(root,'src/team-cli.ts'),...preset.args],cwd:root,logDir,timeoutMs:preset.timeout,signal:record.controller.signal});
      await detect();launch.status=result.status;
      if(result.status!=='completed')launch.detail=(await read(join(logDir,'stderr.log'),'')).slice(-4000)||result.detail||result.status;
    }catch(error){launch.status='error';launch.detail=String(error);}finally{clearInterval(timer);if(active===record)active=undefined;}})();
    return launch;
  }
  async function stop() { const current=active;current?.controller.abort();await current?.done;return {message:'执行进程已停止；未完成的检查点保留，未自动恢复。'}; }
  async function artifact(id: string, task: string, path: string) {
    if(!/^[a-z][a-z0-9_-]{0,63}$/.test(task) || !path.split('/').every(p=>/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p)))throw Error('无效的产物路径');
    const {state}=await detail(id);
    const unit=Object.hasOwn(state.tasks,task)?state.tasks[task]:undefined;
    const item=unit?.status==='accepted'?unit.artifacts.find((a:{path:string})=>a.path===path):undefined;
    if(!item)throw Error('该产物尚未验收');
    let target=await runPath(id);
    for(const part of ['accepted',task,...path.split('/')]){target=join(target,part);if((await lstat(target)).isSymbolicLink())throw Error('不读取链接产物');}
    if((await lstat(target)).size>1024*1024)throw Error('超过 1 MiB，请在工程目录查看');
    const bytes=await readFile(target);if(hash(bytes)!==item.sha256)throw Error('产物哈希与验收记录不一致');
    return {path,text:bytes.toString('utf8'),sha256:item.sha256};
  }
  return {list,detail,start,stop,artifact,isActive:()=>Boolean(active)};
}
