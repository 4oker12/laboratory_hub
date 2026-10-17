'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert(manifest.permissions.includes('offscreen'));
assert(manifest.content_scripts.some(x=>x.all_frames&&x.matches.includes('http://192.168.0.1/*')));
assert(fs.existsSync(path.join(root,'offscreen.html')));
assert(fs.existsSync(path.join(root,'offscreen-frame-probe.js')));
new vm.Script(fs.readFileSync(path.join(root,'offscreen-frame-probe.js'),'utf8'));

async function scenario(sendSignal){
 let handler=null,created=0,closed=0,ruleCalls=0,createdTabs=0,offscreenDetails;
 const chrome={
  runtime:{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',getURL:()=> 'chrome-extension://test/setup.html',
   onInstalled:{addListener:()=>{}},onMessage:{addListener:x=>handler=x},getContexts:async()=>[],sendMessage:async()=>{}},
  action:{onClicked:{addListener:()=>{}}},
  cookies:{getAll:async()=>[]},
  tabs:{query:async()=>[],create:async()=>{createdTabs++;throw Error('NO_TAB_ALLOWED')},onRemoved:{addListener:()=>{}}},
  offscreen:{createDocument:async(args)=>{created++;offscreenDetails=args;
    if(sendSignal)setTimeout(()=>handler({type:'C20_OFFSCREEN_FRAME_SIGNAL',isC20:true,status:'VENDOR_PROTECTED_READ_OK',readConfirmed:true,recordCount:2,has24:true,has5:true},
      {url:'http://192.168.0.1/',origin:'http://192.168.0.1'},()=>{}),2);
   },closeDocument:async()=>{closed++;}},
  declarativeNetRequest:{updateSessionRules:async(x)=>{ruleCalls++;if(x.addRules?.length)
    throw Error('Rule with id 95801 invalid header origin mutation');}}
 };
 const fakeFetch=async url=>{const p=new URL(String(url)).pathname;
  return {status:p==='/'?200:500,url:String(url),text:async()=>p==='/'?'<title>Archer C20</title><input type="password">':''};};
 const env=vm.createContext({chrome,fetch:fakeFetch,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,
   URL,URLSearchParams,setTimeout:(fn,ms)=>setTimeout(fn,ms>=6500?12:ms),clearTimeout,AbortController,console,
   btoa:global.btoa,atob:global.atob});
 env.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),env,{filename:f}));
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),env,{filename:'background.js'});
 const call=()=>new Promise(resolve=>assert(handler({type:'c20.auditOffscreen'},{url:'chrome-extension://test/setup.html'},resolve)));
 const a=await call();assert.equal(a.ok,true,a.error);
 const frame=a.data;
 assert.equal(frame.status,sendSignal?'OFFSCREEN_VENDOR_READ_CONFIRMED':'OFFSCREEN_NO_FRAME_SIGNAL');
 if(sendSignal){assert.equal(frame.vendorStatus,'VENDOR_PROTECTED_READ_OK');assert.equal(frame.readConfirmed,true);assert.equal(frame.isC20,true)}
 assert.equal(created,1);assert.equal(closed,1);assert.equal(createdTabs,0);
 assert.equal(offscreenDetails.reasons[0],'IFRAME_SCRIPTING');
 assert.equal(offscreenDetails.url,'offscreen.html');
 return {frame:frame.status,ruleCalls};
}
(async()=>{for(const signal of [true,false]){
 const r=await scenario(signal);console.log('PASS: offscreen hidden iframe diagnostic',r.frame,'DNR stage=',r.ruleCalls);
}})().catch(e=>{console.error(e);process.exit(1)});
