import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {preflightReadiness,freezeReadiness,treeHashes} from '../src/hwe-readiness.js';
import {passingHwe} from './fixtures/hwe-evidence.js';
import {hash} from '../src/provenance.js';
test('explicit certification source freezes all bytes, remains unchanged and rejects drift',async()=>{
 const root=await mkdtemp(join(tmpdir(),'readiness-source-')),source=join(root,'source');await mkdir(source);const environment={image:'fixture'};
 await writeFile(join(source,'baseline.tar.gz'),'baseline');const bytes=JSON.stringify({sha256:hash('baseline'),environment,evidence:passingHwe()})+'\n';await writeFile(join(source,'ready.json'),bytes);await mkdir(join(source,'logs'));await writeFile(join(source,'logs/raw.txt'),'raw evidence');
 const fingerprint=async()=>environment;assert.equal((await preflightReadiness(source,fingerprint)).matches,true);const before=await treeHashes(source),destination=join(root,'copy');await freezeReadiness(source,destination,fingerprint);assert.deepEqual(await treeHashes(destination),before);assert.equal(await readFile(join(source,'ready.json'),'utf8'),bytes);
 await assert.rejects(freezeReadiness(source,destination,fingerprint));assert.equal((await preflightReadiness(source,async()=>({image:'changed'}))).matches,false);
 await writeFile(join(source,'baseline.tar.gz'),'changed');await assert.rejects(freezeReadiness(source,join(root,'new-copy'),fingerprint),/Readiness mismatch/);await assert.rejects(freezeReadiness(source,join(source,'bad'),fingerprint),/outside/);
});
