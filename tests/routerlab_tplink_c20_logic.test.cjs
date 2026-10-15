"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=path.join(__dirname,"..","extensions","tplink-c20");
const L=require(path.join(app,"logic.js"));
const snap=(text,ids=[],patch={})=>({title:"Archer C20",device:"Archer C20 v5",firmware:"3.16.0 0.9.1 v6038.0",text,ids,fields:[],hasWanControl:false,hasWifiControl:false,hasQuickSetupMenu:false,...patch});
const cfg=()=>({wan:"dhcp",pppoeUser:"",pppoePass:"",ssid24:"Demo24",pass24:"testpass123",ssid5:"Demo5",pass5:"testpass234",adminPass:""});
test("manifest and all scripts parse",()=>{
  for(const f of ["logic.js","content.js","popup.js"])new vm.Script(fs.readFileSync(path.join(app,f),"utf8"),{filename:f});
  const m=JSON.parse(fs.readFileSync(path.join(app,"manifest.json"),"utf8"));
  assert.equal(m.manifest_version,3);assert.deepEqual(m.permissions,["activeTab","scripting"]);
  assert.equal(m.action.default_popup,"popup.html");
});
test("hardware guard",()=>{
  assert.equal(L.verifyModel(snap("")).ok,true);
  assert.equal(L.verifyModel({...snap(""),device:"Archer C20 v4"}).ok,false);
  assert.equal(L.verifyModel({...snap(""),title:"Other",device:"Archer C64 v1"}).ok,false);
});
test("factory login and wizard",()=>{
  assert.equal(L.classify(snap("Create Password Confirm Password",[],{fields:[{type:"password"},{type:"password"}]})),"factory");
  assert.equal(L.classify(snap("Login Password",[],{fields:[{type:"password"}]})),"login");
  assert.equal(L.classify(snap("Выберите поставщика интернет-услуг",["next_button"])),"wizard_isp");
  assert.equal(L.classify(snap("VLAN ID",["next"])),"wizard_vlan");
  assert.equal(L.classify(snap("Настройки беспроводного режима SSID",["wl24gssid","wl5gssid","next"])),"wizard_wifi");
  assert.equal(L.classify(snap("Настройки беспроводного режима SSID",["wl24gssid","wl5gssid"])),"edit_wifi");
  assert.equal(L.classify(snap("Тип интернет-подключения Динамический IP-адрес",["save"])),"wizard_summary");
});
test("WAN and Wi-Fi validation",()=>{
  assert.deepEqual(L.validate(cfg(),"first"),[]);
  assert.deepEqual(L.validate({...cfg(),wan:"pppoe",pppoeUser:"user",pppoePass:"password"},"first"),[]);
  assert.ok(L.validate({...cfg(),wan:"pppoe"},"first").length);
  assert.ok(L.validate({...cfg(),wan:"unchanged"},"first").length);
  assert.ok(L.validate({...cfg(),pass24:"short"},"first").length);
  assert.deepEqual(L.validate({...cfg(),wan:"unchanged",ssid5:"",pass5:"",pass24:""},"edit"),[]);
});
test("no storage, no foreign fetch in scripts",()=>{
  for(const s of ["content.js","popup.js","logic.js"]){
    const c=fs.readFileSync(path.join(app,s),"utf8");
    assert.doesNotMatch(c,/chrome\.(storage|cookies)\b/);
    assert.doesNotMatch(c,/\bfetch\s*\(|\bXMLHttpRequest\b/);
  }
});
