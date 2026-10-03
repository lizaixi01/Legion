/** Read existing certification without changing ready.json or invoking a scorer. */
import {readFile,mkdir,cp,writeFile,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {hweFingerprint,hweProjectRoot} from './hwe-runtime.js';
import {fingerprintDifferences} from './hwe-fingerprint.js';
import {hash} from './provenance.js';
import {classifyHweEvidence} from './hwe-evidence.js';
import {eligible,type Candidate} from './research-loop.js';
export const defaultReadiness=resolve(hweProjectRoot,'.local/hwe-readiness');
export async function preflightReadiness(source=process.env.PROACTIVE_HWE_READINESS_SOURCE??defaultReadiness,fingerprint=hweFingerprint){
 source=resolve(source);const bytes=await readFile(join(source,'ready.json')),ready=JSON.parse(bytes.toString('utf8'));
 const baselineMatches=hash(await readFile(join(source,'baseline.tar.gz')))===ready.sha256,environment=await fingerprint(),differences=fingerprintDifferences(ready.environment,environment);
 const evidence=classifyHweEvidence(ready.evidence),evidenceMatches=eligible({status:'verified',snapshot:{path:join(source,'baseline.tar.gz'),sha256:ready.sha256},evidence} as Candidate);
 return {source,readySha256:hash(bytes),baselineMatches,evidenceMatches,differences,environment,matches:baselineMatches&&evidenceMatches&&differences.length===0,scope:'Existing certification only; no model or scorer call'};
}
export async function treeHashes(root:string,prefix=''):Promise<{path:string;sha256:string}[]>{
 const rows:{path:string;sha256:string}[]=[];
 for(const entry of (await readdir(join(root,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=prefix?prefix+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink())throw Error('Frozen inputs must not contain symbolic links');
  if(entry.isDirectory())rows.push(...await treeHashes(root,path));else rows.push({path,sha256:hash(await readFile(join(root,path)))});
 }return rows;
}
export async function freezeReadiness(source:string,destination:string,fingerprint=hweFingerprint){
 source=resolve(source);destination=resolve(destination);const rel=relative(source,destination);
 if(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../'))throw Error('Certification freeze must be outside its source');
 const preflight=await preflightReadiness(source,fingerprint);if(!preflight.matches)throw Error('Readiness mismatch: '+JSON.stringify(preflight));
 const before=await treeHashes(source);await cp(source,destination,{recursive:true,errorOnExist:true,force:false});
 const after=await treeHashes(destination);if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(before)!==JSON.stringify(await treeHashes(source)))throw Error('Certification bytes changed during freeze');
 await writeFile(destination+'-receipt.json',JSON.stringify({source,destination,preflight,files:after},null,2));return preflight;
}
