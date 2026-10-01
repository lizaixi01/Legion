let attachments=[];
let goalMode=false;
function resetTaskMode(){goalMode=false;$('goal-mode').setAttribute('aria-pressed','false');$('prompt').placeholder='随心输入';}
import {renderMessage} from './message-links.js';
import {createConversationView} from './conversation-view.js';
import {installFileDrop} from './drop-files.js';
import {renderAttachmentCards} from './attachment-cards.js';
import {setIcon} from './ui-icons.js';
const $=id=>document.getElementById(id),api=window.manager;
for(const [id,name] of [['collapse','sidebar'],['expand','sidebar'],['search-icon','search'],['new-chat-icon','compose'],['running-icon','agents'],['attach-files','plus'],['goal-icon','goal'],['worker-icon','model'],['agents-icon','agents'],['permission-icon','edit']])setIcon($(id),name);
const conversationView=createConversationView($('messages'));
installFileDrop(window,$('composer'),api,paths=>{const next=[...new Set([...attachments,...paths])];if(next.length>30){$('error').textContent='最多添加 30 个附件';return;}attachments=next;$('error').textContent='';paintAttachments();$('prompt').focus();},message=>{$('error').textContent=message;});
let current=null,busy=false,sending=false,refreshing=false,lastMessages='',activeId=null,workspaceInfo={path:'',name:'Project'},projectGroupsKey='';
let workerOptions={model:'gpt-6-sol',effort:'high'},taskOverrides={},candidateCount=2,managedReady=false;
let options={model:'gpt-6-sol',effort:'high',permission:'workspace-write',agents:0,delegation:{mode:'auto',count:10}},catalog=[],menu=null,settingsChat=null;
const effortNames={low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高',ultra:'超高'};
const permissionNames={'read-only':'只读','workspace-write':'项目内编辑','danger-full-access':'完全访问'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fresh(){attachments=[];document.getElementById("attachments")?.replaceChildren();resetTaskMode();managedReady=false;taskOverrides={};managedId=null;managedKey="";closeMenu();settingsChat=null;current=null;busy=false;lastMessages='';$('title').textContent='';$('messages').replaceChildren();$('welcome').hidden=false;$('prompt').value='';$('prompt').style.height='auto';$('error').textContent='';$('details').hidden=true;$('details-toggle').hidden=true;updateSend();$('prompt').focus();void refresh();}
function updateSend(){$('goal-mode').disabled=busy||sending||Boolean(managedId);setIcon($('send'),busy?(managedId?'pause':'stop'):'arrow');$('send').classList.toggle('stopping',busy);$('send').title=busy?(managedId?'暂停':'停止'):'发送';$('send').setAttribute('aria-label',$('send').title);$('send').disabled=sending||(!busy&&!$('prompt').value.trim());paintSettings();}
$('attach-files').onclick=async()=>{try{attachments=[...new Set([...attachments,...await api.chooseFiles()])];paintAttachments();}catch(e){$('error').textContent=e.message;}};
$('new-chat').onclick=fresh;api.onNewRun(fresh);
function setSidebarCollapsed(collapsed){
 closeMenu();closeChatMenu();closeCapacity();
 document.body.classList.toggle('sidebar-collapsed',collapsed);
 $('sidebar').inert=collapsed;$('sidebar').setAttribute('aria-hidden',String(collapsed));
 for(const id of ['collapse','expand'])$(id).setAttribute('aria-expanded',String(!collapsed));
 $('expand').setAttribute('aria-hidden',String(!collapsed));$('expand').tabIndex=collapsed?0:-1;
 $(collapsed?'expand':'collapse').focus();
}
$('collapse').onclick=()=>setSidebarCollapsed(true);$('expand').onclick=()=>setSidebarCollapsed(false);
$('prompt').oninput=()=>{$('prompt').style.height='auto';$('prompt').style.height=Math.min($('prompt').scrollHeight,220)+'px';updateSend();};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!busy)$('composer').requestSubmit();}};
$('composer').onsubmit=async e=>{e.preventDefault();if(sending)return;if(busy){if(managedId)await api.engineeringStop();else await api.chatStop();await refresh();return;}const value=$('prompt').value.trim();if(!value)return;closeMenu();sending=true;updateSend();$('error').textContent='';try{const result=await api.chatSend({id:current||undefined,text:value,options:{...options,worker:{...workerOptions}},project:projectChoice?.path,attachments,continuous:goalMode});attachments=[];paintAttachments();managedId=null;current=result.id;$('prompt').value='';$('prompt').style.height='auto';lastMessages='';await refresh();}catch(e){$('error').textContent=e.message;}finally{sending=false;updateSend();}};
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{
  const engineering=await refreshEngineering(),chats=await api.chatList();
  paintProjectGroups(chats,engineering);
  activeId=chats.find(c=>c.status==='running')?.id;
  if(managedId){updateSend();return;}
  if(current){
   const id=current,c=await api.chatDetail(id);if(current!==id)return;
   if(settingsChat!==id){settingsChat=id;projectChoice=c.project?{path:c.project,name:c.project.split(/[\\/]/).at(-1)}:null;paintProject();if(c.options){options={...c.options,delegation:c.options.delegation??{mode:'off',count:10}};if(c.options.worker)workerOptions={...c.options.worker};}paintSettings();}
   busy=c.status==='running';$('title').textContent=c.title;$('welcome').hidden=true;$('details-toggle').hidden=false;
   const activity=busy?c.live?.activity||'正在思考':null;
   const messageKey=JSON.stringify([c.messages,activity,c.live?.progress,c.status,c.management,c.tasks,c.delivery,c.acceptance,c.benchmarkChecks,c.decisions,c.nativeGoal,c.continuousGoal,c.goalBudget]);
   if(messageKey!==lastMessages){const expanded=new Map([...$('messages').querySelectorAll('details[data-evidence]')].map(d=>[d.dataset.evidence,d.open]));const area=$('conversation'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<90,initial=!lastMessages;lastMessages=messageKey;conversationView.update(c.messages,liveProgressView(c.live?.progress)+nativeGoalView(c)+managementView(c.management)+primaryTasksView(c.tasks)+deliveryView(c.delivery,c.acceptance)+benchmarkChecksView(c.benchmarkChecks)+strategyView(c.decisions,c.tasks),activity);for(const d of $('messages').querySelectorAll('details[data-evidence]'))if(expanded.has(d.dataset.evidence))d.open=expanded.get(d.dataset.evidence);if(nearBottom||initial)area.scrollTop=area.scrollHeight;}
   $('error').textContent=c.error||'';
  }
  updateSend();
 }catch(e){$('error').textContent=e.message;}finally{refreshing=false;}
}
function paintProjectGroups(chats,engineering){
  const rootPath=workspaceInfo.path||'',groups=new Map();
 const normalize=value=>String(value||rootPath).replace(/[\\/]+$/,'').toLocaleLowerCase();
 const nameOf=value=>String(value||rootPath||workspaceInfo.name).replace(/[\\/]+$/,'').split(/[\\/]/).at(-1)||workspaceInfo.name;
 const ensure=value=>{const key=normalize(value);if(!groups.has(key))groups.set(key,{path:value||rootPath,name:nameOf(value),rows:[]});return groups.get(key);};
  for(const chat of chats)if(chat.project&&!chat.pinned)ensure(chat.project).rows.push({kind:'chat',id:chat.id,title:chat.title,status:chat.status});
 for(const run of engineering)ensure(run.project).rows.push({kind:'engineering',id:run.id,title:run.title,status:run.status});
  const pinned=chats.filter(chat=>chat.pinned),loose=chats.filter(chat=>!chat.project&&!chat.pinned);
  const key=JSON.stringify([[...groups.values()].map(g=>[g.path,g.name,g.rows]),pinned.map(c=>[c.id,c.title,c.status]),loose.map(c=>[c.id,c.title,c.status]),current,managedId]);
 if(key===projectGroupsKey)return;projectGroupsKey=key;
 const folder='<span class="folder-icon" aria-hidden="true"><svg class="ui-icon folder-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg><svg class="ui-icon folder-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2"/><path d="M3.6 19.2 6 11.6A2 2 0 0 1 7.9 10H21a1 1 0 0 1 .96 1.28l-2.1 6.6A2 2 0 0 1 18 19.3H4a.9.9 0 0 1-.4-.1Z"/></svg></span>';
  renderChatRows($('pinned-chats'),pinned,'置顶');renderChatRows($('loose-chats'),loose,'');
  const container=$('project-groups');
  const projectGroups=[...groups.values()].sort((a,b)=>Number(localStorage.getItem('project-pinned:'+normalize(b.path))==='true')-Number(localStorage.getItem('project-pinned:'+normalize(a.path))==='true'));
  container.innerHTML=projectGroups.map(group=>{const storageKey='project-open:'+normalize(group.path),open=localStorage.getItem(storageKey)!=='false',pinned=localStorage.getItem('project-pinned:'+normalize(group.path))==='true';const rows=group.rows.map(row=>row.kind==='chat'?chatRowMarkup(row,true):`<button class="chat ${row.id===managedId?'selected':''}" data-engineering="${esc(row.id)}" title="${esc(row.title)}">${row.status==='running'?'<span class="running-dot" aria-hidden="true"></span>':''}<span class="chat-title">${esc(row.title)}</span></button>`).join('');return `<section class="project-group ${pinned?'pinned':''}" data-open="${open}"><div class="project-heading"><button class="project project-toggle" data-project-path="${esc(group.path)}" aria-expanded="${open}" title="${esc(group.path)}">${folder}<span class="button-label">${esc(group.name)}</span></button><button class="project-actions" data-project-menu="${esc(group.path)}" aria-label="${esc(group.name)} 项目操作" aria-haspopup="menu" title="项目操作">···</button></div><div class="project-items"><div class="project-items-inner">${rows}</div></div></section>`;}).join('');
 container.querySelectorAll('[data-project-path]').forEach(button=>button.onclick=()=>{const group=button.closest('.project-group'),open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));group.dataset.open=String(open);localStorage.setItem('project-open:'+normalize(button.dataset.projectPath),String(open));});
 container.querySelectorAll('[data-project-menu]').forEach(button=>button.onclick=event=>{event.stopPropagation();showProjectMenu(button.dataset.projectMenu,event,button.closest('.project-group'));});
  bindChatRows(container);bindChatRows($('pinned-chats'));bindChatRows($('loose-chats'));
 container.querySelectorAll('[data-engineering]').forEach(button=>button.onclick=()=>{resetTaskMode();managedId=button.dataset.engineering;current=null;managedKey='';void refresh();});
}
function chatRowMarkup(chat,project=false){return `<div class="chat-entry ${project?'project-chat':''}"><button class="chat ${chat.id===current?'selected':''} ${chat.pinned?'pinned':''}" data-chat="${esc(chat.id)}" title="${esc(chat.title)}">${chat.status==='running'?'<span class="running-dot" aria-hidden="true"></span>':''}<span class="chat-title">${esc(chat.title)}</span></button><button class="chat-actions" data-chat-menu="${esc(chat.id)}" aria-label="${esc(chat.title)} 的操作" aria-haspopup="menu" title="对话操作">···</button></div>`;}
function renderChatRows(container,chats,label){container.innerHTML=(chats.length&&label?`<div class="sidebar-subsection">${esc(label)}</div>`:'')+chats.map(chat=>chatRowMarkup(chat)).join('');}
function bindChatRows(container){container.querySelectorAll('[data-chat]').forEach(button=>button.onclick=()=>{resetTaskMode();managedId=null;managedKey='';projectChoice=null;paintProject();current=button.dataset.chat;lastMessages='';$('error').textContent='';void refresh();});container.querySelectorAll('[data-chat-menu]').forEach(button=>{button.onclick=event=>{event.stopPropagation();showChatMenu(button.dataset.chatMenu,event,button.closest('.chat-entry')?.querySelector('[data-chat]')?.title??'',button.closest('.chat-entry')?.querySelector('[data-chat]')?.classList.contains('pinned'));};button.closest('.chat-entry').oncontextmenu=event=>{event.preventDefault();showChatMenu(button.dataset.chatMenu,event,button.closest('.chat-entry')?.querySelector('[data-chat]')?.title??'',button.closest('.chat-entry')?.querySelector('[data-chat]')?.classList.contains('pinned'));};});}
function showChatMenu(id,event,title,pinned){const menu=$('chat-menu');menu.innerHTML=`<button role="menuitem" data-chat-action="pin">${pinned?'取消置顶':'置顶'}</button><div class="chat-menu-divider"></div><button role="menuitem" class="danger" data-chat-action="delete">删除对话</button>`;menu.hidden=false;const rect=menu.getBoundingClientRect(),x=Math.min(event.clientX,innerWidth-rect.width-8),y=Math.min(event.clientY,innerHeight-rect.height-8);menu.style.left=Math.max(8,x)+'px';menu.style.top=Math.max(8,y)+'px';menu.querySelector('[data-chat-action="pin"]').onclick=async()=>{closeChatMenu();try{await api.chatSetPinned(id,!pinned);projectGroupsKey='';await refresh();}catch(error){$('error').textContent=error.message;}};menu.querySelector('[data-chat-action="delete"]').onclick=async()=>{closeChatMenu();if(!confirm(`确定删除对话“${title}”？此操作无法撤销。`))return;try{await api.chatDelete(id);if(current===id)fresh();else{projectGroupsKey='';await refresh();}}catch(error){$('error').textContent=error.message;}};}
function showProjectMenu(path,event,group){const menu=$('chat-menu'),key=String(path||workspaceInfo.path).replace(/[\\/]+$/,'').toLocaleLowerCase(),pinned=localStorage.getItem('project-pinned:'+key)==='true',projectName=group?.querySelector('.button-label')?.textContent||String(path).split(/[\\/]/).at(-1)||'项目';menu.innerHTML=`<button role="menuitem" data-project-action="pin">${pinned?'取消置顶项目':'置顶项目'}</button><div class="chat-menu-divider"></div><button role="menuitem" class="danger" data-project-action="archive">归档项目</button>`;menu.hidden=false;const rect=menu.getBoundingClientRect(),x=Math.min(event.clientX,innerWidth-rect.width-8),y=Math.min(event.clientY,innerHeight-rect.height-8);menu.style.left=Math.max(8,x)+'px';menu.style.top=Math.max(8,y)+'px';menu.querySelector('[data-project-action="pin"]').onclick=()=>{closeChatMenu();localStorage.setItem('project-pinned:'+key,String(!pinned));projectGroupsKey='';void refresh();};menu.querySelector('[data-project-action="archive"]').onclick=async()=>{closeChatMenu();if(!confirm(`归档“${projectName}”会清除该项目关联的全部聊天记录（包括已置顶的对话），不会删除项目文件。此操作无法撤销，是否继续？`))return;try{const result=await api.chatArchiveProject(path);if(current&&result.deleted.includes(current))fresh();else{projectGroupsKey='';await refresh();}}catch(error){projectGroupsKey='';await refresh();$('error').textContent=error.message;}};}
function closeChatMenu(){$('chat-menu').hidden=true;}
document.addEventListener('click',event=>{if(!event.target.closest('#chat-menu')&&!event.target.closest('[data-chat-menu]')&&!event.target.closest('[data-project-menu]'))closeChatMenu();});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeChatMenu();});
async function history(){if(!$('details').hidden&&$('panel-title').textContent==='运行记录'){$('details').hidden=true;$('history').setAttribute('aria-expanded','false');return;}$('details').hidden=false;$('history').setAttribute('aria-expanded','true');$('panel-title').textContent='运行记录';$('agents-view').setAttribute('aria-expanded','false');$('report').textContent='';const data=await api.list();$('records').innerHTML=data.runs.map(r=>`<button data-run="${r.id}">${r.demo?'流程演示':['codex-master-v1','engineering-master-v1'].includes(r.policy)?'Master 管理':'规则管理'} · ${new Date(r.startedAt).toLocaleDateString()}<br>${r.accepted} / ${r.total} 已验收</button>`).join('')||'暂无运行记录';document.querySelectorAll('[data-run]').forEach(b=>b.onclick=async()=>{const d=await api.detail(b.dataset.run);$('report').textContent=d.report;});}
$('history').onclick=()=>void history();$('details-toggle').onclick=()=>{if(!$('details').hidden){$('details').hidden=true;return;}$('details').hidden=false;$('panel-title').textContent='对话详情';$('history').setAttribute('aria-expanded','false');$('agents-view').setAttribute('aria-expanded','false');$('records').textContent='当前对话使用独立 Codex 会话。';$('report').textContent='回复尚未经过外部验收。';};
function paintSettings(){
  $('worker-button').title='执行模型：'+(catalog.find(m=>m.id===workerOptions.model)?.name||workerOptions.model)+' · '+effortNames[workerOptions.effort];
  $('worker-button').setAttribute('aria-label',$('worker-button').title);
  $('model-label').textContent=(projectChoice?'Manager · ':'')+(catalog.find(m=>m.id===options.model)?.name||options.model)+' · '+effortNames[options.effort];
  $('permission-label').textContent=permissionNames[options.permission];$('permission-button').classList.toggle('elevated',options.permission==='danger-full-access');setIcon($('permission-icon'),options.permission==='danger-full-access'?'shield':options.permission==='read-only'?'eye':'edit');
  const delegation=options.delegation??{mode:'auto',count:10,maxWorkers:64};
  const cap=(delegation.maxWorkers??64)<64?' · 上限 '+delegation.maxWorkers:'';
  $('agents-label').textContent=delegation.mode==='off'?'子 Agent · 关闭':delegation.mode==='fixed'?'子 Agent · '+delegation.count+cap:'子 Agent · 自动'+cap;
  $('agents-button').dataset.mode=delegation.mode;
  for(const id of ['model','worker','permission','agents'])$(id+'-button').disabled=busy||sending||(Boolean(managedId)&&!(id==='agents'&&managedReady));
}
function closeMenu(focus=false){if(menu){const old=menu;menu=null;$('settings-popover').hidden=true;$(old+'-button').setAttribute('aria-expanded','false');if(focus)$(old+'-button').focus();}}
function choose(key,value){options[key]=value;localStorage.setItem('execution-options',JSON.stringify(options));paintSettings();}
function choice(value,title,description,selected){return `<button type="button" class="choice" role="menuitemradio" aria-checked="${selected}" data-value="${esc(value)}"><span class="choice-text">${esc(title)}${description?`<small>${esc(description)}</small>`:''}</span><span class="checkmark">${selected?'✓':''}</span></button>`;}
function openMenu(kind){if(menu===kind){closeMenu(true);return;}closeMenu();closeCapacity();menu=kind;const pop=$('settings-popover');pop.setAttribute('aria-label',kind==='worker'?'执行模型':'执行设置');$(kind+'-button').setAttribute('aria-expanded','true');
  if(kind==='worker'){
    pop.setAttribute('aria-label','执行模型');
    pop.innerHTML='<h2>执行模型</h2><button type="button" id="refresh-worker-models" class="setting">刷新模型</button><input id="worker-search" class="model-search" type="search" placeholder="搜索模型" aria-label="搜索执行模型"><div id="worker-models" role="menu"></div><div class="effort-section"><label for="worker-effort">推理强度</label><select id="worker-effort"></select></div><p class="menu-note">用于子 Agent 执行任务。</p>';
    const persist=()=>{localStorage.setItem('worker-options',JSON.stringify(workerOptions));paintSettings();};
    const paint=()=>{const query=$('worker-search').value.trim().toLowerCase(),models=catalog.filter(m=>(m.name+' '+m.id).toLowerCase().includes(query));$('worker-models').innerHTML=models.map(m=>choice(m.id,m.name,m.id,m.id===workerOptions.model)).join('')||'<p class="menu-note">没有匹配的模型</p>';const levels=catalog.find(m=>m.id===workerOptions.model)?.efforts||[];$('worker-effort').innerHTML=levels.map(e=>'<option value="'+esc(e)+'" '+(e===workerOptions.effort?'selected':'')+'>'+esc(effortNames[e])+'</option>').join('');$('worker-effort').disabled=!levels.length;$('worker-models').querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{const model=catalog.find(m=>m.id===b.dataset.value);workerOptions.model=model.id;if(!model.efforts.includes(workerOptions.effort))workerOptions.effort=model.efforts.includes('high')?'high':model.efforts[0];persist();paint();});};
    $('refresh-worker-models').onclick=async()=>{const button=$('refresh-worker-models');button.disabled=true;try{const fresh=await api.models();if(menu!=='worker')return;catalog=fresh;if(!catalog.some(m=>m.id===workerOptions.model&&m.efforts.includes(workerOptions.effort))){const first=catalog.find(m=>m.efforts.length);if(first)workerOptions={model:first.id,effort:first.efforts.includes('high')?'high':first.efforts[0]};}persist();paint();}catch(e){$('error').textContent=e.message;}finally{button.disabled=false;}};
    $('worker-search').oninput=paint;$('worker-effort').onchange=e=>{workerOptions.effort=e.target.value;persist();};paint();
  }else if(kind==='model'){
    const model=catalog.find(m=>m.id===options.model);const levels=model?.efforts||['high'];
    pop.innerHTML='<h2>'+(projectChoice?'Manager · 规划与管理':'模型')+'</h2><div role="menu">'+catalog.map(m=>choice(m.id,m.name,'',m.id===options.model)).join('')+'</div>'+`<div class="effort-section"><label for="effort">推理强度 <span id="effort-value">${effortNames[options.effort]}</span></label><input id="effort" type="range" min="0" max="${levels.length-1}" step="1" value="${Math.max(0,levels.indexOf(options.effort))}" aria-valuetext="${effortNames[options.effort]}"><div class="effort-labels"><span>更快</span><span>更深入</span></div></div>`;
    pop.querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{choose('model',b.dataset.value);const m=catalog.find(x=>x.id===options.model);if(!m.efforts.includes(options.effort))choose('effort',m.efforts.includes('high')?'high':m.efforts[0]);menu=null;openMenu('model');});
    $('effort').oninput=e=>{choose('effort',levels[Number(e.target.value)]);$('effort-value').textContent=effortNames[options.effort];e.target.setAttribute('aria-valuetext',effortNames[options.effort]);};
  }else if(kind==='permission'){
    pop.innerHTML='<h2>操作权限</h2><div role="menu">'+choice('read-only','只读','允许读取；禁止修改文件。',options.permission==='read-only')+choice('workspace-write','项目内编辑','可修改选定项目；未选择项目时使用独立对话目录。',options.permission==='workspace-write')+choice('danger-full-access','完全访问','可访问电脑文件与网络，不逐项询问。',options.permission==='danger-full-access')+'</div>';
    pop.querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{choose('permission',b.dataset.value);closeMenu(true);});
  }else{
    const d=options.delegation??{mode:'auto',count:10,maxWorkers:64};
    pop.innerHTML='<h2>子 Agent</h2><div role="menu">'+choice('off','关闭','由主 Agent 完成任务。',d.mode==='off')+choice('auto','自动','按任务需要决定是否使用子 Agent 及数量。',d.mode==='auto')+choice('fixed','固定数量','由主 Agent 分配任务。',d.mode==='fixed')+'</div>'+(d.mode==='fixed'?'<label>同时进行<input id="delegation-count" type="number" min="1" max="64" value="'+d.count+'"></label>':'')+(d.mode==='off'?'':'<label>本回合 Worker 上限<input id="delegation-max" type="number" min="1" max="64" value="'+(d.maxWorkers??64)+'"></label>');
    pop.querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{choose('delegation',{mode:b.dataset.value,count:d.count,maxWorkers:d.maxWorkers??64});choose('agents',0);menu=null;openMenu('agents');});
    pop.querySelector('#delegation-count')?.addEventListener('change',e=>{const count=Number(e.target.value);if(Number.isInteger(count)&&count>=1&&count<=64)choose('delegation',{mode:'fixed',count,maxWorkers:d.maxWorkers??64});else e.target.value=String(d.count);});
    pop.querySelector('#delegation-max')?.addEventListener('change',e=>{const maxWorkers=Number(e.target.value);if(Number.isInteger(maxWorkers)&&maxWorkers>=1&&maxWorkers<=64)choose('delegation',{mode:d.mode,count:d.count,maxWorkers});else e.target.value=String(d.maxWorkers??64);});
  }
  pop.hidden=false;const rect=$(kind+'-button').getBoundingClientRect();pop.style.left=Math.max(8,Math.min(rect.left,innerWidth-338))+'px';pop.style.bottom=(innerHeight-rect.top+8)+'px';if(kind==='worker')$('worker-search').focus();else pop.querySelector('button')?.focus();
}
for(const kind of ['model','worker','permission','agents'])$(kind+'-button').onclick=()=>openMenu(kind);
document.addEventListener('pointerdown',e=>{if(menu&&!e.target.closest('#settings-popover')&&!e.target.closest('.setting'))closeMenu();});
document.addEventListener('keydown',e=>{if(!menu)return;if(e.key==='Escape'){e.preventDefault();closeMenu(true);}if(['ArrowDown','ArrowUp'].includes(e.key)&&e.target.type!=='range'){const buttons=[...$('settings-popover').querySelectorAll('button')],index=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}});
window.addEventListener('resize',()=>closeMenu());
async function boot(){try{const [models,project]=await Promise.all([api.models(),api.projectInfo()]);catalog=models;workspaceInfo=project;const saved=JSON.parse(localStorage.getItem('execution-options')||'null');if(saved&&catalog.some(m=>m.id===saved.model&&m.efforts.includes(saved.effort))&&Object.hasOwn(permissionNames,saved.permission)&&[0,2,4].includes(saved.agents))options={...saved,agents:0,delegation:saved.delegation??{mode:'auto',count:10}};const workerSaved=JSON.parse(localStorage.getItem('worker-options')||'null');if(workerSaved&&catalog.some(m=>m.id===workerSaved.model&&m.efforts.includes(workerSaved.effort)))workerOptions=workerSaved;}catch(e){$('error').textContent=e.message;}paintSettings();fresh();setInterval(()=>void refresh(),800);}



let projectChoice=null,managedId=null,managedKey='';
const managedNames={planning:'正在读取项目并制定检查',ready:'计划待执行',running:'正在执行与检查',integrating:'正在检查合并结果',checks_passed:'已通过声明的检查',incomplete:'未完成验收',error:'执行异常',cancelled:'已停止',interrupted:'已中断'};
function paintProject(){paintSettings();$('project-label').textContent=projectChoice?.name||'选择项目';$('clear-project').hidden=!projectChoice;}
$('choose-project').onclick=async()=>{try{const result=await api.chooseProject();if(result){fresh();projectChoice=result;paintProject();$('prompt').placeholder='随心输入';}}catch(e){$('error').textContent=e.message;}};
$('clear-project').onclick=()=>{projectChoice=null;fresh();paintProject();$('prompt').placeholder='随心输入';};
function setGoalMode(enabled){resetTaskMode();goalMode=enabled;$('goal-mode').setAttribute('aria-pressed',String(enabled));$('prompt').placeholder=enabled?'描述要持续完成的目标':'随心输入';}
$('goal-mode').onclick=()=>setGoalMode(!goalMode);
async function refreshEngineering(){
 const list=await api.engineeringList();
 if(!managedId)return list;
 const id=managedId,r=await api.engineeringDetail(id);if(id!==managedId)return;busy=['planning','running','integrating'].includes(r.status);managedReady=r.status==='ready'&&!r.resumableRequested&&!r.historyOnly;$('welcome').hidden=true;$('title').textContent=r.goal.slice(0,45);$('details-toggle').hidden=true;
 if(r.persistentGoal){projectChoice={path:r.project,name:r.project.split(/[\\/]/).at(-1)};options={...r.options};if(r.options.worker)workerOptions={...r.options.worker};paintProject();setGoalMode(true);renderPersistentGoal(r);return list;}
 if(r.resumable){projectChoice={path:r.project,name:r.project.split(/[\\/]/).at(-1)};options={...r.options};const worker=Object.values(r.workers||{}).find(w=>w.backend==='codex');if(worker)workerOptions={model:worker.model,effort:worker.effort};paintProject();renderResumableEngineering(r);return list;}
 projectChoice={path:r.project,name:r.project.split(/[\\/]/).at(-1)};paintProject();
 if(!managedKey){options={...r.options};workerOptions={...(r.execution?.worker||r.workerOptions||{model:r.options.model,effort:r.options.effort})};taskOverrides={...(r.execution?.tasks||{})};candidateCount=r.execution?.candidates??2;paintSettings();}
 const stateKey=JSON.stringify(r);if(stateKey!==managedKey){managedKey=stateKey;
 const openDetails=new Set([...$('messages').querySelectorAll('details[open]')].map(e=>e.dataset.evidence));
 const tasks=r.plan?.tasks|| (r.plan?[{id:'implementation',goal:r.plan.summary,dependsOn:[],outputs:r.plan.outputs,acceptance:r.plan.acceptance,testSource:r.plan.testSource}]:[]);
 const names={pending:'等待依赖',running:'执行中',checking:'检查中',deciding:'管理器决策中',accepted:'检查通过',failed:'检查失败',error:'执行异常',blocked:'依赖未通过',cancelled:'已停止',timeout:'已超时',unverified:'未完成检查',pass:'通过',fail:'失败',not_checked:'未检查',completed:'执行结束'};
 const checkText=report=>report?.checks.map(c=>c.id+': '+(names[c.status]||c.status)+'\n'+c.detail).join('\n')||'';
 const taskHtml=tasks.map(t=>{
   const state=r.team?.tasks?.[t.id];
   return `<details data-evidence="task-${esc(t.id)}"><summary>${esc(t.goal)} · ${esc(state?names[state.status]||state.status:'待执行')}</summary><p>${t.dependsOn.length?'依赖：'+t.dependsOn.map(esc).join('、'):'可独立执行'}<br>交付：${t.outputs.map(esc).join('、')}</p>${r.status==='ready'&&!r.resumableRequested?`<div class="task-model"><label><input type="checkbox" data-task-model="${esc(t.id)}" ${taskOverrides[t.id]?'checked':''}> 单独设置 Worker</label><div data-task-fields="${esc(t.id)}" ${taskOverrides[t.id]?'':'hidden'}>${modelFields(t.id,taskOverrides[t.id]||workerOptions)}</div></div>`:`<p>Worker：${esc((r.execution?.tasks?.[t.id]||r.execution?.worker||r.workerOptions||r.options).model)} · ${esc(effortNames[(r.execution?.tasks?.[t.id]||r.execution?.worker||r.workerOptions||r.options).effort])}</p>`}<ul>${t.acceptance.map(a=>`<li>${esc(a)}</li>`).join('')}</ul><details data-evidence="test-${esc(t.id)}"><summary>任务验收测试</summary><pre>${esc(t.testSource)}</pre></details>${state?.candidates?`<p>${state.selectedCandidate?'入选：'+esc(state.selectedCandidate):'比较候选中'}</p>${Object.entries(state.candidates).map(([key,c])=>`<details data-evidence="candidate-${esc(t.id)}-${esc(key)}"><summary>${esc(key)} · ${esc(names[c.status]||c.status)}</summary>${c.attempts.map(a=>`<pre>${esc(checkText(a.report)||a.worker.detail||'等待检查')}</pre>`).join('')}${c.reason?`<p>${esc(c.reason)}</p>`:''}</details>`).join('')}`:''}${(state?.attempts||[]).map((a,i)=>`<details data-evidence="attempt-${esc(t.id)}-${i}"><summary>第 ${i+1} 次执行 · ${esc(names[a.report?.checks.find(c=>c.id==='node-tests')?.status||a.worker.status]||a.worker.status)}</summary><pre>${esc(checkText(a.report)||a.worker.detail||'等待检查')}</pre></details>`).join('')}${state?.reason?`<p>${esc(state.reason)}</p>`:''}</details>`;
 }).join('');
 $('messages').innerHTML=`<div class="message user">${esc(r.goal)}</div><div class="message assistant"><p>${esc(managedNames[r.status]||r.status)}</p>${r.plan?`${r.status==='ready'?`<p>${esc(r.plan.summary)}</p><p>${tasks.length} 个任务 · Manager 已分配</p>`:''}<ul>${r.plan.acceptance.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>${taskHtml}<details data-evidence="overall"><summary>整体验收与范围</summary><p>原项目保持不变，已有测试冻结。全部任务通过后，合并产物重跑所有任务测试及以下整体测试。</p><pre>${esc(r.plan.testSource)}</pre><p>${r.plan.limitations.map(esc).join('\n')}</p></details>`:''}${r.status==='ready'&&r.resumableRequested?'<p>以下测试是 Manager 提案。请逐项核对需求、边界情况及测试覆盖；批准后冻结，Worker 无权修改验收标准。</p><button id="execute-plan" class="primary-action">批准以上需求与测试的覆盖并执行</button>':''}${r.integration?`<details data-evidence="integration"><summary>合并检查 · ${esc(names[r.integration.checks[0]?.status]||'未知')}</summary><pre>${esc(checkText(r.integration))}</pre></details>`:''}${r.status==='checks_passed'?'<p>通过声明的检查；交付文件尚未覆盖原项目。</p><button id="open-delivery" class="primary-action">打开交付文件</button>':''}${r.status==='incomplete'&&r.integration?'<p class="failure">合并结果未通过验收，未生成交付。请查看合并检查。</p>':''}${r.historyOnly?'<p>旧版本记录，仅能查看历史。</p>':''}${r.error?`<p class="failure">${esc(r.error)}</p>`:''}</div>`;
 for(const detail of $('messages').querySelectorAll('details'))if(openDetails.has(detail.dataset.evidence))detail.open=true;
 document.querySelectorAll('[data-task-model]').forEach(box=>{const task=box.dataset.taskModel,fields=document.querySelector('[data-task-fields="'+task+'"]');box.onchange=()=>{fields.hidden=!box.checked;if(box.checked){taskOverrides[task]={...workerOptions};fields.innerHTML=modelFields(task,taskOverrides[task]);bindModelFields(fields,task,taskOverrides[task],()=>{});}else delete taskOverrides[task];};if(taskOverrides[task])bindModelFields(fields,task,taskOverrides[task],()=>{});});
 if($('candidate-count')){$('candidate-count').value=String(candidateCount);$('candidate-count').onchange=e=>{candidateCount=Number(e.target.value);};}
 $('execute-plan')?.addEventListener('click',async()=>{$('execute-plan').disabled=true;try{await api.engineeringApprove(id,r.approvalHash);managedKey='';await refresh();}catch(e){$('error').textContent=e.message;if($('execute-plan'))$('execute-plan').disabled=false;}});
 $('open-delivery')?.addEventListener('click',async()=>{try{await api.engineeringFolder(id);}catch(e){$('error').textContent=e.message;}});
 }
 updateSend();
 return list;
}
void boot();

$('messages').addEventListener('click',async event=>{const link=event.target.closest('[data-message-link]');if(!link)return;event.preventDefault();if(!current)return;try{await api.chatOpenLink(current,link.dataset.messageLink);}catch(error){$('error').textContent=error.message;}});

function modelFields(key,selection){const model=catalog.find(m=>m.id===selection.model);return `<label>模型<select data-model="${esc(key)}">${catalog.map(m=>`<option value="${esc(m.id)}" ${m.id===selection.model?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label>推理强度<select data-effort="${esc(key)}">${(model?.efforts||[selection.effort]).map(e=>`<option value="${esc(e)}" ${e===selection.effort?'selected':''}>${esc(effortNames[e])}</option>`).join('')}</select></label>`;}
function bindModelFields(container,key,selection,changed){const model=container.querySelector('[data-model="'+key+'"]'),effort=container.querySelector('[data-effort="'+key+'"]');model.onchange=()=>{selection.model=model.value;const levels=catalog.find(m=>m.id===model.value).efforts;if(!levels.includes(selection.effort))selection.effort=levels.includes('high')?'high':levels[0];effort.innerHTML=levels.map(e=>`<option value="${esc(e)}" ${e===selection.effort?'selected':''}>${esc(effortNames[e])}</option>`).join('');changed();};effort.onchange=()=>{selection.effort=effort.value;changed();};}

// Navigation stays local; opening a panel never starts a model session.
function filterChats(){const query=$('chat-search').value.trim().toLocaleLowerCase();document.querySelectorAll('.chat').forEach(button=>{button.hidden=!button.textContent.toLocaleLowerCase().includes(query);});}
$('search-toggle').onclick=()=>{const open=$('chat-search').hidden;$('chat-search').hidden=!open;$('search-toggle').setAttribute('aria-expanded',String(open));if(open)$('chat-search').focus();else{$('chat-search').value='';filterChats();}};
$('chat-search').oninput=filterChats;
new MutationObserver(filterChats).observe($('project-groups'),{childList:true,subtree:true});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('search-toggle').click();}if(event.key==='Escape'&&!$('chat-search').hidden){$('search-toggle').click();}});
let agentsLoading=false;
async function refreshAgents(){if($('details').hidden||$('panel-title').textContent!=='运行中的 Agent'||agentsLoading)return;agentsLoading=true;try{const [chats,engineering]=await Promise.all([api.chatList(),api.engineeringList()]);if($('details').hidden||$('panel-title').textContent!=='运行中的 Agent')return;const rows=[...chats.filter(x=>x.status==='running').map(x=>({name:x.title,role:'Codex 会话'})),...engineering.filter(x=>['planning','running','integrating'].includes(x.status)).map(x=>({name:x.title,role:'Manager · '+(managedNames[x.status]||x.status)}))];$('records').innerHTML=rows.length?rows.map(x=>'<article class="agent-row"><span class="live-dot"></span><div><strong>'+esc(x.name)+'</strong><small>'+esc(x.role)+'</small></div></article>').join(''):'<div class="panel-empty">当前没有运行中的 Agent</div>'; }catch(e){$('report').textContent=e.message;}finally{agentsLoading=false;}}
$('agents-view').onclick=()=>{const open=$('details').hidden||$('panel-title').textContent!=='运行中的 Agent';$('details').hidden=!open;$('agents-view').setAttribute('aria-expanded',String(open));$('history').setAttribute('aria-expanded','false');if(open){$('panel-title').textContent='运行中的 Agent';$('records').textContent='正在读取…';$('report').textContent='';void refreshAgents();}};
setInterval(()=>void refreshAgents(),1500);

const capacityButton=document.getElementById('capacity-button');
function renderCapacity(panel,accounts,updating=false){
 panel.replaceChildren();
 for(const a of accounts){
  const h=document.createElement('h3');h.textContent=a.backend==='codex'?'Codex':'Command Code · DeepSeek';panel.append(h);
  if(!a.available){const p=document.createElement('p');p.textContent='账户信息暂不可用';panel.append(p);continue;}
  if(a.backend==='commandcode'){
   const credits=a.data?.credits?.monthlyCredits;
   const balance=document.createElement('p');balance.textContent=`Credits 余额：${typeof credits==='number'?credits.toFixed(2):'暂不可用'}`;panel.append(balance);
   for(const [name,w] of Object.entries(a.data?.windows??{}))if(w&&typeof w==='object'&&'cap' in w){
    const used=Number(w.used),cap=Number(w.cap),remaining=Number.isFinite(used)&&Number.isFinite(cap)&&cap>0?Math.max(0,Math.min(100,(cap-used)/cap*100)):null;
    const row=document.createElement('p');row.className='capacity-usage';row.textContent=`${name==='fiveHour'?'5 小时窗口':name==='weekly'?'每周窗口':name}：${remaining===null?'暂不可用':`剩余 ${remaining.toFixed(1)}%`}`;panel.append(row);
    if(remaining!==null){const detail=document.createElement('small');detail.textContent=`已用 ${used.toFixed(2)} / ${cap} credits`;panel.append(detail);}
   }
  }else{
   const limits=a.data?.rateLimits;
   const windows=[limits?.primary,limits?.secondary].filter(Boolean);
   for(const [index,w] of windows.entries())if(typeof w.usedPercent==='number'){
    const minutes=Number(w.windowDurationMins);
    const label=minutes===300?'5 小时窗口':minutes===10080?'每周窗口':Number.isFinite(minutes)&&minutes>0?`${minutes%1440===0?minutes/1440+' 天':minutes%60===0?minutes/60+' 小时':minutes+' 分钟'}窗口`:`用量窗口 ${index+1}`;
    const remaining=Math.max(0,Math.min(100,100-w.usedPercent));
    const row=document.createElement('p');row.className='capacity-usage';row.textContent=`${label}：剩余 ${remaining.toFixed(0)}%`;panel.append(row);
   }
   if(!windows.length){const p=document.createElement('p');p.textContent='服务未提供用量窗口';panel.append(p);}
  }
  const time=document.createElement('small');time.textContent=`更新于 ${new Date(a.observedAt).toLocaleTimeString()}`;panel.append(time);
 }
 if(updating){const status=document.createElement('small');status.className='capacity-refreshing';status.textContent='正在更新…';panel.append(status);}
}
window.manager.onAccountCapacityUpdated(accounts=>{const panel=document.getElementById('capacity-panel');if(panel)renderCapacity(panel,accounts);});
function closeCapacity(focus=false){
 const panel=$('capacity-panel');if(!panel)return;
 panel.remove();capacityButton.setAttribute('aria-expanded','false');if(focus)capacityButton.focus();
}
function positionCapacity(panel){
 const rect=capacityButton.getBoundingClientRect();
 panel.style.left=Math.max(8,Math.min(rect.right+12,innerWidth-panel.offsetWidth-8))+'px';
 panel.style.bottom=Math.max(8,innerHeight-rect.bottom)+'px';
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#capacity-panel, #capacity-button'))closeCapacity();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('capacity-panel')){event.preventDefault();closeCapacity(true);}});
window.addEventListener('resize',()=>{const panel=$('capacity-panel');if(panel)positionCapacity(panel);});
capacityButton.addEventListener('click',async()=>{
 if($('capacity-panel')){closeCapacity();return;}
 closeMenu();capacityButton.setAttribute('aria-expanded','true');const panel=document.createElement('section');panel.id='capacity-panel';panel.className='capacity-panel';panel.setAttribute('role','region');panel.setAttribute('aria-label','账户容量');panel.textContent='正在读取账户…';document.body.append(panel);positionCapacity(panel);
 try{const accounts=await window.manager.accountCapacity();if(panel.isConnected)renderCapacity(panel,accounts);}catch{if(panel.isConnected)panel.textContent='账户读取失败，关闭后重试。';}
});

let poolTimer;
document.getElementById('pool-button').onclick=()=>{
 const old=document.getElementById('pool-panel');if(old){clearTimeout(poolTimer);old.remove();return;}
 const panel=document.createElement('section');panel.id='pool-panel';panel.className='capacity-panel';panel.innerHTML='<h3>子 Agent 队列</h3><p>独立会话 · 只读任务</p><label>后端<select id="pool-backend"><option value="codex">Codex · Sol / 中</option><option value="commandcode">Command Code · DeepSeek / 高</option><option value="mixed">混合分配</option></select></label><label>同时运行<input id="pool-limit" type="number" min="1" max="64" value="2"></label><label>每行一个独立任务<textarea id="pool-prompts" rows="5"></textarea></label><button id="pool-start">加入队列</button> <button id="pool-stop">停止</button><p id="pool-status" role="status"></p><div id="pool-results"></div>';document.body.append(panel);
 const status=panel.querySelector('#pool-status');
 async function update(){if(!panel.isConnected)return;try{const s=await api.poolSnapshot();status.textContent=s?`运行 ${s.active.codex+s.active.commandcode} · 排队 ${s.queued} · 已返回 ${Object.keys(s.results).length}`:'尚无任务';const list=panel.querySelector('#pool-results');list.replaceChildren();for(const [id,r] of Object.entries(s?.results??{})){const d=document.createElement('details'),summary=document.createElement('summary'),p=document.createElement('p');summary.textContent='任务 '+(Number(id)+1)+' · '+r.status;p.textContent=r.text||r.detail||'';d.append(summary,p);list.append(d);}}catch(e){status.textContent=e.message;}poolTimer=setTimeout(update,1500);}
 panel.querySelector('#pool-start').onclick=async()=>{try{const backend=panel.querySelector('#pool-backend').value;const jobs=panel.querySelector('#pool-prompts').value.split('\n').filter(s=>s.trim()).map((prompt,i)=>({prompt,backend:backend==='mixed'?(i%2?'commandcode':'codex'):backend}));await api.poolStart({jobs,concurrency:Number(panel.querySelector('#pool-limit').value)});}catch(e){status.textContent=e.message;}};
 panel.querySelector('#pool-stop').onclick=()=>api.poolStop();void update();
};

function managementView(state){
 if(!state)return '';
 const names={planning:'Manager 正在决策',delegating:'子 Agent 执行中',working:'主 Agent 执行中',completed:'已结束',incomplete:'未完成验收',error:'执行异常',cancelled:'已停止',running:'执行中',queued:'等待执行',submitted:'已提交',challenging:'独立挑战中',verifying:'验证中',repairing:'正在修复',needs_repair:'需修复',accepted:'已通过声明的验收',unverified:'未验证',checks_failed:'产物检查失败'};
 const verdict=state.acceptance;const labels={pending:'等待检查',checking:'检查中',accepted:'已通过声明检查',rejected:'存在反例',unverified:'未验证',blocked:'阻塞 / 失败',not_applicable:'回复完成 · 验收不适用'};
 const acceptance=verdict?`<div class="acceptance-status" data-status="${esc(verdict.status)}"><strong>${esc(labels[verdict.status]||verdict.status)}</strong>${verdict.candidateId?`<small>候选 ${esc(verdict.candidateId.slice(0,8))}</small>`:''}<details><summary>检查证据与范围</summary><p>${esc(verdict.detail)}</p>${verdict.uncovered.map(x=>`<p>未覆盖：${esc(x)}</p>`).join('')}${verdict.evidence?renderMessage('[验收证据](<'+verdict.evidence.replaceAll('\\','/')+'>)'):''}</details></div>`:'<p>历史记录 · 未提供版本绑定的验收证据</p>';
 return `<section class="management-progress">${acceptance}<p>${esc(names[state.phase]||state.phase)} · 第 ${state.round+1} 轮</p>${state.decisions.map(d=>`<details><summary>${esc(d.action==='delegate'?'分配 '+d.tasks.length+' 个任务':d.action==='work'?'由主 Agent 执行':'结束')} · ${esc(d.reason)}</summary>${d.tasks.map(t=>`<p>${esc(t.id)} · ${esc(t.backend)} — ${esc(t.goal)}</p>`).join('')}</details>`).join('')}${state.tasks.map(t=>`<details><summary>${esc(t.id)} · ${esc(t.backend)} · ${esc(names[t.status]||t.status)}</summary><details><summary>Worker 自述（未经认证）</summary><p>${esc(t.reply)}</p></details>${t.acceptance?`<p>${esc(labels[t.acceptance.status]||t.acceptance.status)} · ${esc(t.acceptance.detail)}</p>`:''}${t.validation?`<ul>${t.validation.contract.acceptance.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>${t.validation.attempts.map(v=>`<details><summary>版本 ${v.version} · ${esc(v.status==='accepted'?'挑战重放通过（非功能认证）':names[v.status]||v.status)}</summary>${v.checks.map(c=>`<p>${esc(c.criterion)} · ${esc(c.status)}</p><pre>${esc(c.detail)}</pre>`).join('')}<small>产物 ${esc(v.artifactHash.slice(0,12))} · 检查 ${esc(v.verifierHash.slice(0,12))}</small></details>`).join('')}${t.validation.limitations.map(l=>`<p>未覆盖：${esc(l)}</p>`).join('')}${t.validation.error?`<p>${esc(t.validation.error)}</p>`:''}`:''}${t.checks.map(c=>`<p>${esc(c.path)} · ${esc(c.status)} · ${esc(c.detail)}</p>`).join('')}</details>`).join('')}</section>`;
}

function renderResumableEngineering(r){
 busy=['running','checking','integrating','pausing'].includes(r.status);managedReady=false;
 const labels={ready:'待执行',running:'执行中',paused:'已暂停',interrupted:'执行已中断',blocked:'恢复或验收受阻',completed:'已通过批准的检查',rejected:'集成检查失败',cancelled:'已取消'};
 const key=JSON.stringify(r);if(key===managedKey)return;managedKey=key;
 const open=new Set([...$('messages').querySelectorAll('details[open]')].map(x=>x.dataset.evidence));
 $('messages').innerHTML=`<div class="message user">${esc(r.goal)}</div><div class="message assistant"><p>${esc(labels[r.status]||r.status)}</p><p>${r.calls} 次模型调用 · ${r.checks} 次检查 · 截止 ${esc(new Date(r.deadline).toLocaleString())}</p>${r.reason?`<p>${esc(r.reason)}</p>`:''}<div class="run-actions">${busy?'<button id="pause-run" class="primary-action">暂停</button>':['ready','paused','interrupted'].includes(r.status)?'<button id="resume-run" class="primary-action">恢复同一任务</button>':''}${!['completed','cancelled'].includes(r.status)?'<button id="cancel-run" class="primary-action">取消任务</button>':''}${r.status==='completed'?'<button id="run-delivery" class="primary-action">打开交付文件</button>':''}</div>${Object.entries(r.nodes).map(([id,e])=>`<details data-evidence="${esc(id)}"><summary>${esc(id)} · ${esc(e.status)}</summary><p>${esc(e.acceptance?.detail||'')}</p><pre>${esc(JSON.stringify({candidate:e.functional?.candidate.snapshot,requirements:e.contract?.acceptance,checks:e.functional?.report},null,2))}</pre></details>`).join('')}<details data-evidence="events"><summary>最近执行事件</summary><pre>${esc(r.events.slice(-15).map(e=>e.at+' '+e.type).join('\n'))}</pre></details></div>`;
 for(const d of $('messages').querySelectorAll('details'))if(open.has(d.dataset.evidence))d.open=true;
 for(const [button,fn] of [['pause-run',()=>api.engineeringPause()],['resume-run',()=>api.engineeringResume(r.id)],['cancel-run',()=>api.engineeringCancel(r.id)],['run-delivery',()=>api.engineeringFolder(r.id)]])$(button)?.addEventListener('click',async()=>{ $(button).disabled=true;try{await fn();managedKey='';await refresh();}catch(e){$('error').textContent=e.message;$(button).disabled=false;} });updateSend();
}

function renderPersistentGoal(r){
 busy=['running','pausing'].includes(r.status);const key=JSON.stringify(r);if(key===managedKey){updateSend();return;}managedKey=key;
 const labels={ready:'待执行',running:'持续推进中',pausing:'等待当前轮结束后暂停',paused:'已暂停',interrupted:'可从已保存进度恢复',completed:'已通过目标验收',incomplete:'未完成验收',blocked:'需要处理阻塞',cancelled:'已取消'};
 $('messages').innerHTML=`<div class="message user">${esc(r.goal)}</div><div class="message assistant"><p>${esc(labels[r.status]||r.status)}</p><p>${r.rounds.length} / ${r.limits.rounds} 轮 · ${r.calls} / ${r.limits.calls} 次模型调用 · ${r.checks} 次检查</p><small>截止 ${esc(new Date(r.deadline).toLocaleString())}</small>${r.reason?`<p>${esc(r.reason)}</p>`:''}<div class="run-actions">${busy?'<button id="goal-pause" class="primary-action">本轮结束后暂停</button>':['ready','paused','interrupted'].includes(r.status)?'<button id="goal-resume" class="primary-action">继续目标</button>':''}${!['completed','cancelled'].includes(r.status)?'<button id="goal-cancel" class="primary-action">取消</button>':''}${r.status==='completed'?'<button id="goal-files" class="primary-action">打开交付文件</button>':''}</div>${r.rounds.map((round,i)=>`<details><summary>第 ${i+1} 轮 · ${esc(round.decision.reason)}</summary><p>并发 ${round.decision.concurrency} · ${esc(round.decision.action)}</p>${round.decision.tasks.map(t=>`<p>${esc(t.id)} · ${esc(t.backend)} — ${esc(t.goal)}</p>`).join('')}</details>`).join('')}${r.tasks.map(t=>`<details><summary>${esc(t.id)} · ${esc(t.backend)} · ${esc(t.status)}</summary><p>${esc(t.acceptance?.detail||'等待证据')}</p><p>未覆盖：${esc(t.acceptance?.uncovered?.join('；')||'无记录')}</p></details>`).join('')}</div>`;
 for(const [button,fn] of [['goal-pause',()=>api.engineeringPause()],['goal-resume',()=>api.engineeringResume(r.id)],['goal-cancel',()=>api.engineeringCancel(r.id)],['goal-files',()=>api.engineeringFolder(r.id)]])$(button)?.addEventListener('click',async()=>{ $(button).disabled=true;try{await fn();managedKey='';await refresh();}catch(e){$('error').textContent=e.message;$(button).disabled=false;} });updateSend();
}

function paintAttachments(){renderAttachmentCards($('attachments'),attachments,path=>{attachments=attachments.filter(p=>p!==path);paintAttachments();});}

function primaryTasksView(tasks){
 const labels={running:'执行中',completed:'执行结束 · 待验证',error:'执行失败',timeout:'执行超时',cancelled:'已停止',interrupted:'执行中断',transport:'连接失败','rate-limited':'服务限流',quota:'额度不足',auth:'登录失效'};
 return (tasks||[]).map(t=>{
  const history=t.history?.length?t.history:[{attempt:t.attempt||1,prompt:t.prompt,status:t.status,result:t.result,logs:t.logs}];
  return '<details class="management-progress" data-evidence="primary-'+esc(t.id)+'"><summary>'+esc(t.backend)+' · '+esc(labels[t.status]||t.status)+' · '+esc((t.prompt||'').slice(0,70))+'</summary>'+(t.contract?'<details data-evidence="contract-'+esc(t.id)+'"><summary>任务要求</summary><p>'+esc(t.contract.goal)+'</p><ul>'+t.contract.acceptance.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p>交付：'+t.contract.outputs.map(esc).join('、')+'</p></details>':'')+'<p>共 '+history.length+' 次执行；执行记录不代表验收通过。</p>'+history.map(a=>'<details data-evidence="primary-'+esc(t.id)+'-'+a.attempt+'"><summary>第 '+a.attempt+' 次 · '+esc(labels[a.status]||a.status)+'</summary><p>'+esc(a.prompt||'')+'</p>'+(a.model?'<p>'+esc(a.model)+' · '+esc(a.effort||'')+'</p>':'')+(a.startedAt?'<p>开始：'+esc(new Date(a.startedAt).toLocaleString())+(a.finishedAt?' · 结束：'+esc(new Date(a.finishedAt).toLocaleString()):'')+'</p>':'')+'<pre>'+esc([a.result?.text,a.result?.detail].filter(Boolean).join('\n')||'等待执行结果')+'</pre>'+(a.submission?'<p>'+esc(a.submission.status==='captured'?'已保存候选快照（未验收）':'未能保存完整候选')+'</p><p>'+esc(a.submission.artifactHash||a.submission.detail||'')+'</p>':'')+'<p>记录位置：'+esc(a.logs||'未记录')+'</p></details>').join('')+'</details>';
 }).join('');
}

function deliveryView(state,finalAcceptance){
 if(!state?.contract)return '';
 const labels={pending:'等待提交检查',checking:'正在验收',accepted:'通过已声明的验收',rejected:'检查未通过，需要修复',unverified:'尚未充分验证',blocked:'验收受阻'};
 const verdict=finalAcceptance||state.acceptance;
 return '<section class="management-progress">'+(state.inheritedFrom?'<p>继续上次交付 · 当前产物重新验收</p>':'')+(state.previous?'<details data-evidence="delivery-previous"><summary>上次交付 · 历史结果</summary><p>'+esc(state.previous.goal)+'</p><p>'+esc(state.previous.acceptance.detail)+'</p><p>历史结果不代表当前文件已通过验收。</p></details>':'')+'<strong>'+esc(labels[verdict.status]||verdict.status)+'</strong><p>'+esc(verdict.detail)+'</p><details data-evidence="delivery-contract"><summary>交付要求</summary><ul>'+state.contract.acceptance.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p>文件：'+state.contract.outputs.map(esc).join('、')+'</p></details>'+state.versions.map(v=>'<details data-evidence="delivery-version-'+v.version+'"><summary>候选 '+v.version+' · '+esc(labels[v.acceptance.status]||v.acceptance.status)+'</summary><p>'+esc(v.acceptance.detail)+'</p>'+(v.review?.checks||[]).map(c=>'<p>'+esc(c.criterion)+' · '+esc(({pass:'通过',fail:'未通过',error:'检查异常',not_checked:'未检查'})[c.status]||c.status)+'</p>'+(c.detail?'<pre>'+esc(c.detail)+'</pre>':'')).join('')+(v.functional?.report?.checks||[]).map(c=>'<p>外部检查 '+esc(c.id)+' · '+esc(({pass:'通过',fail:'未通过',error:'检查异常',not_checked:'未检查'})[c.status]||c.status)+'</p>'+(c.detail?'<pre>'+esc(c.detail)+'</pre>':'')).join('')+'<p>未覆盖：'+esc(v.acceptance.uncovered.join('；')||'无记录')+'</p></details>').join('')+'</section>';
}

function benchmarkChecksView(checks){
 const labels={verified:'公开检查通过',rejected:'公开检查未通过',error:'验证异常',checking:'正在验证',interrupted:'验证已中断'};
 return (checks||[]).map(c=>'<details class="management-progress" data-evidence="hwe-'+esc(c.id)+'"><summary>HWE · '+esc(labels[c.status]||c.status)+'</summary><p>仅代表固定工具链下的公开检查结果。</p>'+(c.evidence?.metrics?'<p>iter/s：'+esc(c.evidence.metrics.fitness)+' · Fmax：'+esc(c.evidence.metrics.fmax_mhz)+' MHz · LUT4：'+esc(c.evidence.metrics.lut4)+' · 周期：'+esc(c.evidence.metrics.cycles)+'</p>':'')+'<p>'+esc(c.detail||c.evidence?.detail||'')+'</p><p>候选指纹：'+esc(c.sha256||'尚未生成')+'</p>'+(c.evidence?.limitations||[]).map(x=>'<p>范围限制：'+esc(x)+'</p>').join('')+'</details>').join('');
}

function strategyView(decisions,tasks=[]){
 if(!decisions?.length)return '';
 const labels={select:'保留候选',discard:'淘汰候选',continue:'继续实验'};
 const states={pending:'等待名额',launching:'正在登记',dispatched:'已派发',blocked:'派发受阻',cancelled:'已取消',interrupted:'中断待核对',running:'执行中',completed:'执行结束 · 待验证',error:'执行失败',timeout:'执行超时',transport:'连接失败',quota:'额度不足','rate-limited':'服务限流',auth:'登录失效'};
 return '<section class="management-progress"><h3>Manager 决策</h3><p>以下记录对应决策当时的公开检查，不代表整个任务已验收。</p>'+decisions.map(d=>{
  const allocations=d.execution?.allocations||[];
  return '<details data-evidence="decision-'+esc(d.id)+'"><summary>'+esc(labels[d.action]||d.action)+' · '+esc(d.reason)+'</summary>'+(d.historyOnly?'<p>历史决策 · 继续前需要重新核验证据</p>':'')+'<p>'+esc(d.at)+'</p><p>证据：'+esc((d.evidenceIds||[]).join(', '))+'</p>'+(d.selectedId?'<p>保留：'+esc(d.selectedId)+'</p>':'')+(d.selection?'<p>'+esc(d.selection.status==='stale'?'交付前复核：候选已失效':'交付前复核：当时的候选与证据一致')+'</p><p>'+esc(d.selection.detail)+'</p>':'')+(d.nextExperiment?'<p>下一步'+(allocations.length?'实验':'计划（尚未启动）')+'：'+esc(d.nextExperiment)+'</p>':'')+(allocations.length?'<p>计划 '+allocations.length+' 个 Worker · 总执行时限 '+esc(d.execution.workerSeconds)+' 秒（各 Worker 时限之和）</p>'+allocations.map(a=>{
   const task=tasks.find(t=>t.id===a.taskId),status=a.status==='dispatched'&&task?task.status:a.status;
   return '<details data-evidence="allocation-'+esc(a.id)+'"><summary>'+esc(a.work.backend)+' · '+esc(states[status]||status)+'</summary><p>'+esc(a.work.prompt)+'</p><p>单次时限：'+esc(a.work.timeoutSeconds??1800)+' 秒</p><p>任务：'+esc(a.taskId)+'</p>'+(a.detail?'<p>'+esc(a.detail)+'</p>':'')+'</details>';
  }).join(''):'')+'</details>';
 }).join('')+'</section>';
}

function nativeGoalView(chat){
 if(!chat.continuousGoal)return '';
 const goal=chat.nativeGoal,status=goal?.status,b=chat.goalBudget;
 const budget=b?(b.error?'<p>'+esc(b.error)+'</p>':'<p>子任务调用 '+esc(b.workersUsed)+' / '+esc(b.workers)+' · HWE 验证 '+esc(b.checksUsed)+' / '+esc(b.checks)+(b.inflight?' · '+esc(b.inflight)+' 项尚未结清':'')+'（恢复后累计）</p>'):'';
 const names={active:chat.status==='running'?'持续推进中':'上次执行已中断',paused:'已暂停',blocked:'目标受阻',usageLimited:'额度受限',budgetLimited:'达到目标预算',complete:chat.acceptance?.status==='accepted'?'目标已通过声明的验收':'主 Agent 已结束目标 · 查看验收范围'};
 return '<section class="management-progress"><strong>'+esc(names[status]||(chat.status==='running'?'正在建立持续目标':'目标尚未启动'))+'</strong><p>'+esc(chat.continuousGoal.objective)+'</p><p>原截止时间：'+esc(new Date(chat.continuousGoal.deadline).toLocaleString())+'</p>'+(goal?'<p>当前主会话已用 '+esc(goal.tokensUsed)+' token · '+esc(Math.round(goal.timeUsedSeconds))+' 秒（不含独立 Worker）</p>':'')+(chat.status!=='running'&&status!=='complete'?'<p>要继续此目标，请开启“持续目标”并发送继续要求。保留原截止时间和累计额度。</p>':'')+budget+'</section>';
}

function liveProgressView(progress){
 if(!Array.isArray(progress)||!progress.length)return "";
 return '<section class="management-progress"><details open data-evidence="live-progress"><summary>运行进展</summary><p>主 Agent 的阶段说明；最终结果以验收记录为准。</p>'+progress.slice(-8).map(text=>'<div class="message assistant">'+renderMessage(text)+'</div>').join('')+'</details></section>';
}
