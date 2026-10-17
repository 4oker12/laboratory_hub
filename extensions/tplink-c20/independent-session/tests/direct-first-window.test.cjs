'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..');
let handler,tabExists=false,creates=0,windowCreates=[],stockRequests=[],vendorWindow=77;
const chrome={
 runtime:{getURL:()=> 'chrome-extension://c20/setup.html',sendMessage:async()=>{},
   onInstalled:{addListener:()=>{}},onMessage:{addListener:f=>handler=f}},
 action:{onClicked:{addListener:()=>{}}},
 tabs:{query:async()=>tabExists?[{id:71,url:'http://192.168.0.1/'}]:[],
   get:async id=>({id,windowId:vendorWindow,url:'http://192.168.0.1/',status:'complete'}),
   create:async()=>{creates++;throw Error('UNEXPECTED_ADJACENT_TAB');},
   onRemoved:{addListener:()=>{}}},
 windows:{create:async opts=>{windowCreates.push(opts);tabExists=true;return{id:vendorWindow,tabs:[{id:71}]}},
   update:async()=>{},remove:async()=>{}},
 scripting:{executeScript:async()=>[{result:{isC20:true,stage:'LOGIN_FORM',stockIoReady:false,tabExists:true}}]},
 storage:{session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}
};
const fetch=async(url,opts={})=>{
 const path=new URL(url).pathname;
 stockRequests.push({path,method:opts.method||'GET'});
 if(path==='/')return{status:200,url,text:async()=>'<title>Archer C20</title><input type="password">'};
 if(path==='/cgi/getGDPRParm')return{status:500,url,text:async()=>''};
 if(path==='/cgi/getParm')return{status:500,url,text:async()=>''};
 throw Error('UNEXPECTED_NETWORK_ROUTE '+path);
};
const c=vm.createContext({chrome,fetch,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,
  URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,btoa:global.btoa,atob:global.atob});
c.importScripts=(...names)=>names.forEach(n=>vm.runInContext(fs.readFileSync(path.join(base,n),'utf8'),c,{filename:n}));
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),c,{filename:'background.js'});
async function rpc(type,payload={}){return new Promise(resolve=>{assert(handler({type,...payload},{url:'chrome-extension://c20/setup.html'},resolve));})}
(async()=>{
 const s=await rpc('c20.discoverUnified');assert(s.ok,s.error);
 assert.equal(s.data.phase,'TRANSPORT_SETUP');assert.equal(s.data.routerTabUsed,false);
 assert.equal(s.data.transportEvidence.paramsHttp,500);assert.equal(s.data.transportEvidence.fallbackHttp,500);
 assert.equal(creates,0);assert.equal(windowCreates.length,0);
 console.log('PASS: direct Service Worker probes both stock read-only parameter endpoints; HTTP 500 creates no vendor tab');
 const b=await rpc('c20.openVendorSession');assert(b.ok,b.error);
 assert.equal(windowCreates.length,1);assert.equal(windowCreates[0].state,'minimized');
 assert.equal(windowCreates[0].type,'popup');assert.equal(windowCreates[0].focused,false);
 assert.equal(creates,0);assert.equal(b.data.stage,'LOGIN_FORM');
 console.log('PASS: explicit user opt-in starts a minimized standalone vendor window, no adjacent tab');
 const again=await rpc('c20.openVendorSession');assert(again.ok);assert.equal(again.data.reused,true);
 assert.equal(windowCreates.length,1);
 console.log('PASS: fallback is reused and not duplicated');
})().catch(e=>{console.error(e);process.exitCode=1});
