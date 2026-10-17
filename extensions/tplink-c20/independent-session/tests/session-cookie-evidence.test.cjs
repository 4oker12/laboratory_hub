'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(base,'background.js'),'utf8');
const start=src.indexOf('function parseRouterIssuedJsession(');
const end=src.indexOf('// webRequest is observational only',start);
assert(start>=0 && end>start,'session evidence module present');
const requestCallbacks={responses:[]},cookies=[{name:'JSESSIONID',value:'SESSION_SECRET_VALUE',sameSite:'lax'}];
const chrome={runtime:{id:'a'.repeat(32)},cookies:{getAll:async({partitionKey})=>partitionKey?[]:cookies},
 webRequest:{onSendHeaders:{addListener:fn=>requestCallbacks.send=fn},
  onHeadersReceived:{addListener:fn=>requestCallbacks.responses.push(fn)}}};
const context=vm.createContext({chrome, URL:'http://192.168.0.1/',globalThis:{URL},activeLoginAudit:{started:Date.now(),wire:[]},activeStateReadAudit:null,Date});
vm.runInContext(src.slice(start,end),context);
assert.equal(context.parseRouterIssuedJsession('JSESSIONID=fresh123; Path=/; HttpOnly'),'fresh123');
assert.equal(context.parseRouterIssuedJsession('JSESSIONID=deleted123; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Path=/; HttpOnly'),null,
 'expired Set-Cookie deletion must not qualify as fresh session evidence');
assert.equal(context.parseRouterIssuedJsession('JSESSIONID=deleted123; Max-Age=0; Path=/'),null,
 'Max-Age=0 deletion must not qualify as fresh session evidence');
assert.equal(context.parseRouterIssuedJsession('JSESSIONID=fresh123; Max-Age=600; Path=/'),'fresh123');
const url='http://192.168.0.1/cgi_gdpr';
requestCallbacks.send({url,tabId:-1,requestHeaders:[{name:'Cookie',value:'JSESSIONID=SESSION_SECRET_VALUE'},{name:'Referer',value:'http://192.168.0.1/'}]});
for(const fn of requestCallbacks.responses)fn({url,tabId:-1,responseHeaders:[{name:'Set-Cookie',value:'JSESSIONID=SESSION_SECRET_VALUE; HttpOnly; SameSite=Lax'}]});
const recorded=context.activeLoginAudit.wire;
assert.equal(recorded.length,2);
assert.equal(recorded[0].cookiePresent,true);
assert.equal(recorded[0].phase,'REQUEST');
assert.equal(recorded[1].cookiePresent,true);
assert.deepEqual(Array.from(recorded[1].knownNames),['JSESSIONID']);
assert.equal(recorded[1].sameSite,'LAX');
assert(!JSON.stringify(recorded).includes('SESSION_SECRET_VALUE'));
assert(!JSON.stringify(recorded).includes('http://192.168.0.1/'));
const cookieDiagnostic=vm.runInContext('cookiePartitionEvidence()',context);
cookieDiagnostic.then(result=>{
 assert.equal(result.unpartitioned.count,1);
 assert.equal(result.partitioned.count,0);
 assert(!JSON.stringify(result).includes('SESSION_SECRET_VALUE'));
 const bad=context.evidenceHeaderFlags([{name:'Set-Cookie',value:'Authorization=ANOTHER_SECRET; SameSite=Strict'}],true);
 assert.deepEqual(Array.from(bad.knownNames),['AUTHORIZATION']);
 assert.equal(bad.sameSite,'STRICT');
 assert(!JSON.stringify(bad).includes('ANOTHER_SECRET'));
 console.log('PASS: login headers and cookie partitions are reported without any sensitive values');
}).catch(e=>{console.error(e);process.exit(1)});
