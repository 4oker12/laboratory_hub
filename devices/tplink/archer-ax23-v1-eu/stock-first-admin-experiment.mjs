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
 let counter=0;const pending=new Map(),requests=[],byId=new Map(),loginConsoleReplies=[];
 ws.addEventListener('message',evt=>{
  let msg;try{msg=JSON.parse(evt.data)}catch(e){return}
  if(msg.id && pending.has(msg.id)){
   const p=pending.get(msg.id);pending.delete(msg.id);
   if(msg.error)p.reject(Error('CDP_COMMAND_ERROR'));else p.resolve(msg.result)
  }
  if(msg.method==='Runtime.consoleAPICalled'){
   const vals=(msg.params.args||[]).map(a=>a.value);
   if(vals[0]==='ROUTERLAB_AX23_LOGIN_META'&&typeof vals[1]==='string'){
    try{
     const x=JSON.parse(vals[1]);
     loginConsoleReplies.push({source:'stock_browser_safe_observer',
       status:x.status,success:x.success===true,json:x.json===true,
       error:typeof x.error==='string'&&/^[A-Za-z0-9 _.-]{1,48}$/.test(x.error)?x.error:'REDACTED'});
    }catch(_){}
   }
  }
  if(msg.method==='Network.requestWillBeSent'){
   try{
    const r=msg.params.request,u=new URL(r.url);
    if(u.hostname!=='127.0.0.1'||!u.pathname.includes('/cgi-bin/luci'))return;
    const safe=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(x)?x:'UNKNOWN';
    const op=u.searchParams.get('operation')||new URLSearchParams(r.postData||'').get('operation');
    const matched=u.pathname.match(/;stok=([^/]+)/);
    const form=safe(u.searchParams.get('form'));
    // Report only property NAMES from real POST; values may be password, hash or token.
    let bodyFields=[];
    if(form==='login'){
      const raw=r.postData||'';
      if(raw.startsWith('{')){
        try{bodyFields=Object.keys(JSON.parse(raw)).filter(x=>/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(x)).slice(0,18)}catch(_){}
      }else if(raw){
        bodyFields=[...new Set([...new URLSearchParams(raw).keys()].filter(x=>/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(x)))].slice(0,18);
      }
    }
    const event={method:r.method,resourceType:msg.params.type,initiatorType:msg.params.initiator?.type,
      form,operation:safe(op),status:'PENDING',hasStockToken:!!matched,
      bodyFields,_token:matched?.[1]||null,_requestId:msg.params.requestId};
    requests.push(event);byId.set(msg.params.requestId,event);
   }catch(e){}
  }
  if(msg.method==='Network.responseReceived' && byId.has(msg.params.requestId)){
   byId.get(msg.params.requestId).status=msg.params.response.status;
  }
  if(msg.method==='Network.loadingFinished' && byId.has(msg.params.requestId)){
   const entry=byId.get(msg.params.requestId);
   if(entry.form==='login'){
    // Response body is processed in memory ONLY; never emit token/secret values.
    call('Network.getResponseBody',{requestId:msg.params.requestId}).then(reply=>{
     const raw=reply.base64Encoded?Buffer.from(reply.body,'base64').toString('utf8'):reply.body;
     let parsed;
     try{parsed=JSON.parse(raw)}catch(_){entry._reply={json:false,bytes:raw.length};return;}
     const error=parsed?.errorcode;
     const safeError=typeof error==='string'&&/^[A-Za-z0-9 _.-]{1,48}$/.test(error)?error:'ABSENT_OR_REDACTED';
     entry._reply={json:true,success:parsed?.success===true,
       topKeys:parsed&&typeof parsed==='object'?Object.keys(parsed).slice(0,18):[],
       error:safeError,bytes:raw.length};
    }).catch(()=>{entry._reply={json:false,unavailable:true}});
   }
  }
  if(msg.method==='Network.loadingFailed' && byId.has(msg.params.requestId)){
   byId.get(msg.params.requestId).status='NETWORK_FAILURE';
  }
 });
 function call(method,params={}){
  return new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 }
 async function evaluate(expression){
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
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
 await delay(5500);
 // Preserve no session secret, password or token; inspect only original app state.
 const uiAfter=await evaluate([
  '(() => {',
  'const view=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden"};',
  'const visiblePwd=[...document.querySelectorAll("input[type=password]")].filter(view).length;',
  'return {urlPath:location.pathname.replace(/;stok=[^/]+/g,";stok=REDACTED").slice(0,130),',
  'hashHasStok:location.hash.includes("stok"),pathHasNonEmptyStok:/;stok=[^/]+/.test(location.pathname),',
  'initialButtonVisible:view(document.querySelector("#init-login-button a.button-button")),',
  'loginButtonVisible:view(document.querySelector("#login-lan-button a.button-button")),',
  'visiblePasswordCount:visiblePwd,',
  'quickSetupPresent:!!document.querySelector("#quick-setup,#quicksetup-container,.quick-setup-container,#quick-setup-wizard"),',
  'bodyLength:document.body?.outerHTML.length||0};',
  '})()'
 ].join('\n'));
 console.log('AX23_FIRST_ADMIN_STOCK_UI_AFTER_SUBMIT='+JSON.stringify(uiAfter));
 console.log('AX23_FIRST_ADMIN_STOCK_REQUESTS_AFTER_SUBMIT='+JSON.stringify(requests.slice(-14).map(r=>({
   form:r.form, operation:r.operation, status:r.status, method:r.method
 }))));

 const changeRequests=requests.filter(r=>r.form==='initial_login'||r.operation==='write');
 console.log('AX23_FIRST_ADMIN_STOCK_WRITE_ATTEMPTS='+JSON.stringify(changeRequests.slice(0,10)));
 let after;
 try{after=await readStockLoginForm(baseUrl,'check_factory_default')}catch(e){
  console.log('AX23_FIRST_ADMIN=READBACK_UNAVAILABLE');ws.close();return;
 }
 console.log('AX23_FIRST_ADMIN_READBACK_IS_DEFAULT='+String(after.is_default));
 console.log('AX23_FIRST_ADMIN='+((before.is_default===true && after.is_default===false)?'STOCK_TRANSITION_CONFIRMED':'NOT_CONFIRMED'));
 if(before.is_default===true && after.is_default===false){
  const ready=await evaluate([
   '(() => {const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden"};',
   'const controls=[...document.querySelectorAll("a.button-button")].filter(visible).map(e=>({label:e.textContent?.trim().replace(/\\s+/g," ").slice(0,48)||"",parentId:e.closest("[id]")?.id||""}));',
   'return {passwords:[...document.querySelectorAll("input[type=password]")].filter(visible).length,controls};})()'
  ].join(''));
  const loginCandidate=(ready?.controls||[]).filter(c=>/^(log\s*in|login|sign\s*in|войти|вхід|увійти|войти в систему)$/i.test(c.label));
  console.log('AX23_STOCK_LOGIN_FORM_SHAPE='+JSON.stringify(ready));
  console.log('AX23_STOCK_LOGIN_MATCHING_BUTTON_COUNT='+loginCandidate.length);
  if(ready?.passwords===1 && loginCandidate.length===1){
   // Observe the ORIGINAL vendor browser's XHR response. Only allowlisted
   // metadata is retained; decrypted session keys, tokens, hashes never leave RAM.
   const xhrWatch=await evaluate([
    '(() => {',
    'if(window.__routerlabXHRWatchInstalled)return true;',
    'window.__routerlabXHRWatchInstalled=true;',
    'window.__routerlabLoginResponseMeta=null;',
    'const prevOpen=XMLHttpRequest.prototype.open;',
    'XMLHttpRequest.prototype.open=function(method,url,...args){',
    'this.__routerlabIsLogin=(typeof url==="string"&&url.includes("/login?form=login"));',
    'return prevOpen.call(this,method,url,...args)};',
    'const prevSend=XMLHttpRequest.prototype.send;',
    'XMLHttpRequest.prototype.send=function(...args){',
    'if(this.__routerlabIsLogin)this.addEventListener("loadend",function(){',
    'let reply=null;try{const text=this.responseText;const body=JSON.parse(text);',
    'const err=body?.errorcode;',
    'reply={json:true,status:this.status,success:body?.success===true,',
    'error:typeof err==="string"&&/^[A-Za-z0-9 _.-]{1,48}$/.test(err)?err:"ABSENT_OR_REDACTED",',
    'topKeys:body&&typeof body==="object"?Object.keys(body).slice(0,18):[],bytes:text.length};',
    '}catch(_){reply={json:false,status:this.status}}',
    'window.__routerlabLoginResponseMeta=reply;',
    'try{console.info("ROUTERLAB_AX23_LOGIN_META",JSON.stringify(reply))}catch(_){ }',
    '});return prevSend.apply(this,args)};',
    'return true;})()'
   ].join(''));
   console.log('AX23_LOGIN_XHR_OBSERVER_INSTALLED='+Boolean(xhrWatch));
   const fetchWatch=await evaluate([
    '(() => {if(window.__routerlabFetchWatchInstalled)return true;window.__routerlabFetchWatchInstalled=true;',
    'const native=window.fetch;window.fetch=function(...args){const target=args[0];const url=typeof target==="string"?target:(target?.url||"");',
    'const observed=typeof url==="string"&&url.includes("/login?form=login");',
    'const result=native.apply(this,args);if(!observed)return result;',
    'return result.then(async resp=>{try{const raw=await resp.clone().text();const data=JSON.parse(raw);',
    'const error=data?.errorcode;const meta={json:true,status:resp.status,success:data?.success===true,',
    'error:typeof error==="string"&&/^[A-Za-z0-9 _.-]{1,48}$/.test(error)?error:"ABSENT_OR_REDACTED",',
    'topKeys:data&&typeof data==="object"?Object.keys(data).slice(0,18):[]};',
    'window.__routerlabLoginResponseMeta=meta;console.info("ROUTERLAB_AX23_LOGIN_META",JSON.stringify(meta));',
    '}catch(_){console.info("ROUTERLAB_AX23_LOGIN_META",JSON.stringify({json:false,status:resp.status}))}return resp})};',
    'return true;})()'
   ].join(''));
   console.log('AX23_LOGIN_FETCH_OBSERVER_INSTALLED='+Boolean(fetchWatch));

   await evaluate('(() => {const a=[...document.querySelectorAll("input[type=password]")].filter(e=>e.getBoundingClientRect().width>0);a[0].focus();return true})()');
   await call('Input.insertText',{text:password});
   await call('Input.dispatchKeyEvent',{type:'keyUp',key:'A',code:'KeyA'});
   await evaluate('(() => {const a=[...document.querySelectorAll("input[type=password]")].filter(e=>e.getBoundingClientRect().width>0);a[0].dispatchEvent(new Event("change",{bubbles:true}));return a[0].value.length})()');
   const length=await evaluate('(() => [...document.querySelectorAll("input[type=password]")].filter(e=>e.getBoundingClientRect().width>0)[0]?.value.length||0)()');
   console.log('AX23_STOCK_LOGIN_CREDENTIAL_INPUT_ACCEPTED='+Boolean(length===password.length));
   if(length===password.length){
    const label=loginCandidate[0].label;
    const clickedLogin=await evaluate('(() => {const label='+JSON.stringify(label)+';const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};const all=[...document.querySelectorAll("a.button-button")].filter(visible).filter(e=>e.textContent?.trim().replace(/\\s+/g," ")===label);if(all.length!==1)return false;all[0].click();return true;})()');
    console.log('AX23_STOCK_REAL_LOGIN_BUTTON_CLICKED='+Boolean(clickedLogin));
    await delay(4500);
    const afterLogin=await evaluate([
     '(() => {const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0};',
     'return {pathname:location.pathname.replace(/;stok=[^/]+/g,";stok=REDACTED").slice(0,120),',
     'hashTokenPresent:/;stok=[^/]+/.test(location.hash),pathTokenPresent:/;stok=[^/]+/.test(location.pathname),',
     'loginButtonVisible:visible(document.querySelector("#login-lan-button a.button-button")),',
     'passwordInputsVisible:[...document.querySelectorAll("input[type=password]")].filter(visible).length,',
     'vendorTokenPresent:!!localStorage.getItem("token"),',
     'indexModuleResourceCount:performance.getEntriesByType("resource").filter(e=>e.name.includes("/webpages/modules/index/")).length,',
     'vendorLoginButtonVisible:visible(document.querySelector("#local-login-button a.button-button")),',
     'wizardNavigationPresent:!!document.querySelector("#quick-setup,#quicksetup-container,.quick-setup-container"),',
     'bodyLength:document.body?.outerHTML.length||0};})()'
    ].join(''));
    const loginCalls=requests.filter(r=>r.form==='login'||r.form==='initial_login');
    console.log('AX23_STOCK_LOGIN_REQUESTS='+JSON.stringify(loginCalls.map(r=>({form:r.form,method:r.method,resourceType:r.resourceType,initiatorType:r.initiatorType,operation:r.operation,status:r.status,hasStockToken:r.hasStockToken,bodyFields:r.bodyFields}))));
    console.log('AX23_STOCK_LOGIN_UI_AFTER_SUBMIT='+JSON.stringify(afterLogin));
    const xhrReplyMeta=await evaluate('(() => window.__routerlabLoginResponseMeta || null)()');
    console.log('AX23_STOCK_LOGIN_XHR_REPLY_META='+JSON.stringify(xhrReplyMeta));
    const uiValidation=await evaluate([
     '(() => {',
     'const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=="hidden"&&s.display!=="none"};',
     'const p=[...document.querySelectorAll("input[type=password]")].filter(visible);',
     'const btn=document.querySelector("#login-lan-button a.button-button");',
     'const errors=[...document.querySelectorAll("[class*=error],[class*=errortip],[class*=invalid]")].filter(visible);',
     'return {loginLabel:btn?.textContent?.trim().slice(0,48)||"",loginButtonDisabled:btn?.disabled||false,',
     'passwordMinLength:p[0]?.minLength||0,passwordMaxLength:p[0]?.maxLength||0,',
     'visibleErrorCount:errors.length,visibleErrorClasses:errors.slice(0,5).map(e=>typeof e.className==="string"?e.className.slice(0,80):"OTHER"),',
     'passwordInputClass:p[0]?.className||""};})()'
    ].join(''));
    console.log('AX23_STOCK_LOGIN_FORM_VALIDATION='+JSON.stringify(uiValidation));
    // Real stock login result: parse only outcome/field names, never log stok or key values.
    console.log('AX23_STOCK_LOGIN_BROWSER_CONSOLE_META='+JSON.stringify(loginConsoleReplies.slice(-5)));
    let nativeLoginSuccess=xhrReplyMeta?.success===true||loginConsoleReplies.some(r=>r.success===true);
    const nativeLoginRequest=loginCalls.find(r=>r.form==='login'&&r.status===200);
    if(nativeLoginRequest?._reply){
     const meta=nativeLoginRequest._reply;
     nativeLoginSuccess=nativeLoginSuccess||meta.success===true;
     console.log('AX23_STOCK_LOGIN_SERVER_EARLY_RESULT='+JSON.stringify(meta));
    }
    if(nativeLoginRequest?._requestId && !nativeLoginRequest?._reply){
     try{
      const reply=await call('Network.getResponseBody',{requestId:nativeLoginRequest._requestId});
      const raw=reply.base64Encoded?Buffer.from(reply.body,'base64').toString('utf8'):reply.body;
      const data=JSON.parse(raw);
      nativeLoginSuccess=nativeLoginSuccess||data?.success===true;
      const errorcode=typeof data?.errorcode==='string'&&/^[A-Za-z0-9 _-]{1,38}$/.test(data.errorcode)?data.errorcode:'NONE_OR_REDACTED';
      console.log('AX23_STOCK_LOGIN_SERVER_RESULT='+JSON.stringify({
       json:true,success:data?.success===true,topKeys:Object.keys(data||{}).slice(0,20),error:errorcode
      }));
     }catch(err){console.log('AX23_STOCK_LOGIN_SERVER_RESULT=OPAQUE_OR_UNAVAILABLE');}
    }
    // Session token exists only in guest-browser memory. Use real secured stock
    // POST read callbacks (never write) and only report JSON success/field names.
    const token=loginCalls.find(r=>r.form==='login'&&r._token)?._token;
    const protectedReads=[];
    if(token){
     for(const [name,route] of [
      ['quick_setup','/admin/quick_setup?form=quick_setup'],
      ['wan_ipv4_dynamic','/admin/network?form=wan_ipv4_dynamic'],
     ]){
      const readPath='/cgi-bin/luci/;stok='+token+route;
      const expression='(async()=>{const path='+JSON.stringify(readPath)+';'
       +'const c=new AbortController();const t=setTimeout(()=>c.abort(),2800);'
       +'try{const r=await fetch(path,{method:"POST",body:new URLSearchParams({operation:"read"}),credentials:"same-origin",signal:c.signal});'
       +'const isJson=(r.headers.get("content-type")||"").includes("json");'
       +'let result=null;try{if(isJson)result=await r.json()}catch(_){ }'
       +'return {status:r.status,json:isJson,success:result?.success===true,'
       +'dataKeys:result?.data&&typeof result.data==="object"?Object.keys(result.data).slice(0,30):[],'
       +'error:typeof result?.errorcode==="string"&&/^[A-Za-z0-9 _.-]{1,48}$/.test(result.errorcode)?result.errorcode:"REDACTED_OR_NONE",'
       +'topKeys:result&&typeof result==="object"?Object.keys(result).slice(0,18):[]};'
       +'}catch(_){return {status:"NO_HTTP_RESPONSE",json:false,success:false,dataKeys:[]}}finally{clearTimeout(t)}})()';
      const response=await evaluate(expression);
      protectedReads.push({name,...response});
     }
    }
    console.log('AX23_STOCK_AUTHENTICATED_READS='+JSON.stringify(protectedReads));
    const guarded=protectedReads.some(r=>r.status===200&&r.success===true);
    console.log('AX23_STOCK_AUTHENTICATED_HANDLER='+((nativeLoginSuccess&&guarded)?'ORIGINAL_PROTECTED_READ_CONFIRMED':'NOT_CONFIRMED'));
    const loginHttp200=loginCalls.some(r=>r.form==='login'&&r.status===200);
    const sessionEvidence=nativeLoginSuccess&&guarded;
    console.log('AX23_STOCK_LOGIN='+((loginHttp200&&sessionEvidence)?'STOCK_SESSION_AND_PROTECTED_READ_CONFIRMED':'SESSION_NOT_YET_PROVEN'));
   }
  } else console.log('AX23_STOCK_LOGIN=FORM_NOT_READY');
 }
 ws.close();
}
try{await probe()}catch(e){console.error('AX23_FIRST_ADMIN=BLOCKED_'+e.message);process.exitCode=1}
