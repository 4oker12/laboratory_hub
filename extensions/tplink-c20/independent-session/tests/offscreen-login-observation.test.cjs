'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(base,n),'utf8');
const events={},extid='a'.repeat(32);let handler,creation=false,loginCount=0;
const cookieItems=[{name:'Authorization',value:'SECRET_COOKIE_VALUE'}];
const chrome={
 runtime:{id:extid,getURL:p=>'chrome-extension://'+extid+'/'+p,
  onMessage:{addListener:f=>handler=f},onInstalled:{addListener(){}},
  getContexts:async()=>creation?[{contextType:'OFFSCREEN_DOCUMENT'}]:[],
  sendMessage:async req=>{
   if(req.command==='inspect')return {ok:true,result:{stage:'LOGIN_FORM',frameLoads:1,
     diagnostic:{storageAccess:'DENIED',cookieAccess:'NO_COOKIE_VISIBLE',uiError:'NO_RECOGNIZED_ERROR'}}};
   if(req.command==='login'){
     assert.equal(req.args.password,'TEST_PASSWORD_SECRET');loginCount++;
     // The worker sees one completed stock request and one content-frame signal.
     events.onCompleted?.({url:'http://192.168.0.1/cgi_gdpr?8',statusCode:200});
     handler({type:'C20_OFFSCREEN_LOGIN_CLICK_SIGNAL',result:'CLICK_RETURNED'},
       {url:chrome.runtime.getURL('offscreen.html')});
     return {ok:true,result:{submitted:true}};
   }
   throw Error('Unexpected command '+req.command);
  }},
 action:{onClicked:{addListener(){}}},tabs:{query:async()=>[],onRemoved:{addListener(){}}},
 offscreen:{createDocument:async()=>{creation=true}},
 webRequest:{onCompleted:{addListener:f=>events.onCompleted=f},onErrorOccurred:{addListener:f=>events.onErrorOccurred=f}},
 cookies:{getAll:async()=>cookieItems},
 storage:{session:{get:async()=>({}),remove:async()=>{}}}
};
const ctx=vm.createContext({chrome,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,
 URL,URLSearchParams,AbortController,btoa:global.btoa,atob:global.atob,console,
 setTimeout:(fn,ms)=>setTimeout(fn,ms>100?1:ms),clearTimeout});
ctx.importScripts=(...xs)=>xs.forEach(x=>vm.runInContext(read(x),ctx,{filename:x}));
vm.runInContext(read('background.js'),ctx,{filename:'background.js'});
const rpc=(type,args={})=>new Promise(resolve=>{
 assert.equal(handler({type,...args},{url:chrome.runtime.getURL('setup.html')},resolve),true);
});
(async()=>{
 let r=await rpc('c20.discoverUnified');assert(r.ok,r.error);assert.equal(r.data.phase,'LOGIN');
 // Legacy native-click diagnostic remains available for regression testing, but
 // the customer flow now uses a separate encrypted router-origin transport.
 const diagnostic=await vm.runInContext("offscreenLogin('TEST_PASSWORD_SECRET')",ctx);
 r={ok:true,data:{outcome:'LOGIN_PENDING',loginDiagnostic:diagnostic.diagnostic}};
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(loginCount,1);
 const d=JSON.parse(JSON.stringify(r.data.loginDiagnostic));
 assert.equal(d.click,'CLICK_RETURNED');assert.equal(d.requests.length,1);assert.equal(d.requests[0].path,'GDPR');
 assert.equal(d.requests[0].http,200);assert.equal(d.frameNavigation,false);
 assert.equal(d.storageAccess,'DENIED');assert.equal(d.cookieAccess,'NO_COOKIE_VISIBLE');assert.equal(d.cookiePresent,true);
 assert(!JSON.stringify(r).includes('TEST_PASSWORD_SECRET'));
 assert(!JSON.stringify(r).includes('SECRET_COOKIE_VALUE'));
 const previous=JSON.stringify(r.data.loginDiagnostic);
 handler({type:'C20_OFFSCREEN_LOGIN_CLICK_SIGNAL',result:'CLICK_RETURNED'},{url:'http://malicious.invalid/'});
 assert.equal(JSON.stringify(r.data.loginDiagnostic),previous);
 console.log('PASS: unverified hidden login records click/CGI/storage/navigation without secrets or retry');
})().catch(e=>{console.error(e);process.exitCode=1});
