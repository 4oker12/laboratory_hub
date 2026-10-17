'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const folder=path.join(__dirname,'..');
let handler, tabCreates=0, factoryClicks=0, directParamMode='valid';
const pwFields=[{value:'',disabled:false,getClientRects:()=>[1],dispatchEvent:()=>{}},{value:'',disabled:false,getClientRects:()=>[1],dispatchEvent:()=>{}}];
const button={innerText:'Приступим к работе',disabled:false,getClientRects:()=>[1],click:()=>{factoryClicks++}};
class FakeInput{}
Object.defineProperty(FakeInput.prototype,'value',{set:function(v){this._value=v;this.valueSeen=v},configurable:true});
const document={title:'Archer C20',body:{innerText:'TP-Link Новый пароль Подтвердите пароль'},querySelectorAll:sel=>sel==='input[type="password"]'?pwFields:sel==='button,input[type="submit"],a[role="button"]'?[button]:[]};
const chrome={runtime:{getURL:()=> 'chrome-extension://test/setup.html',onInstalled:{addListener:()=>{}},onMessage:{addListener:f=>handler=f},sendMessage:async()=>{}},action:{onClicked:{addListener:()=>{}}},tabs:{create:async (args)=>{if(args.url.startsWith('http')){tabCreates++;return{id:99,url:args.url,status:'complete'}}return{id:101}},query:async()=>[],get:async()=>({id:99,status:'complete',url:'http://192.168.0.1/'}),onRemoved:{addListener:()=>{}},remove:async()=>{}},scripting:{executeScript:async ({func,args})=>{
 // The in-page world supplies DOM objects and browser global constructors.
 const results=vm.runInNewContext('('+func.toString()+')('+JSON.stringify(args[0])+')',{location:{origin:'http://192.168.0.1'},document,HTMLInputElement:FakeInput,Event:class {},});
 return[{result:results}];
}}};
const root='<!doctype html><html><head><title>Archer C20</title></head><body>TP-Link Создать пароль Новый пароль Подтвердите пароль</body></html>';
const ctx=vm.createContext({chrome,crypto:webcrypto,TextEncoder,TextDecoder,URL,AbortController,setTimeout,clearTimeout,btoa,atob,console,
 fetch:async (u,o={})=>({status:200,url:u,text:async()=>new URL(u).pathname==='/'?root:(directParamMode==='valid'?'var nn=xxxxxxxx; var ee=010001; var seq=12345;':'none')})});
ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(folder,file),'utf8'),ctx,{filename:file}));
vm.runInContext(fs.readFileSync(path.join(folder,'background.js'),'utf8'),ctx);
async function cmd(type,params={}){return new Promise(ok=>handler({type,...params},{url:'chrome-extension://test/setup.html'},ok))}
(async()=>{
 const p=await cmd('c20.probe');assert(p.ok,p.error);assert.equal(p.data.stage,'FACTORY_CANDIDATE');assert.equal(p.data.transport,'SERVICE_WORKER_DIRECT');assert.equal(tabCreates,0);
 const auth=await cmd('c20.login',{password:'supersecure123'});assert(!auth.ok);assert.match(auth.error,/FIRST_ADMIN_PASSWORD_REQUIRED/);
 const wrong=await cmd('c20.factoryCreate',{confirm:true,password:'supersecure123',passwordConfirm:'different'});assert(!wrong.ok);assert.equal(tabCreates,0);
 const r=await cmd('c20.factoryCreate',{confirm:true,password:'supersecure123',passwordConfirm:'supersecure123'});
 assert(r.ok,r.error);assert.equal(r.data.submitted,true);assert.equal(r.data.verified,false);assert.equal(tabCreates,1);assert.equal(factoryClicks,1);
 assert.equal(pwFields[0].valueSeen,'supersecure123');assert.equal(pwFields[1].valueSeen,'supersecure123');
 console.log('PASS: FACTORY PROBE ZERO TABS; login blocked; factory password matching/explicit consent; native UI invoked exactly once; no fake verification');
})().catch(e=>{console.error(e);process.exitCode=1});
