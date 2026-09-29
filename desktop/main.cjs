const { app, BrowserWindow, ipcMain, Menu, dialog, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root=path.resolve(__dirname,'..');
protocol.registerSchemesAsPrivileged([{scheme:'proactive',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setPath('userData',path.join(root,'.gui-profile'));
let win, service, chats, engineering, research, poolService, selectedProject, quitting=false;
if(!app.requestSingleInstanceLock())app.quit();
else {
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.whenReady().then(async()=>{
  app.setAppUserModelId('local.proactive.agent');
  const {createDesktopService}=await import(pathToFileURL(path.join(root,'dist/src/desktop-service.js')).href);
  if(!process.env.PROACTIVE_NODE)throw Error('请使用项目启动器启动桌面应用');
  service=createDesktopService(root,process.env.PROACTIVE_NODE);
  const {createChatService}=await import(pathToFileURL(path.join(root,'dist/src/chat-service.js')).href);
  chats=createChatService(root);
  const {createEngineeringService}=await import(pathToFileURL(path.join(root,'dist/src/engineering.js')).href);
  engineering=createEngineeringService(root,process.env.PROACTIVE_NODE);
  const {createResearchService}=await import(pathToFileURL(path.join(root,'dist/src/research-service.js')).href);
  research=createResearchService(root);
  const {modelCatalog}=await import(pathToFileURL(path.join(root,'dist/src/chat-options.js')).href);
  protocol.handle('proactive',request=>{
    const url=new URL(request.url);
    const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/research.js':'research.js','/style.css':'style.css','/message-links.js':'../dist/src/message-links.js'};
    if(url.host!=='app'||!Object.hasOwn(files,url.pathname))return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(path.join(__dirname,files[url.pathname])).href).then(response=>{
      const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
      return new Response(response.body,{status:response.status,headers});
    });
  });
  win=new BrowserWindow({width:1400,height:900,minWidth:980,minHeight:650,title:'Proactive Agent',backgroundColor:'#181818',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  const {resolveChatLink}=await import(pathToFileURL(path.join(root,'dist/src/chat-links.js')).href);
  const {accountCapacities}=await import(pathToFileURL(path.join(root,'dist/src/account-capacity.js')).href);
  const {createPoolService}=await import(pathToFileURL(path.join(root,'dist/src/pool-service.js')).href);poolService=createPoolService(root);
  const methods={
    poolStart:input=>poolService.start(input),poolSnapshot:()=>poolService.snapshot(),poolStop:()=>poolService.stop(),
    accountCapacity:()=>accountCapacities(root),
    researchList:()=>research.list(),researchDetail:id=>research.detail(id),researchStart:input=>{if(chats.isActive()||engineering.isActive()||service.isActive())throw Error('请先停止当前执行');return research.start(input);},researchStop:()=>research.stop(),researchFolder:async id=>{const error=await shell.openPath(research.folder(id));if(error)throw Error(error);},
    chatOpenLink:async(id,target)=>{const link=await resolveChatLink(root,id,target);if(link.kind==='web')await shell.openExternal(link.target);else if(link.kind==='reveal')shell.showItemInFolder(link.target);else {const error=await shell.openPath(link.target);if(error)throw Error(error);}},
    chooseProject:async()=>{const result=await dialog.showOpenDialog(win,{title:'选择 JavaScript 项目',properties:['openDirectory']});if(result.canceled)return null;selectedProject=result.filePaths[0];return {path:selectedProject,name:path.basename(selectedProject)};},
    engineeringPlan:input=>{if(input.project!==selectedProject)throw Error('请先选择项目目录');if(chats.isActive()||service.isActive()||research.isActive())throw Error('请先停止当前执行');return engineering.plan(input);},
    engineeringStart:(id,configuration)=>{if(chats.isActive()||service.isActive()||research.isActive())throw Error('请先停止当前执行');return engineering.start(id,configuration);},
    engineeringList:()=>engineering.list(),engineeringDetail:async id=>{const detail=await engineering.detail(id);selectedProject=detail.project;return detail;},engineeringStop:()=>engineering.stop(),
    engineeringFolder:async id=>{const error=await shell.openPath(await engineering.folder(id));if(error)throw Error(error);},
    models:()=>modelCatalog(),chatList:()=>chats.list(),chatDetail:id=>chats.detail(id),chatSend:input=>{if(input.project&&input.project!==selectedProject)throw Error('请先选择项目目录');if(engineering.isActive()||research.isActive())throw Error('请先停止工程任务');return chats.send(input);},chatStop:()=>chats.stop(),list:()=>service.list(),detail:id=>service.detail(id),start:input=>{if(engineering.isActive()||chats.isActive()||research.isActive())throw Error('请先停止当前执行');return service.start(input);},stop:()=>service.stop(),artifact:(id,task,file)=>service.artifact(id,task,file)};
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
  win.once('ready-to-show',()=>win.show());
  win.on('close',event=>{
    if(!quitting&&(service.isActive()||chats.isActive()||engineering.isActive()||research.isActive()||poolService.isActive())){
      event.preventDefault();void dialog.showMessageBox(win,{type:'question',buttons:['继续运行','停止并退出'],defaultId:0,cancelId:0,message:'任务仍在执行',detail:'退出前将停止本次运行的执行进程，保留已有证据。'}).then(async result=>{if(result.response===1){quitting=true;await Promise.all([service.stop(),chats.stop(),engineering.stop(),research.stop(),poolService.stop()]);app.quit();}});
    }
  });
  await win.loadURL('proactive://app/');
}).catch(error=>{dialog.showErrorBox('Proactive Agent 启动失败',String(error));app.quit();});
app.on('window-all-closed',()=>app.quit());
}




