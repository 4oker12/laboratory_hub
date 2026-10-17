'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..'),src=f=>fs.readFileSync(path.join(base,f),'utf8');
const storage=new Map();
const chrome={
 runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,
  onInstalled:{addListener(){}},onMessage:{addListener(){}},sendMessage:async()=>{throw Error('unexpected actual message');}},
 action:{onClicked:{addListener(){}}},tabs:{query:async()=>[],onRemoved:{addListener(){}}},
 storage:{session:{async get(k){return {[k]:storage.get(k)}},async set(obj){for(const [k,v] of Object.entries(obj))storage.set(k,v)},async remove(k){storage.delete(k)}}}
};
const ctx=vm.createContext({chrome,TextEncoder,TextDecoder,URL,AbortController,
 crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout});
ctx.importScripts=(...xs)=>xs.forEach(x=>vm.runInContext(src(x),ctx,{filename:x}));
vm.runInContext(src('background.js'),ctx,{filename:'background.js'});
(async()=>{
 // Stock wizard in another tab is not proof that RouterLab owns that session.
 vm.runInContext(`
   nativeOpen=true;
   inspectNative=async()=>nativeOpen?{isC20:true,stage:'QUICK_SETUP_ACTIVE',tabExists:true,stockIoReady:true}:null;
   nativeRead=async()=>{throw Error('native wireless access not needed for stage observation');};
   offscreenDiscover=async()=>({stage:'LOGIN_FORM'});
   offscreenCommand=async command=>command==='loginSchema'?{
      status:'INLINE_CALL_FOUND',legacyFields:true,lowercaseFields:false,callSites:3
   }: {stage:'LOGIN_FORM'};
 `,ctx);
 const first=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(first.phase,'LOGIN','another tab cannot silently authorize RouterLab');
 assert.equal(first.routerTabUsed,false);
 assert(!storage.has('c20LastVisibleNativeWizardV1'));
 // Only an explicit user opt-in to the stock session permits that authority.
 vm.runInContext('nativeSessionOptIn=true',ctx);
 const native=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(native.phase,'QUICK_SETUP');
 assert.equal(native.routerTabUsed,true);
 assert(storage.has('c20LastVisibleNativeWizardV1'));
 vm.runInContext('nativeOpen=false',ctx);
 const second=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(second.phase,'LOGIN');
 assert.equal(second.previousNativeWizard,true);
 assert.equal(second.verified,false);
 assert.equal(second.transport,'OFFSCREEN_VENDOR_ORIGIN');
 console.log('PASS: native-tab wizard does not become extension authenticated session after tab closes');

 // HTTP 500 during RSA preflight allows exactly one read-only iframe refresh.
 // With a real wizard revealed, no CGI login or password send occurs.
 vm.runInContext(`
   afterRefresh='QUICK_SETUP_ACTIVE'; refreshed=false; paramsCalls=0; loginCalls=0;
   offscreenDiscover=async()=>({stage:refreshed?afterRefresh:'LOGIN_FORM'});
   offscreenCommand=async command=>{
     if(command==='frameStatus')return{frameLoads:1};
     if(command==='refresh'){refreshed=true;return{refreshed:true}};
     if(command==='quickStage')return{stage:'ISP_WAN'};
     throw Error('UNEXPECTED_COMMAND_'+command);
   };
   offscreenHttp=async path=>{
     if(path==='/cgi/getGDPRParm'){paramsCalls++;return{http:500,text:''}};
     if(path==='/cgi_gdpr')loginCalls++;
     throw Error('LOGIN_MUST_NOT_BE_SUBMITTED');
   };
 `,ctx);
 let r=await vm.runInContext("offscreenEncryptedLogin('secret-not-logged')",ctx);
 assert.equal(r.stage,'QUICK_SETUP_ACTIVE');
 assert.equal(r.submitted,false);
 assert.equal(r.diagnostic.reason,'PARAMS_REFRESH_REVEALED_WIZARD');
 assert.equal(ctx.paramsCalls,1);
 assert.equal(ctx.loginCalls,0);
 console.log('PASS: one RSA HTTP500 -> refresh reveals wizard; no encrypted password sent');

 // If still a login screen and RSA is still 500, retry parameters only once.
 vm.runInContext("afterRefresh='LOGIN_FORM';refreshed=false;paramsCalls=0;loginCalls=0",ctx);
 r=await vm.runInContext("offscreenEncryptedLogin('secret-not-logged')",ctx);
 assert.equal(r.submitted,false);
 assert.equal(r.diagnostic.reason,'PARAMS_HTTP_ERROR');
 assert.equal(r.diagnostic.paramsRecovery,'REFRESHED_AND_RETRIED');
 assert.equal(ctx.paramsCalls,2);
 assert.equal(ctx.loginCalls,0);
 console.log('PASS: repeated RSA HTTP500 prevents login submission and preserves explicit retry');

 // UI must not fence the password button if the actual login was not submitted.
 const ui=src('setup.js');
 assert(ui.includes('loginPending=result.submitted!==false'));
 assert(ui.includes('OFFSCREEN_LOGIN_NOT_SUBMITTED'));
 console.log('PASS: frontend distinguishes preflight failure from ambiguous sent login');
})().catch(e=>{console.error(e);process.exitCode=1});
