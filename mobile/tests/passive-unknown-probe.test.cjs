'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const p=path.join(__dirname,'../RouterLabMobile/Resources/RouterLabPassiveUnknownProbe.js');
const probe=require(p);
function report(input){const x=probe.inspect(input);assert.equal(x.status,'WEB_PAGE_REACHABLE');
assert.equal(x.verified,false);assert.equal(x.authenticated,false);assert.equal(x.canWrite,false);return x;}
const specimens=[
  [{title:'TP-Link Archer AX23'},'TP-Link','Archer AX23'],
  [{title:'ASUS RT-AX58U Router Login'},'ASUS','RT-AX58U'],
  [{title:'D-Link DIR-X1860'},'D-Link','DIR-X1860'],
  [{title:'Cudy WR3000'},'Cudy','WR3000'],
  [{title:'Netis N2'},'Netis','N2'],
  [{title:'Mercusys MR70X'},'Mercusys','MR70X'],
  [{title:'Tenda AC10'},'Tenda','AC10']
];
for(const [input,vendor,model] of specimens){
  const r=report(input);
  assert.equal(r.vendor,vendor,JSON.stringify(input));
  assert.equal(r.modelHint,model,JSON.stringify(input));
  assert.equal(r.confidence,'MODEL_HINT');
}
const unknown=report({title:'Router Login',passwordCount:1});
assert.equal(unknown.vendor,'');assert.equal(unknown.modelHint,'');
assert.equal(unknown.confidence,'UNKNOWN');assert.equal(unknown.ui,'PASSWORD_FORM');
assert.equal(report({title:'Router Setup',passwordCount:2}).ui,'MULTIPLE_PASSWORD_FIELDS');
assert.equal(report({title:'TP-Link',framework:'TPLINK_SU'}).family,'TPLINK_SU_CANDIDATE');
assert.equal(report({title:'Cudy',pagePath:'/cgi-bin/luci/'}).family,'LUCI_CANDIDATE');
assert.equal(report({title:'OpenWrt',pagePath:'/cgi-bin/luci/'}).vendor,'');
const ambiguous=report({title:'TP-Link ASUS Router'});
assert.equal(ambiguous.vendor,'');
assert.equal(ambiguous.ambiguous,true);
const fakeDOM={
  title:'ASUS RT-AX58U / Login',
  body:{},
  querySelectorAll(selector){
    if(selector==='input[type=password]')return [{value:'TOPSECRET'}];
    if(selector==='h1,h2')return [{textContent:'Sign in'}];
    if(selector==='meta[name],meta[property]')return [{name:'generator',content:'ASUS',getAttribute:()=>''}];
    if(selector==='script[src],link[href]')return [{getAttribute(k){return k==='src'?'/assets/login.js?token=SECRET':''}}];
    return [];
  },
  addEventListener(){}
};
const published=[];
const w={
  document:fakeDOM,
  location:{href:'http://192.168.1.1/login',pathname:'/login'},
  webkit:{messageHandlers:{routerlab:{postMessage:m=>published.push(m)}}},
  setTimeout(cb){/* skip later snapshots for deterministic test */},
  $: {su:{}}
};
const scanned=probe.readPage(w);
assert.equal(scanned.vendor,'ASUS');assert.equal(scanned.ui,'PASSWORD_FORM');
probe.attach(w);probe.attach(w);
assert.equal(published.length,1,'Attach must be idempotent');
const outgoing=JSON.stringify(published[0]);
assert.equal(published[0].type,'routerPassiveObservation');
assert.equal(published[0].verified,false);
for(const secret of ['TOPSECRET','SECRET','192.168.1.1','/assets/login.js','Sign in']){
  assert(!outgoing.includes(secret),'private text/path leaked: '+secret);
}
const source=fs.readFileSync(p,'utf8');
assert(!/\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/.test(source),
  'Unknown-device probe must not request CGI or other resources');
for(const op of ['setWan','setWifi','createAdminPassword','login.cgi','skk_set.cgi']){
  assert(!source.includes(op),'Accidental write path: '+op);
}
console.log('PASS passive unknown router: vendor hints, model candidates, no CGI, no secrets, no writes');
