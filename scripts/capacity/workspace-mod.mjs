import path from 'node:path';
import {lstat} from 'node:fs/promises';
const allowed=new Set(['read_file','read_directory','glob','grep','write_file','edit_file']);
export async function guardTool(root,{toolName,input}) {
 if(!allowed.has(toolName))return {block:true,additionalContext:'Only scoped file tools are available. No shell, delegation, network or tool discovery.'};
 try{
  const raw=input.file_path??input.path??input.directory??root;
  if(typeof raw!=='string')throw Error('Invalid path');
  const target=path.resolve(root,raw),rel=path.relative(root,target);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Path is outside the assigned workspace');
  for(const part of ['',...rel.split(path.sep)]){root=path.join(root,part);try{if((await lstat(root)).isSymbolicLink())throw Error('Links are not allowed');}catch(e){if(e.code!=='ENOENT')throw e;}}
  return undefined;
 }catch(e){return {block:true,additionalContext:String(e)};}
}
export default function(cmd) {
 const root=process.cwd();
 cmd.setActiveTools([...allowed]);
 cmd.hooks({beforeToolCall:call=>guardTool(root,call)});
}
