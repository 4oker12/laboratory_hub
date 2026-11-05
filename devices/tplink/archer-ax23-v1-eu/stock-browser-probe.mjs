// Read-only Chrome DevTools probe against the original AX23 first-login UI.
// No form submission, secrets, credentials, request bodies, cookies or tokens.
import {setTimeout as delay} from 'node:timers/promises';
const url=process.argv[2] || 'http://127.0.0.1:18023/webpages/index.html';
async function run(){
 let tab;
 for(let i=0;i<35;i++){
  try {
   const r=await fetch('http://127.0.0.1:19223/json');
   if(r.ok){const tabs=await r.json();tab=tabs.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);if(tab)break;}
  }catch(e){}
  await delay(120);
 }
 if(!tab)throw Error('CDP_BROWSER_NOT_READY');
 const ws=new WebSocket(tab.webSocketDebuggerUrl);
 await Promise.race([
  new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('CDP_CONNECTION_ERROR')),{once:true});}),
  delay(4000).then(()=>{throw Error('CDP_CONNECTION_TIMEOUT');})
 ]);
 let counter=0;
 const callbacks=new Map(),calls=[],errors={};
 ws.addEventListener('message',e=>{
  let m;try{m=JSON.parse(e.data)}catch(_){return}
  if(m.id&&callbacks.has(m.id)){
   const p=callbacks.get(m.id);callbacks.delete(m.id);
   if(m.error)p.reject(Error('CDP_METHOD_ERROR'));else p.resolve(m.result);
  }
  if(m.method==='Runtime.exceptionThrown')errors.js=(errors.js||0)+1;
  if(m.method==='Network.loadingFailed')errors.resource=(errors.resource||0)+1;
  if(m.method==='Network.requestWillBeSent'){
   try{
    const u=new URL(m.params.request.url);
    if(u.hostname!=='127.0.0.1'||!u.pathname.startsWith('/cgi-bin/luci'))return;
    const valid=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x)?x:'REDACTED_OR_NONE';
    calls.push({method:m.params.request.method,path:u.pathname.replace(/;stok=[^/]+/g,';stok=REDACTED').slice(0,100),form:valid(u.searchParams.get('form')),operation:valid(u.searchParams.get('operation'))});
   }catch(_){}
  }
 });
 function command(method,params={}){
  const id=++counter;return new Promise((resolve,reject)=>{callbacks.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 }
 await command('Page.enable');await command('Runtime.enable');await command('Network.enable');
 await command('Page.navigate',{url});await delay(3000);
 const expression=[
  '(() => {',
  'const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden"};',
  'const clean=s=>/^[A-Za-z0-9_-]{1,64}$/.test(s)?s:"OTHER";',
  'const fields=[...document.querySelectorAll("input")].slice(0,24).map(e=>({type:clean(e.type||""),id:clean(e.id||""),name:clean(e.name||""),visible:visible(e),disabled:e.disabled}));',
  'const buttons=[...document.querySelectorAll("button,input[type=submit]")].slice(0,24).map(e=>({type:clean(e.type||""),id:clean(e.id||""),name:clean(e.name||""),visible:visible(e)}));',
  'return {ready:document.readyState,inputCount:document.querySelectorAll("input").length,scriptCount:document.querySelectorAll("script").length,bodyBytes:document.body?.outerHTML.length||0,fields,buttons};',
  '})()'
 ].join('\n');
 const r=await command('Runtime.evaluate',{expression,returnByValue:true});
 const state=r?.result?.value;if(!state||!state.fields)throw Error('STOCK_DOM_NOT_READY');
 console.log('STOCK_AX23_CDP_READ_ONLY=PASS');
 console.log('STOCK_AX23_CDP_VISIBLE_UI='+JSON.stringify(state));
 console.log('STOCK_AX23_CDP_ORIGINAL_API_REQUESTS='+JSON.stringify(calls.slice(0,24)));
 console.log('STOCK_AX23_CDP_ERROR_COUNTS='+JSON.stringify(errors));
 ws.close();
}
try{await run()}catch(e){console.error('STOCK_AX23_CDP_READ_ONLY=BLOCKED '+e.message);process.exitCode=1}
