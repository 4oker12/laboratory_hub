'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../RouterLabMobile/Resources');
const driver=require(path.join(root,'RouterLabC64Driver.js'));
const registry=require(path.join(root,'RouterLabDeviceRegistry.js'));
const hub=require(path.join(root,'RouterLabAdapterHub.js'));
function doc(title,text,passwordCount){
 return {
  title,body:{innerText:text||''},
  querySelectorAll(selector){
   if(selector.includes('input[type=password]'))
    return Array.from({length:passwordCount||0},()=>({disabled:false,getClientRects:()=>[{}]}));
   return [];
  }
 };
}
const v1=driver.detect(doc('TP-Link Archer C64 (EU)','Hardware Version V1.0 Build 250729',2),{$:{su:{}}});
assert.equal(v1.modelCandidate,true);
assert.equal(v1.hardware,'V1.0');
assert.equal(v1.build,'250729');
assert.equal(v1.region,'EU');
assert.equal(v1.stage,'FACTORY_PASSWORD_CANDIDATE');
assert.equal(v1.canWrite,false);
assert.equal(v1.authenticated,false);
assert.equal(v1.framework,'TPLINK_SU_CANDIDATE');
const v2=driver.detect(doc('Archer C64 (EU)','Hardware Version V2.0 Build 20260324',1),{});
assert.equal(v2.modelCandidate,true);
assert.equal(v2.hardware,'V2.0');
assert.equal(v2.build,'20260324');
assert.equal(v2.stage,'LOGIN_CANDIDATE');
assert.equal(v2.canWrite,false);
assert.equal(v2.sessionVerified,false);
const wrong=driver.detect(doc('TP-Link Archer C54','Hardware Version V1',1),{});
assert.equal(wrong.modelCandidate,false);
const unknown=driver.detect(doc('TP-Link','Login',1),{});
assert.equal(unknown.modelCandidate,false);
assert.equal(unknown.stage,'LOGIN_CANDIDATE');
assert.equal(unknown.canWrite,false);
const choice=registry.selectManual('tplink-archer-c64');
assert.equal(choice.adapter,'PENDING_C64');
assert.equal(choice.canWrite,false);
assert.equal(hub.policy(choice.id).driver,'tplink-c64-passive');
const runtime=hub.createRouterRuntime();
runtime.registerDriver('tplink-c64-passive',driver.createBrowserDriver({document:doc('Archer C64','',1)}));
assert.deepEqual(runtime.describe(choice.id).implemented,['probe','getSetupState']);
assert.equal(runtime.describe(choice.id).missing.includes('login'),true);
assert.equal(runtime.describe(choice.id).missing.includes('save'),true);
const source=fs.readFileSync(path.join(root,'RouterLabC64Driver.js'),'utf8');
assert.equal(/\bfetch\s*\(|\bXMLHttpRequest\s*\(|\bform\.submit\s*\(/.test(source),false);
console.log('PASS C64 V1/V2 passive UI fingerprint, model isolation, no write/HTTP auth');
