'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const here=path.resolve(__dirname,'..');
const nn='c'.repeat(128),ee='10001',seq='858738839';
async function testCase(expectedMode){
  const trace=[],activeRules=new Map();let handler,tabsOpened=0;
  const chrome={
    runtime:{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',getURL:()=> 'chrome-extension://test/setup.html',
      onInstalled:{addListener:()=>{}},onMessage:{addListener:x=>handler=x},sendMessage:async()=>{}},
    action:{onClicked:{addListener:()=>{}}},
    cookies:{getAll:async()=>[]},
    tabs:{query:async()=>[],create:async()=>{tabsOpened++;throw Error('router tab cannot be created');},
      onRemoved:{addListener:()=>{}}},
    declarativeNetRequest:{updateSessionRules:async ({removeRuleIds=[],addRules=[]})=>{
      for(const id of removeRuleIds){activeRules.delete(id);trace.push('remove:'+id)}
      for(const r of addRules){
        assert.equal(r.condition.initiatorDomains[0],chrome.runtime.id);
        assert.equal(r.condition.resourceTypes[0],'xmlhttprequest');
        assert.deepEqual(Array.from(r.condition.requestMethods),['post']);
        assert(r.condition.urlFilter.startsWith('|http://192.168.0.1/cgi/'));
        assert(!r.condition.urlFilter.includes('192.168.0.2'));
        activeRules.set(r.id,r);trace.push('install:'+r.action.requestHeaders[0].operation+':'+r.action.requestHeaders[0].header);
      }
    }}
  };
  const fetch=async (url,opts={})=>{
    const pathname=new URL(String(url)).pathname;
    if(pathname==='/')return {status:200,url:String(url),text:async()=> '<html><title>Archer C20</title>Login<input type="password"></html>'};
    if(pathname==='/cgi/getGDPRParm'){
      const rules=[...activeRules.values()];
      const header=rules[0]?.action.requestHeaders;
      const mode=!header?'PLAIN':header[0].operation==='remove'?'REMOVE_ORIGIN':'ROUTER_ORIGIN';
      const valid=mode===expectedMode;
      trace.push('request:'+mode+':'+(valid?200:500));
      return {status:valid?200:500,url:String(url),text:async()=>valid?`var nn="${nn}";var ee="${ee}";var seq=${seq};`:''};
    }
    if(pathname==='/cgi/getParm')return {status:500,url:String(url),text:async()=>''};
    throw Error('Unexpected endpoint '+pathname);
  };
  const sandbox=vm.createContext({chrome,fetch,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,setTimeout,clearTimeout,AbortController,console,btoa:global.btoa,atob:global.atob});
  sandbox.importScripts=(...files)=>{for(const f of files)vm.runInContext(fs.readFileSync(path.join(here,f),'utf8'),sandbox,{filename:f})};
  vm.runInContext(fs.readFileSync(path.join(here,'background.js'),'utf8'),sandbox,{filename:'background.js'});
  const call=(type)=>new Promise(resolve=>assert(handler({type},{url:'chrome-extension://test/setup.html'},resolve)));
  const response=await call('c20.discoverUnified');
  assert(response.ok,response.error);
  assert.equal(tabsOpened,0,'no router tab opened');
  assert.equal(activeRules.size,0,'temporary DNR rules must be removed after every probe');
  const d=response.data.transportEvidence;
  if(expectedMode==='NO_SUCCESS'){
    assert.equal(response.data.phase,'TRANSPORT_SETUP');
    assert.equal(d.headerAttempts.length,2);
    assert(d.headerAttempts.every(x=>x.http===500));
  } else {
    assert.equal(response.data.phase,'LOGIN');
    assert.equal(d.gdprParamsValid,true);
    assert.equal(d.headerSelectedMode,expectedMode);
    assert.equal(d.headerAttempts.find(x=>x.variant===expectedMode).valid,true);
    // A subsequent explicit probe must reuse the verified scoped profile.
    const p=await call('c20.probe');
    assert(p.ok,p.error);
    assert.equal(p.data.protocolReady,true);
    assert.equal(activeRules.size,0);
  }
  assert(trace.some(x=>x==='request:PLAIN:500'));
  assert(!JSON.stringify(d).includes('var nn'));
  return trace;
}
(async()=>{
  for(const mode of ['REMOVE_ORIGIN','ROUTER_ORIGIN','NO_SUCCESS']){
    const trace=await testCase(mode);
    console.log('PASS',mode,'request_count',trace.filter(x=>x.startsWith('request:')).length,'rule_cleanup',trace.filter(x=>x.startsWith('remove:')).length);
  }
})().catch(e=>{console.error(e);process.exit(1)});
