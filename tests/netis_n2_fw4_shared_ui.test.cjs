'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const rel='extensions/tplink-c20/independent-session/';
const file=name=>fs.readFileSync(path.join(root,rel,name),'utf8');
const html=file('setup.html');
const controller=file('netis-setup.js');

test('Netis UI reuses the exact RouterLab setup.html and setup.css',()=>{
  assert.match(html,/<link rel="stylesheet" href="setup\.css">/);
  assert.match(html,/<script src="setup\.js"><\/script>/);
  assert.match(html,/<script src="netis-setup\.js"><\/script>/);
  assert.match(html,/id="deviceTplink"/);
  assert.match(html,/id="deviceNetis"/);
  assert.doesNotMatch(html,/<link[^>]*netis[^>]*\.css/);
});
test('controller only uses elements in the shared HTML',()=>{
  for(const [,id] of controller.matchAll(/el\('([^']+)'\)/g)){
    assert.ok(html.includes('id="'+id+'"'),'missing shared UI element: '+id);
  }
});
test('existing TP-Link controller is skipped only on Netis route',()=>{
  const stock=file('setup.js');
  assert.match(stock,/get\('device'\) !== 'netis'/);
  assert.match(stock,/action\(discover\);/);
});
test('Netis MV3 worker has a separate allowlisted message branch',()=>{
  const src=file('background.js');
  assert.match(src,/importScripts\('netis-fw4\.js','netis-dispatch\.js'\)/);
  assert.match(src,/RouterLabNetisDispatcher\.authorizeSender\(sender\)/);
  assert.match(src,/RouterLabNetisDispatcher\.command\(m\)/);
  assert.match(src,/if\(sender\.url!==PAGE\|\|!m\|\|!\/\^c20/);
});
test('Netis controller does not claim verified configured Wi-Fi or PPPoE SET',()=>{
  assert.match(html,/смена SSID\/пароля и PPPoE\/Static пока недоступны/);
  assert.match(controller,/FACTORY_DHCP_SUBMITTED_ONCE/);
  assert.match(controller,/APPLY_UNCONFIRMED/);
});
test('Netis protocol copy bundled in MV3 matches device-source byte-for-byte',()=>{
  const a=file('netis-fw4.js');
  const b=fs.readFileSync(path.join(root,'devices/netis/n2/fw4/netis-fw4.js'),'utf8');
  assert.equal(a,b,'adapter copy drifted: update both in same commit');
});
test('sender checks reject page-origin injection and accept extension-owned tab',()=>{
  const ctx={
    URL,URLSearchParams,TextEncoder,Buffer,fetch:async()=>{throw Error('do not call router')},
    chrome:{runtime:{id:'unit-test-extension',getURL:p=>'chrome-extension://unit-test-extension/'+p}}
  };
  vm.createContext(ctx);
  vm.runInContext(file('netis-fw4.js'),ctx);
  vm.runInContext(file('netis-dispatch.js'),ctx);
  const auth=ctx.RouterLabNetisDispatcher.authorizeSender;
  assert.equal(auth({id:'unit-test-extension',url:'chrome-extension://unit-test-extension/setup.html?device=netis',tab:{id:5}}),true);
  assert.equal(auth({id:'unit-test-extension',url:'http://192.168.1.1/index.html'}),false);
  assert.equal(auth({id:'another-extension',url:'chrome-extension://unit-test-extension/setup.html?device=netis'}),false);
  assert.equal(auth({id:'unit-test-extension',url:'chrome-extension://unit-test-extension/setup.html?device=c20'}),false);
});
test('manifest authorizes only observed Netis private origin beyond existing C20',()=>{
  const m=JSON.parse(file('manifest.json'));
  assert.ok(m.host_permissions.includes('http://192.168.1.1/*'));
  assert.ok(m.host_permissions.includes('http://192.168.0.1/*'));
  assert.equal(m.host_permissions.length,2);
});