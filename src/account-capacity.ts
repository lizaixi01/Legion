import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execute} from './process.js';
export interface AccountCapacity{backend:string;observedAt:string;available:boolean;data?:unknown;error?:string;concurrencyLimit:null}
const commandRoot='D:/Apps/Command Code/resources/app/node_modules';
export const workerSpecs={codex:{backend:'codex' as const,model:'gpt-6-sol',effort:'medium',command:process.env.PROACTIVE_NODE??process.execPath,prefix:[join(process.env.APPDATA!,'npm/node_modules/@openai/codex/bin/codex.js')]},commandcode:{backend:'commandcode' as const,model:'deepseek/deepseek-v4.1-flash',effort:'high',command:process.env.PROACTIVE_NODE??process.execPath,prefix:[commandRoot+'/command-code/dist/index.mjs']}};
async function codexAccount():Promise<unknown>{return new Promise((resolve,reject)=>{
 const c=spawn(process.env.PROACTIVE_NODE??process.execPath,[...workerSpecs.codex.prefix,'app-server'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let buffer='',done=false;
 const timer=setTimeout(()=>finish(Error('Account request timed out')),20000);
 function finish(error?:Error,value?:unknown){if(done)return;done=true;clearTimeout(timer);c.stdin.end();c.kill();error?reject(error):resolve(value);}
 c.on('error',finish);c.stdin.on('error',()=>{});c.on('exit',()=>{if(!done)finish(Error('Account reader exited'));});c.stderr.resume();
 c.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const r=JSON.parse(line);if(r.id===1){if(r.error){finish(Error('Codex initialization failed'));return;}c.stdin.write(JSON.stringify({method:'initialized'})+'\n');c.stdin.write(JSON.stringify({id:2,method:'account/rateLimits/read',params:null})+'\n');}if(r.id===2)r.error?finish(Error(r.error.message)):finish(undefined,r.result);}catch{}}});
 c.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'proactive-capacity',version:'1.0'}}})+'\n');
 });}
export async function accountCapacities(root:string):Promise<AccountCapacity[]>{return Promise.all(['codex','commandcode'].map(async backend=>{const base={backend,observedAt:new Date().toISOString(),concurrencyLimit:null};try{
 if(backend==='codex')return {...base,available:true,data:await codexAccount()};
 const logs=join(root,'.capacity','account-'+randomUUID());await mkdir(logs,{recursive:true});const r=await execute({command:process.env.PROACTIVE_NODE??process.execPath,args:[join(root,'scripts/capacity/command-account.mjs')],cwd:root,logDir:logs,timeoutMs:30000,env:{...process.env,COMMANDCODE_HARNESS:commandRoot+'/@commandcode/harness/dist/index.js'}});if(r.status!=='completed')throw Error('Command Code account unavailable');const data=JSON.parse(await readFile(join(logs,'stdout.jsonl'),'utf8'));return {...base,available:data.credits!==null||data.windows!==null,data};
 }catch(e){return {...base,available:false,error:String(e)};}}));}


