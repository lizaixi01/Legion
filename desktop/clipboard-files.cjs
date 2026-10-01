const {execFile}=require('node:child_process');
const {join}=require('node:path');
// Explorer's copied files use a Windows file-drop list, not ordinary text.
async function readClipboardFiles(){
 if(process.platform!=='win32')return [];
 const command=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const script="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $items=@([System.Windows.Forms.Clipboard]::GetFileDropList()); ConvertTo-Json -InputObject $items -Compress";
 const output=await new Promise((resolve,reject)=>execFile(command,['-NoProfile','-STA','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000,encoding:'utf8',maxBuffer:1024*1024},(error,stdout)=>error?reject(error):resolve(stdout)));
 const paths=JSON.parse(output.trim()||'[]');if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'))throw Error('剪贴板文件列表无效');return paths;
}
module.exports={readClipboardFiles};
