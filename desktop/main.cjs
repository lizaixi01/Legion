const { app, BrowserWindow, ipcMain, Menu, dialog, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs=require('node:fs');
const {readClipboardFiles}=require('./clipboard-files.cjs');
// A packaged install keeps the program files read-only inside the app bundle, so the
// code root and the writable data root are resolved separately.
const packaged=app.isPackaged;
const applicationTitle=packaged?'Legion':'Legion Beta';
const codeRoot=packaged?app.getAppPath():path.resolve(__dirname,'..');
const root=packaged?app.getPath('userData'):path.resolve(__dirname,'..');
const profileDir=packaged?root:path.join(root,'.gui-profile');
if(!packaged&&!process.env.PROACTIVE_NODE){try{const configText=fs.readFileSync(path.join(process.env.LOCALAPPDATA||'', 'ProactiveAgent','current.json'),'utf8').replace(/^\uFEFF/,'');const config=JSON.parse(configText);if(path.resolve(config.projectRoot)===root)process.env.PROACTIVE_NODE=config.node;}catch{}}
function resolveNode(){
  if(process.env.PROACTIVE_NODE)return process.env.PROACTIVE_NODE;
  const name=process.platform==='win32'?'node.exe':'node';
  for(const dir of (process.env.PATH||'').split(path.delimiter)){if(!dir)continue;const candidate=path.join(dir,name);try{if(fs.statSync(candidate).isFile())return candidate;}catch{}}
  // No Node.js installed: reuse Electron's bundled Node runtime for child processes.
  process.env.ELECTRON_RUN_AS_NODE='1';
  return process.execPath;
}
const startupLog=path.join(profileDir,'lifecycle.log');
function recordLifecycle(message){try{fs.mkdirSync(path.dirname(startupLog),{recursive:true});fs.appendFileSync(startupLog,`${new Date().toISOString()} pid=${process.pid} ${message}\n`);}catch{}}
recordLifecycle('starting');
app.on('will-quit',()=>recordLifecycle('will-quit'));
protocol.registerSchemesAsPrivileged([{scheme:'proactive',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setPath('userData',profileDir);
let win, service, chats, engineering, poolService, selectedProject, quitting=false;
const selectedAttachments=new Set();
let accountCapacityData=null,accountCapacityTask=null,readAccountCapacity;
const accountCapacityCache=path.join(profileDir,'account-capacity.json');
function refreshAccountCapacity(){
  if(accountCapacityTask)return accountCapacityTask;
  if(!readAccountCapacity)return Promise.reject(Error('Account capacity reader is not ready'));
  accountCapacityTask=readAccountCapacity(root).then(data=>{
    accountCapacityData=data.map(item=>item.available?item:accountCapacityData?.find(old=>old.backend===item.backend&&old.available)||item);
    try{fs.mkdirSync(path.dirname(accountCapacityCache),{recursive:true});fs.writeFileSync(accountCapacityCache,JSON.stringify(accountCapacityData));}catch{}
    if(win&&!win.isDestroyed())win.webContents.send('account-capacity-updated',accountCapacityData);
    return accountCapacityData;
  }).finally(()=>{accountCapacityTask=null;});
  return accountCapacityTask;
}
if(!app.requestSingleInstanceLock())app.quit();
else {
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
  app.setAppUserModelId(packaged?'local.legion':'local.legion.beta');
  try{const cached=JSON.parse(fs.readFileSync(accountCapacityCache,'utf8'));if(Array.isArray(cached)&&cached.every(a=>a&&typeof a.backend==='string'&&typeof a.observedAt==='string'))accountCapacityData=cached;}catch{}
  const {createDesktopService}=await import(pathToFileURL(path.join(codeRoot,'dist/src/desktop-service.js')).href);
  process.env.PROACTIVE_NODE=resolveNode();
  service=createDesktopService(root,process.env.PROACTIVE_NODE);
  const {createChatService}=await import(pathToFileURL(path.join(codeRoot,'dist/src/chat-service.js')).href);
  chats=createChatService(root);
  const {createEngineeringProduct}=await import(pathToFileURL(path.join(codeRoot,'dist/src/engineering-product.js')).href);
  engineering=createEngineeringProduct(root,process.env.PROACTIVE_NODE);
  const {modelCatalog}=await import(pathToFileURL(path.join(codeRoot,'dist/src/chat-options.js')).href);
  protocol.handle('proactive',require('./resources.cjs').serveDesktopResource);
  win=new BrowserWindow({width:1400,height:900,minWidth:980,minHeight:650,title:applicationTitle,backgroundColor:'#181818',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.on('page-title-updated',event=>{event.preventDefault();win.setTitle(applicationTitle);});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  const {resolveChatLink}=await import(pathToFileURL(path.join(codeRoot,'dist/src/chat-links.js')).href);
  const {accountCapacities}=await import(pathToFileURL(path.join(codeRoot,'dist/src/account-capacity.js')).href);readAccountCapacity=accountCapacities;
  const {createPoolService}=await import(pathToFileURL(path.join(codeRoot,'dist/src/pool-service.js')).href);poolService=createPoolService(root);
  const methods={
    projectInfo:()=>({path:root,name:path.basename(root)}),
    poolStart:input=>poolService.start(input),poolSnapshot:()=>poolService.snapshot(),poolStop:()=>poolService.stop(),
    accountCapacity:()=>{if(!accountCapacityData)return refreshAccountCapacity();if(Date.now()-Math.max(...accountCapacityData.map(a=>Date.parse(a.observedAt)||0))>5*60_000)void refreshAccountCapacity();return accountCapacityData;},
    chatOpenLink:async(id,target)=>{const link=await resolveChatLink(root,id,target);if(link.kind==='web')await shell.openExternal(link.target);else if(link.kind==='reveal')shell.showItemInFolder(link.target);else {const error=await shell.openPath(link.target);if(error)throw Error(error);}},
    pasteFiles:async()=>{const paths=await readClipboardFiles();if(!paths.length)return [];if(paths.length>30)throw Error('最多添加 30 个附件');const resolved=paths.map(p=>fs.realpathSync(p));for(const p of resolved){const info=fs.statSync(p);if(!info.isFile()&&!info.isDirectory())throw Error('附件类型不支持');}for(const p of resolved)selectedAttachments.add(p);return resolved;},
    registerDroppedFiles:paths=>{if(!Array.isArray(paths)||!paths.length||paths.length>30||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw Error('一次最多添加 30 个本地文件或文件夹');const resolved=[...new Set(paths.map(p=>fs.realpathSync(p)))];for(const p of resolved){const info=fs.statSync(p);if(!info.isFile()&&!info.isDirectory())throw Error('不支持该附件类型');}for(const p of resolved)selectedAttachments.add(p);return resolved;},
    chooseFiles:async()=>{const result=await dialog.showOpenDialog(win,{title:"添加文件",properties:["openFile","multiSelections"]});if(result.canceled)return [];for(const file of result.filePaths)selectedAttachments.add(file);return result.filePaths;},
    chooseProject:async()=>{const result=await dialog.showOpenDialog(win,{title:'选择项目',properties:['openDirectory']});if(result.canceled)return null;selectedProject=result.filePaths[0];return {path:selectedProject,name:path.basename(selectedProject)};},
    goalStart:input=>{if(input.project&&input.project!==selectedProject)throw Error('请先选择项目目录');if(chats.isActive()||service.isActive())throw Error('请先停止当前执行');return engineering.startGoal({...input,project:input.project||root});},
    engineeringSupport:project=>{if(project!==selectedProject)throw Error('请先选择项目目录');return engineering.support(project);},
    engineeringPlan:input=>{if(input.project!==selectedProject)throw Error('请先选择项目目录');if(chats.isActive()||service.isActive())throw Error('请先停止当前执行');return engineering.plan(input);},
    engineeringApprove:(id,hash)=>{if(chats.isActive()||service.isActive())throw Error("请先停止当前执行");return engineering.approve(id,hash);},
    engineeringResume:id=>{if(chats.isActive()||service.isActive())throw Error("请先停止当前执行");return engineering.resume(id);},engineeringPause:()=>engineering.pause(),engineeringCancel:id=>engineering.cancel(id),
    engineeringStart:(id,configuration)=>{if(chats.isActive()||service.isActive())throw Error('请先停止当前执行');return engineering.start(id,configuration);},
    engineeringList:()=>engineering.list(),engineeringDetail:async id=>{const detail=await engineering.detail(id);selectedProject=detail.project;return detail;},engineeringStop:()=>engineering.stop(),
    engineeringFolder:async id=>{const error=await shell.openPath(await engineering.folder(id));if(error)throw Error(error);},
    models:()=>modelCatalog(),chatList:()=>chats.list(),chatDetail:id=>chats.detail(id),chatSend:input=>{if(input.attachments&&(!Array.isArray(input.attachments)||input.attachments.some(p=>!selectedAttachments.has(p))))throw Error("请重新选择或拖入附件");if(input.project&&input.project!==selectedProject)throw Error('请先选择项目目录');if(engineering.isActive())throw Error('请先停止工程任务');return chats.send(input);},chatStop:()=>chats.stop(),chatSetPinned:(id,pinned)=>chats.setPinned(id,pinned),chatDelete:id=>chats.deleteChat(id),chatArchiveProject:project=>chats.archiveProject(project),list:()=>service.list(),detail:id=>service.detail(id),start:input=>{if(engineering.isActive()||chats.isActive())throw Error('请先停止当前执行');return service.start(input);},stop:()=>service.stop(),artifact:(id,task,file)=>service.artifact(id,task,file)};
  for(const [name,fn] of Object.entries(methods))ipcMain.handle('manager:'+name,(event,...args)=>{
    const source=new URL(event.senderFrame.url);
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||source.protocol!=='proactive:'||source.host!=='app')throw Error('Untrusted caller');
    return fn(...args);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'文件',submenu:[{label:'新聊天',accelerator:'CmdOrCtrl+N',click:()=>win.webContents.send('new-run')},{type:'separator'},{label:'退出',role:'quit'}]},
    {label:'编辑',submenu:[{role:'copy',label:'复制'},{role:'selectAll',label:'全选'}]},
    {label:'视图',submenu:[{role:'reload',label:'刷新'},{role:'togglefullscreen',label:'全屏'},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'}]},
  ]));
  win.once('ready-to-show',()=>{win.show();win.focus();recordLifecycle('window-shown');});
  win.webContents.on('render-process-gone',(_event,details)=>recordLifecycle('renderer-gone '+JSON.stringify(details)));
  win.on('close',event=>{
    if(!quitting&&(service.isActive()||chats.isActive()||engineering.isActive()||poolService.isActive())){
      event.preventDefault();void dialog.showMessageBox(win,{type:'question',buttons:['继续运行','暂停工程并退出'],defaultId:0,cancelId:0,message:'任务仍在执行',detail:'工程任务将在安全边界暂停；其他执行停止。无法干净暂停时保留中断记录。'}).then(async result=>{if(result.response===1){quitting=true;await engineering.stop();await Promise.all([service.stop(),chats.stop(),poolService.stop()]);app.quit();}});
    }
  });
  if(!accountCapacityData||Date.now()-Math.max(...accountCapacityData.map(a=>Date.parse(a.observedAt)||0))>5*60_000)void refreshAccountCapacity().catch(()=>{});
  await win.loadURL('proactive://app/');
}).catch(error=>{recordLifecycle('startup-error '+String(error));dialog.showErrorBox('Legion 启动失败',String(error));app.quit();});
app.on('window-all-closed',()=>app.quit());
}




