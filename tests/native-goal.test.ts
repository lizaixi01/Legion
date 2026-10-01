import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeGoalLifecycle,type NativeGoal} from '../src/native-goal.js';

const initial:NativeGoal={threadId:'thread',objective:'goal',status:'paused',tokensUsed:0,timeUsedSeconds:0,createdAt:1,updatedAt:1};
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('native goal keeps intermediate turns alive and completes only after final turn and persisted status',async()=>{
 let goal={...initial};const saved:NativeGoal[]=[];let finished=0;
 const lifecycle=nativeGoalLifecycle(()=>goal.threadId,async(method,raw)=>{const args=raw as {status?:NativeGoal['status']};if(method==='thread/goal/set')goal={...goal,status:args.status!};return {goal};},async(value)=>{saved.push(value);},()=>{finished++;},error=>{throw error;});
 await lifecycle.prepare('goal');lifecycle.started('one');await lifecycle.activate();
 lifecycle.completed({params:{turn:{id:'one',status:'completed'}}});await tick();assert.equal(finished,0);
 lifecycle.started('two');goal={...goal,status:'complete',tokensUsed:100};lifecycle.observe(goal);await tick();assert.equal(finished,0);
 lifecycle.completed({params:{turn:{id:'two',status:'completed'}}});await tick();assert.equal(finished,1);assert.equal(saved.at(-1)!.status,'complete');await lifecycle.close();assert.equal(goal.status,'complete');
});
test('stopping pauses native continuation and prevents later activation',async()=>{
 let goal={...initial};const lifecycle=nativeGoalLifecycle(()=>goal.threadId,async(_method,raw)=>{const args=raw as {status?:NativeGoal['status']};if(args.status)goal={...goal,status:args.status};return {goal};},async()=>{},()=>{},()=>{});
 await lifecycle.prepare('goal');lifecycle.started('one');await lifecycle.activate();assert.equal(goal.status,'active');await lifecycle.close();assert.equal(goal.status,'paused');await assert.rejects(lifecycle.activate(),/cancelled/);
});
test('blocked first turn is not reactivated and late start acknowledgement does not hide completion',async()=>{
 let goal={...initial};let finished=0;const lifecycle=nativeGoalLifecycle(()=>goal.threadId,async(_method,raw)=>{const args=raw as {status?:NativeGoal['status']};if(args.status)goal={...goal,status:args.status};return {goal};},async()=>{},()=>{finished++;},()=>{});
 await lifecycle.prepare('goal');goal={...goal,status:'blocked'};lifecycle.completed({params:{turn:{id:'one',status:'completed'}}});await tick();lifecycle.started('one');await lifecycle.activate();await tick();assert.equal(goal.status,'blocked');assert.equal(finished,1);await lifecycle.close();
});

test('changed objectives and failed goal persistence cannot publish completion',async()=>{
 let goal={...initial},failed=0,finished=0;
 const lifecycle=nativeGoalLifecycle(()=>goal.threadId,async(_method,raw)=>{const args=raw as {status?:NativeGoal['status']};if(args.status)goal={...goal,status:args.status};return {goal};},async value=>{if(value.status==='complete')throw Error('disk unavailable');},()=>{finished++;},()=>{failed++;});
 await lifecycle.prepare('goal');lifecycle.started('one');await lifecycle.activate();
 assert.throws(()=>lifecycle.observe({...goal,objective:'weaker goal'}),/objective changed/);
 goal={...goal,status:'complete'};lifecycle.observe(goal);lifecycle.completed({params:{turn:{id:'one',status:'completed'}}});await tick();assert.ok(failed>0);assert.equal(finished,0);await assert.rejects(lifecycle.close(),/disk/);
});

test('stop waits for in-flight activation and leaves the native goal paused',async()=>{
 let goal={...initial},release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),sent=new Promise<void>(r=>{entered=r;}),statuses:string[]=[];
 const lifecycle=nativeGoalLifecycle(()=>goal.threadId,async(_method,raw)=>{const {status}=raw as {status?:NativeGoal['status']};if(status==='active'){entered();await gate;}if(status){statuses.push(status);goal={...goal,status};}return {goal};},async()=>{},()=>{},()=>{});
 await lifecycle.prepare('goal');const activating=lifecycle.activate();void activating.catch(()=>{});await sent;const closing=lifecycle.close();release();
 await assert.rejects(activating,/cancelled/);await closing;await lifecycle.close();assert.equal(goal.status,'paused');assert.deepEqual(statuses,['paused','active','paused']);
});

test('an unconfirmed activation still sends a pause during cleanup',async()=>{
 let goal={...initial};const lifecycle=nativeGoalLifecycle(()=>goal.threadId,async(_method,raw)=>{const {status}=raw as {status?:NativeGoal['status']};if(status)goal={...goal,status};if(status==='active')throw Error('activation reply lost');return {goal};},async()=>{},()=>{},()=>{});
 await lifecycle.prepare('goal');await assert.rejects(lifecycle.activate(),/reply lost/);assert.equal(goal.status,'active');await lifecycle.close();assert.equal(goal.status,'paused');
});

test('a delayed read cannot overwrite a newer terminal goal notification',async()=>{
 let goal={...initial},delay=false,reply!:()=>void,entered!:()=>void,finished=0;const waiting=new Promise<void>(r=>{entered=r;});
 const lifecycle=nativeGoalLifecycle(()=>goal.threadId,async(method,raw)=>{const {status}=raw as {status?:NativeGoal['status']};if(status)goal={...goal,status};const snapshot={...goal};if(method==='thread/goal/get'&&delay){entered();await new Promise<void>(r=>{reply=r;});}return {goal:snapshot};},async()=>{},()=>{finished++;},()=>{});
 await lifecycle.prepare('goal');lifecycle.started('turn');await lifecycle.activate();delay=true;lifecycle.completed({params:{turn:{id:'turn',status:'completed'}}});await waiting;
 goal={...goal,status:'complete'};lifecycle.observe(goal);reply();await tick();assert.equal(lifecycle.snapshot()!.status,'complete');assert.equal(finished,1);await lifecycle.close();
});

test('a delayed activation reply cannot overwrite a newer completed notification',async()=>{
 let goal={...initial},reply!:()=>void,entered!:()=>void,finished=0;const waiting=new Promise<void>(r=>{entered=r;});
 const lifecycle=nativeGoalLifecycle(()=>goal.threadId,async(_method,raw)=>{const {status}=raw as {status?:NativeGoal['status']};if(status)goal={...goal,status};const snapshot={...goal};if(status==='active'){entered();await new Promise<void>(r=>{reply=r;});}return {goal:snapshot};},async()=>{},()=>{finished++;},()=>{});
 await lifecycle.prepare('goal');lifecycle.started('turn');const activating=lifecycle.activate();await waiting;
 goal={...goal,status:'complete'};lifecycle.observe(goal);lifecycle.completed({params:{turn:{id:'turn',status:'completed'}}});reply();await activating;await tick();
 assert.equal(lifecycle.snapshot()!.status,'complete');assert.equal(finished,1);await lifecycle.close();
});
