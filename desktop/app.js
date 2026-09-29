import {renderMessage} from './message-links.js';
import {researchView} from './research.js';
const $=id=>document.getElementById(id),api=window.manager;
let current=null,busy=false,sending=false,refreshing=false,lastMessages='',activeId=null,workspaceInfo={path:'',name:'Project'},projectGroupsKey='';
let workerOptions={model:'gpt-6-sol',effort:'high'},taskOverrides={},candidateCount=2,managedReady=false;
let options={model:'gpt-6-sol',effort:'high',permission:'workspace-write',agents:0,delegation:{mode:'auto',count:10}},catalog=[],menu=null,settingsChat=null;
const effortNames={low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高',ultra:'超高'};
const permissionNames={'read-only':'只读','workspace-write':'项目内编辑','danger-full-access':'完全访问'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const research=researchView(()=>{closeMenu();managedId=null;current=null;busy=false;});
function fresh(){research.close();managedReady=false;taskOverrides={};managedId=null;managedKey="";closeMenu();settingsChat=null;current=null;busy=false;lastMessages='';$('title').textContent='';$('messages').replaceChildren();$('welcome').hidden=false;$('prompt').value='';$('prompt').style.height='auto';$('error').textContent='';$('details').hidden=true;$('details-toggle').hidden=true;updateSend();$('prompt').focus();void refresh();}
function updateSend(){$('send').textContent=busy?'■':'↑';$('send').classList.toggle('stopping',busy);$('send').title=busy?'停止':'发送';$('send').setAttribute('aria-label',busy?'停止':'发送');$('send').disabled=sending||(!busy&&!$('prompt').value.trim());paintSettings();}
$('new-chat').onclick=fresh;api.onNewRun(fresh);
$('collapse').onclick=()=>{$('sidebar').hidden=true;$('expand').hidden=false;};$('expand').onclick=()=>{$('sidebar').hidden=false;$('expand').hidden=true;};
$('prompt').oninput=()=>{$('prompt').style.height='auto';$('prompt').style.height=Math.min($('prompt').scrollHeight,220)+'px';updateSend();};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!busy)$('composer').requestSubmit();}};
$('composer').onsubmit=async e=>{e.preventDefault();if(sending)return;if(busy){if(managedId)await api.engineeringStop();else await api.chatStop();await refresh();return;}const value=$('prompt').value.trim();if(!value)return;closeMenu();sending=true;updateSend();$('error').textContent='';try{const result=await api.chatSend({id:current||undefined,text:value,options:{...options},project:projectChoice?.path});managedId=null;current=result.id;$('prompt').value='';$('prompt').style.height='auto';lastMessages='';await refresh();}catch(e){$('error').textContent=e.message;}finally{sending=false;updateSend();}};
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{
  if(research.isActive()){await research.refresh();return;}
  const engineering=await refreshEngineering(),chats=await api.chatList();
  paintProjectGroups(chats,engineering);
  activeId=chats.find(c=>c.status==='running')?.id;
  if(managedId){updateSend();return;}
  if(current){
   const id=current,c=await api.chatDetail(id);if(current!==id)return;
   if(settingsChat!==id){settingsChat=id;projectChoice=c.project?{path:c.project,name:c.project.split(/[\\/]/).at(-1)}:null;paintProject();if(c.options)options={...c.options,delegation:c.options.delegation??{mode:'off',count:10}};paintSettings();}
   busy=c.status==='running';$('title').textContent=c.title;$('welcome').hidden=true;$('details-toggle').hidden=false;
   const messageKey=JSON.stringify([c.messages,c.live,c.status,c.management]);
   if(messageKey!==lastMessages){const area=$('conversation'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<90,initial=!lastMessages;lastMessages=messageKey;$('messages').innerHTML=c.messages.map(m=>'<div class="message '+m.role+'">'+renderMessage(m.text)+'</div>').join('')+(c.live?.text?'<div class="message assistant">'+renderMessage(c.live.text)+'</div>':'')+managementView(c.management)+(busy?'<div class="activity">'+esc(c.live?.activity||'正在思考')+'</div>':'');if(nearBottom||initial)area.scrollTop=area.scrollHeight;}
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
 container.querySelectorAll('[data-engineering]').forEach(button=>button.onclick=()=>{managedId=button.dataset.engineering;current=null;managedKey='';void refresh();});
}
function chatRowMarkup(chat,project=false){return `<div class="chat-entry ${project?'project-chat':''}"><button class="chat ${chat.id===current?'selected':''} ${chat.pinned?'pinned':''}" data-chat="${esc(chat.id)}" title="${esc(chat.title)}">${chat.status==='running'?'<span class="running-dot" aria-hidden="true"></span>':''}<span class="chat-title">${esc(chat.title)}</span></button><button class="chat-actions" data-chat-menu="${esc(chat.id)}" aria-label="${esc(chat.title)} 的操作" aria-haspopup="menu" title="对话操作">···</button></div>`;}
function renderChatRows(container,chats,label){container.innerHTML=(chats.length&&label?`<div class="sidebar-subsection">${esc(label)}</div>`:'')+chats.map(chat=>chatRowMarkup(chat)).join('');}
function bindChatRows(container){container.querySelectorAll('[data-chat]').forEach(button=>button.onclick=()=>{managedId=null;managedKey='';projectChoice=null;paintProject();current=button.dataset.chat;lastMessages='';$('error').textContent='';void refresh();});container.querySelectorAll('[data-chat-menu]').forEach(button=>{button.onclick=event=>{event.stopPropagation();showChatMenu(button.dataset.chatMenu,event,button.closest('.chat-entry')?.querySelector('[data-chat]')?.title??'',button.closest('.chat-entry')?.querySelector('[data-chat]')?.classList.contains('pinned'));};button.closest('.chat-entry').oncontextmenu=event=>{event.preventDefault();showChatMenu(button.dataset.chatMenu,event,button.closest('.chat-entry')?.querySelector('[data-chat]')?.title??'',button.closest('.chat-entry')?.querySelector('[data-chat]')?.classList.contains('pinned'));};});}
function showChatMenu(id,event,title,pinned){const menu=$('chat-menu');menu.innerHTML=`<button role="menuitem" data-chat-action="pin">${pinned?'取消置顶':'置顶'}</button><div class="chat-menu-divider"></div><button role="menuitem" class="danger" data-chat-action="delete">删除对话</button>`;menu.hidden=false;const rect=menu.getBoundingClientRect(),x=Math.min(event.clientX,innerWidth-rect.width-8),y=Math.min(event.clientY,innerHeight-rect.height-8);menu.style.left=Math.max(8,x)+'px';menu.style.top=Math.max(8,y)+'px';menu.querySelector('[data-chat-action="pin"]').onclick=async()=>{closeChatMenu();try{await api.chatSetPinned(id,!pinned);projectGroupsKey='';await refresh();}catch(error){$('error').textContent=error.message;}};menu.querySelector('[data-chat-action="delete"]').onclick=async()=>{closeChatMenu();if(!confirm(`确定删除对话“${title}”？此操作无法撤销。`))return;try{await api.chatDelete(id);if(current===id)fresh();else{projectGroupsKey='';await refresh();}}catch(error){$('error').textContent=error.message;}};}
function showProjectMenu(path,event,group){const menu=$('chat-menu'),key=String(path||workspaceInfo.path).replace(/[\\/]+$/,'').toLocaleLowerCase(),pinned=localStorage.getItem('project-pinned:'+key)==='true',projectName=group?.querySelector('.button-label')?.textContent||String(path).split(/[\\/]/).at(-1)||'项目';menu.innerHTML=`<button role="menuitem" data-project-action="pin">${pinned?'取消置顶项目':'置顶项目'}</button><div class="chat-menu-divider"></div><button role="menuitem" class="danger" data-project-action="archive">归档项目</button>`;menu.hidden=false;const rect=menu.getBoundingClientRect(),x=Math.min(event.clientX,innerWidth-rect.width-8),y=Math.min(event.clientY,innerHeight-rect.height-8);menu.style.left=Math.max(8,x)+'px';menu.style.top=Math.max(8,y)+'px';menu.querySelector('[data-project-action="pin"]').onclick=()=>{closeChatMenu();localStorage.setItem('project-pinned:'+key,String(!pinned));projectGroupsKey='';void refresh();};menu.querySelector('[data-project-action="archive"]').onclick=async()=>{closeChatMenu();if(!confirm(`归档“${projectName}”会清除该项目关联的全部聊天记录（包括已置顶的对话），不会删除项目文件。此操作无法撤销，是否继续？`))return;try{const result=await api.chatArchiveProject(path);if(current&&result.deleted.includes(current))fresh();else{projectGroupsKey='';await refresh();}}catch(error){projectGroupsKey='';await refresh();$('error').textContent=error.message;}};}
function closeChatMenu(){$('chat-menu').hidden=true;}
document.addEventListener('click',event=>{if(!event.target.closest('#chat-menu')&&!event.target.closest('[data-chat-menu]')&&!event.target.closest('[data-project-menu]'))closeChatMenu();});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeChatMenu();});
async function history(){if(!$('details').hidden&&$('panel-title').textContent==='运行记录'){$('details').hidden=true;$('history').setAttribute('aria-expanded','false');return;}$('details').hidden=false;$('history').setAttribute('aria-expanded','true');$('panel-title').textContent='运行记录';$('agents-view').setAttribute('aria-expanded','false');$('report').textContent='';const data=await api.list();$('records').innerHTML=data.runs.map(r=>`<button data-run="${r.id}">${r.demo?'流程演示':['codex-master-v1','engineering-master-v1'].includes(r.policy)?'Master 管理':'规则管理'} · ${new Date(r.startedAt).toLocaleDateString()}<br>${r.accepted} / ${r.total} 已验收</button>`).join('')||'暂无运行记录';document.querySelectorAll('[data-run]').forEach(b=>b.onclick=async()=>{const d=await api.detail(b.dataset.run);$('report').textContent=d.report;});}
$('history').onclick=()=>void history();$('details-toggle').onclick=()=>{if(!$('details').hidden){$('details').hidden=true;return;}$('details').hidden=false;$('panel-title').textContent='对话详情';$('history').setAttribute('aria-expanded','false');$('agents-view').setAttribute('aria-expanded','false');$('records').textContent='当前对话使用独立 Codex 会话。';$('report').textContent='回复尚未经过外部验收。';};
function paintSettings(){
  $('model-label').textContent=(projectChoice?'Manager · ':'')+(catalog.find(m=>m.id===options.model)?.name||options.model)+' · '+effortNames[options.effort];
  $('permission-button').textContent=permissionNames[options.permission];$('permission-button').classList.toggle('elevated',options.permission==='danger-full-access');
  $('agents-button').textContent=options.delegation?.mode==='off'?'子 Agent · 关闭':options.delegation?.mode==='fixed'?'子 Agent · '+options.delegation.count:'子 Agent · 自动';
  for(const id of ['model','permission','agents'])$(id+'-button').disabled=busy||sending||(Boolean(managedId)&&!(id==='agents'&&managedReady));
}
function closeMenu(focus=false){if(menu){const old=menu;menu=null;$('settings-popover').hidden=true;$(old+'-button').setAttribute('aria-expanded','false');if(focus)$(old+'-button').focus();}}
function choose(key,value){options[key]=value;localStorage.setItem('execution-options',JSON.stringify(options));paintSettings();}
function choice(value,title,description,selected){return `<button type="button" class="choice" role="menuitemradio" aria-checked="${selected}" data-value="${esc(value)}"><span class="choice-text">${esc(title)}${description?`<small>${esc(description)}</small>`:''}</span><span class="checkmark">${selected?'✓':''}</span></button>`;}
function openMenu(kind){if(menu===kind){closeMenu(true);return;}closeMenu();menu=kind;const pop=$('settings-popover');$(kind+'-button').setAttribute('aria-expanded','true');
  if(kind==='model'){
    const model=catalog.find(m=>m.id===options.model);const levels=model?.efforts||['high'];
    pop.innerHTML='<h2>'+(projectChoice?'Manager · 规划与管理':'模型')+'</h2><div role="menu">'+catalog.map(m=>choice(m.id,m.name,'',m.id===options.model)).join('')+'</div>'+`<div class="effort-section"><label for="effort">推理强度 <span id="effort-value">${effortNames[options.effort]}</span></label><input id="effort" type="range" min="0" max="${levels.length-1}" step="1" value="${Math.max(0,levels.indexOf(options.effort))}" aria-valuetext="${effortNames[options.effort]}"><div class="effort-labels"><span>更快</span><span>更深入</span></div></div>`;
    pop.querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{choose('model',b.dataset.value);const m=catalog.find(x=>x.id===options.model);if(!m.efforts.includes(options.effort))choose('effort',m.efforts.includes('high')?'high':m.efforts[0]);menu=null;openMenu('model');});
    $('effort').oninput=e=>{choose('effort',levels[Number(e.target.value)]);$('effort-value').textContent=effortNames[options.effort];e.target.setAttribute('aria-valuetext',effortNames[options.effort]);};
  }else if(kind==='permission'){
    pop.innerHTML='<h2>操作权限</h2><div role="menu">'+choice('read-only','只读','允许读取；禁止修改文件。',options.permission==='read-only')+choice('workspace-write','项目内编辑','可修改选定项目；未选择项目时使用独立对话目录。',options.permission==='workspace-write')+choice('danger-full-access','完全访问','可访问电脑文件与网络，不逐项询问。',options.permission==='danger-full-access')+'</div>';
    pop.querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{choose('permission',b.dataset.value);closeMenu(true);});
  }else{
    const d=options.delegation??{mode:'auto',count:10};
    pop.innerHTML='<h2>子 Agent</h2><div role="menu">'+choice('off','不使用 sub agent','由主 Agent 完成任务。',d.mode==='off')+choice('auto','LLM 动态决定','按任务和执行证据决定是否委派及数量。',d.mode==='auto')+choice('fixed','使用 sub agent','默认 10 个名额，任务由 Manager 分配。',d.mode==='fixed')+'</div>'+(d.mode==='fixed'?'<label>数量<input id="delegation-count" type="number" min="1" max="64" value="'+d.count+'"></label>':'');
    pop.querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{choose('delegation',{mode:b.dataset.value,count:d.count});choose('agents',0);menu=null;openMenu('agents');});
    pop.querySelector('#delegation-count')?.addEventListener('change',e=>{const count=Number(e.target.value);if(Number.isInteger(count)&&count>=1&&count<=64)choose('delegation',{mode:'fixed',count});else e.target.value=String(d.count);});
  }
  pop.hidden=false;const rect=$(kind+'-button').getBoundingClientRect();pop.style.left=Math.max(8,Math.min(rect.left,innerWidth-338))+'px';pop.style.bottom=(innerHeight-rect.top+8)+'px';pop.querySelector('button')?.focus();
}
for(const kind of ['model','permission','agents'])$(kind+'-button').onclick=()=>openMenu(kind);
document.addEventListener('pointerdown',e=>{if(menu&&!e.target.closest('#settings-popover')&&!e.target.closest('.setting'))closeMenu();});
document.addEventListener('keydown',e=>{if(!menu)return;if(e.key==='Escape'){e.preventDefault();closeMenu(true);}if(['ArrowDown','ArrowUp'].includes(e.key)&&e.target.type!=='range'){const buttons=[...$('settings-popover').querySelectorAll('button')],index=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}});
window.addEventListener('resize',()=>closeMenu());
async function boot(){try{const [models,project]=await Promise.all([api.models(),api.projectInfo()]);catalog=models;workspaceInfo=project;const saved=JSON.parse(localStorage.getItem('execution-options')||'null');if(saved&&catalog.some(m=>m.id===saved.model&&m.efforts.includes(saved.effort))&&Object.hasOwn(permissionNames,saved.permission)&&[0,2,4].includes(saved.agents))options={...saved,agents:0,delegation:saved.delegation??{mode:'auto',count:10}};const workerSaved=JSON.parse(localStorage.getItem('worker-options')||'null');if(workerSaved&&catalog.some(m=>m.id===workerSaved.model&&m.efforts.includes(workerSaved.effort)))workerOptions=workerSaved;}catch(e){$('error').textContent=e.message;}paintSettings();fresh();setInterval(()=>void refresh(),800);}



let projectChoice=null,managedId=null,managedKey='';
const managedNames={planning:'正在读取项目并制定检查',ready:'计划待执行',running:'正在执行与检查',integrating:'正在检查合并结果',checks_passed:'已通过声明的检查',incomplete:'未完成验收',error:'执行异常',cancelled:'已停止',interrupted:'已中断'};
function paintProject(){paintSettings();$('project-label').textContent=projectChoice?.name||'选择工程项目';$('clear-project').hidden=!projectChoice;}
$('choose-project').onclick=async()=>{try{const result=await api.chooseProject();if(result){fresh();projectChoice=result;paintProject();$('prompt').placeholder='随心输入';}}catch(e){$('error').textContent=e.message;}};
$('clear-project').onclick=()=>{projectChoice=null;fresh();paintProject();$('prompt').placeholder='随心输入';};
async function refreshEngineering(){
 const list=await api.engineeringList();
 if(!managedId)return list;
 const id=managedId,r=await api.engineeringDetail(id);if(id!==managedId)return;busy=['planning','running','integrating'].includes(r.status);managedReady=r.status==='ready';$('welcome').hidden=true;$('title').textContent=r.goal.slice(0,45);$('details-toggle').hidden=true;
 projectChoice={path:r.project,name:r.project.split(/[\\/]/).at(-1)};paintProject();
 if(!managedKey){options={...r.options};workerOptions={...(r.execution?.worker||r.workerOptions||{model:r.options.model,effort:r.options.effort})};taskOverrides={...(r.execution?.tasks||{})};candidateCount=r.execution?.candidates??2;paintSettings();}
 const stateKey=JSON.stringify(r);if(stateKey!==managedKey){managedKey=stateKey;
 const openDetails=new Set([...$('messages').querySelectorAll('details[open]')].map(e=>e.dataset.evidence));
 const tasks=r.plan?.tasks|| (r.plan?[{id:'implementation',goal:r.plan.summary,dependsOn:[],outputs:r.plan.outputs,acceptance:r.plan.acceptance,testSource:r.plan.testSource}]:[]);
 const names={pending:'等待依赖',running:'执行中',checking:'检查中',deciding:'管理器决策中',accepted:'检查通过',failed:'检查失败',error:'执行异常',blocked:'依赖未通过',cancelled:'已停止',timeout:'已超时',unverified:'未完成检查',pass:'通过',fail:'失败',not_checked:'未检查',completed:'执行结束'};
 const checkText=report=>report?.checks.map(c=>c.id+': '+(names[c.status]||c.status)+'\n'+c.detail).join('\n')||'';
 const taskHtml=tasks.map(t=>{
   const state=r.team?.tasks?.[t.id];
   return `<details data-evidence="task-${esc(t.id)}"><summary>${esc(t.goal)} · ${esc(state?names[state.status]||state.status:'待执行')}</summary><p>${t.dependsOn.length?'依赖：'+t.dependsOn.map(esc).join('、'):'可独立执行'}<br>交付：${t.outputs.map(esc).join('、')}</p>${r.status==='ready'?`<div class="task-model"><label><input type="checkbox" data-task-model="${esc(t.id)}" ${taskOverrides[t.id]?'checked':''}> 单独设置 Worker</label><div data-task-fields="${esc(t.id)}" ${taskOverrides[t.id]?'':'hidden'}>${modelFields(t.id,taskOverrides[t.id]||workerOptions)}</div></div>`:`<p>Worker：${esc((r.execution?.tasks?.[t.id]||r.execution?.worker||r.workerOptions||r.options).model)} · ${esc(effortNames[(r.execution?.tasks?.[t.id]||r.execution?.worker||r.workerOptions||r.options).effort])}</p>`}<ul>${t.acceptance.map(a=>`<li>${esc(a)}</li>`).join('')}</ul><details data-evidence="test-${esc(t.id)}"><summary>任务验收测试</summary><pre>${esc(t.testSource)}</pre></details>${state?.candidates?`<p>${state.selectedCandidate?'入选：'+esc(state.selectedCandidate):'比较候选中'}</p>${Object.entries(state.candidates).map(([key,c])=>`<details data-evidence="candidate-${esc(t.id)}-${esc(key)}"><summary>${esc(key)} · ${esc(names[c.status]||c.status)}</summary>${c.attempts.map(a=>`<pre>${esc(checkText(a.report)||a.worker.detail||'等待检查')}</pre>`).join('')}${c.reason?`<p>${esc(c.reason)}</p>`:''}</details>`).join('')}`:''}${(state?.attempts||[]).map((a,i)=>`<details data-evidence="attempt-${esc(t.id)}-${i}"><summary>第 ${i+1} 次执行 · ${esc(names[a.report?.checks.find(c=>c.id==='node-tests')?.status||a.worker.status]||a.worker.status)}</summary><pre>${esc(checkText(a.report)||a.worker.detail||'等待检查')}</pre></details>`).join('')}${state?.reason?`<p>${esc(state.reason)}</p>`:''}</details>`;
 }).join('');
 $('messages').innerHTML=`<div class="message user">${esc(r.goal)}</div><div class="message assistant"><p>${esc(managedNames[r.status]||r.status)}</p>${r.plan?`${r.status==='ready'?`<p>${esc(r.plan.summary)}</p><p>${tasks.length} 个任务 · Manager 已分配</p>`:''}<ul>${r.plan.acceptance.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>${taskHtml}<details data-evidence="overall"><summary>整体验收与范围</summary><p>原项目保持不变，已有测试冻结。全部任务通过后，合并产物重跑所有任务测试及以下整体测试。</p><pre>${esc(r.plan.testSource)}</pre><p>${r.plan.limitations.map(esc).join('\n')}</p></details>`:''}${r.status==='ready'&&!r.options?.delegation?'<label>执行方式 <select id="candidate-count"><option value="2">两条路线竞争</option><option value="1">单路线</option></select></label><button id="execute-plan" class="primary-action">执行计划</button>':''}${r.integration?`<details data-evidence="integration"><summary>合并检查 · ${esc(names[r.integration.checks[0]?.status]||'未知')}</summary><pre>${esc(checkText(r.integration))}</pre></details>`:''}${r.status==='checks_passed'?'<p>通过声明的检查；交付文件尚未覆盖原项目。</p><button id="open-delivery" class="primary-action">打开交付文件</button>':''}${r.status==='incomplete'&&r.integration?'<p class="failure">合并结果未通过验收，未生成交付。请查看合并检查。</p>':''}${r.error?`<p class="failure">${esc(r.error)}</p>`:''}</div>`;
 for(const detail of $('messages').querySelectorAll('details'))if(openDetails.has(detail.dataset.evidence))detail.open=true;
 document.querySelectorAll('[data-task-model]').forEach(box=>{const task=box.dataset.taskModel,fields=document.querySelector('[data-task-fields="'+task+'"]');box.onchange=()=>{fields.hidden=!box.checked;if(box.checked){taskOverrides[task]={...workerOptions};fields.innerHTML=modelFields(task,taskOverrides[task]);bindModelFields(fields,task,taskOverrides[task],()=>{});}else delete taskOverrides[task];};if(taskOverrides[task])bindModelFields(fields,task,taskOverrides[task],()=>{});});
 if($('candidate-count')){$('candidate-count').value=String(candidateCount);$('candidate-count').onchange=e=>{candidateCount=Number(e.target.value);};}
 $('execute-plan')?.addEventListener('click',async()=>{$('execute-plan').disabled=true;try{await api.engineeringStart(id,{candidates:candidateCount,worker:{...workerOptions},tasks:structuredClone(taskOverrides)});managedKey='';await refresh();}catch(e){$('error').textContent=e.message;if($('execute-plan'))$('execute-plan').disabled=false;}});
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
async function refreshAgents(){if($('details').hidden||$('panel-title').textContent!=='运行中的 Agent'||agentsLoading)return;agentsLoading=true;try{const [chats,engineering,experiments]=await Promise.all([api.chatList(),api.engineeringList(),api.researchList()]);if($('details').hidden||$('panel-title').textContent!=='运行中的 Agent')return;const rows=[...chats.filter(x=>x.status==='running').map(x=>({name:x.title,role:'Codex 会话'})),...engineering.filter(x=>['planning','running','integrating'].includes(x.status)).map(x=>({name:x.title,role:'Manager · '+(managedNames[x.status]||x.status)})),...experiments.filter(x=>x.status==='running').map(x=>({name:'微架构实验',role:'Manager · 第 '+x.round+' 轮'}))];$('records').innerHTML=rows.length?rows.map(x=>'<article class="agent-row"><span class="live-dot"></span><div><strong>'+esc(x.name)+'</strong><small>'+esc(x.role)+'</small></div></article>').join(''):'<div class="panel-empty">当前没有运行中的 Agent</div>'; }catch(e){$('report').textContent=e.message;}finally{agentsLoading=false;}}
$('agents-view').onclick=()=>{const open=$('details').hidden||$('panel-title').textContent!=='运行中的 Agent';$('details').hidden=!open;$('agents-view').setAttribute('aria-expanded',String(open));$('history').setAttribute('aria-expanded','false');if(open){$('panel-title').textContent='运行中的 Agent';$('records').textContent='正在读取…';$('report').textContent='';void refreshAgents();}};
setInterval(()=>void refreshAgents(),1500);

const capacityButton=document.getElementById('capacity-button');
function renderCapacity(panel,accounts,updating=false){
 panel.replaceChildren();
 for(const a of accounts){
  const h=document.createElement('h3');h.textContent=a.backend==='codex'?'Codex · Sol':'Command Code · DeepSeek';panel.append(h);
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
capacityButton.addEventListener('click',async()=>{
 const old=document.getElementById('capacity-panel');if(old){old.remove();capacityButton.setAttribute('aria-expanded','false');return;}
 capacityButton.setAttribute('aria-expanded','true');const panel=document.createElement('section');panel.id='capacity-panel';panel.className='capacity-panel';panel.textContent='正在读取账户…';document.body.append(panel);
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
