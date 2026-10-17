'use strict';
// Regression from real C20 run: ISP_WAN was clicked, but Next led to an
// unrecognized VLAN page because hidden #prio was used as the stage marker.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(base,'background.js'),'utf8');
function worker(){
 const map=new Map();
 const chrome={runtime:{getURL:x=>'chrome-extension://lab/'+x,onInstalled:{addListener(){}},onMessage:{addListener(){}}},
  action:{onClicked:{addListener(){}}},tabs:{onRemoved:{addListener(){}},query:async()=>[]},
  storage:{session:{async get(k){return{[k]:map.get(k)}},async set(obj){for(const [k,v]of Object.entries(obj))map.set(k,v)},async remove(k){map.delete(k)}}},
  scripting:{executeScript:async()=>{throw Error('stub not installed')}}};
 const ctx=vm.createContext({chrome,console,Date,Promise,TextEncoder,TextDecoder,URL,AbortController,setTimeout,clearTimeout});
 ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),ctx));
 vm.runInContext(src,ctx);return{ctx,map};
}
function e(id,shown=true,text='') {return {id,innerText:text,getClientRects:()=>shown?[{width:100,height:20}]:[],
  click(){},disabled:false,getAttribute:()=>null};}
(async()=>{
 const w=worker();
 const dom={
  'quicksetup-process-content':e('quicksetup-process-content',true,'VLAN ID: Включить  Назад  Далее'),
  quicksetup_dsl_container:e('quicksetup_dsl_container',true,'VLAN ID: Включить'),
  prio:e('prio',false,'0 1 2 3 4 5 6 7'),
  next:e('next',true,'Далее'),
  quicksetup_isp_container:e('quicksetup_isp_container',false,'Выберите поставщика интернет-услуг'),
  select_wan_type:e('select_wan_type',false,'Динамический IP-адрес')
 };
 const doc={getElementById:id=>dom[id]||null,querySelectorAll:()=>Object.values(dom)};
 const page=vm.createContext({document:doc});
 vm.runInContext(`inspectNative=async()=>({stage:'QUICK_SETUP_ACTIVE',isC20:true})`,w.ctx);
 w.ctx.chrome.scripting.executeScript=async({func})=>[{result:vm.runInContext('('+func.toString()+')()',page)}];
 const state=await vm.runInContext('quickStageSnapshot()',w.ctx);
 assert.equal(state.stage,'VLAN_DEFAULTS','visible DSL container must identify VLAN');
 assert.equal(state.markers.vlan,true);
 assert.equal(state.markers.isp,false);
 assert.equal(state.markers.next,true);
 console.log('PASS snapshot: stock VLAN page recognized despite hidden native #prio');
 let clicks=0;
 dom.next.click=()=>{clicks++};
 const vendor=vm.runInContext('vendorQuickSetupStep.toString()',w.ctx);
 const action=vm.runInContext('('+vendor+')',vm.createContext({document:{title:'Archer C20',body:{innerText:'VLAN ID'},getElementById:doc.getElementById,querySelectorAll:doc.querySelectorAll},location:{origin:'http://192.168.0.1'}}));
 const result=action({ssid24:'',ssid5:'',password:''});
 assert.equal(result.step,'VLAN_DEFAULTS');assert.equal(result.submitted,true);assert.equal(clicks,1);
 console.log('PASS vendor: physical VLAN visible container submits native Next once');
 // The previous ISP stage was submitted before Chrome SW restart: a different
 // visible stage may safely clear its one-shot fence, without repeating ISP Next.
 const g=worker();
 await g.ctx.chrome.storage.session.set({c20PendingQuickStepV1:{stage:'ISP_WAN',signature:'ISP_WAN|isp',at:42}});
 vm.runInContext(`discoverUnified=async()=>({phase:'QUICK_SETUP',verified:true});
   let calls=0;
   quickStageSnapshot=async()=>({stage:(++calls===1?'VLAN_DEFAULTS':'CONFIGURED_AUTHENTICATED'),signature:'VLAN_DEFAULTS|vlan'});
   runQuickStep=async()=>({submitted:true,step:'VLAN_DEFAULTS'});
   nativeRead=async()=>({apiVerified:true,wifi:{allBandsConfirmed:true}});
   nativeWanDhcpEvidence=async()=>({dhcpVerified:true});`,g.ctx);
 const flow=await vm.runInContext('autoQuick()',g.ctx);
 assert.equal(flow.outcome,'AUTO_QUICK_DONE');assert.equal(flow.steps[0],'VLAN_DEFAULTS');
 console.log('PASS restart: new detected VLAN stage clears old ISP step guard, without resending ISP');
})().catch(e=>{console.error(e);process.exitCode=1});
