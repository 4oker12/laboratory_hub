'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  NetisFW4Adapter, createFetchTransport, safeParse, fingerprint,
  stage, toSharedFlow, decodeResult, buildFactoryDhcp
} = require('../devices/netis/n2/fw4/netis-fw4.js');

// Synthetic fixtures; no credentials or SSIDs copied from the owner's HAR.
const base={model:'N2',version:'N2-V4.0.1.4317',vender:'CIS',passwd:'1'};
const factory={...base,passwd:'0',wl2g_idx:'6',wl5g_idx:'0',
  wlan:[{rfPower:'100'},{},{},{},{},{},{rfPower:'100'}]};
function mock(responses) {
  const calls=[];
  const transport=async request=>{
    calls.push(request);
    const response=responses.shift();
    if(response instanceof Error) throw response;
    return {status:response.status??200,text:response.text??JSON.stringify(response.value)};
  };
  return {calls,adapter:new NetisFW4Adapter({transport})};
}

test('safe parser accepts trailing commas but does not execute router JavaScript',()=>{
  assert.deepEqual(safeParse('{"model":"N2","a":[1,2,],"q":",]",}'),{model:'N2',a:[1,2],q:',]'});
  assert.throws(()=>safeParse('({"a":1})'));
  assert.throws(()=>safeParse('{"__proto__":{}}'),/UNSAFE_KEY/);
});
test('N2 FW4 detection and shared factory/configured flow',()=>{
  assert.equal(fingerprint(base),true);
  assert.equal(fingerprint({...base,version:'N2-V1.6'}),false);
  assert.equal(stage(factory).mode,'FACTORY');
  assert.equal(toSharedFlow(factory).mode,'FIRST_CONNECT');
  assert.equal(toSharedFlow(base).mode,'KNOWN_PASSWORD');
  assert.equal(toSharedFlow({...base,model:'N3'}).mode,'UNAVAILABLE');
});
test('GET base wire request is captured exactly',async()=>{
  const x=mock([{value:base}]);
  const r=await x.adapter.detect();
  assert.equal(r.supported,true);
  assert.equal(r.stage.mode,'CONFIGURED');
  assert.equal(x.calls[0].path,'/cgi-bin/skk_get.cgi');
  assert.equal(x.calls[0].method,'POST');
  assert.equal(new URLSearchParams(x.calls[0].body).get('app'),'base');
});
test('login uses Base64 form encoding and no token persistence',async()=>{
  const x=mock([{value:['SUCCESS']}]);
  const r=await x.adapter.login('test-login-pass');
  assert.equal(r.status,'REQUEST_OK');
  const form=new URLSearchParams(x.calls[0].body);
  assert.equal(x.calls[0].path,'/cgi-bin/login.cgi');
  assert.equal(form.get('password'),Buffer.from('test-login-pass').toString('base64'));
});
test('factory DHCP command requires state and explicit confirmation',async()=>{
  const form=buildFactoryDhcp({adminPassword:'test-admin',wifiPassword:'wifiPass123',ssid2g:'Lab2G',ssid5g:'Lab5G'},factory);
  assert.equal(form.app,'wan_set_shortcut');
  assert.equal(form.wl2g_idx,6);
  assert.equal(form.wl5g_idx,0);
  assert.equal(form.type,1);
  assert.throws(()=>buildFactoryDhcp({adminPassword:'test-admin',wifiPassword:'wifiPass123',ssid2g:'Lab2G',ssid5g:'Lab5G'},base),/NOT_FACTORY/);
  const x=mock([]);
  await assert.rejects(x.adapter.factoryDhcp({},{}),/CONFIRMATION/);
  assert.equal(x.calls.length,0);
});
test('network interruption during factory apply remains unconfirmed',async()=>{
  const x=mock([{value:factory},new TypeError('network unreachable')]);
  const result=await x.adapter.factoryDhcp({adminPassword:'test-admin',wifiPassword:'wifiPass123',ssid2g:'Lab2G',ssid5g:'Lab5G'},{confirmed:true});
  assert.equal(result.status,'APPLY_UNCONFIRMED');
  assert.equal(result.verified,false);
  assert.equal(x.calls.filter(c=>c.path==='/cgi-bin/skk_set.cgi').length,1);
});
test('radio-power mutation requires readback, not only SUCCESS',async()=>{
  const before={...factory,passwd:'1'};
  const after={...before,wlan:before.wlan.map((w,i)=>i===6?{rfPower:'50'}:w)};
  const x=mock([{value:before},{value:['SUCCESS']},{value:after}]);
  const result=await x.adapter.setRadioPower('2g',50,{confirmed:true});
  assert.equal(result.status,'READBACK_OK');
  assert.equal(result.persisted,false);
  const form=new URLSearchParams(x.calls[1].body);
  assert.equal(form.get('wl_idx'),'6');
  assert.equal(form.get('rfPower'),'50');
  assert.equal(x.calls[2].path,'/cgi-bin/skk_get.cgi');
});
test('radio-power write fails closed if confirmation absent',async()=>{
  const x=mock([]);
  await assert.rejects(x.adapter.setRadioPower('5g',50),/CONFIRMATION/);
  assert.equal(x.calls.length,0);
});
test('IGMP flags updated and verified',async()=>{
  const before={...base,igmpProxyEnabled:'1',igmpSnoopEnabled:'1'};
  const after={...base,igmpProxyEnabled:'0',igmpSnoopEnabled:'0'};
  const x=mock([{value:before},{value:['SUCCESS']},{value:after}]);
  const result=await x.adapter.setIgmp({proxy:false,snooping:false,confirmed:true});
  assert.equal(result.status,'READBACK_OK');
  const fields=new URLSearchParams(x.calls[1].body);
  assert.equal(fields.get('igmpProxyEnabled'),'0');
  assert.equal(fields.get('igmpSnoopEnabled'),'0');
});
test('router HTTP transport allowlists private IP and CGI paths',async()=>{
  const sent=[];
  const fetchImpl=async(url,options)=>{sent.push({url,options});return {status:200,text:async()=> '["SUCCESS"]'}};
  const transport=createFetchTransport({baseUrl:'http://192.168.1.1/',fetchImpl});
  await transport({path:'/cgi-bin/login.cgi',method:'POST',headers:{},body:'password=x'});
  assert.equal(sent[0].url,'http://192.168.1.1/cgi-bin/login.cgi');
  assert.equal(sent[0].options.credentials,'include');
  await assert.rejects(transport({path:'/not-a-router',method:'POST',headers:{},body:''}),/PATH_NOT_ALLOWED/);
  assert.throws(()=>createFetchTransport({baseUrl:'https://example.com/',fetchImpl}),/PRIVATE_HTTP/);
});
test('write status distinguishes reply from persistence',()=>{
  assert.equal(decodeResult(['SUCCESS']).status,'REQUEST_OK');
  assert.equal(decodeResult(['SETTING']).status,'APPLY_PENDING');
  assert.equal(decodeResult(['LOCK']).status,'LOCKED');
});
