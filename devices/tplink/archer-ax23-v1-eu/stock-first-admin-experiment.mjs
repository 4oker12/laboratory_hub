// First-admin stock-browser experiment. MUST run within an ephemeral PID+network namespace.
// Password is generated in memory and never printed, stored in Git or sent to a real router.
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readStockLoginForm} from './stock-read-client.mjs';
if(process.env.ROUTERLAB_AX23_SANDBOXED !== '1'){
 console.error('AX23_FIRST_ADMIN=BLOCKED_UNISOLATED');process.exit(2);
}
const baseUrl='http://127.0.0.1:18023';
const tabUrl=baseUrl+'/webpages/index.html';
async function probe(){
 const before=await readStockLoginForm(baseUrl,'check_factory_default');
 if(before.is_default!==true){console.log('AX23_FIRST_ADMIN=BLOCKED_NOT_FACTORY_STATE');return}
 console.log('AX23_FIRST_ADMIN_PRECHECK=STOCK_FACTORY_TRUE');
 let tab;
 for(let i=0;i<45;i++){
  try{const r=await fetch('http://127.0.0.1:19224/json');if(r.ok){const a=await r.json();tab=a.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);if(tab)break}}catch(e){}
  await delay(100);
 }
 if(!tab)throw Error('CDP_BROWSER_NOT_AVAILABLE');
 const ws=new WebSocket(tab.webSocketDebuggerUrl);
 await Promise.race([
  new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('CDP_CONNECTION_ERROR')),{once:true})}),
  delay(4500).then(()=>{throw Error('CDP_CONNECT_TIMEOUT')})
 ]);
 let counter=0;const pending=new Map(),requests=[],byId=new Map();
 ws.addEventListener('message',evt=>{
  let msg;try{msg=JSON.parse(evt.data)}catch(e){return}
  if(msg.id && pending.has(msg.id)){
   const p=pending.get(msg.id);pending.delete(msg.id);
   if(msg.error)p.reject(Error('CDP_COMMAND_ERROR'));else p.resolve(msg.result)
  }
  if(msg.method==='Network.requestWillBeSent'){
   try{
    const r=msg.params.request,u=new URL(r.url);
    if(u.hostname!=='127.0.0.1'||!u.pathname.includes('/cgi-bin/luci'))return;
    const safe=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(x)?x:'UNKNOWN';
    const op=u.searchParams.get('operation')||new URLSearchParams(r.postData||'').get('operation');
    const event={method:r.method,form:safe(u.searchParams.get('form')),operation:safe(op),status:'PENDING'};
    requests.push(event);byId.set(msg.params.requestId,event);
   }catch(e){}
  }
  if(msg.method==='Network.responseReceived' && byId.has(msg.params.requestId)){
   byId.get(msg.params.requestId).status=msg.params.response.status;
  }
  if(msg.method==='Network.loadingFailed' && byId.has(msg.params.requestId)){
   byId.get(msg.params.requestId).status='NETWORK_FAILURE';
  }
 });
 function call(method,params={}){
  return new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 }
 async function evaluate(expression){
  const r=await call('Runtime.evaluate',{expression,returnByValue:true});
  if(r?.exceptionDetails)throw Error('STOCK_UI_JS_EXCEPTION');
  return r?.result?.value;
 }
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
 await call('Page.navigate',{url:tabUrl});await delay(3000);
 const visible=await evaluate('(() => {const a=[...document.querySelectorAll("input[type=password]")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0});const b=document.querySelector("#init-login-button a.button-button");return {passwords:a.length,submitVisible:!!b&&b.getBoundingClientRect().width>0,defaultRoute:location.pathname==="/webpages/index.html"};})()');
 console.log('AX23_FIRST_ADMIN_STOCK_UI_SHAPE='+JSON.stringify(visible));
 if(visible?.passwords!==2||!visible?.submitVisible){
  console.log('AX23_FIRST_ADMIN=BLOCKED_UI_CONTRACT_CHANGED');ws.close();return;
 }
 // Random test secret stays in memory; never log it, its value, its encryption or POST.
 const password='RtrLab'+randomBytes(9).toString('base64url')+'A9!';
 for(let i=0;i<2;i++){
  await evaluate('(() => { const a=[...document.querySelectorAll("input[type=password]")].filter(e=>e.getBoundingClientRect().width>0);a['+i+'].focus();return true;})()');
  await call('Input.insertText',{text:password});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'A',code:'KeyA'});
  await evaluate('(() => {const a=[...document.querySelectorAll("input[type=password]")].filter(e=>e.getBoundingClientRect().width>0);a['+i+'].dispatchEvent(new Event("change",{bubbles:true}));return a['+i+'].value.length;})()');
 }
 const entered=await evaluate('(() => [...document.querySelectorAll("input[type=password]")].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.value.length))()');
 const filled=Array.isArray(entered)&&entered.length===2&&entered.every(v=>v===password.length);
 console.log('AX23_FIRST_ADMIN_SYNTHETIC_INPUTS_MATCH='+filled);
 if(!filled){console.log('AX23_FIRST_ADMIN=BLOCKED_INPUT_NOT_ACCEPTED');ws.close();return;}
 const clicked=await evaluate('(() => {const b=document.querySelector("#init-login-button a.button-button");if(!b)return false;b.click();return true;})()');
 console.log('AX23_FIRST_ADMIN_STOCK_BUTTON_CLICKED='+Boolean(clicked));
 await delay(4000);
 const changeRequests=requests.filter(r=>r.form==='initial_login'||r.operation==='write');
 console.log('AX23_FIRST_ADMIN_STOCK_WRITE_ATTEMPTS='+JSON.stringify(changeRequests.slice(0,10)));
 let after;
 try{after=await readStockLoginForm(baseUrl,'check_factory_default')}catch(e){
  console.log('AX23_FIRST_ADMIN=READBACK_UNAVAILABLE');ws.close();return;
 }
 console.log('AX23_FIRST_ADMIN_READBACK_IS_DEFAULT='+String(after.is_default));
 console.log('AX23_FIRST_ADMIN='+((before.is_default===true && after.is_default===false)?'STOCK_TRANSITION_CONFIRMED':'NOT_CONFIRMED'));
 ws.close();
}
try{await probe()}catch(e){console.error('AX23_FIRST_ADMIN=BLOCKED_'+e.message);process.exitCode=1}
