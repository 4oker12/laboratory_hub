/* RouterLab C20 unified two-state flow. Pure, side-effect-free helpers. */
'use strict';
const C20Flow = Object.freeze({
  classifyNative(n){
    if(!n || !n.isC20) return {mode:'UNAVAILABLE',phase:'NO_C20',action:'DISCOVER'};
    switch(n.stage){
      case 'FACTORY_PASSWORD': return {mode:'FIRST_CONNECT',phase:'CREATE_ADMIN',action:'CREATE_ADMIN'};
      case 'LOGIN_LOCKED': return {mode:'KNOWN_PASSWORD',phase:'AUTH_LOCKED',action:'WAIT_LOCKOUT'};
      case 'LOGIN_FORM': return {mode:'KNOWN_PASSWORD',phase:'LOGIN',action:'LOGIN'};
      case 'AUTH_UNCONFIRMED': return {mode:'KNOWN_PASSWORD',phase:'VERIFY_STATE',action:'VERIFY_WITHOUT_PASSWORD'};
      case 'QUICK_SETUP_ACTIVE': return {mode:'KNOWN_PASSWORD',phase:'QUICK_SETUP',action:'RESUME_QUICK'};
      case 'CONFIGURED_AUTHENTICATED': return {mode:'KNOWN_PASSWORD',phase:'WIFI_EDITOR',action:'READ_WIFI'};
      default: return {mode:'UNAVAILABLE',phase:'UNKNOWN_STATE',action:'DIAGNOSE'};
    }
  },
  cleanWifi(form){
    const ssid24=typeof form?.ssid24==='string'?form.ssid24.trim():'';
    const ssid5=typeof form?.ssid5==='string'?form.ssid5.trim():'';
    const password=typeof form?.wifiPassword==='string'?form.wifiPassword:'';
    const hasNames=!!(ssid24||ssid5), hasKey=!!password;
    for(const [key,val] of [['SSID24',ssid24],['SSID5',ssid5]])if(val && (/\r|\n|\0/.test(val)||new TextEncoder().encode(val).length>32))throw Error('C20_BAD_'+key);
    if(hasKey&&(password.length<8||password.length>63||!/^[\x20-\x7e]+$/.test(password)))throw Error('C20_WIFI_PASSWORD_8_TO_63_ASCII');
    if(hasNames && !(ssid24&&ssid5))throw Error('C20_BOTH_SSIDS_REQUIRED_IF_CHANGED');
    return{ssid24,ssid5,password,hasNames,hasKey};
  },
  quickStepFromSignals(s){
    if(s.wlan) return 'WIRELESS';
    if(s.isp) return 'ISP_WAN';
    if(s.vlan) return 'VLAN_DEFAULTS';
    if(s.finish) return 'FINISH';
    return 'UNKNOWN';
  }
});
