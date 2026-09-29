import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('desktop sends greetings in every delegation mode to chat even with a selected project',async()=>{
 const source=await readFile('desktop/app.js','utf8');const handler=source.slice(source.indexOf("$('composer').onsubmit="),source.indexOf('async function refresh()'));
 for(const mode of ['off','auto','fixed']){const nodes:Record<string,any>={composer:{},prompt:{value:'hi',style:{}},error:{}};const calls:any[]=[];const scope:any={sending:false,busy:false,current:null,managedId:null,managedKey:'',lastList:'',lastMessages:'',projectChoice:{path:'D:/arbitrary-python-project'},options:{delegation:{mode,count:10}},$: (id:string)=>nodes[id],closeMenu(){},updateSend(){},refresh:async()=>{},api:{chatSend:async(input:any)=>{calls.push(input);return {id:'new-chat'};},engineeringPlan:()=>{throw Error('Must not enter engineering benchmark');}}};runInNewContext(handler,scope);await nodes.composer.onsubmit({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].text,'hi');assert.equal(calls[0].project,scope.projectChoice.path);assert.equal(scope.current,'new-chat');assert.equal(nodes.error.textContent,'');}
});
