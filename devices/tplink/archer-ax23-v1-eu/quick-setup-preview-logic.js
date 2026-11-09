/* RouterLab AX23 Quick Setup TRAINING preview — never controls a router.
 * Step IDs and field families verified in official AX23(EU) V1 stock qs/script.js.
 * Does not transmit, encrypt or persist credentials. No simulated HTTP success.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.AX23QuickPreview=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const STEPS=Object.freeze([
  Object.freeze({id:"qsSetTimezone",label:"Часовой пояс"}),
  Object.freeze({id:"qsChooseInternetType",label:"Тип подключения"}),
  Object.freeze({id:"qsInternetEdit",label:"Интернет и IPTV"}),
  Object.freeze({id:"qsWirelessSetting",label:"Wi-Fi"}),
  Object.freeze({id:"qsSummary",label:"Сводка"})
 ]);
 const TYPES=Object.freeze(["dhcp","pppoe","static"]);
 const FIELDS=Object.freeze({
  qsSetTimezone:["timeTimezone"],
  qsChooseInternetType:["networkConntype"],
  qsInternetEdit:["ispSpecialInternetVid"],
  qsWirelessSetting:["wireless2gSsid","wireless5gSsid","wirelessSmartEnable"],
  qsSummary:[]
 });
 const trim=x=>typeof x==="string"?x.trim():"";
 const validV4=x=>{
  const parts=trim(x).split(".");
  return parts.length===4 && parts.every(p=>/^\d{1,3}$/.test(p) && +p<=255);
 };
 function create(){
  return {
   timezone:"Europe/Kyiv",wan:"dhcp",pppoeUser:"",pppoePass:"",
   staticIp:"",staticMask:"",staticGateway:"",staticDns:"",
   vlanEnabled:false,vlanId:"",
   smartConnect:false,
   ssid24:"RouterLab-Test-2G",pass24:"RouterLabDemo88",
   ssid5:"RouterLab-Test-5G",pass5:"RouterLabDemo88"
  };
 }
 function validate(step,state){
  const error=[];
  if(step===0 && !trim(state.timezone))error.push("Укажи часовой пояс.");
  if(step===1 && !TYPES.includes(state.wan))error.push("Выбери тип подключения.");
  if(step===2){
   if(state.wan==="pppoe"&&(!trim(state.pppoeUser)||!state.pppoePass))error.push("Для PPPoE нужны логин и пароль.");
   if(state.wan==="static"&&![state.staticIp,state.staticMask,state.staticGateway,state.staticDns].every(validV4))error.push("Для Static IP введи корректные IPv4-адреса, маску, шлюз и DNS.");
   if(state.vlanEnabled && !(String(state.vlanId).match(/^\d{1,4}$/) && +state.vlanId>=1 && +state.vlanId<=4094))error.push("VLAN ID: 1–4094.");
  }
  if(step===3){
   const wifi=[["2,4 ГГц",state.ssid24,state.pass24],["5 ГГц",state.smartConnect?state.ssid24:state.ssid5,state.smartConnect?state.pass24:state.pass5]];
   for(const [label,ssid,pass] of wifi){
    const b=new TextEncoder().encode(trim(ssid)).length;
    if(b<1||b>32)error.push("SSID "+label+": 1–32 байта.");
    if(typeof pass!=="string" || !((pass.length>=8&&pass.length<=63)||(/^[0-9a-fA-F]{64}$/.test(pass))))error.push("Пароль "+label+": 8–63 символа или 64 hex.");
   }
  }
  return error;
 }
 function sanitizedReport(state,phase){
  return {
    mode:"AX23_QUICK_SETUP_UI_ONLY_PREVIEW",
    originalVendorWrite:false,
    originalVendorRead:false,
    emulatedSession:false,
    completedLocally:phase==="complete",
    connectionType:TYPES.includes(state.wan)?state.wan:"invalid",
    vlanRequested:!!state.vlanEnabled,
    smartConnect:!!state.smartConnect,
    wifi24Configured:!!trim(state.ssid24),
    wifi5Configured:!!trim(state.smartConnect?state.ssid24:state.ssid5),
    stockStages:STEPS.map(s=>s.id),
    stockForm:"/admin/quick_setup?form=quick_setup",
    hardwareValidation:"NOT_TESTED"
  };
 }
 return Object.freeze({STEPS,TYPES,FIELDS,create,validate,sanitizedReport,validV4});
});
