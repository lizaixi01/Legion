import {renderMessage} from './message-links.js';
import {researchView} from './research.js';
const $=id=>document.getElementById(id),api=window.manager;
let current=null,busy=false,sending=false,refreshing=false,lastList='',lastMessages='',activeId=null;
let workerOptions={model:'gpt-6-sol',effort:'high'},taskOverrides={},candidateCount=2,managedReady=false;
let options={model:'gpt-6-sol',effort:'high',permission:'workspace-write',agents:0,delegation:{mode:'auto',count:10}},catalog=[],menu=null,settingsChat=null;
const effortNames={low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高',ultra:'超高'};
const permissionNames={'read-only':'只读','workspace-write':'项目内编辑','danger-full-access':'完全访问'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const research=researchView(()=>{closeMenu();managedId=null;current=null;busy=false;});
function fresh(){research.close();managedReady=false;taskOverrides={};managedId=null;managedKey="";closeMenu();settingsChat=null;current=null;busy=false;lastMessages='';$('title').textContent='';$('messages').replaceChildren();$('welcome').hidden=false;$('prompt').value='';$('prompt').style.height='auto';$('error').textContent='';$('details').hidden=true;$('details-toggle').hidden=true;updateSend();$('prompt').focus();lastList='';void refresh();}
function updateSend(){$('send').textContent=busy?'■':'↑';$('send').classList.toggle('stopping',busy);$('send').title=busy?'停止':'发送';$('send').setAttribute('aria-label',busy?'停止':'发送');$('send').disabled=sending||(!busy&&!$('prompt').value.trim());paintSettings();}
$('new-chat').onclick=fresh;$('project').onclick=fresh;api.onNewRun(fresh);
$('collapse').onclick=()=>{$('sidebar').hidden=true;$('expand').hidden=false;};$('expand').onclick=()=>{$('sidebar').hidden=false;$('expand').hidden=true;};
$('prompt').oninput=()=>{$('prompt').style.height='auto';$('prompt').style.height=Math.min($('prompt').scrollHeight,220)+'px';updateSend();};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!busy)$('composer').requestSubmit();}};
$('composer').onsubmit=async e=>{e.preventDefault();if(sending)return;if(busy){if(managedId)await api.engineeringStop();else await api.chatStop();await refresh();return;}const value=$('prompt').value.trim();if(!value)return;closeMenu();sending=true;updateSend();$('error').textContent='';try{const result=await (projectChoice&&options.delegation?.mode!=='off'?api.engineeringPlan({project:projectChoice.path,goal:value,options:{...options},workerOptions:{...workerOptions}}):api.chatSend({id:current||undefined,text:value,options:{...options},project:projectChoice?.path}));if(projectChoice&&options.delegation?.mode!=='off'){managedId=result.id;current=null;managedKey="";}else current=result.id;$('prompt').value='';$('prompt').style.height='auto';lastList='';lastMessages='';await refresh();}catch(e){$('error').textContent=e.message;}finally{sending=false;updateSend();}};
async function refresh(){if(refreshing)return;refreshing=true;try{if(research.isActive()){await research.refresh();return;}await refreshEngineering();if(managedId)return;const chats=await api.chatList();activeId=chats.find(c=>c.status==='running')?.id;const key=JSON.stringify([chats,current]);if(key!==lastList){lastList=key;$('chats').innerHTML=chats.map(c=>`<button class="chat ${c.id===current?'selected':''}" data-chat="${c.id}" title="${esc(c.title)}">${c.status==='running'?'· ':''}${esc(c.title)}</button>`).join('');document.querySelectorAll('[data-chat]').forEach(b=>b.onclick=()=>{managedId=null;managedKey="";projectChoice=null;paintProject();current=b.dataset.chat;lastMessages='';$('error').textContent='';void refresh();});}if(current){const id=current,c=await api.chatDetail(id);if(current!==id)return;if(settingsChat!==id){settingsChat=id;if(c.options)options={...c.options,delegation:c.options.delegation??{mode:'off',count:10}};paintSettings();}busy=c.status==='running';$('title').textContent=c.title;$('welcome').hidden=true;$('details-toggle').hidden=false;const messageKey=JSON.stringify([c.messages,c.live,c.status,c.management]);if(messageKey!==lastMessages){const area=$('conversation');const nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<90;const initial=!lastMessages;lastMessages=messageKey;$('messages').innerHTML=c.messages.map(m=>`<div class="message ${m.role}">${renderMessage(m.text)}</div>`).join('')+(c.live?.text?`<div class="message assistant">${renderMessage(c.live.text)}</div>`:'')+managementView(c.management)+(busy?`<div class="activity">${esc(c.live?.activity||'正在思考')}</div>`:'');if(nearBottom||initial)area.scrollTop=area.scrollHeight;}$('error').textContent=c.error||'';}updateSend();}catch(e){$('error').textContent=e.message;}finally{refreshing=false;}}
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
    pop.innerHTML='<h2>操作权限</h2><div role="menu">'+choice('read-only','只读','允许读取；禁止修改文件。',options.permission==='read-only')+choice('workspace-write','项目内编辑','可修改本对话目录；越界操作直接拒绝。',options.permission==='workspace-write')+choice('danger-full-access','完全访问','可访问电脑文件与网络，不逐项询问。',options.permission==='danger-full-access')+'</div>';
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
$('project').onclick=()=>{const open=$('project').getAttribute('aria-expanded')!=='true';$('project').setAttribute('aria-expanded',String(open));$('chats').hidden=!open;$('engineering-chats').hidden=!open;localStorage.setItem('project-expanded',String(open));};
async function boot(){try{catalog=await api.models();const saved=JSON.parse(localStorage.getItem('execution-options')||'null');if(saved&&catalog.some(m=>m.id===saved.model&&m.efforts.includes(saved.effort))&&Object.hasOwn(permissionNames,saved.permission)&&[0,2,4].includes(saved.agents))options={...saved,agents:0,delegation:saved.delegation??{mode:'auto',count:10}};const workerSaved=JSON.parse(localStorage.getItem('worker-options')||'null');if(workerSaved&&catalog.some(m=>m.id===workerSaved.model&&m.efforts.includes(workerSaved.effort)))workerOptions=workerSaved;}catch(e){$('error').textContent=e.message;}const expanded=localStorage.getItem('project-expanded')!=='false';$('project').setAttribute('aria-expanded',String(expanded));$('chats').hidden=!expanded;$('engineering-chats').hidden=!expanded;paintSettings();fresh();setInterval(()=>void refresh(),800);}



let projectChoice=null,managedId=null,managedKey='',managedListKey='';
const managedNames={planning:'正在读取项目并制定检查',ready:'计划待执行',running:'正在执行与检查',integrating:'正在检查合并结果',checks_passed:'已通过声明的检查',incomplete:'未完成验收',error:'执行异常',cancelled:'已停止',interrupted:'已中断'};
function paintProject(){paintSettings();$('project-label').textContent=projectChoice?.name||'选择工程项目';$('clear-project').hidden=!projectChoice;}
$('choose-project').onclick=async()=>{try{const result=await api.chooseProject();if(result){fresh();projectChoice=result;paintProject();$('prompt').placeholder='描述要完成的项目改动';}}catch(e){$('error').textContent=e.message;}};
$('clear-project').onclick=()=>{projectChoice=null;fresh();paintProject();$('prompt').placeholder='随心输入';};
async function refreshEngineering(){
 const list=await api.engineeringList(),key=JSON.stringify([list,managedId]);if(key!==managedListKey){managedListKey=key;$('engineering-chats').innerHTML=list.map(r=>`<button class="chat ${r.id===managedId?'selected':''}" data-engineering="${r.id}" title="${esc(managedNames[r.status])}">◇ ${esc(r.title)}</button>`).join('');document.querySelectorAll('[data-engineering]').forEach(b=>b.onclick=()=>{managedId=b.dataset.engineering;current=null;managedKey='';void refresh();});}
 if(!managedId)return;
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
}
void boot();

$('messages').addEventListener('click',async event=>{const link=event.target.closest('[data-message-link]');if(!link)return;event.preventDefault();if(!current)return;try{await api.chatOpenLink(current,link.dataset.messageLink);}catch(error){$('error').textContent=error.message;}});

function modelFields(key,selection){const model=catalog.find(m=>m.id===selection.model);return `<label>模型<select data-model="${esc(key)}">${catalog.map(m=>`<option value="${esc(m.id)}" ${m.id===selection.model?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label>推理强度<select data-effort="${esc(key)}">${(model?.efforts||[selection.effort]).map(e=>`<option value="${esc(e)}" ${e===selection.effort?'selected':''}>${esc(effortNames[e])}</option>`).join('')}</select></label>`;}
function bindModelFields(container,key,selection,changed){const model=container.querySelector('[data-model="'+key+'"]'),effort=container.querySelector('[data-effort="'+key+'"]');model.onchange=()=>{selection.model=model.value;const levels=catalog.find(m=>m.id===model.value).efforts;if(!levels.includes(selection.effort))selection.effort=levels.includes('high')?'high':levels[0];effort.innerHTML=levels.map(e=>`<option value="${esc(e)}" ${e===selection.effort?'selected':''}>${esc(effortNames[e])}</option>`).join('');changed();};effort.onchange=()=>{selection.effort=effort.value;changed();};}

// Navigation stays local; opening a panel never starts a model session.
function filterChats(){const query=$('chat-search').value.trim().toLocaleLowerCase();document.querySelectorAll('.chat').forEach(button=>{button.hidden=!button.textContent.toLocaleLowerCase().includes(query);});}
$('search-toggle').onclick=()=>{const open=$('chat-search').hidden;$('chat-search').hidden=!open;$('search-toggle').setAttribute('aria-expanded',String(open));if(open)$('chat-search').focus();else{$('chat-search').value='';filterChats();}};
$('chat-search').oninput=filterChats;
new MutationObserver(filterChats).observe($('chats'),{childList:true});
new MutationObserver(filterChats).observe($('engineering-chats'),{childList:true});
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
   const windows=[['5 小时窗口',limits?.primary],['每周窗口',limits?.secondary]];
   for(const [label,w] of windows)if(w&&typeof w.usedPercent==='number'){
    const remaining=Math.max(0,Math.min(100,100-w.usedPercent));
    const row=document.createElement('p');row.className='capacity-usage';row.textContent=`${label}：剩余 ${remaining.toFixed(0)}%`;panel.append(row);
   }
   if(!windows.some(([,w])=>w)){const p=document.createElement('p');p.textContent='服务未提供用量窗口';panel.append(p);}
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

function managementView(state){if(!state)return '';const names={planning:'Manager 正在决策',delegating:'子 Agent 执行中',working:'主 Agent 执行中',completed:'已结束',error:'执行异常',cancelled:'已停止'};return `<section class="management-progress"><p>${esc(names[state.phase]||state.phase)} · 第 ${state.round+1} 轮</p>${state.decisions.map(d=>`<details><summary>${esc(d.action==='delegate'?'分配 '+d.tasks.length+' 个任务':d.action==='work'?'由主 Agent 执行':'结束')} · ${esc(d.reason)}</summary>${d.tasks.map(t=>`<p>${esc(t.id)} · ${esc(t.backend)} — ${esc(t.goal)}</p>`).join('')}</details>`).join('')}${state.tasks.map(t=>`<details><summary>${esc(t.id)} · ${esc(t.backend)} · ${esc(t.status)}</summary><p>${esc(t.reply)}</p>${t.checks.map(c=>`<p>${esc(c.path)} · ${esc(c.status)} · ${esc(c.detail)}</p>`).join('')}</details>`).join('')}</section>`;}
