import {pathToFileURL} from 'node:url';
const h=await import(pathToFileURL(process.env.COMMANDCODE_HARNESS).href);
const data=await h.fetchUsageData({getAuthKey:()=>h.getCommandAuthKey({runtime:h.getCommandConfigRuntime(),path:h.getAuthFile(),env:process.env}),getApiBaseUrl:()=>h.getApiBaseUrl(),createRequest:({baseUrl,authKey})=>({get:async({endpoint})=>{const url=new URL(endpoint,baseUrl);if(url.protocol!=='https:')throw Error('Account endpoint must use HTTPS');const r=await fetch(url,{headers:{Authorization:`Bearer ${authKey}`,'User-Agent':'proactive-agent-capacity'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`Account HTTP ${r.status}`);return r.json();}})});
// Only billing fields cross the process boundary. Never log credentials or user identity.
console.log(JSON.stringify({credits:data.credits?.credits??null,windows:data.credits?.windowLimits??null,plan:data.subscription?.data?.planId??null,errors:data.errors}));
