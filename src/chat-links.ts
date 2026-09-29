import {lstat,realpath,readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,extname} from 'node:path';

export async function resolveChatLink(root:string,id:string,target:string) {
  if(!/^[a-f0-9-]{36}$/.test(id)||typeof target!=='string'||!target||/[\u0000-\u001f]/.test(target))throw Error('无效的链接');
  if(/^https?:\/\//i.test(target)){
    const url=new URL(target);if(url.username||url.password)throw Error('不支持带凭据的链接');
    return {kind:'web' as const,target:url.href};
  }
  let path=decodeURIComponent(target);
  if(/^\/[a-z]:\//i.test(path))path=path.slice(1);
  if(/^[a-z][a-z0-9+.-]*:/i.test(path)&&!(/^[a-z]:[\\/]/i.test(path)&&process.platform==='win32'))throw Error('不支持的链接类型');
  let project:string|undefined,managementDir:string|undefined;try{const chat=JSON.parse(await readFile(resolve(root,'.chats',id,'chat.json'),'utf8'));project=chat.project;managementDir=chat.managementDir;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const workspace=await realpath(project??resolve(root,'.chats',id,'workspace'));
  const candidate=resolve(workspace,path);
  const roots=[workspace];if(managementDir&&/^[a-f0-9-]{36}$/.test(managementDir))roots.push(await realpath(resolve(root,'.chats',id,'turns',managementDir)));
  const inside=(p:string)=>roots.some(base=>{const rel=relative(base,p);return rel!== '..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(rel);});
  if(!inside(candidate))throw Error('文件不在当前对话目录中');
  const actual=await realpath(candidate);if(!inside(actual))throw Error('文件链接指向对话目录之外');
  if(!(await lstat(actual)).isFile())throw Error('链接不是文件');
  const viewable=new Set(['.html','.htm','.pdf','.txt','.md','.png','.jpg','.jpeg','.webp','.gif']);
  return {kind:viewable.has(extname(actual).toLowerCase())?'file' as const:'reveal' as const,target:actual};
}
