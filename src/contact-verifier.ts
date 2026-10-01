import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {digest,type AcceptanceContract} from './challenge.js';
import {commandChecker} from './checker.js';
import type {TrustedVerifier} from './acceptance.js';
export interface ContactDomain{kind:'contacts-v1';source:string;input:unknown[];hash:string;contract:AcceptanceContract}
const Record=z.object({name:z.string(),email:z.string()}).passthrough();
/** Host-owned normalization rules; expected values never come from a model. */
export function cleanContacts(input:unknown[]){const seen=new Set<string>();const records:{name:string;email:string}[]=[];for(const raw of input){const result=Record.safeParse(raw);if(!result.success)continue;const email=result.data.email.trim().toLowerCase(),name=result.data.name.trim();if(!name||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||seen.has(email))continue;seen.add(email);records.push({name,email});}return records;}
export async function contactDomain(goal:string,project:string):Promise<ContactDomain|undefined>{
 const match=/^清洗联系人 ([a-zA-Z0-9_-]+\.json)[。.]?$/.exec(goal.trim());if(!match)return;
 const bytes=await readFile(join(project,match[1]!));if(bytes.length>2*1024*1024)throw Error('联系人文件超过 2 MiB');const input=z.array(z.unknown()).max(50000).parse(JSON.parse(bytes.toString('utf8')));
 return {kind:'contacts-v1',source:match[1]!,input,hash:digest(bytes),contract:{goal,outputs:['cleaned-contacts.json'],acceptance:['逐行保留 name 和 email 均为字符串且清洗后有效的联系人；name 去除首尾空白，email 去除首尾空白并转小写','有效邮箱须满足非空本地部分、@、含点域名且无空白；name 不得为空','按清洗后的 email 去重，保留首条记录顺序；输出仅包含 name 和 email，不得添加联系人']}};
}
export function contactVerifier(domain:ContactDomain):TrustedVerifier{return {id:'contact-cleaning',version:'1:'+domain.hash,covers:c=>c.originalRequirement===domain.contract.goal&&JSON.stringify(c.outputs)===JSON.stringify(domain.contract.outputs)&&JSON.stringify(c.acceptance)===JSON.stringify(domain.contract.acceptance),check:async(candidate,contract,dir,signal)=>{
 const script=join(dir,'contacts.cjs');await writeFile(script,`const fs=require('node:fs'),assert=require('node:assert/strict');let actual,passed=false;try{actual=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));assert.deepStrictEqual(actual,${JSON.stringify(cleanContacts(domain.input))});passed=true;}catch{};console.log(JSON.stringify({checks:${JSON.stringify(contract.requirements.map(r=>({id:r.id})))}.map(r=>({...r,status:passed?'pass':'fail',detail:'Exact comparison against frozen original contacts and host normalization rules'})),artifacts:[]}));`);await mkdir(join(dir,'execution'),{recursive:true});return commandChecker({command:'$node',args:[script,join(candidate.snapshot,'cleaned-contacts.json')],timeoutMs:15000})(candidate.snapshot,join(dir,'execution'),signal);
 }};}
