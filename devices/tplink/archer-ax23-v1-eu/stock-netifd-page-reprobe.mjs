// Authenticated-context stock browser RELOAD after original isolated netifd.
// Uses ONLY existing Chrome CDP session: no login, no passwords, no manual
// token access, no replaying or modifying requests. No physical router.
// Collect ONLY allowlisted original request form names and HTTP status codes.
import {setTimeout as delay} from 'node:timers/promises';

if (process.env.ROUTERLAB_AX23_SANDBOXED !== '1' ||
    process.env.ROUTERLAB_AX23_TRY_NETIFD !== '1') {
  console.error('AX23_NETIFD_PAGE_REPROBE=ISOLATION_REQUIRED');
  process.exit(2);
}

const CDP='http://127.0.0.1:19224/json';
const ALLOWED=new Set([
  'quick_setup','wan_ipv4_dynamic','wan_ipv4_status','wireless_2g',
  'wireless_5g','upgrade','all','check_factory_default','login'
]);
async function run(){
 let tab;
 for(let i=0;i<30;i++){
  try{
   const resp=await fetch(CDP);
   if(resp.ok){const arr=await resp.json();tab=arr.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);if(tab)break;}
  }catch(_){}
  await delay(100);
 }
 if(!tab){console.log('AX23_NETIFD_PAGE_REPROBE=CHROME_UNAVAILABLE');return;}
 const ws=new WebSocket(tab.webSocketDebuggerUrl);
 await Promise.race([
  new Promise((resolve,reject)=>{
   ws.addEventListener('open',resolve,{once:true});
   ws.addEventListener('error',()=>reject(new Error('CDP_CONNECT_FAILED')),{once:true});
  }),delay(4000).then(()=>{throw new Error('CDP_TIMEOUT');})
 ]);
 let n=0;
 const pending=new Map();
 const entries=new Map();
 ws.addEventListener('message',event=>{
  let msg;try{msg=JSON.parse(event.data)}catch(_){return;}
  if(msg.id&&pending.has(msg.id)){
   const cb=pending.get(msg.id);pending.delete(msg.id);
   if(msg.error)cb.reject(new Error('CDP_COMMAND_FAILED'));else cb.resolve(msg.result);
  }
  if(msg.method==='Network.requestWillBeSent'){
   try{
    const r=msg.params.request,u=new URL(r.url);
    if(u.hostname!=='127.0.0.1'||!u.pathname.includes('/cgi-bin/luci/'))return;
    const form=u.searchParams.get('form');
    if(!ALLOWED.has(form))return;
    entries.set(msg.params.requestId,{form,status:'PENDING'});
   }catch(_){}
  }
  if(msg.method==='Network.responseReceived'){
   const x=entries.get(msg.params.requestId);
   if(x)x.status=msg.params.response.status;
  }
  if(msg.method==='Network.loadingFailed'){
   const x=entries.get(msg.params.requestId);
   if(x)x.status='NETWORK_FAILURE';
  }
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++n;pending.set(id,{resolve,reject});
  ws.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const x=await call('Runtime.evaluate',{expression,returnByValue:true});
  return x?.result?.value;
 };
 try{
  await call('Network.enable');await call('Runtime.enable');await call('Page.enable');
  const pre=await evaluate('(() => ({stockTokenPresent:!!localStorage.getItem("token"),path:location.pathname.includes("/webpages/index.html")}))()');
  console.log('AX23_NETIFD_PAGE_REPROBE_PRE='+JSON.stringify(pre||{}));
  await call('Page.reload',{ignoreCache:true});
  await delay(6000);
  const post=await evaluate([
   '(() => {const v=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0};',
   'return {stockTokenPresent:!!localStorage.getItem("token"),',
   'loginFormVisible:[...document.querySelectorAll("input[type=password]")].some(v),',
   'indexResourceCount:performance.getEntriesByType("resource").filter(e=>e.name.includes("/modules/index/")).length};})()'
  ].join(''));
  const counts={};
  for(const {form,status} of entries.values()){
   if(!counts[form])counts[form]={};
   const name=String(status);
   counts[form][name]=(counts[form][name]||0)+1;
  }
  console.log('AX23_NETIFD_PAGE_REPROBE_UI='+JSON.stringify(post||{}));
  console.log('AX23_NETIFD_PAGE_REPROBE_VENDOR_FORM_HTTP='+JSON.stringify(counts));
  console.log('AX23_NETIFD_PAGE_REPROBE='+(counts.quick_setup?
    'ORIGINAL_QUICKSETUP_BROWSER_REQUEST_OBSERVED':'NO_QUICKSETUP_BROWSER_REQUEST'));
 }finally{ws.close();}
}
try{await run()}catch(e){
 console.log('AX23_NETIFD_PAGE_REPROBE=INCONCLUSIVE_'+
  String(e.message||'UNKNOWN').replace(/[^A-Z_]/g,'').slice(0,50));
 process.exitCode=1;
}
