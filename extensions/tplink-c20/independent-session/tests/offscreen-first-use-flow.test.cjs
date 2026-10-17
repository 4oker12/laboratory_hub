'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const main=fs.readFileSync(path.join(base,'offscreen-vendor-control-main.js'),'utf8');
const worker=fs.readFileSync(path.join(base,'background.js'),'utf8');
const {mock}=require('./fixtures/stock-isp.cjs');
const id='11111111-1111-4111-8111-111111111111', ext='chrome-extension://'+'a'.repeat(32);
function start(document,$,Input=class Input{}){
 let callbacks=[],msgs=[];
 const parent={postMessage(m,to){assert.equal(to,ext);msgs.push(m)}};
 const win={name:'routerlab-c20-offscreen-probe',top:{},parent,$,
  addEventListener(type,cb){if(type==='message')callbacks.push(cb)}};
 const ctx={window:win,location:{origin:'http://192.168.0.1'},document,
  HTMLInputElement:Input,TextEncoder,Event:class Event{constructor(type){this.type=type}},
  setTimeout:(f,ms)=>setTimeout(f,1),clearTimeout,console};
 vm.runInNewContext(main,ctx);
 return {async command(name,args={}){
   const n=msgs.length;
   await callbacks[0]({source:parent,origin:ext,data:{type:'C20_OFFSCREEN_OPERATION',requestId:id,command:name,args}});
   for(let i=0;i<20&&msgs.length===n;i++)await new Promise(r=>setTimeout(r,1));
   assert.equal(msgs.length,n+1,'single response');
   return JSON.parse(JSON.stringify(msgs[n].result));
 }};
}
function elem(id,value='',text=''){return{id,value,innerText:text,textContent:text,disabled:false,
 getClientRects(){return[1]},dispatchEvent(){},getAttribute(){return null}}}
(async()=>{
 // First use: the protected stock form gets two password fields. Actual click
 // occurs after the result receipt, not before it.
 let clicks=0;
 class Input{set value(x){this._value=x}get value(){return this._value||''}}
 const pass1=Object.assign(new Input(),elem('pw1'));const pass2=Object.assign(new Input(),elem('pw2'));
 const startButton=elem('start','','Приступим к работе');startButton.click=()=>{clicks++};
 const firstDoc={title:'Archer C20',body:{innerText:'Archer C20 Создайте пароль администратора'},
  getElementById:()=>null,querySelectorAll:sel=>{
   if(sel==='input[type="password"]')return[pass1,pass2];
   if(sel.startsWith('button'))return[startButton];return[];
  }};
 const factory=start(firstDoc,null,Input);
 assert.equal((await factory.command('inspect')).stage,'FACTORY_PASSWORD');
 const pre=await factory.command('factoryCreate',{password:'test_admin_ABC123'});
 assert.equal(pre.submitted,true);assert(!JSON.stringify(pre).includes('ABC123'));
 await new Promise(r=>setTimeout(r,12));assert.equal(clicks,1);
 assert.equal(pass1.value,'test_admin_ABC123');assert.equal(pass2.value,'test_admin_ABC123');
 // A live factory password field already containing input must not be overwritten.
 assert.equal((await factory.command('factoryCreate',{password:'SECOND_TEST'})).submitted,false);
 console.log('PASS offscreen first admin: exact stock form, one click, no replay');
 // Quick Setup: use precisely the stock tpSelect cascade from the hardware capture.
 const t=mock();t.document.querySelectorAll=selector=>selector==='[id]'?Object.values(t.el):[];
 const quick=start(t.document,t.$);
 assert.equal((await quick.command('quickStage')).stage,'ISP_WAN');
 const isp=await quick.command('quickStep',{ssid24:'',ssid5:'',password:''});
 assert.equal(isp.step,'ISP_WAN');assert.equal(isp.submitted,true);
 await new Promise(r=>setTimeout(r,12));assert.equal(t.nextClicks,1);
 assert.deepEqual(t.calls.filter(c=>!c.startsWith('open:')),
  ['select_country=Украина','select_city=все','select_isp=Воля','select_wan_type=Динамический IP-адрес','NEXT']);
 console.log('PASS offscreen ISP: stock country/region/provider/DHCP, single Next');
 // Summary requires the known stock goSave handler and verified WAN text.
 let saves=0;
 const pane=elem('quicksetup-process-content','','Обзор Тип интернет-подключения');
 const conntype=elem('conntype','Динамический IP-адрес');
 const save=elem('save');save.click=()=>{saves++};save.getAttribute=()=> 'goSave()';
 const e={'quicksetup-process-content':pane,conntype,save};
 const summaryDoc={title:'Archer C20',body:{innerText:'Быстрая настройка Обзор'},
  getElementById:id=>e[id]||null,querySelectorAll:selector=>selector==='[id]'?Object.values(e):[]};
 const summary=start(summaryDoc,null);
 assert.equal((await summary.command('quickStage')).stage,'SUMMARY');
 const result=await summary.command('quickStep',{ssid24:'',ssid5:'',password:''});
 assert.equal(result.submitted,true);assert.equal(result.step,'SUMMARY');
 await new Promise(r=>setTimeout(r,12));assert.equal(saves,1);
 console.log('PASS offscreen Summary: actual goSave, one click only');
 // Worker guards: factory and wizard are now routed, not rejected; no UI duplication.
 assert(worker.includes('offscreenFactoryCreate({password:pw'));
 assert(worker.includes("if(transport==='offscreen')return await offscreenAutoQuick(request)"));
 assert(!worker.includes('C20_FACTORY_OFFSCREEN_NOT_YET_SUPPORTED_NO_WRITE_SENT'));
 assert(!worker.includes('C20_QUICK_OFFSCREEN_NOT_YET_SUPPORTED_NO_WRITE_SENT'));
 console.log('PASS source routing: factory + quick use offscreen; prior supported login untouched');
})().catch(e=>{console.error(e);process.exitCode=1});
