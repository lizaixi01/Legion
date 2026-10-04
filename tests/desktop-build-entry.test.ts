import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import path from 'node:path';
import {runInNewContext} from 'node:vm';

test('CLI desktop entry uses the shared clean build and never launches after failure',async()=>{
 const source=await readFile('bin/legion.cjs','utf8');
 for(const status of [0,1]){
  const builds:{args:string[]}[]=[],launches:string[][]=[];
  const proc={execPath:process.execPath,argv:['node','legion'],exitCode:0};
  runInNewContext(source,{__dirname:resolve('bin'),process:proc,console:{log(){},error(){}},require:(name:string)=>name==='node:path'?path:{spawnSync:(_command:string,args:string[])=>{builds.push({args});return {status};},spawn:(_command:string,args:string[])=>{launches.push(args);return {on(){},unref(){}};}}});
  assert.deepEqual([...builds[0]!.args],[resolve('scripts/build.cjs')]);assert.equal(launches.length,status===0?1:0);assert.equal(proc.exitCode,status);
  if(status===0)assert.deepEqual([...launches[0]!],[join(resolve('desktop'),'launch.cjs')]);
 }
});

test('Beta shortcut shares the clean build and supports an offline check-only launch',async()=>{
 const source=await readFile('desktop/launch-beta.ps1','utf8');assert.match(source,/scripts\\build\.cjs/);assert.doesNotMatch(source,/typescript\\bin\\tsc|build-renderer\.cjs/);assert.match(source,/if \(\$CheckOnly\) \{ exit 0 \}/);
});
