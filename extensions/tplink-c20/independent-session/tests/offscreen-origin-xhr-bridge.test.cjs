'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const script=fs.readFileSync(path.join(__dirname,'..','offscreen-vendor-control-main.js'),'utf8');
const router='http://192.168.0.1',extension='chrome-extension://'+'a'.repeat(32);
const id='11111111-1111-4111-8111-111111111111';let listener=null,actions=[],errorNext=false;
const parent={postMessage:(m,origin)=>{assert.equal(origin,extension);actions.push(m)}};
class XMLHttpRequestMock{
 headers={};open(method,url,async){this.method=method;this.url=url;assert(async)}
 setRequestHeader(k,v){this.headers[k]=v}
 send(body){this.body=body;const endpoint=new URL(this.url).pathname;
  if(endpoint==='/cgi/getGDPRParm'){assert.equal(this.method,'POST');assert.equal(body,null);assert(!('Content-Type' in this.headers));}
  else if(endpoint==='/cgi_gdpr'){assert.equal(this.method,'POST');assert.equal(this.headers['Content-Type'],'text/plain');assert.equal(body,'sign=encrypted\r\ndata=cipher\r\n');}
  else throw Error('Unknown endpoint '+endpoint);
  if(errorNext&&endpoint==='/cgi_gdpr'){errorNext=false;this.status=0;this.readyState=4;queueMicrotask(()=>this.onerror());return;}
  this.status=200;this.responseText=endpoint==='/cgi/getGDPRParm'?'var nn="test";':"ENCRYPTED_RESPONSE";
  queueMicrotask(()=>this.onload());
 }
}
const page={name:'routerlab-c20-offscreen-probe',top:{},parent,
 addEventListener:(event,fn)=>{assert.equal(event,'message');listener=fn}};
const sandbox={window:page,location:{origin:router},document:{title:'Archer C20',body:{innerText:'Archer C20'}},
 XMLHttpRequest:XMLHttpRequestMock,TextEncoder,URL,setTimeout,clearTimeout};
vm.runInNewContext(script,sandbox);
async function call(path,method,body,headers={}){
 const before=actions.length;
 listener({source:parent,origin:extension,data:{type:'C20_OFFSCREEN_OPERATION',requestId:id,
   command:'http',args:{path,method,body,headers}}});
 for(let i=0;i<40&&actions.length===before;i++)await new Promise(r=>setTimeout(r,1));
 assert(actions.length>before,'router-origin XHR must reply');return actions[actions.length-1].result;
}
(async()=>{
 const params=await call('/cgi/getGDPRParm','POST',null);assert.equal(params.http,200);
 const login=await call('/cgi_gdpr','POST','sign=encrypted\r\ndata=cipher\r\n',{'Content-Type':'text/plain'});
 assert.equal(login.http,200);assert.equal(login.text,'ENCRYPTED_RESPONSE');
 const rejected=await call('/cgi/reboot','POST',null);assert.equal(rejected.error,'ROUTE_REJECTED');
 const blocked=await call('/cgi_gdpr','POST','sign=X',{'Origin':'http://bad.test'});
 assert.equal(blocked.error,'HEADERS_REJECTED');
 errorNext=true;
 const network=await call('/cgi_gdpr','POST','sign=encrypted\r\ndata=cipher\r\n',{'Content-Type':'text/plain'});
 assert.equal(network.http,0);assert.equal(network.error,'NETWORK_ERROR');
 assert.equal(network.readyState,4);assert(Number.isInteger(network.elapsedMs));
 assert(!JSON.stringify(network).includes('cipher'));
 assert.equal(actions.length,5);
 console.log('PASS: only allowlisted XHR, safe readyState and latency on network failure');
})().catch(e=>{console.error(e);process.exitCode=1});
