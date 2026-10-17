'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const files=n=>fs.readFileSync(path.join(root,n),'utf8');
const manifest=JSON.parse(files('manifest.json'));
assert(manifest.content_scripts.some(x=>x.world==='MAIN'&&x.js.includes('offscreen-vendor-control-main.js')));
assert.match(files('offscreen.html'),/offscreen-controller\.js/);
assert.match(files('background.js'),/async function offscreenLogin/);
assert.match(files('background.js'),/OFFSCREEN_VENDOR_ORIGIN/);
const keys={ssid24:'ORIGINAL24',ssid5:'ORIGINAL5',stack24:'1,1,0,0,0,0',stack5:'1,2,0,0,0,0'};
let authenticated=true,creations=0,writes=0,loginCount=0,offscreenActive=false;
const memory={};let handler;
const chrome={
 runtime:{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',getURL:p=>'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'+p,
  onInstalled:{addListener(){}},onMessage:{addListener:f=>handler=f},getContexts:async()=>offscreenActive?[{contextType:'OFFSCREEN_DOCUMENT'}]:[],
  sendMessage:async m=>{
   assert.equal(m.type,'C20_OFFSCREEN_OPERATION');
   if(m.command==='inspect')return {ok:true,result:authenticated?
    {stage:'CONFIGURED_AUTHENTICATED',readConfirmed:true,radio:{...keys}}:{stage:'LOGIN_FORM'}};
   if(m.command==='login'){assert.equal(m.args.password,'realAdmin123');loginCount++;authenticated=true;return{ok:true,result:{submitted:true}}}
   if(m.command==='wifiSet'){
      assert(authenticated);assert.equal(m.args.old24,keys.ssid24);assert.equal(m.args.old5,keys.ssid5);
      assert.equal(m.args.stack24,keys.stack24);assert.equal(m.args.stack5,keys.stack5);
      writes++;keys.ssid24=m.args.ssid24;keys.ssid5=m.args.ssid5;
      return {ok:true,result:{submitted:true,ack:'ACK_ZERO'}};
   }
   if(m.command==='reboot')return{ok:true,result:{requested:false,reason:'STOCK_CONTROL_MISSING'}};
   throw Error('Unexpected command '+m.command);
  }},
 action:{onClicked:{addListener(){}}},tabs:{query:async()=>[],onRemoved:{addListener(){}}},
 offscreen:{createDocument:async opts=>{creations++;offscreenActive=true;assert.equal(opts.url,'offscreen.html')},closeDocument:async()=>{offscreenActive=false}},
 storage:{session:{get:async key=>Object.fromEntries((Array.isArray(key)?key:[key]).filter(k=>k in memory).map(k=>[k,memory[k]])),
  set:async obj=>Object.assign(memory,obj),remove:async key=>{delete memory[key]}}}
};
const t=vm.createContext({chrome,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,
 URL,URLSearchParams,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms>800?5:ms),clearTimeout,
 console,btoa:global.btoa,atob:global.atob});
t.importScripts=(...args)=>args.forEach(x=>vm.runInContext(files(x),t,{filename:x}));
vm.runInContext(files('background.js'),t,{filename:'background.js'});
const rpc=(type,args={})=>new Promise(resolve=>{
 assert(handler({type,...args},{url:chrome.runtime.getURL('setup.html')},resolve));
});
(async()=>{
 let x=await rpc('c20.discoverUnified');assert.equal(x.ok,true,x.error);
 assert.equal(x.data.phase,'WIFI_EDITOR');assert.equal(x.data.radio.ssid24,'ORIGINAL24');
 assert.equal(creations,1,'one persistent offscreen document');
 console.log('PASS: already-authenticated hidden vendor read can open editor without visible window');
 x=await rpc('c20.continueUnified',{confirm:true,ssid24:'REPLACED24',ssid5:'REPLACED5'});
 assert.equal(x.ok,true,x.error);assert.equal(x.data.outcome,'WIFI_SET');
 assert.equal(x.data.write.configVerified,true);assert.equal(x.data.write.applied,false);
 assert.equal(writes,1);
 console.log('PASS: guarded Wi-Fi write/readback, correctly not claiming on-air apply');
 x=await rpc('c20.continueUnified',{confirm:true,ssid24:'Y',ssid5:'Z'});
 assert.equal(x.ok,true,x.error);assert.equal(x.data.outcome,'PENDING_WIFI_VERIFICATION');
 assert.equal(writes,1);
 console.log('PASS: ambiguous/pending write cannot be repeated');
 assert.equal(creations,1,'hidden frame persists through all operations');
})().catch(e=>{console.error(e);process.exitCode=1});
