'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const a=code.indexOf('function validateWifiChange(req)'),b=code.indexOf('async function checkPendingWifi()',a);
assert(a>0&&b>a);
const source=code.slice(a,b);
async function scenario(mode){
 const saved={};let state24='Old_24',state5='Old_5',readCalls=0,writeCalls=0;
 const area={get:async key=>({[key]:saved[key]}),set:async object=>Object.assign(saved,object),remove:async key=>{delete saved[key]}};
 const ctx={console,setTimeout,clearTimeout,TextEncoder,Date,window:{},chrome:{storage:{session:area},scripting:{executeScript:async ()=>{writeCalls++;if(mode==='unknown')return [{result:{submitted:true,ack:'UNKNOWN_TIMEOUT'}}];state24='New_24';return[{result:{submitted:true,ack:'ACK_ZERO'}}]}}}};
 const prefix=`async function vendorWifiTransaction(){};let nativeEvidence=null,pendingWrite=null,tabId=4;const PENDING_KEY='c20PendingWifiWriteV1';`;
 const util=code.slice(code.indexOf('async function recoverPending()'),code.indexOf('function clearSession()'));
 const stubs=`async function inspectNative(){return {isC20:true,stage:'CONFIGURED_AUTHENTICATED',stockIoReady:true};}
async function nativeRead(){globalThis.readCalls++;nativeEvidence={tabId,at:Date.now(),map:{ssid24:globalThis.state24,ssid5:globalThis.state5,stack24:'1,1,1,1,1,1',stack5:'1,1,1,1,1,2'},modelConfirmed:true};return{apiVerified:true,wifi:{mapped:nativeEvidence.map}};}
`;
 ctx.state24=state24;ctx.state5=state5;ctx.readCalls=0;
 vm.createContext(ctx);vm.runInContext(prefix+util+stubs+'function messageSafe(e){return String(e.message||e)}\n'+source+'\nthis.run=nativeSetWifi;',ctx);
 const req={confirm:true,old24:'Old_24',old5:'Old_5',ssid24:'New_24',ssid5:'Old_5'};
 if(mode==='changed')ctx.state24='AlteredByOtherUser';
 const r=await ctx.run(req);
 if(mode==='changed')assert.equal(writeCalls,0);
 return{ctx,r,writeCalls,saved,req};
}
(async()=>{
 const a=await scenario('ok');assert.equal(a.r.verified,false,'simulated VM readback is intentionally fixed');assert.equal(a.writeCalls,1);assert.equal(a.ctx.readCalls>=2,true);
 // The simulated page read never picks up the mocked write: pending must persist.
 assert(a.saved.c20PendingWifiWriteV1);assert.equal(a.saved.c20PendingWifiWriteV1.stage,'PENDING_VERIFICATION');
 vm.runInContext('pendingWrite=null;nativeEvidence=null;',a.ctx); // emulate MV3 SW eviction
 let denied=await a.ctx.run(a.req);assert.equal(denied.preflightFailed,true);assert.match(String(denied.reason),/PENDING_WRITE/);assert.equal(a.writeCalls,1);
 console.log('PASS: empty SW memory -> fresh read -> one vendor SET; pending stored and duplicate blocked');
 const b=await scenario('unknown');assert.equal(b.r.verified,false);assert(b.saved.c20PendingWifiWriteV1);assert.equal(b.writeCalls,1);
 console.log('PASS: unknown ACK retains pending state across MV3 restart');
 // Stale UI baseline refuses to mutate.
 let mismatch=await scenario('changed');
 assert.equal(mismatch.r.preflightFailed,true);assert.match(mismatch.r.reason,/WIFI_CHANGED_SINCE_DISPLAY_REREAD/);assert.equal(mismatch.writeCalls,0);
 console.log('PASS: stale UI baseline rejected before ANY vendor SET');
})().catch(e=>{console.error(e);process.exitCode=1});
