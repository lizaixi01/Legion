import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

test('compiled configuration imports perform no writes or execution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'legion-config-import-'));
 const modules=['config','chat-options','management/candidate-types'].map(name=>pathToFileURL(resolve('dist/src',name+'.js')).href);
 const script=`import fs from 'node:fs';import fsp from 'node:fs/promises';import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const forbidden=()=>{throw Error('Import performed an external effect');};for(const name of ['writeFile','appendFile','mkdir','rm','rename','unlink']){fsp[name]=forbidden;fs[name]=forbidden;fs[name+'Sync']=forbidden;}for(const name of ['spawn','spawnSync','exec','execFile','execSync','execFileSync','fork'])child[name]=forbidden;syncBuiltinESMExports();for(const module of ${JSON.stringify(modules)})await import(module);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,windowsHide:true,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(await readdir(root),[]);
});
