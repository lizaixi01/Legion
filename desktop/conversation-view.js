import {renderMessage} from './message-links.js';

// Keep finished messages in place while status and task evidence change.
export function createConversationView(target){
 let transcript,progress,activity,rows=[],progressHtml='';
 return {
  update(messages,evidence='',status=null){
   const doc=target.ownerDocument;
   if(transcript?.parentNode!==target){
    transcript=doc.createElement('div');transcript.className='conversation-transcript';
    progress=doc.createElement('div');progress.className='conversation-progress';
    activity=doc.createElement('div');activity.className='activity';activity.setAttribute('role','status');activity.setAttribute('aria-live','polite');activity.hidden=true;
    target.replaceChildren(transcript,progress,activity);rows=[];progressHtml='';
   }
   for(const [index,message] of messages.entries()){
    let row=rows[index];
    if(!row){const element=doc.createElement('div');transcript.append(element);row={element};rows.push(row);}
    if(row.text!==message.text||row.role!==message.role){
     row.element.className='message '+(message.role==='user'?'user':'assistant');
     row.element.innerHTML=renderMessage(message.text);row.text=message.text;row.role=message.role;
    }
   }
   for(const row of rows.splice(messages.length))row.element.remove();
   if(evidence!==progressHtml){progress.innerHTML=evidence;progressHtml=evidence;}
   activity.hidden=!status;
   if(activity.textContent!==(status||''))activity.textContent=status||'';
  }
 };
}
