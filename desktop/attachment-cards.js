export function renderAttachmentCards(target,paths,remove){
 target.replaceChildren();if(!paths.length)return;
 const doc=target.ownerDocument,status=doc.createElement('div');status.className='attachment-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent=`已添加 ${paths.length} 个附件`;target.append(status);
 const row=doc.createElement('div');row.className='attachment-list';target.append(row);
 for(const path of paths){
  const name=path.split(/[\\/]/).at(-1),ext=name.includes('.')?name.split('.').at(-1).toUpperCase():'目录/文件';
  const card=doc.createElement('div');card.className='attachment-card';card.title=path;
  const icon=doc.createElement('span');icon.className='attachment-kind'+(ext==='PDF'?' pdf':'');icon.textContent=ext.slice(0,10);
  const label=doc.createElement('span');label.className='attachment-name';label.textContent=name;
  const state=doc.createElement('small');state.className='attachment-ready';state.textContent='已添加';
  const button=doc.createElement('button');button.type='button';button.className='attachment-remove';button.textContent='×';button.title='移除附件';button.setAttribute('aria-label','移除 '+name);button.onclick=()=>remove(path);
  card.append(icon,label,state,button);row.append(card);
 }
}
