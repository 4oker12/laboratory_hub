'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(dir,'background.js'),'utf8');
assert.match(source,/flow\.phase!=='TRANSPORT_SETUP' && flow\.phase!=='VERIFY_STATE' && flow\.phase!=='LOGIN'/);
assert.match(source,/OFFSCREEN_REFRESH_STAGE_UNRECOGNIZED/);
assert.match(source,/OFFSCREEN_CONTROL_ALREADY_PRESENT_DIAGNOSTIC_SKIPPED/);
assert(!source.includes('OFFSCREEN_ALREADY_PRESENT_NOT_OWNED'));
let pending=null,stage='POSSIBLY_AUTHENTICATED',refreshed=0,login=0,changed=0,directCalls=0;
const chrome={
 runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onInstalled:{addListener(){}},onMessage:{addListener(){}},getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT'}],
  sendMessage:async({command})=>{if(command==='pageState')return{ok:true,result:{stage,diagnostic:{storageAccess:'DENIED',cookieAccess:'NO_COOKIE_VISIBLE'}}};
   if(command==='refresh'){refreshed++;stage='LOGIN_FORM';return{ok:true,result:{refreshed:true}};}
   if(command==='inspect')return{ok:true,result:{stage,readConfirmed:false}};
   if(command==='loginSchema')return{ok:true,result:{status:'INLINE_CALL_FOUND',legacyFields:true,lowercaseFields:false,callSites:3}};
   if(command==='quickStage')return{ok:true,result:{stage:'UNKNOWN'}};
   if(command==='http'){throw Error('NO_CGI_ALLOWED_IN_LOGOUT_TEST');}
   throw Error('UNEXPECTED_COMMAND_'+command);
  }},
 action:{onClicked:{addListener(){}}},tabs:{query:async()=>[],onRemoved:{addListener(){}}},
 offscreen:{createDocument:async()=>{}},
 storage:{session:{get:async key=>({[key]:undefined}),set:async()=>{},remove:async()=>{}}},
 cookies:{getAll:async()=>[]}
};
const ctx=vm.createContext({chrome,TextEncoder,TextDecoder,URL,AbortController,
 setTimeout:(fn,ms)=>setTimeout(fn,ms>300?1:ms),clearTimeout,console,
 fetch:async()=>{directCalls++;return{status:500,url:'http://192.168.0.1/cgi/getGDPRParm',text:async()=>''}}});
ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(path.join(dir,name),'utf8'),ctx,{filename:name}));
vm.runInContext(source,ctx,{filename:'background.js'});
(async()=>{
 const one=await vm.runInContext('refreshUnifiedState()',ctx);
 assert.equal(one.phase,'LOGIN');
 assert.equal(one.stateRefresh.before,'POSSIBLY_AUTHENTICATED');
 assert.equal(one.stateRefresh.after,'LOGIN_FORM');
 assert.equal(one.stateRefresh.mode,'FRAME_RELOADED_AFTER_UNAVAILABLE');
 assert.equal(one.stateRefresh.noPasswordSent,true);
 assert.equal(refreshed,1);assert.equal(login,0);assert.equal(changed,0);
 const two=await vm.runInContext('refreshUnifiedState()',ctx);
 assert.equal(two.phase,'LOGIN');assert.equal(refreshed,2,'each explicit refresh may check whether stock login became active');
 assert.equal(two.stateRefresh.mode,'LOGIN_FORM_RELOADED');assert.equal(login,0);
 console.log('PASS: native logout -> stale offscreen -> one user-triggered reload -> LOGIN, no credential POST');
})().catch(e=>{console.error(e);process.exitCode=1});
