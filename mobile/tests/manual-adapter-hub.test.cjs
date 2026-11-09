'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const here=path.join(__dirname,'../RouterLabMobile/Resources');
const reg=require(path.join(here,'RouterLabDeviceRegistry.js'));
const hub=require(path.join(here,'RouterLabAdapterHub.js'));
const c54=require(path.join(here,'RouterLabC54Driver.js'));
function expected(value,reason){assert.equal(value.reason,reason,JSON.stringify(value));}
async function main(){
  for(const p of reg.PROFILES){
    const candidate=reg.selectManual(p.id);
    assert(candidate,'Model missing: '+p.id);
    assert.equal(candidate.status,'MANUAL_SELECTION');
    assert.equal(candidate.evidence,'MANUAL');
    assert.equal(candidate.canWrite,false);
    assert.equal(candidate.authenticated,false);
    assert.equal(candidate.firmwareVerified,false);
  }
  assert.equal(reg.selectManual('injected-model'),null);
  assert.equal(hub.choose('tplink-archer-c54','MANUAL').driver,'tplink-c54-v1');
  assert.equal(hub.choose('tplink-archer-c54','MANUAL').stage,'IDENTIFIED_MANUAL');
  assert.equal(hub.choose('tplink-archer-c20','MANUAL').driver,'tplink-c20-v5');
  assert.equal(hub.choose('netis-n2','MANUAL').driver,'netis-fw4');
  assert.equal(hub.choose('cudy-wr3000','MANUAL').driver,'cudy-luci-wr3000');
  assert.equal(hub.choose('bad-id','MANUAL').ok,false);
  expected(hub.versionGate('tplink-archer-c54',{hardware:'v2',build:'250811',region:'EU'}),'HARDWARE_NOT_VALIDATED');
  expected(hub.versionGate('tplink-archer-c54',{hardware:'v1',build:'260101',region:'EU'}),'FIRMWARE_BUILD_NOT_VALIDATED');
  expected(hub.versionGate('tplink-archer-c54',{hardware:'v1',build:'250811',region:'US'}),'REGION_NOT_VALIDATED');
  assert.equal(hub.versionGate('tplink-archer-c54',{hardware:'v1',build:'250811',region:'EU'}).ok,true);
  const valid={deviceMatched:true,hardware:'v1',build:'250811',region:'EU',sessionVerified:true,writeContractVerified:false};
  expected(hub.canCall('tplink-archer-c54','setWifi',valid,true),'WRITE_CONTRACT_NOT_VERIFIED');
  expected(hub.canCall('tplink-archer-c54','login',{...valid,deviceMatched:false},true),'DEVICE_IDENTITY_NOT_VERIFIED');
  expected(hub.canCall('tplink-archer-c54','readWan',{...valid,sessionVerified:false},true),'SESSION_NOT_VERIFIED');
  expected(hub.canCall('tplink-archer-c54','login',valid,false),'ADAPTER_METHOD_NOT_IMPLEMENTED');
  expected(hub.canCall('tplink-archer-c54','probe',{sameOrigin:false},true),'PROBE_NOT_AVAILABLE_OR_ORIGIN_UNVERIFIED');
  assert.equal(hub.canCall('tplink-archer-c54','probe',{sameOrigin:true},true).allowed,true);
  expected(hub.nextState('INIT','AUTHENTICATED',{}),'INVALID_STATE_TRANSITION');
  expected(hub.nextState('LOGIN_PENDING','AUTHENTICATED',{}),'SESSION_NOT_VERIFIED');
  expected(hub.nextState('VERIFY_PENDING','READBACK_VERIFIED',{}),'READBACK_NOT_VERIFIED');
  expected(hub.nextState('QUICK_SETUP','SAVE_PENDING',{}),'WRITE_CONTRACT_NOT_VERIFIED');
  assert.equal(hub.nextState('LOGIN_PENDING','AUTHENTICATED',{sessionVerified:true}).ok,true);
  const rt=hub.createRouterRuntime();
  rt.registerDriver('tplink-c54-v1',{probe:async()=>({reason:'PASSIVE'})});
  assert.deepEqual(rt.describe('tplink-archer-c54').implemented,['probe']);
  const probe=await rt.execute('tplink-archer-c54','probe',{}, {sameOrigin:true});
  assert.equal(probe.ok,true);
  expected(await rt.execute('tplink-archer-c54','login',{},valid),'ADAPTER_METHOD_NOT_IMPLEMENTED');
  expected(await rt.execute('tplink-archer-c54','setWanDhcp',{},valid),'ADAPTER_METHOD_NOT_IMPLEMENTED');
  const fakeDoc={
    title:'TP-Link Archer C54 EU',
    body:{innerText:'Archer C54 · Hardware Version v1 · Build 250811 · Login'},
    querySelectorAll(selector){
      return selector.includes('input')?[{disabled:false,getClientRects:()=>[1]}]:[];
    }
  };
  const passive=c54.probePage({document:fakeDoc,window:{$:{su:{}}}});
  assert.equal(passive.compatible,true);
  assert.equal(passive.framework,'TPLINK_SU');
  assert.equal(passive.hardware,'v1');
  assert.equal(passive.build,'250811');
  assert.equal(passive.sessionVerified,false);
  assert.equal(passive.writeContractVerified,false);
  const conflict=c54.probePage({document:{...fakeDoc,title:'Archer C20',body:{innerText:'Archer C20'}}});
  assert.equal(conflict.compatible,false);
  const panel=fs.readFileSync(path.join(here,'RouterLabUniversalPanel.js'),'utf8');
  assert(panel.includes('selectManual(profileId)'));
  assert(panel.includes('routerModelCatalog'));
  assert(panel.includes("adapter-route"));
  const swift=fs.readFileSync(path.join(__dirname,'../RouterLabMobile/RouterSession.swift'),'utf8');
  const view=fs.readFileSync(path.join(__dirname,'../RouterLabMobile/ContentView.swift'),'utf8');
  for(const str of ['func selectRouterModel(', 'manualSelectionPending', 'case "routerModelCatalog":',
                    'evidence == "MANUAL"', 'manualRouterAddressHint']) {
    assert(swift.includes(str),'native bridge missing '+str);
  }
  for(const str of ['Picker("Производитель и модель"', 'applyManualRouterModel','manualRouterIPAddress',
                    'session.selectRouterModel(', 'showModelOverride']) {
    assert(view.includes(str),'manual dropdown missing '+str);
  }
  assert(!/\/cgi_gdpr|\/cgi\/login/.test(fs.readFileSync(path.join(here,'RouterLabC54Driver.js'),'utf8')));
  console.log('PASS manual selection / policy routing / C54 passive probe / write safety gates');
}
main().catch(e=>{console.error(e);process.exitCode=1});
