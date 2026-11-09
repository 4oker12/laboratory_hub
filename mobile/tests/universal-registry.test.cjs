'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const here = path.resolve(__dirname, '../RouterLabMobile/Resources');
const source = fs.readFileSync(path.join(here, 'RouterLabDeviceRegistry.js'), 'utf8');
const ctx = vm.createContext({console});
vm.runInContext(source, ctx);
const reg = vm.runInContext('RouterLabDeviceRegistry',ctx);
function found(input, id) {
  const result = reg.fingerprint(input);
  assert.equal(result.id,id,JSON.stringify(input));
  assert.equal(result.status,'MODEL_CANDIDATE');
  assert.equal(result.authenticated,false);
  assert.equal(result.canWrite,false);
  assert.equal(result.firmwareVerified,false);
  return result;
}
const c54 = found({title:'TP-Link Wi-Fi 6?',headings:'Archer C54 Hardware Version V1.0'},'tplink-archer-c54');
assert.equal(c54.model,'Archer C54');
assert.equal(c54.revision,'v1.0');
assert.equal(c54.adapter,'PENDING_C54');
assert.equal(reg.operation(c54.id,'login').supported,false);
assert.equal(reg.operation(c54.id,'quickSetup').supported,false);
assert.equal(reg.operation(c54.id,'wanDhcp').supported,false);
assert.equal(reg.operation(c54.id,'wifiEdit').supported,false);
found({title:'Archer C54',headings:'Create password'},'tplink-archer-c54');
found({title:'Archer C20',body:'Archer C54 supported in FAQ'},'tplink-archer-c20');
found({title:'Cudy Wireless',body:'WR1200 configuration'},'cudy-wr1200');
found({title:'Cudy WR1300 V4'},'cudy-wr1300');
found({title:'Cudy WR3000'},'cudy-wr3000');
found({title:'Netis N2',body:'FW4'},'netis-n2');
found({title:'Archer C5400'},'generic-tplink');
found({title:'Archer AX23'},'generic-tplink');
found({title:'Cudy WR3600'},'generic-cudy');
found({title:'Netis N3'},'generic-netis');
assert.equal(reg.fingerprint({title:'Archer AX23 and Archer AX55'}).status,'AMBIGUOUS');
assert.equal(reg.fingerprint({title:'WR3000'}).id,'');
assert.equal(reg.fingerprint({title:'TP-Link Router',body:'Archer C54 and Archer C20'}).status,'AMBIGUOUS');
assert.equal(reg.fingerprint({title:'TP-Link Management'}).model,'');
assert.equal(reg.fingerprint({title:'192.168.0.1',body:'Password'}).status,'VENDOR_ONLY');
assert.equal(reg.operation('tplink-archer-c54','passwordReset').supported,false);
assert.equal(reg.operation('cudy-wr3000','login').supported,false);
const universal = fs.readFileSync(path.join(here, 'RouterLabUniversalPanel.js'),'utf8');
new vm.Script(universal);
for(const required of ['routerFingerprint','routerFingerprintHint','genericPanelReady',
                       'modelCandidateOnly:true','loginVerified:false','writesEnabled:false'])
  assert(universal.includes(required),'missing '+required);
assert(!/\bfetch\s*\(/.test(universal),'Universal panel MUST NOT call vendor endpoints');
assert(!/\/cgi_gdpr|\/cgi\/login/.test(universal),'No blind C20 protocol on C54');
const session = fs.readFileSync(path.join(__dirname,'../RouterLabMobile/RouterSession.swift'),'utf8');
for(const required of ['case "routerFingerprint"', 'case "routerFingerprintHint"',
                       'genericIdentifiedOnly', 'genericPanelReady',
                       'RouterLabDeviceRegistry', 'RouterLabUniversalPanel'])
  assert(session.includes(required),'missing Swift bridge '+required);
console.log('PASS router registry: C54/C20/Netis/Cudy identity, ambiguity, no writes, iOS bridge');
