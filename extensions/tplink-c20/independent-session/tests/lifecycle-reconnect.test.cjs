'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const store=new Map();
const chrome={runtime:{getURL:x=>'chrome-extension://test/'+x,onInstalled:{addListener(){}},onMessage:{addListener(){}}},action:{onClicked:{addListener(){}}},
 tabs:{onRemoved:{addListener(){}},query:async()=>[]},
 storage:{session:{async get(key){return {[key]:store.get(key)}},async set(o){for(const [k,v]of Object.entries(o))store.set(k,v)},async remove(k){store.delete(k)}}}};
const ctx=vm.createContext({chrome,Date,Promise,setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,AbortController,console});
ctx.importScripts=(...names)=>names.forEach(n=>vm.runInContext(fs.readFileSync(path.join(base,n),'utf8'),ctx,{filename:n}));
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),ctx);
const k='c20PendingQuickStepV1';
vm.runInContext('const originalDiscoverUnified=discoverUnified;',ctx);
(async()=>{
 // Save cannot be clicked twice before reconnection, even after MV3 worker restart.
 vm.runInContext(`discoverUnified=async()=>({phase:'QUICK_SETUP',verified:true});
 quickStageSnapshot=async()=>({stage:'SUMMARY',signature:'SUMMARY'});
 let clicks=0;runQuickStep=async()=>{clicks++;return{submitted:true,step:'SUMMARY'}};`,ctx);
 const first=await vm.runInContext('autoQuick()',ctx);
 assert.equal(first.outcome,'AUTO_QUICK_RECONNECT_REQUIRED');
 assert.equal(first.stage,'SUMMARY');
 assert.equal(store.get(k).stage,'SUMMARY');
 const second=await vm.runInContext('autoQuick()',ctx);
 assert.equal(second.outcome,'AUTO_QUICK_RECONNECT_REQUIRED');
 assert.equal(vm.runInContext('clicks',ctx),1);
 console.log('PASS: Save once; subsequent attempt waits for reconnect');

 // Native login page after reset does not falsely claim success or restart quick setup.
 vm.runInContext(`discoverUnified=originalDiscoverUnified;nativeSessionOptIn=true;inspectNative=async()=>({tabExists:true,isC20:true,stage:'LOGIN_FORM'});`,ctx);
 let discover=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(discover.phase,'LOGIN');
 assert.equal(discover.quickAppliedPending,true);
 assert.equal(discover.quickSetupVerified,undefined);
 console.log('PASS: after Save, login form is ordinary password-entry and verification is pending');

 // A protected read of the configured device alone is insufficient: WAN must agree.
 vm.runInContext(`inspectNative=async()=>({tabExists:true,isC20:true,stage:'CONFIGURED_AUTHENTICATED'});
 nativeRead=async()=>({apiVerified:true,wifi:{mapped:{ssid24:'Radio24',ssid5:'Radio5'},allBandsConfirmed:true}});
 nativeWanDhcpEvidence=async()=>({dhcpVerified:false,reason:'DHCP_NOT_ACTIVE'});`,ctx);
 discover=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(discover.phase,'WIFI_EDITOR');
 assert.equal(discover.quickAppliedPending,true);
 assert.equal(discover.quickSetupVerified,undefined);
 assert.equal(store.has(k),true);
 console.log('PASS: configured page without WAN readback does not produce false completed status');

 // Confirm two-band WLAN and DHCP, unlock normal editor and clear only this fence.
 vm.runInContext(`nativeWanDhcpEvidence=async()=>({dhcpVerified:true});`,ctx);
 discover=await vm.runInContext('discoverUnified()',ctx);
 assert.equal(discover.phase,'WIFI_EDITOR');
 assert.equal(discover.quickSetupVerified,true);
 assert.equal(discover.quickAppliedPending,false);
 assert.equal(store.has(k),false);
 console.log('PASS: verified after reconnect -> configured editor; factory wizard not repeated');
})().catch(e=>{console.error(e);process.exitCode=1});
