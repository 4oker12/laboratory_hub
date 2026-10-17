'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(base,'background.js'),'utf8');
function worker(){
 const map=new Map();
 const chrome={runtime:{getURL:x=>'chrome-extension://lab/'+x,onInstalled:{addListener(){}},onMessage:{addListener(){}}},
  action:{onClicked:{addListener(){}}},tabs:{onRemoved:{addListener(){}},query:async()=>[]},
  storage:{session:{async get(k){return {[k]:map.get(k)}},async set(obj){for(const [k,v]of Object.entries(obj))map.set(k,v)},async remove(k){map.delete(k)}}}};
 const ctx=vm.createContext({chrome,TextEncoder,TextDecoder,console,setTimeout,clearTimeout,Date,Promise,URL,AbortController});
 ctx.importScripts=(...filenames)=>filenames.forEach(n=>vm.runInContext(fs.readFileSync(path.join(base,n),'utf8'),ctx));
 vm.runInContext(src,ctx);return{ctx,map};
}
function element(init={}){return{
 id:init.id||'',value:init.value||'',textContent:init.text||'',innerText:init.text||'',options:init.options||[],
 disabled:!!init.disabled,checked:!!init.checked,click:init.click||(()=>{}),dispatchEvent:()=>{},
 getAttribute:name=>name==='onclick'?init.onclick||null:null,
 getClientRects:()=>init.visible===false?[]:[1]
};}
function stepFunc(elements,extra={}){
 const {ctx}=worker();
 const document={title:'Archer C20',body:{innerText:'Быстрая настройка Archer C20'},
  getElementById:id=>elements[id]||null,querySelectorAll:()=>Object.values(elements)};
 const target=vm.createContext({document,location:{origin:'http://192.168.0.1'},
   window:extra.window||{},HTMLInputElement:extra.HTMLInputElement||class {},
   Event:class{constructor(type){this.type=type}}});
 const functionText=vm.runInContext('vendorQuickSetupStep.toString()',ctx);
 return vm.runInContext('('+functionText+')',target);
}
const {mock:ispFixture}=require('./fixtures/stock-isp.cjs');
function run(){
 {
  const t=ispFixture();const f=stepFunc(t.el,{window:{$:t.$}});
  const o=f({ssid24:'',ssid5:'',password:''});
  assert.equal(o.submitted,true);assert.equal(o.step,'ISP_WAN');
  assert.deepEqual(t.calls.filter(s=>!s.startsWith('open:')),
    ['select_country=Украина','select_city=все','select_isp=Воля',
     'select_wan_type=Динамический IP-адрес','NEXT']);
  assert.equal(t.nextClicks,1);
  console.log('PASS ISP: physical stock Ukraine -> all -> Volia -> Dynamic IP -> Next');
 }
 {
  const t=ispFixture({missing:['box_select_country']});
  const f=stepFunc(t.el,{window:{$:t.$}});
  const o=f({ssid24:'',ssid5:'',password:''});
  assert.equal(o.submitted,false);
  assert.equal(o.reason,'COUNTRY_STOCK_DROPDOWN_MISSING');
  assert.equal(t.nextClicks,0);
  console.log('PASS ISP: missing stock widget -> no speculative write');
 }
 {
  const t=ispFixture({missing:['ack_select_isp']});
  const f=stepFunc(t.el,{window:{$:t.$}});
  const o=f({ssid24:'',ssid5:'',password:''});
  assert.equal(o.submitted,false);
  assert.equal(o.reason,'ISP_STOCK_SELECTION_NOT_ACKNOWLEDGED');
  assert.equal(t.nextClicks,0);
  console.log('PASS ISP: vendor must acknowledge each stage before Next');
 }
 {
  let saved=0;const summary='Обзор Тип интернет-подключения: Динамический IP-адрес';
  const elements={'quicksetup-process-content':element({id:'quicksetup-process-content',text:summary}),
   conntype:element({id:'conntype',text:'Динамический IP-адрес'}),
   save:element({id:'save',onclick:'goSave()',click(){saved++}})};
  const f=stepFunc(elements);
  assert.equal(f({ssid24:'',ssid5:'',password:''}).step,'SUMMARY');
  assert.equal(saved,1);
  elements.conntype.textContent='PPPoE';
  const blocked=f({ssid24:'',ssid5:'',password:''});
  assert.equal(blocked.reason,'SUMMARY_WAN_DHCP_NOT_CONFIRMED');assert.equal(saved,1);
  elements.conntype.textContent='Динамический IP-адрес';
  elements.save.getAttribute=()=>null;
  const untrusted=f({ssid24:'',ssid5:'',password:''});
  assert.equal(untrusted.reason,'STOCK_SAVE_HANDLER_UNCONFIRMED');assert.equal(saved,1);
  console.log('PASS Summary: native goSave and DHCP evidence required');
 }
 {
  let advance=0;
  class Input {constructor(id){this.id=id;this._value=''}get value(){return this._value}set value(v){this._value=v}}
  const ssid24=new Input('wl24gssid'),ssid5=new Input('wl5gssid');
  for(const e of [ssid24,ssid5]){e.disabled=false;e.getClientRects=()=>[1];e.dispatchEvent=()=>{}};
  const elements={wl24gssid:ssid24,wl5gssid:ssid5,next:element({id:'next',click(){advance++}})};
  const f=stepFunc(elements,{HTMLInputElement:Input});
  const result=f({ssid24:'New-24',ssid5:'New-5',password:''});
  assert.equal(result.step,'WIRELESS');assert.equal(result.submitted,true);
  assert.equal(ssid24.value,'New-24');assert.equal(ssid5.value,'New-5');assert.equal(advance,1);
  console.log('PASS Wireless: lower-case physical DOM IDs recognized, values set');
 }
 {
  const {ctx}=worker();vm.runInContext(`let calls=0;
   discoverUnified=async()=>({phase:'QUICK_SETUP',verified:true});
   quickStageSnapshot=async()=>({stage:++calls===1?'SUMMARY':'CONFIGURED_AUTHENTICATED',signature:'s'+calls});
   runQuickStep=async function(wifi){if(wifi.ssid24!=='Opt24'||wifi.ssid5!=='Opt5'||wifi.password!=='12345678')throw Error('QUICK_UI_VALUES_LOST');return{submitted:true,step:'SUMMARY'}};
   nativeRead=async()=>({apiVerified:true,wifi:{allBandsConfirmed:true}});
   nativeWanDhcpEvidence=async()=>({dhcpVerified:true});`,ctx);
  return vm.runInContext('autoQuick({wifi:{ssid24:"Opt24",ssid5:"Opt5",wifiPassword:"12345678"}})',ctx).then(result=>{
   assert.equal(result.outcome,'AUTO_QUICK_RECONNECT_REQUIRED');assert.equal(result.steps[0],'SUMMARY');
   console.log('PASS flow: optional UI Wi-Fi data forwarded; final save verified, no duplicate click');
  });
 }
}
run().catch(e=>{console.error(e);process.exitCode=1});
