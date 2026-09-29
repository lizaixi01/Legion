import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.cwd();let rows=[];
for(const name of (await readdir(join(root,'.capacity'))).filter(n=>n.startsWith('probe-'))){
 let waves;try{waves=JSON.parse(await readFile(join(root,'.capacity',name,'report.json'),'utf8'));}catch{continue;}
 for(const mode of ['codex','commandcode','mixed']){
 const set=waves.filter(w=>w.mode===mode);if(!set.length)continue;
 const top=Math.max(...set.map(w=>w.level)),at=set.filter(w=>w.level===top),durations=at.flatMap(w=>w.results.map(r=>r.durationMs)).sort((a,b)=>a-b);
 rows.push({batch:name,mode,top,waves:at.length,topSuccess:at.flatMap(w=>w.results).filter(r=>r.valid).length,topTotal:at.flatMap(w=>w.results).length,total:set.flatMap(w=>w.results).length,failed:set.flatMap(w=>w.results).filter(r=>!r.valid).length,p50:Math.round(durations[Math.floor(durations.length*.5)]/100)/10,p95:Math.round(durations[Math.min(durations.length-1,Math.floor(durations.length*.95))]/100)/10});
 }
}
await writeFile(join(root,'.capacity','summary.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
