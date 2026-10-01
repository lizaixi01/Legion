import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('file drag highlights without navigation, clears on drop and reports attachment results',async()=>{
 const source=(await readFile('desktop/drop-files.js','utf8')).replace('export function','function');const handlers:Record<string,Function>={},classes=new Set<string>();let receive:Function=()=>{},paths:unknown,error='';
 const context:any={target:{addEventListener:(n:string,f:Function)=>handlers[n]=f},composer:{classList:{add:(c:string)=>classes.add(c),remove:(c:string)=>classes.delete(c)}},api:{onFilesDropped:(cb:Function)=>receive=cb},accept:(p:unknown)=>paths=p,report:(s:string)=>error=s};
 runInNewContext(source+'\ninstallFileDrop(target,composer,api,accept,report)',context);
 let prevented=0;const event={dataTransfer:{types:['Files'],dropEffect:''},preventDefault:()=>prevented++};handlers.dragenter!(event);handlers.dragover!(event);assert.ok(classes.has('file-drag-over'));assert.equal(event.dataTransfer.dropEffect,'copy');handlers.drop!(event);assert.equal(classes.size,0);assert.equal(prevented,3);
 receive({paths:['file','folder']});assert.deepEqual(paths,['file','folder']);receive({error:'missing'});assert.equal(error,'missing');handlers.dragenter!({dataTransfer:{types:['text/plain']}});assert.equal(classes.size,0);
});

test('preload resolves actual File paths through webUtils before registering drop',async()=>{
 const source=await readFile('desktop/preload.cjs','utf8');let api:any;const handlers:Record<string,Function>={},file={native:true},invocations:any[]=[];
 runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(_n:string,a:unknown)=>api=a},webUtils:{getPathForFile:(f:unknown)=>{assert.equal(f,file);return 'D:/input.json';}},ipcRenderer:{invoke:async(name:string,paths:string[])=>{invocations.push({name,paths});return paths;}}}),window:{addEventListener:(n:string,cb:Function)=>handlers[n]=cb}});
 let result:any;api.onFilesDropped((r:unknown)=>result=r);handlers.drop!({dataTransfer:{types:['Files'],files:[file]},preventDefault(){}});await new Promise(r=>setTimeout(r,0));assert.equal(invocations[0].name,'manager:registerDroppedFiles');assert.equal(result.paths[0],'D:/input.json');
});

test('paste accepts native files, falls back to Explorer clipboard and preserves text paste',async()=>{
 const source=await readFile('desktop/preload.cjs','utf8');let api:any,result:any;const handlers:Record<string,Function>={},calls:string[]=[];let clipboard:string[]=['D:/书籍.pdf'];
 runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(_n:string,a:unknown)=>api=a},webUtils:{getPathForFile:()=> 'D:/native.pdf'},ipcRenderer:{invoke:async(name:string,paths?:string[])=>{calls.push(name);return paths??clipboard;}}}),window:{addEventListener:(n:string,cb:Function)=>handlers[n]=cb}});
 api.onFilesDropped((value:any)=>result=value);let prevented=0;
 const paste=(files:unknown[])=>handlers.paste!({target:{closest:()=>true},clipboardData:{files},preventDefault:()=>prevented++});
 paste([{}]);await new Promise(r=>setTimeout(r,0));assert.equal(result.paths[0],'D:/native.pdf');assert.equal(prevented,1);
 paste([]);await new Promise(r=>setTimeout(r,0));assert.equal(result.paths[0],'D:/书籍.pdf');assert.equal(calls.at(-1),'manager:pasteFiles');assert.equal(prevented,1);
 clipboard=[];result=undefined;paste([]);await new Promise(r=>setTimeout(r,0));assert.equal(result,undefined);assert.equal(prevented,1);
});
