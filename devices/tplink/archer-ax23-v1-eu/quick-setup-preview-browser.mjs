// Browser E2E of the SEPARATE AX23 Quick Setup training UI; no actual router.
import {setTimeout as delay} from 'node:timers/promises';
const base=process.argv[2]||'http://127.0.0.1:18083';
const debug='http://127.0.0.1:19225/json';
let ws;
async function main(){
 let tab;
 for(let i=0;i<50;i++){
  try{
   const r=await fetch(debug);if(r.ok){const arr=await r.json();tab=arr.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);if(tab)break;}
  }catch(_){}
  await delay(100);
 }
 if(!tab)throw Error('PREVIEW_CDP_NOT_READY');
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await Promise.race([
  new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('CDP_WS_ERROR')),{once:true})}),
  delay(5000).then(()=>{throw Error('CDP_WS_TIMEOUT')})
 ]);
 let idx=0;const requests=new Map();let cgi=0;
 ws.addEventListener('message',event=>{
  let msg;try{msg=JSON.parse(event.data)}catch(_){return}
  if(msg.id&&requests.has(msg.id)){
   const cb=requests.get(msg.id);requests.delete(msg.id);
   if(msg.error)cb.reject(Error('CDP_METHOD_ERROR'));else cb.resolve(msg.result);
  }
  if(msg.method==='Network.requestWillBeSent'){
   const url=msg.params?.request?.url||'';
   if(url.includes('/cgi-bin/luci'))cgi++;
  }
 });
 function send(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++idx;requests.set(id,{resolve,reject});
   ws.send(JSON.stringify({id,method,params}));
  });
 }
 async function evalJS(expression){
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error('BROWSER_JS_EXCEPTION');
  return r.result.value;
 }
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Page.navigate',{url:base+'/webpages/routerlab-quick-setup.html'});
 await delay(1400);
 const boot=await evalJS('(() => ({title:document.title,stage:[...document.querySelectorAll("[data-stage]")].find(x=>!x.hidden)?.dataset.stage,nav:document.querySelectorAll("#steps .step").length}))()');
 if(boot.stage!=='0'||boot.nav!==5)throw Error('PREVIEW_FIRST_SCREEN_NOT_READY');
 const count=5;
 for(let step=0;step<count;step++){
  const target=step===4?'finish':'next';
  const clicked=await evalJS('(() => {document.getElementById('+JSON.stringify(target)+').click();return [...document.querySelectorAll("[data-stage]")].find(x=>!x.hidden)?.dataset.stage})()');
  if(clicked!==String(step+1)){
   const err=await evalJS('document.getElementById("errors").textContent');
   throw Error('PREVIEW_STEP_'+step+'_BLOCKED '+(err?'FORM_VALIDATION':'UNKNOWN'));
  }
 }
 const done=await evalJS('(() => ({heading:[...document.querySelectorAll("[data-stage]")].find(x=>!x.hidden)?.querySelector("h1")?.textContent, report:JSON.parse(document.getElementById("report").textContent),stored:localStorage.length}))()');
 if(!done.heading?.includes('Маршрут Quick Setup пройден'))throw Error('PREVIEW_NOT_COMPLETED');
 if(done.report.report.originalVendorWrite!==false || done.report.report.emulatedSession!==false)throw Error('PREVIEW_MISREPRESENTED_AS_HARDWARE');
 if(done.report.trace.length!==5)throw Error('PREVIEW_STEP_TRACE_INCOMPLETE');
 if(cgi!==0)throw Error('PREVIEW_MADE_STOCK_CGI_CALL');
 console.log('AX23_QUICK_SETUP_WALKTHROUGH_BROWSER_END_TO_END=PASS');
 console.log('AX23_QUICK_SETUP_WALKTHROUGH_STAGES=5,HTTP_CGI_REQUESTS=0,DEVICE_WRITES=0');
 ws.close();
}
try{await main()}catch(err){console.error('AX23_QUICK_SETUP_WALKTHROUGH_BROWSER_END_TO_END=FAIL '+err.message);ws?.close();process.exitCode=1}
