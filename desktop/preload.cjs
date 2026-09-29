const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('manager',{
  projectInfo:()=>ipcRenderer.invoke('manager:projectInfo'),
  poolStart:input=>ipcRenderer.invoke('manager:poolStart',input),poolSnapshot:()=>ipcRenderer.invoke('manager:poolSnapshot'),poolStop:()=>ipcRenderer.invoke('manager:poolStop'),
  accountCapacity:()=>ipcRenderer.invoke('manager:accountCapacity'),
  onAccountCapacityUpdated:callback=>ipcRenderer.on('account-capacity-updated',(_event,data)=>callback(data)),
  researchList:()=>ipcRenderer.invoke('manager:researchList'),
  researchDetail:id=>ipcRenderer.invoke('manager:researchDetail',id),
  researchStart:input=>ipcRenderer.invoke('manager:researchStart',input),
  researchStop:()=>ipcRenderer.invoke('manager:researchStop'),
  researchFolder:id=>ipcRenderer.invoke('manager:researchFolder',id),
  chooseProject:()=>ipcRenderer.invoke('manager:chooseProject'),
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




