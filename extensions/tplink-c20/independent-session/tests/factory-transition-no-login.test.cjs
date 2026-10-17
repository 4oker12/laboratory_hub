'use strict';
// Regression for physical v0.7.1: CREATE_ADMIN -> transient LOGIN_FORM must
// not lose the factory submission fence or request a second password.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..'),get=f=>fs.readFileSync(path.join(base,f),'utf8');
const saved=new Map();
const chrome={runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onInstalled:{addListener(){}},onMessage:{addListener(){}},sendMessage:async()=>{throw Error('Unexpected runtime call')}},
 action:{onClicked:{addListener(){}}},tabs:{query:async()=>[],onRemoved:{addListener(){}}},
 storage:{session:{async get(key){return {[key]:saved.get(key)};},async set(obj){for(const [k,v] of Object.entries(obj))saved.set(k,v);},async remove(key){saved.delete(key);}}}};
const ctx=vm.createContext({chrome,Date,TextEncoder,TextDecoder,URL,AbortController,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout});
ctx.importScripts=(...xs)=>xs.forEach(x=>vm.runInContext(get(x),ctx,{filename:x}));
vm.runInContext(get('background.js'),ctx,{filename:'background.js'});
(async()=>{
 ctx.__stage='FACTORY_PASSWORD';ctx.__commands=[];ctx.__adminCalls=0;
 vm.runInContext(`inspectNative=async()=>null;offscreenDiscover=async()=>({stage:__stage});
   offscreenCommand=async name=>{__commands.push(name);return {stage:__stage==='QUICK_SETUP_ACTIVE'?'ISP_WAN':__stage,signature:__stage}};
   offscreenFactoryCreate=async()=>{__adminCalls++;__stage='LOGIN_FORM';return {submitted:true,verified:false}};`,ctx);
 const submitted=await vm.runInContext(`continueUnified({confirm:true,adminPassword:'EXAMPLE_PASS_ONLY',adminConfirm:'EXAMPLE_PASS_ONLY'})`,ctx);
 assert.equal(submitted.outcome,'ADMIN_SUBMITTED');
 assert.equal(ctx.__adminCalls,1,'factory password submitted once');
 assert(saved.has('c20PendingFirstPasswordV1'),'submission fence created before click');
 let r=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(r.mode,'FIRST_CONNECT');assert.equal(r.phase,'QUICK_SETUP');
 assert.equal(r.factoryTransitionPending,true);assert.equal(r.factoryObservedStage,'LOGIN_FORM');
 assert(saved.has('c20PendingFirstPasswordV1'),'first admin submission fence must survive transient login');
 assert(!ctx.__commands.includes('loginSchema'),'must not switch to regular login during factory transition');
 const wait=await vm.runInContext('offscreenAutoQuick({wifi:{}})',ctx);
 assert.equal(wait.outcome,'AUTO_QUICK_PENDING');assert.equal(wait.reason,'WAIT_FOR_STOCK_FACTORY_WIZARD_NO_LOGIN_OR_RETRY');
 assert(!ctx.__commands.includes('quickStep'),'wizard must not advance while login form is seen');
 ctx.__stage='QUICK_SETUP_ACTIVE';
 r=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(r.phase,'QUICK_SETUP');assert.equal(r.factoryTransitionPending,undefined);
 assert.equal(saved.has('c20PendingFirstPasswordV1'),false,'wizard is proof that password step advanced');
 ctx.__stage='LOGIN_FORM';
 r=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(r.phase,'LOGIN','normal login allowed after the factory transition fence has cleared');
 console.log('PASS: factory password -> transient login -> real quick setup; no second login/credential click');
})().catch(e=>{console.error(e);process.exitCode=1});
