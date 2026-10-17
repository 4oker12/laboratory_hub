'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(dir,'background.js'),'utf8');
let stage='LOGIN_FORM',refreshes=0,logins=0,protectedReads=0;
const chrome={
 runtime:{id:'b'.repeat(32),getURL:p=>'chrome-extension://'+'b'.repeat(32)+'/'+p,
  onInstalled:{addListener(){}},onMessage:{addListener(){}},
  getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT'}],
  sendMessage:async({command})=>{
   if(command==='inspect'){
    if(stage==='CONFIGURED_AUTHENTICATED'){protectedReads++;return{ok:true,result:{stage,readConfirmed:true,radio:{ssid24:'redacted-24',ssid5:'redacted-5'}}};}
    return{ok:true,result:{stage,readConfirmed:false}};
   }
   if(command==='pageState')return{ok:true,result:{stage,diagnostic:{storageAccess:'DENIED',cookieAccess:'NO_COOKIE_VISIBLE'}}};
   if(command==='refresh'){refreshes++;stage='CONFIGURED_AUTHENTICATED';return{ok:true,result:{refreshed:true}};}
   if(command==='loginSchema')return{ok:true,result:{status:'INLINE_CALL_FOUND',legacyFields:true,lowercaseFields:false,callSites:3}};
   if(command==='wanRead')return{ok:true,result:{status:'WAN_UNKNOWN'}};
   if(command==='quickStage')return{ok:true,result:{stage:'UNKNOWN'}};
   if(command==='login'){logins++;throw Error('LOGIN_MUST_NOT_BE_SENT');}
   throw Error('UNEXPECTED_COMMAND_'+command);
  }},
 action:{onClicked:{addListener(){}}},tabs:{query:async()=>[],onRemoved:{addListener(){}}},
 offscreen:{createDocument:async()=>{}},
 storage:{session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}},
 cookies:{getAll:async()=>[]}
};
const ctx=vm.createContext({chrome,TextEncoder,TextDecoder,URL,AbortController,
 setTimeout:(fn,ms)=>setTimeout(fn,ms>300?1:ms),clearTimeout,console,
 fetch:async()=>{throw Error('DIRECT_NETWORK_NOT_EXPECTED')}});
ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(path.join(dir,name),'utf8'),ctx,{filename:name}));
vm.runInContext(source,ctx,{filename:'background.js'});
(async()=>{
 const result=await vm.runInContext('refreshUnifiedState()',ctx);
 assert.equal(refreshes,1,'explicit refresh reloads stale login form once');
 assert.equal(logins,0,'must never submit credentials');
 assert.equal(protectedReads,1,'one protected stock-origin read confirms session');
 assert.equal(result.phase,'WIFI_EDITOR');assert.equal(result.verified,true);
 assert.equal(result.stateRefresh.mode,'LOGIN_FORM_RELOADED');
 assert.equal(result.stateRefresh.protectedRefreshRead,'CONFIRMED');
 assert.equal(result.stateRefresh.noPasswordSent,true);
 console.log('PASS: explicit refresh reloads stale LOGIN_FORM, confirms stock WLAN once, never sends LOGIN');
})().catch(e=>{console.error(e);process.exitCode=1});
