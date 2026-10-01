import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fingerprintMatches} from '../src/hwe.js';

const sha=(digit:string)=>digit.repeat(64);
function environment(root:string){return {commit:'frozen',riscvFormal:'formal',image:'sha256:image',filesSha256:sha('a'),verifierSha256:sha('b'),oss:'/opt/oss',xpack:'/opt/xpack',additionalInputs:{[root+'/.local/hwe-bench/Makefile']:sha('c'),[root+'/.local/hwe-bench/cores/baseline/core.yaml']:sha('d'),'/opt/oss/libexec/yosys':sha('e')}};}

test('identical repository inputs survive relocation and JSON property reordering',()=>{
 const before=environment('/mnt/d/Projects/Proactive Agent'),after=environment('/mnt/d/Projects/Independent Snapshot');
 assert.equal(fingerprintMatches(before,after),true);
 assert.equal(fingerprintMatches(before,Object.fromEntries(Object.entries(after).reverse())),true);
});

test('content, toolchain, image and verifier changes still invalidate readiness',()=>{
 const before=environment('/mnt/d/Projects/Proactive Agent');
 for(const field of ['commit','riscvFormal','image','filesSha256','verifierSha256','oss','xpack'])assert.equal(fingerprintMatches(before,{...before,[field]:'changed'}),false,field);
 for(const [path] of Object.entries(before.additionalInputs)){
  assert.equal(fingerprintMatches(before,{...before,additionalInputs:{...before.additionalInputs,[path]:sha('f')}}),false,path);
  const inputs={...before.additionalInputs};delete inputs[path];assert.equal(fingerprintMatches(before,{...before,additionalInputs:inputs}),false,path);
 }
 assert.equal(fingerprintMatches(before,{...before,additionalInputs:{...before.additionalInputs,'/opt/oss/new-input':sha('f')}}),false);
});

test('legacy absolute paths compare to stable repository keys without rewriting readiness',()=>{
 const before=environment('/mnt/d/Projects/Proactive Agent');
 const after={...before,additionalInputs:{'repo:Makefile':sha('c'),'repo:cores/baseline/core.yaml':sha('d'),'/opt/oss/libexec/yosys':sha('e')}};
 assert.equal(fingerprintMatches(before,after),true);
 assert.equal(fingerprintMatches(after,after),true);
 const duplicate={...after,additionalInputs:{...after.additionalInputs,...before.additionalInputs}};
 assert.equal(fingerprintMatches(before,duplicate),false);
 const mixed=environment('/mnt/d/one');delete mixed.additionalInputs['/mnt/d/one/.local/hwe-bench/Makefile'];mixed.additionalInputs['/mnt/d/two/.local/hwe-bench/Makefile']=sha('c');
 assert.equal(fingerprintMatches(before,mixed),false);
 const movedTool:{additionalInputs:Record<string,string>}={additionalInputs:{...after.additionalInputs}};delete movedTool.additionalInputs['/opt/oss/libexec/yosys'];movedTool.additionalInputs['/opt/other/libexec/yosys']=sha('e');
 assert.equal(fingerprintMatches(before,movedTool),false);
});

test('recorded readiness accepts the failed snapshot fingerprint with only repository path changes',async()=>{
 const ready={environment:JSON.parse(await readFile(new URL('./fixtures/hwe-environment-legacy.json',import.meta.url),'utf8'))};
 const relocated=structuredClone(ready.environment);
 relocated.additionalInputs=Object.fromEntries(Object.entries(ready.environment.additionalInputs).map(([path,value])=>[path.replace('/mnt/d/Projects/Proactive Agent/.local/hwe-bench/','/mnt/d/Projects/Legion-HWE-20261001/.local/hwe-bench/'),value]));
 assert.equal(fingerprintMatches(ready.environment,relocated),true);
});
