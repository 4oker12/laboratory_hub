'use strict';
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function sandbox(){
 const data=new Map();
 const chrome={runtime:{getURL:x=>'chrome-extension://routerlab/'+x,onMessage:{addListener(){}},onInstalled:{addListener(){}}},action:{onClicked:{addListener(){}}},
   tabs:{onRemoved:{addListener(){}},query:async()=>[]},
   storage:{session:{async get(key){return {[key]:data.get(key)}},async set(record){for(const [k,v] of Object.entries(record))data.set(k,v)},async remove(k){data.delete(k)}}}};
 const ctx=vm.createContext({chrome,console,TextEncoder,TextDecoder,URL,AbortController,fetch(){throw Error('not expected')},setTimeout,clearTimeout,Date,Promise});
 ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx,{filename:name}));
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx,{filename:'background.js'});
 return {ctx,data};
}
(async()=>{
 let test=sandbox();
 vm.runInContext(`discoverUnified=async()=>({phase:'QUICK_SETUP',verified:true});
   let cursor=0; const stageSequence=['ISP_WAN','WIRELESS','WIRELESS','CONFIGURED_AUTHENTICATED'];
   quickStageSnapshot=async()=>({stage:stageSequence[Math.min(cursor++,3)],signature:'stage'+stageSequence[Math.min(cursor-1,3)]});
   runQuickStep=async()=>({submitted:true,step:'ISP_WAN'});
   nativeRead=async()=>({apiVerified:true,wifi:{allBandsConfirmed:true}});
   nativeWanDhcpEvidence=async()=>({dhcpVerified:true});`,test.ctx);
 const ok=await vm.runInContext('autoQuick()',test.ctx);
 assert.equal(ok.outcome,'AUTO_QUICK_DONE');assert.equal(ok.verified.wifi,true);assert.equal(ok.verified.wanDhcp,true);
 assert.equal(test.data.has('c20PendingQuickStepV1'),false);
 test=sandbox();
 vm.runInContext(`discoverUnified=async()=>({phase:'QUICK_SETUP',verified:true});
   let cursor=0; const stages=['ISP_WAN','WIRELESS','WIRELESS','CONFIGURED_AUTHENTICATED'];
   quickStageSnapshot=async()=>({stage:stages[Math.min(cursor++,3)],signature:'stage'+stages[Math.min(cursor-1,3)]});
   runQuickStep=async()=>({submitted:true,step:'ISP_WAN'});
   nativeRead=async()=>({apiVerified:true,wifi:{allBandsConfirmed:true}});
   nativeWanDhcpEvidence=async()=>({dhcpVerified:false,reason:'DHCP_NOT_ACTIVE'});`,test.ctx);
 const partial=await vm.runInContext('autoQuick()',test.ctx);
 assert.equal(partial.outcome,'AUTO_QUICK_PENDING');assert.equal(partial.verified.wanDhcp,false);
 test=sandbox();
 vm.runInContext(`discoverUnified=async()=>({phase:'QUICK_SETUP',verified:true});
   quickStageSnapshot=async()=>({stage:'ISP_WAN',signature:'ISP_WAN|country=0'});
   runQuickStep=async()=>({submitted:false,step:'ISP_WAN',reason:'ISP_REGION_NOT_SELECTED'});`,test.ctx);
 const blocked=await vm.runInContext('autoQuick()',test.ctx);
 assert.equal(blocked.outcome,'AUTO_QUICK_BLOCKED');assert.equal(test.data.size,0);
 test=sandbox();
 await test.ctx.chrome.storage.session.set({c20PendingQuickStepV1:{stage:'ISP_WAN',signature:'ISP_WAN|country=0',at:1000}});
 vm.runInContext(`discoverUnified=async()=>({phase:'QUICK_SETUP',verified:true});
   quickStageSnapshot=async()=>({stage:'ISP_WAN',signature:'ISP_WAN|country=0'});
   runQuickStep=async()=>{throw Error('must not submit twice')};`,test.ctx);
 const guarded=await vm.runInContext('autoQuick()',test.ctx);
 assert.equal(guarded.outcome,'AUTO_QUICK_PENDING');assert.equal(guarded.reason,'PREVIOUS_STEP_MAY_HAVE_BEEN_SENT');
 const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
 const ui=fs.readFileSync(path.join(root,'setup.js'),'utf8');
 const ids=new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]));
 const missing=Array.from(ui.matchAll(/el\('([^']+)'\)/g),m=>m[1]).filter(id=>!ids.has(id));
 assert.deepEqual(missing,[]);
 assert(!html.includes('id="quick24"'));assert(!html.includes('id="firstConfirm"'));
 console.log('PASS customer auto-quick: verified completion, WAN uncertainty, missing ISP stop, session retry fence, one-password UI');
})().catch(e=>{console.error(e);process.exitCode=1});
