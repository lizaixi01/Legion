const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

// Render links only; all surrounding model output remains escaped text.
export function renderMessage(text:string):string {
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map(part=>{
    if(part.startsWith('`'))return escapeHtml(part);
    const pattern=/\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s]+?))\)/g;
    let result='',start=0;
    for(const match of part.matchAll(pattern)){
      const target=match[2]??match[3]!;
      result+=escapeHtml(part.slice(start,match.index));
      const allowed=!/[\u0000-\u001f]/.test(target)&&(!/^[a-z][a-z0-9+.-]*:/i.test(target)||/^(https?:|[a-z]:[\\/])/i.test(target));
      result+=allowed?`<a href="#" data-message-link="${escapeHtml(target)}" title="${escapeHtml(target)}">${escapeHtml(match[1]!)}</a>`:escapeHtml(match[0]);
      start=match.index!+match[0].length;
    }
    return result+escapeHtml(part.slice(start));
  }).join('');
}
