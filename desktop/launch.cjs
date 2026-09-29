const {spawn}=require('node:child_process');
const path=require('node:path');
const env={...process.env,PROACTIVE_NODE:process.execPath};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(__dirname,'main.cjs')],{env,stdio:'inherit',windowsHide:false});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
