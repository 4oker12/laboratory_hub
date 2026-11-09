'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'../../../devices/tplink/archer-ax23-v1-eu');
const logic=require(path.join(base,'quick-setup-preview-logic.js'));
test('official AX23 router Quick Setup step names and order are preserved',()=>{
 assert.deepEqual(logic.STEPS.map(x=>x.id),[
 'qsSetTimezone','qsChooseInternetType','qsInternetEdit','qsWirelessSetting','qsSummary'
 ]);
 assert.equal(logic.FIELDS.qsInternetEdit[0],'ispSpecialInternetVid');
 assert.equal(logic.FIELDS.qsChooseInternetType[0],'networkConntype');
});
test('default demo values complete all five local-only stages',()=>{
 const s=logic.create();
 for(let i=0;i<5;i++)assert.deepEqual(logic.validate(i,s),[],logic.STEPS[i].id);
 assert.equal(logic.sanitizedReport(s,'complete').originalVendorWrite,false);
});
test('PPPoE credentials must be provided but are never exported',()=>{
 const s=logic.create();s.wan='pppoe';
 assert.ok(logic.validate(2,s).some(x=>x.includes('PPPoE')));
 s.pppoeUser='PRIVATE_USERNAME_NEVER_REPORT';
 s.pppoePass='PRIVATE_PASSWORD_NEVER_REPORT';
 assert.deepEqual(logic.validate(2,s),[]);
 const serialized=JSON.stringify(logic.sanitizedReport(s,'complete'));
 assert.doesNotMatch(serialized,/PRIVATE_|pppoePass|pppoeUser/);
});
test('invalid static addresses, VLAN and Wi-Fi pass fail before review',()=>{
 const s=logic.create();s.wan='static';
 assert.ok(logic.validate(2,s).length);
 Object.assign(s,{staticIp:'192.0.2.11',staticMask:'255.255.255.0',staticGateway:'192.0.2.1',staticDns:'192.0.2.53'});
 assert.deepEqual(logic.validate(2,s),[]);
 s.vlanEnabled=true;s.vlanId='4095';
 assert.ok(logic.validate(2,s).length);
 s.vlanId='3000';assert.deepEqual(logic.validate(2,s),[]);
 s.ssid24='';assert.ok(logic.validate(3,s).length);
 s.ssid24='RouterLab-Test-2G';s.pass5='short';assert.ok(logic.validate(3,s).length);
});
test('HTML training route stays explicit and has no CGI writes',()=>{
 const html=fs.readFileSync(path.join(base,'quick-setup-preview.html'),'utf8');
 assert.match(html,/не штатный Quick Setup/);
 assert.match(html,/Никакие настройки устройства не применялись/);
 assert.match(html,/quick-setup-preview-logic\.js/);
 assert.doesNotMatch(html,/<form\b/i);
 assert.doesNotMatch(html,/\bfetch\s*\(|new\s+XMLHttpRequest|sendBeacon/);
 for(const source of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]){
  new vm.Script(source[1]);
 }
});
