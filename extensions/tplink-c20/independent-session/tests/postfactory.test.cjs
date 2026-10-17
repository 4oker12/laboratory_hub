'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'..');
let handler,created=0,inspected=0;
const document={title:'Archer C20',body:{innerText:'TP-Link Быстрая настройка Выберите поставщика интернет-услуг Страна WAN'},querySelectorAll:()=>[]};
const tabs={create:async()=>{created++;throw Error('Unexpected tab creation')},query:async()=>[{id:17,url:'http://192.168.0.1/'}],get:async()=>({id:17,url:'http://192.168.0.1/',status:'complete'}),onRemoved:{addListener:()=>{}},remove:async()=>{}};
const chrome={runtime:{getURL:()=> 'chrome-extension://test/setup.html',onInstalled:{addListener:()=>{}},onMessage:{addListener:f=>handler=f},sendMessage:async()=>{}},action:{onClicked:{addListener:()=>{}}},tabs,scripting:{executeScript:async({func})=>{inspected++;const r=vm.runInNewContext('('+func.toString()+')()', {window:{$:{io:()=>{}}},document,location:{origin:'http://192.168.0.1'}});return [{result:r}];}}};
const fetch=async (u)=>{const p=new URL(u).pathname;const root='<!doctype html><html><head><title>Archer C20</title></head><body>TP-Link Создать пароль</body></html>';return {status:p==='/'?200:500,url:u,text:async()=>p==='/'?root:'internal error'}};
const ctx=vm.createContext({chrome,fetch,URL,AbortController,setTimeout,clearTimeout,TextEncoder,TextDecoder,console});
ctx.importScripts=(...filenames)=>filenames.forEach(f=>vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),ctx,{filename:f}));
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),ctx);
function cmd(type){return new Promise(done=>handler({type},{url:'chrome-extension://test/setup.html'},done))}
(async()=>{
 const r=await cmd('c20.probe');assert(r.ok,r.error);
 assert.equal(r.data.stage,'QUICK_SETUP_ACTIVE');
 assert.equal(r.data.paramsHttp,null);assert.equal(r.data.protocolReady,true);
 assert.equal(r.data.transport,'EXISTING_ROUTER_TAB');assert.equal(created,0);
 const n=await cmd('c20.inspectNative');assert(n.ok,n.error);assert.equal(n.data.stockIoReady,true);assert.equal(n.data.stage,'QUICK_SETUP_ACTIVE');
 assert(inspected>0);
 console.log('PASS: post-factory native Quick Setup detected with GDPR HTTP 500; no new router tab, no repeated login or writes');
})().catch(e=>{console.error(e);process.exitCode=1});
