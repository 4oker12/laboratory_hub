'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root,'offscreen-vendor-read-main.js'),'utf8');
const isolated = fs.readFileSync(path.join(root,'offscreen-frame-probe.js'),'utf8');
const nn = 'd'.repeat(128), ee='10001', seq='98654123';

async function trial(outcome) {
  const url='http://192.168.0.1';
  const listeners=[], posted=[], calls=[], headers=[];
  const context={top:{},name:'routerlab-c20-offscreen-probe',
    addEventListener:(name,fn)=>{assert.equal(name,'message');listeners.push(fn)},
    removeEventListener:(name,fn)=>{let at=listeners.indexOf(fn);if(at>=0)listeners.splice(at,1)},
    postMessage(msg,target){assert.equal(target,url);posted.push(msg);queueMicrotask(()=>{
      for(const fn of [...listeners])fn({source:context,origin:url,data:msg});
    })}
  };
  class FakeXHR {
    constructor(){this.status=0;this.responseText='';}
    open(method,target,asyncFlag){calls.push({method,target,asyncFlag})}
    setRequestHeader(name,value){headers.push([name,value])}
    send(body){calls[0].body=body;queueMicrotask(()=>{
      if(outcome==='error')return this.onerror();
      this.status=outcome==='valid'?200:500;
      this.responseText=outcome==='valid'?`var nn="${nn}";var ee="${ee}";var seq=${seq};`:'Server Error';
      this.onload();
    })}
  }
  const vendor = {as:[],ds:[],act:()=>{
    const rows=[];vendor.rows=rows;return rows;
  },exe:()=>{
    vendor.rows.push({SSID:'SUPER_SECRET_WIFI_NAME',X_TP_Band:'2.4GHz',__stack:'1,1,0,0,0,0'},
     {SSID:'FIVE_SECRET',X_TP_Band:'5GHz',__stack:'1,2,0,0,0,0'});return 0;
  }};
  context.$=vendor;context.ACT_GL=5;
  const doc={title:'Archer C20',body:{innerText:'Archer C20'},querySelectorAll:()=>[]};
  const env={window:context,location:{origin:url},document:doc,
    XMLHttpRequest:FakeXHR,console,setTimeout,clearTimeout};
  vm.runInNewContext(main,env,{filename:'offscreen-vendor-read-main.js'});
  const signal=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('no safe result')),500);
    const chrome={runtime:{sendMessage:async result=>{clearTimeout(timer);resolve(result)}}};
    vm.runInNewContext(isolated,{...env,chrome,crypto:require('node:crypto').webcrypto},
      {filename:'offscreen-frame-probe.js'});
  });
  assert.deepEqual(calls,[{method:'POST',target:url+'/cgi/getGDPRParm',asyncFlag:true,body:null}]);
  assert.deepEqual(Array.from(headers,([name,value])=>[name,value]),
   [['Accept','*/*'],['Cache-Control','no-cache'],['Pragma','no-cache']]);
  assert.equal(signal.gdprHttp,outcome==='valid'?200:outcome==='http500'?500:0);
  assert.equal(signal.gdprValid,outcome==='valid');
  assert.equal(signal.gdprStatus,outcome==='valid'?'RSA_PARAMS_VALID':outcome==='http500'?'HTTP_OR_BODY_UNCONFIRMED':'XHR_NETWORK_ERROR');
  assert.equal(signal.status,'VENDOR_PROTECTED_READ_OK');
  assert.equal(signal.readConfirmed,true);
  assert(!JSON.stringify(signal).includes(nn));
  assert(!JSON.stringify(signal).includes(seq));
  assert(!JSON.stringify(signal).includes('SECRET'));
  assert(!JSON.stringify(signal).includes('__stack'));
  console.log('PASS: vendor iframe same-origin GDPR XHR',outcome,signal.gdprStatus);
}
(async()=>{for(const o of ['valid','http500','error'])await trial(o)})().catch(err=>{console.error(err);process.exitCode=1});
