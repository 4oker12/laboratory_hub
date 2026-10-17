'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const origin='chrome-extension://'+'a'.repeat(32);
const events=new Map(),messages=[];
const win={top:{},name:'routerlab-c20-offscreen-probe',parent:{postMessage:(x)=>messages.push(x)},
  addEventListener:(name,fn)=>events.set(name,fn)};
const document={title:'Archer C20',body:{innerText:'Вы превысили пять попыток входа. Попробуйте снова через 579с.'},
  querySelectorAll:()=>[],getElementById:()=>null};
const ctx=vm.createContext({window:win,document,location:{origin:'http://192.168.0.1'},console,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','offscreen-vendor-control-main.js'),'utf8'),ctx);
(async()=>{
 const message={source:win.parent,origin,data:{type:'C20_OFFSCREEN_OPERATION',requestId:'12345678-1234-1234-1234-123456789abc',command:'inspect',args:{}}};
 await events.get('message')(message);
 assert.equal(messages.length,1);
 assert.equal(messages[0].result.stage,'LOGIN_LOCKED');
 assert.equal(messages[0].result.diagnostic.uiError,'STOCK_LOGIN_LOCKOUT_VISIBLE');
 assert(!JSON.stringify(messages).includes('579'),'suppress unneeded raw vendor lockout text');
 console.log('PASS: vendor stock lockout screen identified without credential submission or DOM leakage');
})().catch(e=>{console.error(e);process.exitCode=1});
