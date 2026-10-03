// Copy qualification evidence; separate successful phases never become a paired speed score.
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {hash} from '../../src/provenance.ts';
const [destination,source2,source4,cancelSource]=process.argv.slice(2);
if(!cancelSource)throw Error('prepare-acceptance-proof.mjs <new-directory> <worker-2-batch> <worker-4-batch> <cancel-batch>');
const root=resolve(destination);await mkdir(root);const sources=[];
for(const [concurrency,batch] of [[2,source2],[4,source4]]){
 const source=resolve(batch),run=join(source,'worker-'+concurrency),dir=join(root,'source-'+concurrency);await mkdir(dir);
 const state=JSON.parse(await readFile(join(run,'state.json'),'utf8')),owner='research-'+hash(run).slice(0,16);
 for(const name of ['result.json','model-output-audit.json'])await cp(join(source,name),join(dir,name));
 const acceptance=JSON.parse(await readFile(join(source,'acceptance-'+concurrency+'.json'),'utf8'));
 await writeFile(join(dir,'consistency.json'),JSON.stringify(acceptance.consistency,null,2));
 await cp(join(run,'state.json'),join(dir,'state.json'));await cp(join(run,'events.jsonl'),join(dir,'events.jsonl'));
 await cp(join(source,'readiness/ready.json'),join(dir,'ready.json'));await cp(join(source,'model-catalog.json'),join(dir,'model-catalog.json'));
 await cp(join(source,'independent-'+owner+'.jsonl'),join(dir,'owner-audit.jsonl'));
 const manifest=JSON.parse(await readFile(join(run,'implementation/manifest.json'),'utf8'));
 const implementation=Object.fromEntries(manifest.map(f=>[f.source.split(/[\\/]/).at(-1),f.sha256]));
 await writeFile(join(dir,'implementation-hashes.json'),JSON.stringify(implementation,null,2));
 sources.push({concurrency,directory:'source-'+concurrency,sourceBatch:source,resultSha256:hash(await readFile(join(source,'result.json'))),stateSha256:hash(await readFile(join(run,'state.json'))),owner,resumed:state.resumed??false});
}
await cp(join(resolve(cancelSource),'cancel-result.json'),join(root,'cancel-result.json'));
await writeFile(join(root,'qualification.json'),JSON.stringify({version:1,mode:'development-qualification',pairedTiming:false,sources,cancellationSource:resolve(cancelSource),note:'Qualification only. Original failed batches and calls remain in their own directories. Different replay workloads and model counts prevent paired timing comparison.'},null,2));
console.log(JSON.stringify({root,mode:'development-qualification',pairedTiming:false,sources}));
