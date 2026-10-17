'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const start=code.indexOf('async function vendorWifiTransaction(req)');
const end=code.indexOf('function validateWifiChange(req)',start);
assert(start>0&&end>start);
const routine=code.slice(start,end);
function hardware(initial={}){
 const radios=initial.radios||[
   {SSID:'TPlink_24',X_TP_Band:'2.4GHz',__stack:'1,2,3,4,5,6',X_TP_PreSharedKey:'hidden-original-24'},
   {SSID:'TPlink_5',X_TP_Band:'5GHz',__stack:'1,2,3,4,5,7',X_TP_PreSharedKey:'hidden-original-5'}
 ];
 let queue=[],getCalls=0,setCalls=0;
 const $={as:[],ds:[],act(type,object,stack,parent,attrs){
   assert.equal(object,'LAN_WLAN');
   if(type===1){getCalls++; assert.equal(stack,'0,0,0,0,0,0');return radios.map(x=>({SSID:x.SSID,X_TP_Band:x.X_TP_Band,__stack:x.__stack}));}
   if(type===2){setCalls++;queue.push({stack,attrs});return null;}
   throw Error('UNEXPECTED_TYPE_'+type);
 },exe(callback){
   if(callback){if(initial.errorCode!==undefined){queue=[];callback(initial.errorCode);return 0;}
     for(const {stack,attrs} of queue){const x=radios.find(r=>r.__stack===stack);assert(x);Object.assign(x,attrs);}
     queue=[];callback(0);return 0;
   }
   return 0;
 }};
 const ctx={window:{$,ACT_GL:1,ACT_SET:2},location:{origin:'http://192.168.0.1'},
  document:{title:'Archer C20',body:{innerText:'Основные настройки'}},
  setTimeout,clearTimeout};
 vm.createContext(ctx);vm.runInContext(routine+'\nthis.vendorWifiTransaction=vendorWifiTransaction',ctx);
 return {ctx,radios,run:ctx.vendorWifiTransaction,counts:()=>({getCalls,setCalls})};
}
const base={old24:'TPlink_24',old5:'TPlink_5',stack24:'1,2,3,4,5,6',stack5:'1,2,3,4,5,7',ssid24:'TPlink_24_NEW',ssid5:'TPlink_5'};
(async()=>{
 const h=hardware();
 const r=await h.run(base);
 assert.equal(r.submitted,true);assert.equal(r.ack,'ACK_ZERO');
 assert.equal(h.radios[0].SSID,'TPlink_24_NEW');assert.equal(h.radios[1].SSID,'TPlink_5');
 assert.equal(h.radios[0].X_TP_PreSharedKey,'hidden-original-24');
 assert.deepEqual(h.counts(),{getCalls:1,setCalls:1});
 console.log('PASS: guarded native SSID-only change uses dynamic instance stack; original key untouched');
 const changed=hardware();const denied=await changed.run({...base,old24:'WRONG'});
 assert.equal(denied.reason,'STALE_WLAN_STATE_REREAD_REQUIRED');assert.equal(changed.counts().setCalls,0);
 console.log('PASS: stale read or unexpected SSID blocks vendor SET');
 const bad=hardware();bad.ctx.document.title='Unknown Router';bad.ctx.document.body.innerText='Other';
 const blocked=await bad.run(base);assert.equal(blocked.reason,'MODEL_NOT_C20');assert.equal(bad.counts().setCalls,0);
 console.log('PASS: non-Archer page blocks writes');
 const password=hardware();const pw=await password.run({...base,ssid24:'TPlink_24',ssid5:'TPlink_5',password:'new-secret-pass'});
 assert.equal(pw.submitted,true);assert.equal(password.counts().setCalls,2);
 assert.equal(password.radios[0].X_TP_PreSharedKey,'new-secret-pass');
 assert.equal(password.radios[1].X_TP_PreSharedKey,'new-secret-pass');
 assert.equal(password.radios[0].SSID,'TPlink_24');
 console.log('PASS: user-requested new key updates both bands without changing SSID');
 const failing=hardware({errorCode:9003});const err=await failing.run(base);
 assert.equal(err.ack,'ERROR');assert.equal(err.code,9003);assert.equal(err.retrySafe,false);
 console.log('PASS: vendor error 9003 is not mistaken for success or safe retry');
 const ambiguous=hardware({radios:[
   {SSID:'A',X_TP_Band:'2.4GHz',__stack:'1,2,3,4,5,6'},
   {SSID:'B',X_TP_Band:'2.4GHz',__stack:'1,2,3,4,5,7'}
 ]});const amb=await ambiguous.run(base);assert.equal(amb.reason,'RADIO_MAPPING_CHANGED');
 assert.equal(ambiguous.counts().setCalls,0);
 console.log('PASS: ambiguous/missing 5 GHz band blocks writes');
})().catch(e=>{console.error(e);process.exitCode=1});
