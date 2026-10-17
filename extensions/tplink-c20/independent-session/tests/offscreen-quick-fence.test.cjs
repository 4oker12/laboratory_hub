'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..');const src=fs.readFileSync(path.join(base,'background.js'),'utf8');
const map=new Map();const chrome={runtime:{getURL:x=>'chrome-extension://lab/'+x,onInstalled:{addListener(){}},onMessage:{addListener(){}}},
 action:{onClicked:{addListener(){}}},tabs:{onRemoved:{addListener(){}},query:async()=>[]},
 storage:{session:{async get(k){return {[k]:map.get(k)}},async set(o){Object.entries(o).forEach(([k,v])=>map.set(k,v))},async remove(k){map.delete(k)}}}};
const context=vm.createContext({chrome,TextEncoder,TextDecoder,Date,Promise,URL,AbortController,
 setTimeout:(cb,ms)=>setTimeout(cb,0),clearTimeout,console});
context.importScripts=(...files)=>files.forEach(name=>vm.runInContext(fs.readFileSync(path.join(base,name),'utf8'),context));
vm.runInContext(src,context);
const logs=[];const stages=['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'];let position=0;
context.__mock=async command=>{
 logs.push(command);
 if(command==='quickStage')return{stage:stages[position],signature:stages[position],markers:{isp:position===0}};
 if(command==='quickStep'){const stage=stages[position];if(position<stages.length-1)position++;
  return{step:stage,submitted:true};}
 throw Error('Unexpected command '+command)
};
vm.runInContext('offscreenCommand=(name)=>__mock(name)',context);
(async()=>{
 const r=await vm.runInContext('offscreenAutoQuick({wifi:{}})',context);
 assert.equal(r.outcome,'AUTO_QUICK_RECONNECT_REQUIRED');assert.deepEqual([...r.steps],stages);
 assert.equal(map.get('c20PendingQuickStepV1')?.stage,'SUMMARY');
 const before=logs.length;const second=await vm.runInContext('offscreenAutoQuick({wifi:{}})',context);
 assert.equal(second.outcome,'AUTO_QUICK_RECONNECT_REQUIRED');assert(!logs.slice(before).includes('quickStep'));
 console.log('PASS offscreen autoQuick: ISP -> VLAN -> wireless -> Summary; final Save never repeated');
 // The same step after an uncertain dispatch remains locked.
 map.clear();position=0;logs.length=0;
 context.__mock=async command=>{
  logs.push(command);
  if(command==='quickStage')return{stage:'ISP_WAN',signature:'ISP_WAN'};
  if(command==='quickStep')return{step:'ISP_WAN',submitted:true};
 };
 const blocked=await vm.runInContext('offscreenAutoQuick({wifi:{}})',context);
 assert.equal(blocked.outcome,'AUTO_QUICK_PENDING');assert.equal(blocked.reason,'STEP_TRANSITION_NOT_CONFIRMED_NO_RETRY');
 const n=logs.filter(x=>x==='quickStep').length;
 const again=await vm.runInContext('offscreenAutoQuick({wifi:{}})',context);
 assert.equal(again.outcome,'AUTO_QUICK_PENDING');assert.equal(logs.filter(x=>x==='quickStep').length,n);
 console.log('PASS offscreen autoQuick: unconfirmed transition blocks all retries');
})().catch(e=>{console.error(e);process.exitCode=1});
