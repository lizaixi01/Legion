export function installFileDrop(target,composer,api,receive,report){
 let depth=0;
 const clear=()=>{depth=0;composer.classList.remove('file-drag-over');};
 const isFile=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
 target.addEventListener('dragenter',e=>{if(!isFile(e))return;e.preventDefault();depth++;composer.classList.add('file-drag-over');});
 target.addEventListener('dragover',e=>{if(!isFile(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
 target.addEventListener('dragleave',e=>{if(!isFile(e))return;if(--depth<=0)clear();});
 target.addEventListener('drop',e=>{if(isFile(e))e.preventDefault();clear();});
 target.addEventListener('blur',clear);
 api.onFilesDropped?.(result=>{clear();if(result.error)report(result.error);else receive(result.paths);});
}
