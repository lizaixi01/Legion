import {readFile} from 'node:fs/promises';
import {runProgramBench} from './programbench.js';
const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
try{const [action,file]=process.argv.slice(2);if(action!=='run'||!file)throw Error('Usage: npm run benchmark -- run <config.json>');const result=await runProgramBench(JSON.parse(await readFile(file,'utf8')),controller.signal);process.exitCode=result.status==='evaluated'?0:1;}catch(error){console.error(String(error));process.exitCode=1;}
