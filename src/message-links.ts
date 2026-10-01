import {Marked,Renderer} from 'marked';

const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const allowedTarget=(target:string)=>!/[\u0000-\u001f]/.test(target)&&(!/^[a-z][a-z0-9+.-]*:/i.test(target)||/^(https?:|[a-z]:[\\/])/i.test(target));
const link=(target:string,label:string)=>`<a href="#" data-message-link="${escapeHtml(target)}" title="${escapeHtml(target)}">${label}</a>`;
const renderer=new Renderer();
// Model HTML stays text. All links use the existing checked IPC opener.
renderer.html=({text})=>escapeHtml(text);
renderer.link=function({raw,href,tokens}){return allowedTarget(href)?link(href,this.parser.parseInline(tokens)):escapeHtml(raw);};
renderer.image=({raw,href,text})=>allowedTarget(href)?link(href,escapeHtml(text||'图片')):escapeHtml(raw);
const markdown=new Marked({renderer,gfm:true,breaks:true,async:false});

export function renderMessage(text:string):string {
  return markdown.parse(text,{async:false});
}
