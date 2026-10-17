'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(base,'offscreen-vendor-control-main.js'),'utf8');
const id='11111111-1111-4111-8111-111111111111';const ext='chrome-extension://'+'a'.repeat(32);
const parent={postMessage:(msg,target)=>{assert.equal(target,ext);calls.push(msg)}};
const calls=[],listeners=[], clicks=[];
let mode='login',records=[];
const root={name:'routerlab-c20-offscreen-probe',top:{},parent,$:null,ACT_GL:5,ACT_SET:2,
 addEventListener:(event,cb)=>{assert.equal(event,'message');listeners.push(cb)}};
const password={disabled:false,value:'',getClientRects:()=>[{}],dispatchEvent(){}};
const submit={disabled:false,innerText:'Войти',getClientRects:()=>[{}],click(){clicks.push('login');mode='configured'}};
const document={title:'Archer C20',body:{get innerText(){return 'Archer C20'}} ,
 querySelectorAll:sel=>{
  if(mode!=='login')return[];
  if(sel==='input[type="password"]')return [password];
  if(sel.startsWith('button'))return[submit];
  return[];
 }};
function Input(){};Object.defineProperty(Input.prototype,'value',{set(v){this._new=v;this.value=v},get(){return this._new||''}});
// The stock page exposes a TP-Link queue, with read results populated synchronously by $.exe().
root.$={as:[],ds:[],act(type,oid,stack,pStack,arg){
 assert.equal(oid,'LAN_WLAN');
 if(type===5){records=[];return records;}
 if(type===2)return {};
 throw Error('invalid type');
},exe:()=>{records.push({SSID:'FIRST_24',X_TP_Band:'2.4GHz',__stack:'1,1,0,0,0,0'},
 {SSID:'FIRST_5',X_TP_Band:'5GHz',__stack:'1,2,0,0,0,0'});return 0}};
const ctx={window:root,location:{origin:'http://192.168.0.1'},document,HTMLInputElement:Input,
 TextEncoder,Event:class Event{constructor(type){this.type=type}},setTimeout:(f,ms)=>setTimeout(f,ms>=40?2:ms),clearTimeout,console};
vm.runInNewContext(script,ctx);
async function run(command,args={}){
 const prev=calls.length;
 await Promise.all(listeners.map(fn=>fn({source:parent,origin:ext,data:{type:'C20_OFFSCREEN_OPERATION',requestId:id,command,args}})));
 for(let i=0;i<30&&calls.length===prev;i++)await new Promise(r=>setTimeout(r,1));
 assert(calls.length>prev,'reply received');return calls[calls.length-1].result;
}
(async()=>{
 const first=await run('inspect');assert.equal(first.stage,'LOGIN_FORM');
 const invalid=await run('login',{password:''});assert.equal(invalid.submitted,false);
 const auth=await run('login',{password:'TEST_PASSWORD'});assert.equal(auth.submitted,true);
 assert(!JSON.stringify(auth).includes('TEST_PASSWORD'));
 await new Promise(r=>setTimeout(r,10));assert.equal(clicks.length,1);
 const next=await run('inspect');assert.equal(next.readConfirmed,true);assert.equal(next.stage,'CONFIGURED_AUTHENTICATED');
 assert.equal(next.radio.ssid24,'FIRST_24');assert.equal(next.radio.stack5,'1,2,0,0,0,0');
 console.log('PASS: real main-world iframe routing, one password submit, protected stock read');
})().catch(err=>{console.error(err);process.exitCode=1});
