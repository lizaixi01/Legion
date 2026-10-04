import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';

test('compiled product tree contains only product modules and renderer assets',async()=>{
 async function inspect(directory:string):Promise<void>{
  for(const file of await readdir(directory,{withFileTypes:true})){
   const path=join(directory,file.name);
   assert.doesNotMatch(path,/hwe|research-cli|research-loop|fixtures|[\\/]tests[\\/]/i);
   if(file.isDirectory())await inspect(path);
   else assert.doesNotMatch(await readFile(path,'utf8'),/legion_hwe_check|createHwe|PROACTIVE_HWE_|CoreMark|RV32IM|fmax_mhz|lut4/);
  }
 }
 assert.deepEqual((await readdir('dist')).sort(),['desktop','src']);await inspect('dist');
 const config=JSON.parse(await readFile('package.json','utf8'));assert.equal(config.scripts.research,undefined);
 assert.ok(!config.build.files.includes('dist/**/*'));
});
