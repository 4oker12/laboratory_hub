/* Persistent extension-side relay; never stores credentials or opens a browser window. */
'use strict';
const ROUTER_ORIGIN='http://192.168.0.1';
const frame=document.querySelector('iframe[name="routerlab-c20-offscreen-probe"]');
let loaded=false,frameLoads=0;
frame.addEventListener('load',()=>{loaded=true;frameLoads++;});
// Diagnostics from our router-origin MAIN script. No credentials, cookie values,
// or response bodies are ever relayed.
window.addEventListener('message',e=>{
  if(e.source!==frame.contentWindow||e.origin!==ROUTER_ORIGIN||
     e.data?.type!=='C20_OFFSCREEN_LOGIN_CLICK_SIGNAL')return;
  const result=e.data.result;
  if(!['CLICK_ATTEMPT','CLICK_RETURNED','CLICK_EXCEPTION'].includes(result))return;
  chrome.runtime.sendMessage({type:'C20_OFFSCREEN_LOGIN_CLICK_SIGNAL',result}).catch(()=>{});
});
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(request?.type!=='C20_OFFSCREEN_OPERATION')return false;
  if(sender.id!==chrome.runtime.id || sender.tab)return false;
  const command=request.command;
  if(!['inspect','login','loginSchema','wifiSet','reboot','http','factoryCreate','quickStage','quickStep','wanRead','pageState','refresh','frameStatus'].includes(command)){respond({ok:false,reason:'COMMAND_DENIED'});return false;}
  if(command==='frameStatus'){
    respond({ok:true,result:{loaded,frameLoads}});
    return false;
  }
  if(command==='refresh'){
    // Controlled refresh after a confirmed encrypted login, never a second login.
    loaded=false;const previous=frameLoads;
    frame.src=ROUTER_ORIGIN+'/?routerlab_refresh='+Date.now();
    (async()=>{for(let i=0;i<45&&frameLoads===previous;i++)await new Promise(r=>setTimeout(r,100));
      respond({ok:frameLoads>previous,result:{refreshed:frameLoads>previous,frameLoads}});
    })().catch(()=>respond({ok:false,reason:'REFRESH_FAILED'}));
    return true;
  }
  const id=crypto.randomUUID();
  let finished=false;
  const finish=v=>{if(finished)return;finished=true;clearTimeout(timer);window.removeEventListener('message',receive);respond(v);};
  const receive=e=>{
    if(e.source!==frame.contentWindow||e.origin!==ROUTER_ORIGIN||e.data?.type!=='C20_OFFSCREEN_OPERATION_RESULT'||e.data?.requestId!==id)return;
    finish({ok:true,result:{...e.data.result,frameLoads}});
  };
  window.addEventListener('message',receive);
  const timer=setTimeout(()=>finish({ok:false,reason:'OFFSCREEN_ROUTER_FRAME_TIMEOUT'}),command==='wifiSet'?16500:13500);
  (async()=>{
    // Bounded initialization: iframe can still be loading after the document appears.
    for(let i=0;i<35&&!loaded;i++)await new Promise(r=>setTimeout(r,100));
    if(!loaded)return finish({ok:false,reason:'OFFSCREEN_ROUTER_FRAME_NOT_LOADED'});
    if(finished)return;
    frame.contentWindow.postMessage({type:'C20_OFFSCREEN_OPERATION',requestId:id,command,
      args:request.args&&typeof request.args==='object'?request.args:{}},ROUTER_ORIGIN);
  })().catch(()=>finish({ok:false,reason:'OFFSCREEN_RELAY_ERROR'}));
  return true;
});
