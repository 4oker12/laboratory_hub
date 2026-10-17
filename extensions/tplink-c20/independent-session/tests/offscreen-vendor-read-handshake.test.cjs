'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const mainCode=fs.readFileSync(path.join(base,'offscreen-vendor-read-main.js'),'utf8');
const isolatedCode=fs.readFileSync(path.join(base,'offscreen-frame-probe.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
assert(manifest.content_scripts.some(c=>c.world==='MAIN'&&c.js.includes('offscreen-vendor-read-main.js')&&c.all_frames));
assert(manifest.content_scripts.some(c=>c.js.includes('offscreen-frame-probe.js')&&c.all_frames));
assert.match(fs.readFileSync(path.join(base,'offscreen.html'),'utf8'),/routerlab-c20-offscreen-probe/);
async function test(mode){
 const listeners=[];const signals=[];let acts=0,execs=0;
 const router={origin:'http://192.168.0.1'};
 const w={top:{},name:'routerlab-c20-offscreen-probe',
   addEventListener:(type,fn)=>{assert.equal(type,'message');listeners.push(fn);},
   removeEventListener:(type,fn)=>{const n=listeners.indexOf(fn);if(n>=0)listeners.splice(n,1);},
   postMessage(msg,target){assert.equal(target,router.origin);queueMicrotask(()=>{
      for(const cb of [...listeners])cb({source:w,origin:router.origin,data:msg});
    });}
 };
 const pw={disabled:false,getClientRects:()=>[1]};const login={disabled:false,getClientRects:()=>[1],innerText:'Войти'};
 const $={as:mode==='busy'?[1]:[],ds:[],act:(type,oid,stack,parent,attrs)=>{
   acts++;assert.equal(type,1);assert.equal(oid,'LAN_WLAN');assert.equal(stack,'0,0,0,0,0,0');
   assert.equal(attrs.includes('X_TP_PreSharedKey'),false,'no credentials fetched');
   if(mode==='notqueued')return null;
   return $.rows=[];
 },exe:()=>{execs++;
   if(mode==='badAck')return 500;
   $.rows.push({SSID:'S24',X_TP_Band:'2.4GHz',__stack:'1,1,0,0,0,0'},
     {SSID:'S5',X_TP_Band:'5GHz',__stack:'1,2,0,0,0,0'});return 0;
 }};
 if(mode!=='unready')w.$=$;
 const document={title:'Archer C20',body:{innerText:mode==='factory'?'Создать пароль Archer C20':'Archer C20'},
   querySelectorAll:(selector)=>{
     if(selector==='input[type=password]')return mode==='login'?[pw]:mode==='factory'?[pw,pw]:[];
     if(selector.startsWith('button,'))return mode==='login'?[login]:[];
     return [];
   }};
 const setTimeoutSafe=(fn,ms)=>setTimeout(fn,ms>=6200?500:0);
 const core={window:w,location:router,document,console,setTimeout:setTimeoutSafe,clearTimeout};
 vm.runInNewContext(mainCode,core,{filename:'offscreen-vendor-read-main.js'});
 const finished=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('did not receive isolated-world signal')),1200);
  const chrome={runtime:{sendMessage:async msg=>{signals.push(msg);clearTimeout(timer);resolve(msg)}}};
  const isolate={...core,crypto:require('node:crypto').webcrypto,chrome};
  vm.runInNewContext(isolatedCode,isolate,{filename:'offscreen-frame-probe.js'});
 });
 const signal=await finished;
 assert.equal(signal.isC20,true);
 assert.equal(signal.type,'C20_OFFSCREEN_FRAME_SIGNAL');
 assert.equal(signal.readConfirmed,mode==='read');
 assert.equal(signal.status,{read:'VENDOR_PROTECTED_READ_OK',login:'LOGIN_FORM',factory:'FACTORY_PASSWORD',
   busy:'VENDOR_QUEUE_BUSY',unready:'STOCK_API_NOT_READY',badAck:'VENDOR_LIST_REJECTED',notqueued:'LIST_NOT_QUEUED'}[mode]);
 assert.equal(acts,mode==='read'||mode==='badAck'||mode==='notqueued'?1:0);
 assert.equal(execs,mode==='read'||mode==='badAck'?1:0);
 assert.equal(JSON.stringify(signal).includes('S24'),false,'SSID must not leak into diagnostic');
 assert.equal(JSON.stringify(signal).includes('1,1,0'),false,'vendor stacks must not leak');
 return signal.status;
}
(async()=>{for(const mode of ['read','login','factory','busy','unready','badAck','notqueued']){
  const s=await test(mode);console.log('PASS:',mode,s);
}})().catch(e=>{console.error(e);process.exitCode=1});
