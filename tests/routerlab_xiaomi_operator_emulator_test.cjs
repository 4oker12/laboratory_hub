"use strict";
/* Offline unit tests: firmware registry, state transitions, isolation and XSS encoding. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..", "docs", "emulator", "xiaomi");
const registry = require(path.join(root, "catalog.js"));
const scenarios = require(path.join(root, "scenarios.js"));
const core = require(path.join(root, "core.js"));
const storage = require(path.join(root, "storage.js"));
const views = require(path.join(root, "views.js"));

test("catalog identifies only verified hardware + firmware; families group firmware", () => {
  assert.equal(registry.MODELS.length, 1);
  const r4a = registry.requireModel("xiaomi-r4a-3.0.24-int");
  assert.equal(r4a.hardware,"R4A");
  assert.equal(r4a.firmware,"3.0.24");
  assert.equal(r4a.capabilities.realWan,false);
  assert.equal(registry.families().length,1);
  assert.equal(registry.firmwareFor(r4a.familyId).length,1);
  assert.throws(() => registry.requireModel("xiaomi-r4a-unknown"),/Неподдерживаемая/);
});

test("state factory and configured profiles preserve strict contracts", () => {
  const first = core.makeState("factory");
  const configured = core.makeState("configured");
  assert.equal(first.modelId,"xiaomi-r4a-3.0.24-int");
  assert.equal(first.inited,false);
  assert.equal(configured.inited,true);
  assert.equal(first.lan.ip,"192.168.31.1");
  assert.equal(core.validateState(first),true);
  assert.equal(core.validateState({...configured,modelId:"unknown-firmware"}),false);
  assert.equal(core.validateState({...configured,scenario:"bogus"}),false);
});

test("factory wizard changes only returned state, writes admin/WAN/Wi-Fi values",() => {
  const initial = core.makeState("factory");
  const out = core.completeWizard(initial,{
    country:"UA",language:"uk",wanType:"dhcp",ssid:"Operator",
    wifiPassword:"OperatorWifi88",adminPassword:"OperatorAdmin88"
  });
  assert.equal(initial.inited,false);
  assert.equal(out.inited,true);
  assert.equal(out.wan.type,"dhcp");
  assert.equal(out.wifi24.ssid,"Operator");
  assert.equal(out.wifi5.ssid,"Operator_5G");
  assert.equal(out.adminPassword,"OperatorAdmin88");
  assert.throws(() => core.completeWizard(out,{country:"UA"}),/уже завершена/);
});

test("WAN supports DHCP and PPPoE with proper validation and no fake session",() => {
  const s=core.makeState("configured");
  const p=core.setWan(s,{type:"pppoe",username:"test-user",password:"test-password"});
  assert.equal(p.wan.type,"pppoe");
  assert.equal(p.wan.username,"test-user");
  assert.equal(s.wan.type,"dhcp");
  const d=core.setWan(p,{type:"dhcp"});
  assert.equal(d.wan.username,"");
  assert.equal(d.wan.password,"");
  assert.throws(() => core.setWan(s,{type:"static"}),/DHCP и PPPoE/);
  assert.throws(() => core.setWan(s,{type:"pppoe",username:"",password:"pass"}),/логин/);
});

test("Wi-Fi 2.4 and 5 GHz are independent, password and band are checked",() => {
  const original=core.makeState("configured");
  const modified=core.setWifi(original,"5",{
    enabled:true,ssid:"Guest_5G",password:"NewPassword12",hidden:true,channel:"36"
  });
  assert.equal(modified.wifi24.ssid,original.wifi24.ssid);
  assert.equal(modified.wifi5.ssid,"Guest_5G");
  assert.equal(modified.wifi5.hidden,true);
  assert.equal(original.wifi5.ssid,"RouterLab_5G");
  assert.throws(() => core.setWifi(original,"6",{enabled:true,ssid:"X",password:"12345678"}),/Неизвестный/);
  assert.throws(() => core.setWifi(original,"24",{enabled:true,ssid:"X",password:"short"}),/от 8 до 63/);
});

test("LAN state and scenarios are modeled, not measured",() => {
  const s=core.makeState("configured");
  const lan=core.setLan(s,{ip:"192.168.2.1",dhcp:false});
  assert.equal(lan.lan.ip,"192.168.2.1");
  assert.equal(lan.lan.dhcp,false);
  assert.throws(() => core.setLan(s,{ip:"999.1.1.1"}),/IPv4/);
  for(const item of scenarios.ALL){
    const next=core.setScenario(s,item.id);
    assert.equal(core.wanStatus(next),item.status);
    assert.ok(item.diagnostic.length>30);
  }
  assert.throws(() => core.setScenario(s,"fake"),/Неизвестный/);
});

test("HTML escaping protects entered SSIDs and all interpolated labels",() => {
  assert.equal(core.escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("state storage is isolated per exact firmware and denies corrupt schema",() => {
  const map=new Map();
  const backend={
    getItem:key=>map.get(key)??null,
    setItem:(key,v)=>map.set(key,v),
    removeItem:key=>map.delete(key)
  };
  const store=storage.createStore(backend);
  const s=core.makeState("configured");
  assert.equal(store.load(s.modelId),null);
  assert.equal(store.save(s),true);
  assert.equal(store.load(s.modelId).routerName,s.routerName);
  assert.throws(() => store.keyFor("unregistered-firmware"),/Unknown firmware/);
  map.set(store.keyFor(s.modelId),JSON.stringify({...s,schema:99}));
  assert.equal(store.load(s.modelId),null);
  assert.equal(store.save(s),true);
  assert.equal(store.reset(s.modelId),true);
  assert.equal(store.load(s.modelId),null);
});

test("static demo has no router networking API and maintains browser script order",() => {
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  const js=fs.readFileSync(path.join(root,"app.js"),"utf8");
  const scripts=["catalog.js","scenarios.js","core.js","storage.js","views.js","app.js"];
  const indexes=scripts.map(s=>html.indexOf('src="./'+s+'"'));
  assert.ok(indexes.every(i=>i>0));
  assert.deepEqual(indexes,[...indexes].sort((a,b)=>a-b));
  assert.ok(html.includes('connect-src &#39;none&#39;')||html.includes("connect-src 'none'"));
  assert.doesNotMatch(js,/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bnavigator\.sendBeacon\b/);
  assert.ok(html.includes("УЧЕБНАЯ СИМУЛЯЦИЯ"));
});


test("views are selected by explicit firmware profile, not brand guessing", () => {
  const model=registry.requireModel("xiaomi-r4a-3.0.24-int");
  const configured=core.makeState("configured");
  const context={model,state:configured,core,scenarios,page:"wan",wizardStep:0,wizard:{}};
  const view=views.createViews(context);
  assert.match(view.renderSettings(),/DHCP/);
  assert.match(view.renderStatus(),/Состояние маршрутизатора/);
  const r4aProfile={...model,profile:"unverified-v2"};
  assert.throws(() => views.createViews({...context,model:r4aProfile}),/No verified Xiaomi UI profile/);
  assert.throws(() => core.makeState("configured","unverified-firmware"),/Неподдерживаемая/);
});

test("screen templates HTML-escape operator-editable SSID text", () => {
  const model=registry.requireModel("xiaomi-r4a-3.0.24-int");
  const initial=core.makeState("configured");
  const state=core.setWifi(initial,"24",{
    enabled:true,ssid:'<img src=x onerror="alert(1)">',
    password:"DemoPassword88",hidden:false,channel:"auto"
  });
  const view=views.createViews({model,state,core,scenarios,page:"wifi",wizardStep:0,wizard:{}});
  const html=view.renderStatus();
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('<img src=x onerror='));
});


test("stock UI inventory prevents accidental full-parity claims", () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(root,"stock-ui-inventory.json"),"utf8"));
  assert.equal(inventory.device_id,"xiaomi-r4a-3.0.24-int");
  assert.equal(inventory.stock_initial_wizard_routes.length,36);
  assert.equal(new Set(inventory.stock_initial_wizard_routes.map(x=>x.route)).size,36);
  assert.ok(inventory.stock_initial_wizard_routes.every(x=>
    ["approximate","not_implemented"].includes(x.demo_status)
  ));
  assert.ok(inventory.stock_initial_wizard_routes.some(x=>
    x.route==="/static" && x.demo_status==="not_implemented"
  ));
  assert.ok(inventory.stock_initial_wizard_routes.some(x=>
    x.route==="/repeater" && x.demo_status==="not_implemented"
  ));
  assert.ok(inventory.stock_initial_js_api_callsites.includes("/api/misystem/set_iptv"));
  assert.ok(inventory.stock_initial_js_api_callsites.includes("/api/misystem/net_diagnose_start"));
  assert.equal(inventory.authenticated_admin_pages.inventory_complete,false);
  assert.equal(inventory.browser_e2e_verified,false);
  assert.equal(inventory.stock_pixel_parity_verified,false);
  const direct=inventory.direct_stock_extraction;
  assert.equal(direct.image_sha256_verified,true);
  assert.equal(direct.counts.all_www_files,609);
  assert.equal(direct.counts.javascript,66);
  assert.equal(direct.counts.css,36);
  assert.equal(direct.counts.luci_view_files,92);
  assert.equal(direct.stock_setting_templates.length,16);
  assert.equal(direct.stock_apsetting_templates.length,5);
  assert.ok(direct.stock_setting_templates.some(x=>x.endsWith("/vpn.htm")));
  assert.ok(direct.stock_setting_templates.some(x=>x.endsWith("/ddns.htm")));
  assert.ok(direct.stock_setting_templates.some(x=>x.endsWith("/upgrade_manual.htm")));
  assert.ok(direct.stock_all_js_api_references.includes("/api/misystem/set_iptv"));
  assert.equal(direct.stock_all_js_api_references.length,34);
  assert.equal(direct.configured_admin_menu_exhaustively_verified,false);
  assert.equal(direct.configured_admin_html_rendering_verified,false);
});
