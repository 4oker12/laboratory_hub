'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=path.resolve(__dirname,'..');
const bg=fs.readFileSync(path.join(dir,'background.js'),'utf8');
const start=bg.indexOf('const ROUTER_COOKIE_XHR_RULE=');
const end=bg.indexOf('// The device locks out after repeated invalid passwords.',start);
assert(start>=0&&end>start);
const cid='a'.repeat(32);
const events=[];
let stored=[{name:'JSESSIONID',value:'secret-cookie-value',domain:'192.168.0.1',path:'/',sameSite:'unspecified'}];
let reject=false;
const chrome={runtime:{id:cid,onStartup:{addListener(){}}},
 cookies:{getAll:async({url})=>{assert.equal(url,'http://192.168.0.1/');return stored}},
 declarativeNetRequest:{updateSessionRules:async arg=>{if(reject&&arg.addRules)throw Error('mock browser permission rejected');events.push(arg)}}};
const c=vm.createContext({chrome,URL:'http://192.168.0.1/',console});
vm.runInContext(bg.slice(start,end),c);
(async()=>{
 const status=await vm.runInContext('prepareRouterCookieBridge()',c);
 assert.equal(status,'RULE_INSTALLED');
 const last=events.find(x=>x.addRules);
 assert(last&&last.addRules.length===2);
 const [cgi,frame]=last.addRules;
 assert.equal(cgi.id,95802);assert.equal(frame.id,95803);
 assert.equal(cgi.condition.resourceTypes[0],'xmlhttprequest');
 assert.deepEqual(Array.from(cgi.condition.tabIds),[-1]);
 assert.deepEqual(Array.from(cgi.condition.initiatorDomains),['192.168.0.1']);
 assert.match(cgi.condition.regexFilter,/cgi_gdpr/);
 assert.equal(frame.condition.resourceTypes[0],'sub_frame');
 assert.deepEqual(Array.from(frame.condition.tabIds),[-1]);
 assert.deepEqual(Array.from(frame.condition.initiatorDomains),[cid]);
 assert.equal(cgi.action.requestHeaders[0].operation,'set');
 assert.equal(cgi.action.requestHeaders[0].header,'cookie');
 assert.equal(cgi.action.requestHeaders[0].value,'JSESSIONID=secret-cookie-value');
 // Ensure the actual test browser URL regex cannot match other LAN devices.
 for(const url of ['http://192.168.0.2/cgi_gdpr','http://192.168.0.1/cgi/hack','https://192.168.0.1/cgi_gdpr']){
   assert(!new RegExp(cgi.condition.regexFilter).test(url));
 }
 assert(new RegExp(cgi.condition.regexFilter).test('http://192.168.0.1/cgi_gdpr'));
 assert(new RegExp(frame.condition.regexFilter).test('http://192.168.0.1/?routerlab_refresh=1'));
 assert(!new RegExp(frame.condition.regexFilter).test('http://192.168.0.1/cgi_gdpr'));
 await vm.runInContext('stopRouterCookieBridge()',c);
 assert.equal(events.at(-1).removeRuleIds.length,2);
 stored=[];
 assert.equal(await vm.runInContext('prepareRouterCookieBridge()',c),'COOKIE_NOT_PRESENT');
 stored=[{name:'JSESSIONID',value:'bad\r\nheader',domain:'192.168.0.1'}];
 assert.equal(await vm.runInContext('prepareRouterCookieBridge()',c),'COOKIE_NOT_PRESENT');
 stored=[{name:'JSESSIONID',value:'valid',domain:'192.168.0.1'},
         {name:'JSESSIONID',value:'another',domain:'192.168.0.1'}];
 assert.equal(await vm.runInContext('prepareRouterCookieBridge()',c),'COOKIE_AMBIGUOUS');
 stored=[{name:'JSESSIONID',value:'valid',domain:'192.168.0.1'}];
 reject=true;
 assert.equal(await vm.runInContext('prepareRouterCookieBridge()',c),'RULE_REJECTED');
 assert.equal(vm.runInContext('routerCookieBridgeActive',c),false);
  // Fresh response cookie can be bridged even if Chrome has not yet saved
 // it in any cookie partition. This is the physical 0.8.2 failure mode.
 stored=[];reject=false;
 const statusFromRsa=await vm.runInContext("prepareRouterCookieBridge('freshFromParams')",c);
 assert.equal(statusFromRsa,'RULE_INSTALLED');
 assert.equal(events.filter(x=>x.addRules).at(-1).addRules[0].action.requestHeaders[0].value,'JSESSIONID=freshFromParams');
 assert.equal(await vm.runInContext("prepareRouterCookieBridge('bad\\r\\nvalue')",c),'INVALID_FRESH_COOKIE');
 await vm.runInContext('stopRouterCookieBridge()',c);
// Audit must report only status enums, no session value.
 assert.match(bg,/receipt\.cookieBridge=await prepareRouterCookieBridge\(fresh\)/);
 assert.match(bg,/receipt\.cookieBridgeAfterLogin=await prepareRouterCookieBridge\(/);
 assert.match(bg,/if\(!cookieBridgeSessionConfirmed\)await stopRouterCookieBridge\(\)/);
 assert.match(bg,/case 'c20\.end':await stopRouterCookieBridge\(\)/);
 assert(!bg.includes('console.log(cookie)'));
 console.log('PASS: one-router, no-tab session rules; cookie sanity checks, cleanup, pre-login fence');
})().catch(e=>{console.error(e);process.exit(1)});
