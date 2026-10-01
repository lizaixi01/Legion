const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('manager',{
  projectInfo:()=>ipcRenderer.invoke('manager:projectInfo'),
  poolStart:input=>ipcRenderer.invoke('manager:poolStart',input),poolSnapshot:()=>ipcRenderer.invoke('manager:poolSnapshot'),poolStop:()=>ipcRenderer.invoke('manager:poolStop'),
  accountCapacity:()=>ipcRenderer.invoke('manager:accountCapacity'),
  onAccountCapacityUpdated:callback=>ipcRenderer.on('account-capacity-updated',(_event,data)=>callback(data)),
  chooseFiles:()=>ipcRenderer.invoke('manager:chooseFiles'),
  onFilesDropped:callback=>{
    window.addEventListener('paste',event=>{
      if(!event.target?.closest?.('#composer'))return;
      const files=[...(event.clipboardData?.files||[])];
      if(files.length)event.preventDefault();
      try{
        const paths=files.map(file=>webUtils.getPathForFile(file)).filter(Boolean);
        const task=paths.length?ipcRenderer.invoke('manager:registerDroppedFiles',paths):ipcRenderer.invoke('manager:pasteFiles');
        task.then(paths=>{if(paths.length)callback({paths});else if(files.length)callback({error:'未添加：请复制本地文件，或使用 ＋ 选择文件'});},error=>callback({error:'未添加附件：'+error.message}));
      }catch(error){callback({error:'未添加附件：'+error.message});}
    });
    window.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files'))event.preventDefault();});
    window.addEventListener('drop',event=>{
      if(![...event.dataTransfer.types].includes('Files'))return;
      event.preventDefault();
      try{const paths=[...event.dataTransfer.files].map(file=>webUtils.getPathForFile(file)).filter(Boolean);
        if(!paths.length){callback({error:'请从文件管理器拖入本地文件或文件夹'});return;}
        ipcRenderer.invoke('manager:registerDroppedFiles',paths).then(paths=>callback({paths}),error=>callback({error:error.message}));
      }catch(error){callback({error:error.message});}
    });
  },
  chooseProject:()=>ipcRenderer.invoke('manager:chooseProject'),
  engineeringApprove:(id,hash)=>ipcRenderer.invoke('manager:engineeringApprove',id,hash),
  engineeringResume:id=>ipcRenderer.invoke('manager:engineeringResume',id),
  engineeringPause:()=>ipcRenderer.invoke('manager:engineeringPause'),
  engineeringCancel:id=>ipcRenderer.invoke('manager:engineeringCancel',id),
  goalStart:input=>ipcRenderer.invoke('manager:goalStart',input),
  engineeringSupport:project=>ipcRenderer.invoke('manager:engineeringSupport',project),
  engineeringPlan:input=>ipcRenderer.invoke('manager:engineeringPlan',input),
  engineeringStart:(id,configuration)=>ipcRenderer.invoke('manager:engineeringStart',id,configuration),
  engineeringList:()=>ipcRenderer.invoke('manager:engineeringList'),
  engineeringDetail:id=>ipcRenderer.invoke('manager:engineeringDetail',id),
  engineeringStop:()=>ipcRenderer.invoke('manager:engineeringStop'),
  engineeringFolder:id=>ipcRenderer.invoke('manager:engineeringFolder',id),
  models:()=>ipcRenderer.invoke('manager:models'),
  chatOpenLink:(id,target)=>ipcRenderer.invoke('manager:chatOpenLink',id,target),
  chatList:()=>ipcRenderer.invoke('manager:chatList'),
  chatDetail:id=>ipcRenderer.invoke('manager:chatDetail',id),
  chatSend:input=>ipcRenderer.invoke('manager:chatSend',input),
  chatStop:()=>ipcRenderer.invoke('manager:chatStop'),
  chatSetPinned:(id,pinned)=>ipcRenderer.invoke('manager:chatSetPinned',id,pinned),
  chatDelete:id=>ipcRenderer.invoke('manager:chatDelete',id),
  chatArchiveProject:project=>ipcRenderer.invoke('manager:chatArchiveProject',project),
  list:()=>ipcRenderer.invoke('manager:list'),
  detail:id=>ipcRenderer.invoke('manager:detail',id),
  start:input=>ipcRenderer.invoke('manager:start',input),
  stop:()=>ipcRenderer.invoke('manager:stop'),
  artifact:(id,task,file)=>ipcRenderer.invoke('manager:artifact',id,task,file),
  onNewRun:callback=>ipcRenderer.on('new-run',()=>callback()),
});




