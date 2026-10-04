// Execute the real main process with only the Electron shell replaced.
// Dynamic imports, IPC handlers, compiled services, queues and child transport are real.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {EventEmitter}=require('node:events');
const codeRoot=process.env.LEGION_CODE_ROOT,dataRoot=process.env.LEGION_DATA_ROOT,project=process.env.LEGION_FIXTURE_PROJECT;
const handlers=new Map();let window;
class Window extends EventEmitter {
 constructor(){super();window=this;this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{url:'proactive://app/'},session:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}},setWindowOpenHandler(){},send(){}});}
 isDestroyed(){return false;} setTitle(){} show(){} focus(){}
 async loadURL(url){assert.equal(url,'proactive://app/');await exercise();}
}
const app=new EventEmitter();Object.assign(app,{isPackaged:true,getAppPath:()=>codeRoot,getPath:()=>dataRoot,setPath(){},requestSingleInstanceLock:()=>true,whenReady:async()=>{},setAppUserModelId(){},quit(){}});
const electron={app,BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},Menu:{setApplicationMenu(){},buildFromTemplate:x=>x},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[project]}),showErrorBox:(_title,error)=>{throw Error(error);}},protocol:{registerSchemesAsPrivileged(){},handle(){}},net:{},shell:{}};
const originalLoad=Module._load;Module._load=function(id,...args){return id==='electron'?electron:originalLoad.call(this,id,...args);};
async function call(name,...args){const handler=handlers.get('manager:'+name);assert.ok(handler,name);return handler({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args);}
async function settled(id){for(let i=0;i<500;i++){const summary=(await call('chatList')).find(chat=>chat.id===id);if(summary.status!=='running')return call('chatDetail',id);await new Promise(r=>setTimeout(r,20));}throw Error('Offline desktop turn timed out');}
async function exercise(){
 try{
  const projectInfo=await call('chooseProject');assert.equal(projectInfo.path,project);
  const options={model:'gpt-6-sol',effort:'medium',permission:'workspace-write',agents:0,delegation:{mode:'off',count:1}};
  const hello=await call('chatSend',{text:'hello',project,options});const greeting=await settled(hello.id);
  assert.equal(greeting.status,'completed',greeting.error);assert.equal(greeting.messages.at(-1).text,'Offline greeting');
  const goal='Aggregate numbers [3,1,2]: write aggregate.json with sum and sorted.';
  const send=await call('chatSend',{text:goal,project,options:{...options,delegation:{mode:'fixed',count:1,maxWorkers:1}}});const completed=await settled(send.id);
  assert.equal(completed.status,'completed',completed.error);assert.equal(completed.acceptance.status,'accepted');
  assert.equal(completed.tasks.length,1);assert.equal(completed.tasks[0].status,'completed');assert.equal(completed.tasks[0].history.length,1);
  assert.equal(completed.delivery.versions.length,1);assert.equal(completed.delivery.versions[0].functional.acceptance.status,'accepted');
  const registered=JSON.parse(fs.readFileSync(path.join(project,'registered.json'),'utf8'));
  assert.deepEqual(registered.dynamicTools.map(t=>t.name),['legion_delivery','legion_dispatch','legion_tasks']);
  assert.doesNotMatch(JSON.stringify(registered),/hwe|readiness|RV32IM|CoreMark/i);
  const old='11111111-1111-4111-8111-111111111111',turn='22222222-2222-4222-8222-222222222222';
  const oldDir=path.join(dataRoot,'.chats',old);fs.mkdirSync(path.join(oldDir,'turns',turn,'hwe-checks'),{recursive:true});
  const oldFile=path.join(oldDir,'chat.json');const oldBytes=JSON.stringify({id:old,project,title:'Legacy external project',updatedAt:'2026-10-01T00:00:00Z',status:'completed',transport:'app-server-primary-v9',sessionId:'legacy-specialized-thread',messages:[{role:'assistant',text:'Historical result'}],reviewTurn:turn,hweReadiness:{old:true},benchmarkChecks:[{status:'verified',evidence:{metrics:{fitness:1}}}]});fs.writeFileSync(oldFile,oldBytes);
  const legacy=await call('chatDetail',old);assert.equal(legacy.messages[0].text,'Historical result');assert.equal(legacy.status,'completed');assert.equal(fs.readFileSync(oldFile,'utf8'),oldBytes);
  const continued=await call('chatSend',{id:old,text:'hello',options});const renewed=await settled(continued.id);
  assert.equal(renewed.status,'completed',renewed.error);assert.equal(renewed.transport,'app-server-primary-v10');
  const turnInput=JSON.parse(fs.readFileSync(path.join(project,'last-turn.json'),'utf8'));assert.match(JSON.stringify(turnInput),/Historical result/);
  const oldGoal='33333333-3333-4333-8333-333333333333',budgetId='44444444-4444-4444-8444-444444444444',deadline=Date.now()+60000;
  const budgetDir=path.join(dataRoot,'.chats',oldGoal,'goal-budgets',budgetId);
  const {createGoalBudget,openGoalBudget,readGoalBudget}=await import(require('node:url').pathToFileURL(path.join(codeRoot,'dist/src/primary-goal-budget.js')).href);
  await createGoalBudget(budgetDir,{id:budgetId,objective:goal,deadline,workers:64,checks:3});
  const originalBudget=await openGoalBudget(budgetDir,{id:budgetId,objective:goal,deadline});await (await originalBudget.reserve('worker','historical-call'))();await (await originalBudget.reserve('check','historical-check'))();await originalBudget.close();
  const goalFile=path.join(dataRoot,'.chats',oldGoal,'chat.json');fs.writeFileSync(goalFile,JSON.stringify({id:oldGoal,project,title:'Legacy ongoing goal',updatedAt:'2026-10-01T00:00:00Z',status:'error',transport:'app-server-primary-v9',sessionId:'old-goal-thread',messages:[{role:'user',text:goal}],continuousGoal:{objective:goal,deadline,budgetId}}));
  const resumableBytes=fs.readFileSync(goalFile,'utf8'),limitedBytes=JSON.stringify({...JSON.parse(resumableBytes),nativeGoal:{threadId:'old-goal-thread',objective:goal,status:'paused',tokenBudget:8000,tokensUsed:2000,timeUsedSeconds:12,createdAt:1,updatedAt:2}});
  fs.writeFileSync(goalFile,limitedBytes);
  const budgetBefore=JSON.stringify(await readGoalBudget(budgetDir)),lastTurnBefore=fs.readFileSync(path.join(project,'last-turn.json'),'utf8');
  await assert.rejects(()=>call('chatSend',{id:oldGoal,text:'continue',continuous:true,options}),/原生 Token 限额/);
  assert.equal(fs.readFileSync(goalFile,'utf8'),limitedBytes);assert.equal(JSON.stringify(await readGoalBudget(budgetDir)),budgetBefore);assert.equal(fs.readFileSync(path.join(project,'last-turn.json'),'utf8'),lastTurnBefore);assert.equal(fs.existsSync(path.join(dataRoot,'.chats',oldGoal,'turns')),false);
  fs.writeFileSync(goalFile,resumableBytes);
  const restarted=await call('chatSend',{id:oldGoal,text:'continue',continuous:true,options:{...options,delegation:{mode:'fixed',count:1,maxWorkers:1}}});const goalResult=await settled(restarted.id);
  assert.equal(goalResult.status,'completed',goalResult.error);assert.equal(goalResult.acceptance.status,'accepted');assert.equal(goalResult.continuousGoal.objective,goal);assert.equal(goalResult.continuousGoal.deadline,deadline);assert.equal(goalResult.continuousGoal.budgetId,budgetId);
  const keptBudget=await readGoalBudget(budgetDir);assert.equal(keptBudget.workersUsed,3);assert.equal(keptBudget.checksUsed,1);assert.equal(keptBudget.config.deadline,deadline);assert.equal(keptBudget.config.workers,64);assert.equal(keptBudget.config.checks,3);
  assert.equal((await call('chatList')).length,4);await call('chatStop');
  fs.writeFileSync(path.join(dataRoot,'offline-result.json'),JSON.stringify({status:'passed',mainEntry:'desktop/main.cjs',tools:registered.dynamicTools.map(t=>t.name),greeting:greeting.status,dispatch:completed.tasks[0].status,delivery:completed.acceptance.status,legacyReadOnly:true,legacyContinuation:true,legacyGoalBudgetPreserved:true,legacyTokenLimitFailClosed:true,realModelCalls:0}));
  process.exit(0);
 }catch(error){console.error(error);process.exit(1);}
}
require(path.join(codeRoot,'desktop/main.cjs'));
