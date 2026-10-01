import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('desktop sends greetings in every delegation mode to chat even with a selected project',async()=>{
 const source=await readFile('desktop/app.js','utf8');const handler=source.slice(source.indexOf("$('composer').onsubmit="),source.indexOf('async function refresh()'));
 for(const mode of ['off','auto','fixed']){const nodes:Record<string,any>={composer:{},prompt:{value:'hi',style:{}},error:{}};const calls:any[]=[];const scope:any={attachments:[],paintAttachments(){},workerOptions:{model:'gpt-6-sol',effort:'medium'},goalMode:false,engineeringMode:false,sending:false,busy:false,current:null,managedId:null,managedKey:'',lastList:'',lastMessages:'',projectChoice:{path:'D:/arbitrary-python-project'},options:{delegation:{mode,count:10}},$: (id:string)=>nodes[id],closeMenu(){},updateSend(){},refresh:async()=>{},api:{chatSend:async(input:any)=>{calls.push(input);return {id:'new-chat'};},engineeringPlan:()=>{throw Error('Must not enter engineering benchmark');}}};runInNewContext(handler,scope);await nodes.composer.onsubmit({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].text,'hi');assert.equal(calls[0].options.worker.model,'gpt-6-sol');assert.equal(calls[0].project,scope.projectChoice.path);assert.equal(scope.current,'new-chat');assert.equal(nodes.error.textContent,'');}
});


test('recovery is not an opt-in composer mode',async()=>{
 const html=await readFile('desktop/index.html','utf8'),source=await readFile('desktop/app.js','utf8');assert.doesNotMatch(html,/id="engineering-mode"/);assert.doesNotMatch(source,/engineeringMode|engineering-mode/);assert.match(source,/api\.engineeringResume/);assert.match(source,/api\.engineeringPause/);
});

test('new conversation resets goal mode and ordinary input wording',async()=>{
 const source=await readFile('desktop/app.js','utf8');const elements:Record<string,any>={};const node=(id:string)=>elements[id]??=( {style:{},setAttribute(k:string,v:string){this[k]=v;},replaceChildren(){},focus(){}} as any);
 const scope:any={goalMode:true,document:{getElementById:node},$:node,research:{close(){}},closeMenu(){},updateSend(){},refresh(){}};
 runInNewContext(source.slice(source.indexOf('function resetTaskMode'),source.indexOf('\nimport ',source.indexOf('function resetTaskMode')))+source.slice(source.indexOf('function fresh()'),source.indexOf('function updateSend()')),scope);
 runInNewContext('fresh()',scope);assert.equal(scope.goalMode,false);assert.equal(node('prompt').placeholder,'随心输入');assert.equal(node('goal-mode')['aria-pressed'],'false');
});


test('resumable support probe starts no planner and accepts projects without tests for normal chat',async()=>{
 const {mkdtemp,writeFile,mkdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {createEngineeringProduct}=await import('../src/engineering-product.js');
 const root=await mkdtemp(join(tmpdir(),'legion-support-'));const project=join(root,'project');await mkdir(project);await writeFile(join(project,'main.py'),'print("hello")');
 const service=createEngineeringProduct(root);assert.equal((await service.support(project)).supported,false);assert.equal(service.isActive(),false);assert.deepEqual(await service.list(),[]);
 await writeFile(join(project,'main.test.js'),'');assert.equal((await service.support(project)).supported,true);
 await writeFile(join(project,'asset.bin'),Buffer.from([0,1,2]));assert.equal((await service.support(project)).supported,false);
});


test('persistent goal entry uses the primary chat with independent worker settings',async()=>{
 const source=await readFile('desktop/app.js','utf8'),handler=source.slice(source.indexOf("$('composer').onsubmit="),source.indexOf('async function refresh()'));
 const nodes:Record<string,any>={composer:{},prompt:{value:'持续完成联系人清洗',style:{}},error:{}};let input:any;
 const scope:any={goalMode:true,engineeringMode:false,attachments:[],paintAttachments(){},workerOptions:{model:'gpt-6-sol',effort:'low'},sending:false,busy:false,current:null,managedId:null,managedKey:'',projectChoice:{path:'D:/contacts'},options:{model:'gpt-6-sol',effort:'high'},$: (id:string)=>nodes[id],closeMenu(){},updateSend(){},refresh:async()=>{},lastMessages:'',api:{chatSend:async(value:any)=>{input=value;return {id:'goal'};},goalStart:()=>{throw Error('Must not start legacy goal executor');}}};runInNewContext(handler,scope);await nodes.composer.onsubmit({preventDefault(){}});assert.equal(input.options.worker.effort,'low');assert.equal(input.options.effort,'high');assert.equal(input.continuous,true);assert.equal(scope.current,'goal');assert.equal(scope.managedId,null);
});
