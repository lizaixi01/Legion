import {gunzipSync} from 'node:zlib';

export interface RtlArchiveInspection {ok:boolean;detail:string;files:string[]}

const MAX_FILE_BYTES=2*1024*1024;
const MAX_ENTRIES=512;

/** Read tar entry headers far enough to judge the layout the frozen verifier requires. */
function tarEntries(tar:Buffer){
 const entries:{name:string;size:number;kind:number}[]=[];
 let offset=0;
 while(offset+512<=tar.length&&entries.length<MAX_ENTRIES+1){
  const header=tar.subarray(offset,offset+512);
  if(header.every(byte=>byte===0))break;
  const field=(from:number,to:number)=>{const raw=header.subarray(from,to);const end=raw.indexOf(0);return raw.subarray(0,end===-1?raw.length:end).toString('utf8');};
  const name=field(0,100),prefix=field(345,500),sizeText=field(124,136).trim();
  const size=Number.parseInt(sizeText,8);
  entries.push({name:prefix?`${prefix}/${name}`:name,size:Number.isFinite(size)&&size>0?size:0,kind:header[156]??0});
  offset+=512+Math.ceil((Number.isFinite(size)&&size>0?size:0)/512)*512;
 }
 return entries;
}

/**
 * The frozen verifier imports RTL snapshots through bridge.py:load_snapshot, which accepts only
 * flat `*.sv` regular files under 2 MiB. Packaging a directory instead (for example
 * `tar -czf out.tar.gz cores/baseline/rtl`) yields nested paths and is rejected deep inside the
 * container with a bare "Invalid RTL archive". Mirror the rule here so callers get a precise,
 * host-side reason before spending a container.
 */
export function inspectRtlArchive(bytes:Buffer):RtlArchiveInspection {
 let tar:Buffer;
 try{tar=gunzipSync(bytes);}catch{return {ok:false,detail:'not a readable gzip archive; create it with tar -czf',files:[]};}
 let entries;
 try{entries=tarEntries(tar);}catch{return {ok:false,detail:'tar headers could not be read',files:[]};}
 if(!entries.length)return {ok:false,detail:'archive is empty',files:[]};
 const rejects:{name:string;why:string}[]=[];
 let sv=0;
 for(const entry of entries){
  const name=entry.name;
  if(!(entry.kind===0||entry.kind===48)){rejects.push({name,why:'not a regular file'});continue;}
  if(name.endsWith('/')){rejects.push({name,why:'directory entry'});continue;}
  if(name.includes('/')){rejects.push({name,why:'nested path; archive the files themselves, not their folder'});continue;}
  if(!name.endsWith('.sv')){rejects.push({name,why:'not a .sv file'});continue;}
  if(entry.size>MAX_FILE_BYTES){rejects.push({name,why:`larger than ${MAX_FILE_BYTES} bytes`});continue;}
  sv++;
 }
 if(rejects.length){
  const shown=rejects.slice(0,3).map(r=>`${r.name||'(unnamed)'} (${r.why})`).join('; ');
  const more=rejects.length>3?`; +${rejects.length-3} more`:'';
  return {ok:false,detail:`${rejects.length} entr${rejects.length===1?'y':'ies'} rejected: ${shown}${more}. Expected a flat archive of *.sv files, e.g. run tar from inside the RTL directory: tar -czf out.tar.gz *.sv`,files:[]};
 }
 if(!sv)return {ok:false,detail:'archive contains no .sv files',files:[]};
 return {ok:true,detail:`${sv} flat .sv files`,files:entries.map(e=>e.name)};
}
