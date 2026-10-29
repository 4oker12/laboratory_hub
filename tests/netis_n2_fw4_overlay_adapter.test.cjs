'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeRegistry}=require('../overlay/adapters/registry.js');
const {descriptor}=require('../overlay/adapters/netis-n2-fw4.js');
const origin='http://192.168.1.1';
const device={model:'N2',version:'N2-V4.0.1.4317',vender:'CIS',passwd:'1'};
const wireless={...device,wl2g_idx:'0',wl5g_idx:'1',wlan:[{rfPower:'50'},{rfPower:'100'}]};
const createContext=()=>{
  const seen=[];
  return {seen,routerOrigin:origin,pageOrigin:origin,
    async transport(req){
      seen.push(req);
      if(req.method!=='POST'||!req.path.startsWith('/cgi-bin/'))throw Error('BAD_TRANSPORT');
      const form=new URLSearchParams(req.body);
      if(req.path==='/cgi-bin/skk_get.cgi'){
        switch(form.get('app')){
          case 'base':return {status:200,text:JSON.stringify(device)};
          case 'wan_lan':return {status:200,text:JSON.stringify({...device,wan:[{type:'1'}],lanIpAddr:'192.168.1.1'})};
          case 'wlan':return {status:200,text:JSON.stringify(wireless)};
          case 'igmp':return {status:200,text:JSON.stringify({...device,igmpProxyEnabled:'0',igmpSnoopEnabled:'1'})};
          default:throw Error('UNKNOWN_READ');
        }
      }
      if(req.path==='/cgi-bin/login.cgi')return {status:200,text:'["SUCCESS"]'};
      throw Error('UNEXPECTED_WRITE');
    }
  };
};
test('registry identifies Netis N2 FW4 via read-only probe',async()=>{
  const registry=makeRegistry();
  registry.register(descriptor);
  const ctx=createContext();
  const found=await registry.detect(ctx);
  assert.equal(found.id,'netis-n2-fw4-cis');
  assert.equal(found.evidence.version,'N2-V4.0.1.4317');
  assert.equal(found.adapter.firmware,found.evidence.version);
  assert.ok(ctx.seen.every(x=>x.path==='/cgi-bin/skk_get.cgi'));
  assert.deepEqual(found.adapter.capabilities.wifiChange,'NOT_EVIDENCED');
});
test('shared adapter can read WAN Wi-Fi IGMP without changing them',async()=>{
  const registry=makeRegistry();registry.register(descriptor);
  const ctx=createContext(),matched=await registry.detect(ctx),a=matched.adapter;
  assert.equal((await a.readStatus()).mode,'CONFIGURED');
  assert.equal((await a.readWan()).type,'1');
  assert.equal((await a.readWifi())['2g'].rfPower,'50');
  assert.equal((await a.readIgmp()).snooping,true);
  assert.ok(ctx.seen.every(x=>x.path==='/cgi-bin/skk_get.cgi'));
});
test('strict router origin and sender-origin checks fail closed',async()=>{
  const registry=makeRegistry();registry.register(descriptor);
  const ctx=createContext();
  await assert.rejects(registry.detect({...ctx,pageOrigin:'http://192.168.0.1'}),/ORIGIN_MISMATCH/);
  await assert.rejects(registry.detect({...ctx,routerOrigin:'https://evil.test'}),/ORIGIN_INVALID/);
  await assert.rejects(registry.detect({...ctx,transport:null}),/TRANSPORT_REQUIRED/);
});
test('no admin password, no firmware guess, no unsafe writes on detection',async()=>{
  const r=makeRegistry();r.register(descriptor);
  const ctx=createContext();
  ctx.transport=async req=>{
    ctx.seen.push(req);
    return {status:200,text:JSON.stringify({...device,model:'Other'})};
  };
  const found=await r.detect(ctx);
  assert.equal(found.id,null);
  assert.ok(ctx.seen.every(req=>req.path==='/cgi-bin/skk_get.cgi'));
});
test('unsupported writes remain explicitly unavailable in descriptor',async()=>{
  const r=makeRegistry();r.register(descriptor);
  const found=await r.detect(createContext());
  assert.equal(found.adapter.capabilities.pppoeWrite,'NOT_EVIDENCED');
  assert.equal(found.adapter.capabilities.staticWanWrite,'NOT_EVIDENCED');
  assert.equal(found.adapter.capabilities.rebootPersistence,'NOT_EVIDENCED');
  assert.equal(typeof found.adapter.setWifi,'undefined');
  assert.equal(typeof found.adapter.setPppoe,'undefined');
});
test('mutations cannot occur without affirmative confirmation',async()=>{
  const r=makeRegistry();r.register(descriptor);
  const ctx=createContext();
  const found=await r.detect(ctx);
  await assert.rejects(found.adapter.setRadioPower('2g',50),/CONFIRMATION/);
  await assert.rejects(found.adapter.setIgmp({proxy:false,snooping:false}),/CONFIRMATION/);
  await assert.rejects(found.adapter.configureFactoryDhcp({},{}),/CONFIRMATION/);
  assert.ok(ctx.seen.every(req=>req.path==='/cgi-bin/skk_get.cgi'));
});
