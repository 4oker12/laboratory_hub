'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {NetisFW4Adapter,buildFactoryDhcp}=require('../devices/netis/n2/fw4/netis-fw4.js');
const guide=()=>({model:'N2',version:'N2-V4.0.1.4317',vender:'CIS',
 passwd:'0',wl2g_idx:'6',wl5g_idx:'0',wlan:Array.from({length:12},()=>({}))});
const form={ssid2g:'RouterLab-Test-24',ssid5g:'RouterLab-Test-5G',
 wifiPassword:'test_wifi_1234',adminPassword:'test_admin_1234'};
const fieldOrder=['wl2g_idx','wl5g_idx','wlanMode','wl_idx','ssid2g','ssid5g',
'wpaPsk','encrypt','wpaPskType','wpaPskFormat','password','autoUpdate','id',
'ifIndex','wan','wl_link','type','dhcp','dnsMode','dns1','dns2','firstSetup','quick_set','app'];
test('physical HAR exact factory CGI form shape and dynamic indices',()=>{
 const v=buildFactoryDhcp(form,guide());
 assert.deepEqual(Object.keys(v),fieldOrder);
 assert.equal(v.wl2g_idx,6);assert.equal(v.wl5g_idx,0);
 assert.equal(v.firstSetup,1);assert.equal(v.quick_set,'ap');
 assert.equal(v.dns1,'');assert.equal(v.dns2,'');
 assert.equal(v.wan,'mod');assert.equal(v.type,1);
 assert.equal(v.app,'wan_set_shortcut');
});
test('one factory SET, lost Wi-Fi -> inconclusive not failure',async()=>{
 const seen=[];const a=new NetisFW4Adapter({transport:async req=>{
  seen.push(req.path);
  if(req.path.endsWith('skk_get.cgi'))return {status:200,text:JSON.stringify(guide())};
  throw TypeError('normal Wi-Fi disconnect during Apply');
 }});
 const result=await a.factoryDhcp(form,{confirmed:true});
 assert.equal(result.status,'APPLY_UNCONFIRMED');
 assert.equal(result.requiresReconnect,true);
 assert.equal(seen.filter(x=>x.endsWith('skk_set.cgi')).length,1);
});
test('explicit rejection and unsupported state never become false successes',async()=>{
 const seen=[];const a=new NetisFW4Adapter({transport:async req=>{
  seen.push(req.path);
  if(req.path.endsWith('skk_get.cgi'))return {status:200,text:JSON.stringify(guide())};
  return {status:200,text:'["REJECTED"]'};
 }});
 const result=await a.factoryDhcp(form,{confirmed:true});
 assert.equal(result.status,'REJECTED');assert.equal(result.requiresReconnect,false);
 const another=new NetisFW4Adapter({transport:async req=>{
  if(req.path.endsWith('skk_get.cgi'))return {status:200,text:JSON.stringify({...guide(),passwd:'1'})};
  throw Error('must never write configured');
 }});
 await assert.rejects(another.factoryDhcp(form,{confirmed:true}),/NOT_FACTORY/);
 assert.equal(seen.filter(x=>x.endsWith('skk_set.cgi')).length,1);
});
