'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const folder=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(folder,'background.js'),'utf8');
const fakeChrome={runtime:{getURL:()=>'',onInstalled:{addListener(){}},onMessage:{addListener(){}}},action:{onClicked:{addListener(){}}},tabs:{onRemoved:{addListener(){}}}};
const ctx=vm.createContext({chrome:fakeChrome,TextEncoder,TextDecoder,console,setTimeout,clearTimeout});
ctx.importScripts=(...names)=>names.forEach(n=>vm.runInContext(fs.readFileSync(path.join(folder,n),'utf8'),ctx));
vm.runInContext(code,ctx);
function element({value='',text='',options=[],click}={}){return{value,options,textContent:text,disabled:false,getClientRects:()=>[1],click:click||(()=>{}),dispatchEvent:()=>{}}}
const {mock}=require('./fixtures/stock-isp.cjs');
const t=mock();
const target=vm.createContext({document:t.document,location:{origin:'http://192.168.0.1'},
 window:{$:t.$},Event:class{}});
const func=vm.runInContext('('+vm.runInContext('vendorQuickSetupStep.toString()',ctx)+')',target);
let ret=func({ssid24:'',ssid5:'',password:''});
assert.equal(ret.submitted,true);assert.equal(ret.step,'ISP_WAN');assert.equal(t.nextClicks,1);
assert.deepEqual(t.calls.filter(v=>!v.startsWith('open:')),
 ['select_country=Украина','select_city=все','select_isp=Воля','select_wan_type=Динамический IP-адрес','NEXT']);
const missing=mock({missing:['box_select_city']});
const blocked=vm.createContext({document:missing.document,location:{origin:'http://192.168.0.1'},window:{$:missing.$}});
ret=vm.runInContext('('+vm.runInContext('vendorQuickSetupStep.toString()',ctx)+')',blocked)({});
assert.equal(ret.reason,'CITY_STOCK_DROPDOWN_MISSING');assert.equal(missing.nextClicks,0);
console.log('PASS real DOM cascade Ukraine/all/Volia/Dynamic IP; missing city dropdown blocks before Next');
