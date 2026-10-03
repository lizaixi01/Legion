// Raw output and original child exit code, without shell/batch control transfer.
import {mkdir,open,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
const [directory,...args]=process.argv.slice(2);if(!directory||!args.length)throw Error('capture.mjs <new-log-directory> <Node arguments...>');
const root=resolve(directory);await mkdir(root);const stdout=await open(join(root,'stdout.log'),'wx'),stderr=await open(join(root,'stderr.log'),'wx');
const startedAt=new Date().toISOString();let child;
try{const result=await new Promise((accept,reject)=>{child=spawn(process.execPath,args,{windowsHide:true,shell:false,stdio:['inherit',stdout.fd,stderr.fd]});child.once('error',reject);child.once('close',(exitCode,signal)=>accept({exitCode,signal}));});await writeFile(join(root,'exit.json'),JSON.stringify({startedAt,endedAt:new Date().toISOString(),...result},null,2));process.exitCode=result.exitCode??1;}
catch(error){await writeFile(join(root,'exit.json'),JSON.stringify({startedAt,error:String(error),exitCode:null},null,2));process.exitCode=1;}
finally{await stdout.close();await stderr.close();}
