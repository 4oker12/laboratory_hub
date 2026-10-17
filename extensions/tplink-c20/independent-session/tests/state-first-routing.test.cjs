'use strict';
// Hardware-inspired contract: router may reply login $.ret=0 but still be in
// Quick Setup. A read failure alone must never classify a password failure.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..'),src=f=>fs.readFileSync(path.join(base,f),'utf8');
const stored=new Map();
const chrome={
  runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,
    onInstalled:{addListener(){}},onMessage:{addListener(){}},sendMessage:async()=>{throw Error('No actual transport in this test');}},
  action:{onClicked:{addListener(){}}},tabs:{query:async()=>[],onRemoved:{addListener(){}}},
  storage:{session:{async get(k){return {[k]:stored.get(k)};},async set(o){for(const [k,v] of Object.entries(o))stored.set(k,v);},async remove(k){stored.delete(k);}}}
};
const ctx=vm.createContext({chrome,Date,TextEncoder,TextDecoder,URL,AbortController,
  crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout});
ctx.importScripts=(...xs)=>xs.forEach(x=>vm.runInContext(src(x),ctx,{filename:x}));
vm.runInContext(src('background.js'),ctx,{filename:'background.js'});
(async()=>{
  ctx.currentScreen='LOGIN_FORM';ctx.refreshCount=0;ctx.readCount=0;ctx.loginCount=0;
  ctx.refreshStage='QUICK_SETUP_ACTIVE';ctx.wizardStep='ISP_WAN';
  vm.runInContext(`
    inspectNative=async()=>null;
    offscreenDiscover=async()=>({stage:currentScreen,readConfirmed:false});
    offscreenCommand=async(cmd)=>{
      if(cmd==='refresh'){refreshCount++;currentScreen=refreshStage;return {refreshed:true};}
      if(cmd==='quickStage')return {stage:currentScreen==='QUICK_SETUP_ACTIVE'?wizardStep:currentScreen};
      if(cmd==='loginSchema')return {status:'INLINE_CALL_FOUND',legacyFields:true,lowercaseFields:false,callSites:3};
      throw Error('unexpected '+cmd);
    };
    read=async()=>{readCount++;throw Error('C20_WLAN_INCOMPLETE');};
    offscreenEncryptedLogin=async()=>{loginCount++;return {stage:'LOGIN_STATE_UNRESOLVED'};};
  `,ctx);
  let found=await vm.runInContext('checkAcceptedLoginState()',ctx);
  assert.equal(found.stage,'QUICK_SETUP_ACTIVE');
  assert.equal(found.wizardStep,'ISP_WAN');
  assert.equal(ctx.refreshCount,1);
  assert.equal(stored.has('c20PendingAcceptedLoginStateV1'),false,'wizard evidence resolves fence');
  let route=await vm.runInContext('discoverUnified()',ctx);
  assert.equal(route.phase,'QUICK_SETUP');
  assert.equal(ctx.readCount,0,'wizard must precede stale protected WLAN read');
  console.log('PASS: login ACK -> stock wizard after one refresh; no WLAN read and no password resend');

  ctx.currentScreen='LOGIN_FORM';ctx.refreshStage='LOGIN_FORM';ctx.refreshCount=0;
  found=await vm.runInContext('checkAcceptedLoginState()',ctx);
  assert.equal(found.stage,'UNKNOWN');
  assert.equal(ctx.refreshCount,1,'bounded one refresh only');
  assert.equal(stored.has('c20PendingAcceptedLoginStateV1'),true,'unknown state is fenced');
  route=await vm.runInContext('discoverUnified()',ctx);
  assert.equal(route.phase,'VERIFY_STATE');
  assert.equal(route.action,'VERIFY_WITHOUT_PASSWORD');
  assert.equal(route.verified,false);
  const r=await vm.runInContext(`continueUnified({confirm:true,adminPassword:'dummyOnly'}) .then(x=>x).catch(e=>({error:e.message}))`,ctx);
  assert.match(r.error||r.reason,/FLOW_NOT_READY_VERIFY_STATE/);
  assert.equal(ctx.loginCount,0,'no repeated login during unresolved state');
  console.log('PASS: unknown state persists, no password retry, verify required');

  stored.delete('c20PendingAcceptedLoginStateV1');ctx.currentScreen='LOGIN_LOCKED';
  route=await vm.runInContext('discoverUnified()',ctx);
  assert.equal(route.phase,'AUTH_LOCKED');
  assert.equal(route.action,'WAIT_LOCKOUT');
  console.log('PASS: visible lockout blocks authentication attempt');
})().catch(e=>{console.error(e);process.exitCode=1;});
