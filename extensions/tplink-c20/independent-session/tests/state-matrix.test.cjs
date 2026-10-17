'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..');
const cases=[
 {name:'factory password',text:'Archer C20 Приступим к работе',passwordFields:2,io:false,expected:'FACTORY_CANDIDATE'},
 {name:'login form',text:'Archer C20 Вход',passwordFields:1,io:true,expected:'LOGIN_REQUIRED'},
 {name:'quick setup',text:'Archer C20 Быстрая настройка Выберите поставщика интернет-услуг Страна',passwordFields:0,io:true,expected:'QUICK_SETUP_ACTIVE'},
 {name:'dashboard',text:'Archer C20 Карта сети Интернет Беспроводной режим',passwordFields:0,io:true,expected:'CONFIGURED_AUTHENTICATED'}
];
(async()=>{for(const c of cases){
 let handler,created=0,fetchCalls=0,authPosts=0;
 const doc={title:'Archer C20',body:{innerText:c.text},querySelectorAll:s=>s==='input[type="password"]'?Array.from({length:c.passwordFields},()=>({disabled:false,getClientRects:()=>[1]})):[]};
 const tabs={query:async()=>[{id:1,url:'http://192.168.0.1/'}],get:async()=>({url:'http://192.168.0.1/',id:1,status:'complete'}),create:async()=>{created++;return {id:2}},onRemoved:{addListener(){}},remove:async()=>{}};
 const chrome={runtime:{getURL:()=> 'chrome-extension://test/setup.html',onInstalled:{addListener(){}},onMessage:{addListener:f=>handler=f},sendMessage:async()=>{}},action:{onClicked:{addListener(){}}},tabs,scripting:{executeScript:async({func,args})=>{let r=vm.runInNewContext('('+func.toString()+')(...args)',{document:doc,window:c.io?{$:{io(){}}}:{},location:{origin:'http://192.168.0.1'},args:args||[]});return[{result:r}]}}};
 const ctx=vm.createContext({chrome,fetch:async()=>{fetchCalls++;throw Error('UNEXPECTED_FETCH')},URL,AbortController,setTimeout,clearTimeout,TextEncoder,TextDecoder,console});
 ctx.importScripts=(...f)=>f.forEach(x=>vm.runInContext(fs.readFileSync(path.join(base,x),'utf8'),ctx,{filename:x}));
 vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),ctx);
 const command=(type,args={})=>new Promise(done=>handler({type,...args},{url:'chrome-extension://test/setup.html'},done));
 const p=await command('c20.probe');assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.data.stage,c.expected,c.name);
 assert.equal(created,0,c.name+' created tabs');assert.equal(fetchCalls,0,c.name+' fetched');
 const b=await command('c20.bootstrap',{confirm:true,username:'user',password:'not-a-real-password'});
 if(c.expected==='QUICK_SETUP_ACTIVE'||c.expected==='CONFIGURED_AUTHENTICATED'){
   assert(b.ok,b.error);assert.equal(b.data.authenticated,false);assert.equal(b.data.apiVerified,false);assert.equal(b.data.canApply,false);assert.equal(b.data.next,'AUTHENTICATED_READ_PROBE_REQUIRED');
   assert.equal(fetchCalls,0);assert.equal(created,0);
 } else if(c.expected==='FACTORY_CANDIDATE') {
   assert(!b.ok, 'factory bootstrap should not silently login');
   assert(/C20_FIRST_ADMIN_PASSWORD_REQUIRED/.test(b.error),b.error);
 } else {
   assert(!b.ok, 'login must not claim success without readable API');
 }
 console.log('PASS:',c.name,'->',c.expected,'no silent tab/no state probe HTTP');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
