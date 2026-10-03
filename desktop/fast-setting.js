// A preference switch: it never claims that a response was served through Fast.
export function bindFastSetting(button,selection,supported,changed){
 const enabled=['fast','priority'].includes(selection.serviceTier);
 button.textContent='Fast：'+(enabled?'开':selection.serviceTier==='default'?'关':'默认');
 button.setAttribute('aria-pressed',String(enabled));
 button.disabled=!supported&&!enabled;
 button.title=supported?'为这个角色请求 Fast；增加额度消耗。实际档位以响应审计为准。':'本机模型目录未声明 Fast 支持';
 button.onclick=()=>{selection.serviceTier=enabled?'default':'fast';changed();};
}
