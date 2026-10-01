import {open} from 'node:fs/promises';
import {StringDecoder} from 'node:string_decoder';

/** One cursor per attempt; repeated UI polls read only newly appended bytes. */
export function createChatOutput(file:string){
  let offset=0,identity='',decoder=new StringDecoder('utf8'),partial='',draft='',text='',activity='正在思考',discarding=false;
  let tail:Promise<unknown>=Promise.resolve();const progress=new Map<string,string>();
  let bytesRead=0;
  const reset=()=>{offset=0;decoder=new StringDecoder('utf8');partial='';draft='';text='';activity='正在思考';discarding=false;progress.clear();};
  const consume=(line:string)=>{try{
    const e=JSON.parse(line),item=e.params?.item;
    if(e.type==='app_server_event'&&e.method==='item/completed'&&item?.type==='agentMessage'&&item.phase==='commentary'&&typeof item.text==='string'&&typeof item.id==='string'){
      const value=item.text.trim();if(value){progress.set(item.id,value.length>1500?value.slice(0,1500)+'…':value);if(progress.size>8)progress.delete(progress.keys().next().value!);}
    }
    if(e.type==='item.completed'&&e.item?.type==='agent_message'&&typeof e.item.text==='string'){text=(text+(text?'\n\n':'')+e.item.text).slice(-1048576);draft='';}
    else if(e.type==='agent_message_delta'&&typeof e.delta==='string')draft=(draft+e.delta).slice(-1048576);
    if(e.type==='app_server_event'&&item?.type==='commandExecution')activity='正在执行命令';
    if(e.type==='app_server_event'&&item?.type==='dynamicToolCall')activity='正在调度子任务';
    if(e.item?.type==='command_execution')activity=e.type==='item.completed'?'正在整理结果':'正在执行命令';
  }catch{/* Incomplete/unknown records do not change the last valid UI state. */}};
  const read=async(includeText=true)=>{
    let handle:Awaited<ReturnType<typeof open>>;
    try{handle=await open(file,'r');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {text:'',activity:'正在连接'};throw error;}
    try{
      const info=await handle.stat(),key=`${info.dev}:${info.ino}:${info.birthtimeMs}`;
      if(identity!==key||info.size<offset)reset();identity=key;
      const buffer=Buffer.alloc(65536);
      while(offset<info.size){const read=await handle.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!read.bytesRead)break;offset+=read.bytesRead;bytesRead+=read.bytesRead;
        let chunk=decoder.write(buffer.subarray(0,read.bytesRead));
        if(discarding){const end=chunk.indexOf('\n');if(end<0)continue;chunk=chunk.slice(end+1);discarding=false;}
        partial+=chunk;let newline:number;
        while((newline=partial.indexOf('\n'))>=0){if(newline<=2097152)consume(partial.slice(0,newline));partial=partial.slice(newline+1);}
        // Ignore an oversized record until its newline, without retaining the growing payload.
        if(partial.length>2097152){partial='';discarding=true;}
      }
      if(includeText&&partial){try{JSON.parse(partial);consume(partial);partial='';}catch{/* Wait for the rest of the final line. */}}
      return {text:includeText?(text||draft):'',activity,...(progress.size?{progress:[...progress.values()]}:{})};
    }finally{await handle.close();}
  };
  return {read:(includeText=true)=>{const next=tail.then(()=>read(includeText));tail=next.catch(()=>{});return next;},bytesRead:()=>bytesRead};
}
