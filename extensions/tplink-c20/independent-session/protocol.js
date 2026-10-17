/* Strict TP-Link GDPR wire commands. The read-back is mandatory after SET. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.C20Protocol=api})(typeof globalThis==='object'?globalThis:this,()=>{
'use strict';
const ROOT_STACK='0,0,0,0,0,0';
const validStack=s=>typeof s==='string'&&/^\d+(?:,\d+){5}$/.test(s);
const node=(oid,stack,index,attrs)=>`[${oid}#${stack}#0,0,0,0,0,0]${index},${attrs.length}\r\n${attrs.join('\r\n')}\r\n`;
const WIFI_ATTRS=['Enable','SSID','X_TP_Band','X_TP_PreSharedKey','SSIDAdvertisementEnabled'];

// Two observed TP-Link GDPR login dialects. The legacy VR-style firmware
// uses UserName plus Base64(UTF-8 password) before AES/RSA wrapping.
// Generate the vendor attributes in a single place rather than inline strings.
function adminField(v,label){
 if(typeof v!=='string'||!v||v.length>80||/[\r\n\0]/.test(v))throw Error('INVALID_LOGIN_'+label);
 return v;
}
function loginLowercase(user,password){
 adminField(user,'USER');adminField(password,'PASSWORD');
 return '8\r\n'+node('/cgi/login',ROOT_STACK,0,['username='+user,'password='+password]);
}
function loginLegacy(user,password){
 adminField(user,'USER');adminField(password,'PASSWORD');
 const bytes=new TextEncoder().encode(password);
 if(bytes.length>255)throw Error('INVALID_LOGIN_PASSWORD_BYTES');
 const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
 return '8\r\n'+node('/cgi/login',ROOT_STACK,0,['UserName='+user,'Passwd='+encoded]);
}

// ACT_GL is 5 (as declared in the user's stock lib.js and used by
// the physically working stock WLAN list). ACT_GET=1 is NOT a list read.
// Use dynamic stacks from this list rather than guessing per-band IDs.
function wifiRead(){return '5\r\n'+node('LAN_WLAN',ROOT_STACK,0,['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled'])}
function wifiReadFallback(){return '5\r\n'+node('LAN_WLAN',ROOT_STACK,0,['SSID','X_TP_Band'])}
function versionRead(){return '1\r\n'+node('IGD_DEV_INFO','0,0,0,0,0,0',0,['modelName','hardwareVersion','softwareVersion'])}
function wanRead(){return '1&1\r\n'+node('WAN_IP_CONN','1,1,1,0,0,0',0,['Enable','AddressingType','ConnectionType'])+node('WAN_PPP_CONN','1,1,1,0,0,0',1,['Enable','ConnectionType'])}
function checked(v,label,min,max){if(typeof v!=='string'||v.length<min||v.length>max||/[\r\n\0]/.test(v))throw Error('INVALID_'+label);return v}
function wifiSet({ssid24,ssid5,password,stack24,stack5}){
 checked(ssid24,'SSID24',1,32);checked(ssid5,'SSID5',1,32);
 if(!validStack(stack24)||!validStack(stack5)||stack24===stack5)throw Error('DYNAMIC_STACKS_REQUIRED');
 if(password!==undefined)checked(password,'WIFI_KEY',8,63);
 const mk=(ssid,index,stack)=>{
   const lines=['SSID='+ssid];if(password!==undefined)lines.push('X_TP_PreSharedKey='+password);
   return node('LAN_WLAN',stack,index,lines)
 };
 // Stock TP-Link wizard uses ACT_SET for both dynamic WLAN instance stacks.
 // Do not use this until the hardware's exact stacks have been read back.
 return '2&2\r\n'+mk(ssid24,0,stack24)+mk(ssid5,1,stack5);
}
function wanSetDhcp(observed){
 // Never guess which WAN object to mutate. We require fresh explicit evidence.
 if(!observed||!observed.hasWanIpConn||!observed.hasAddressingType)throw Error('WAN_SCHEMA_NOT_CONFIRMED');
 throw Error('WAN_DHCP_SET_CONTRACT_NOT_VALIDATED_ON_HARDWARE');
}
function parseErrors(text){const t=String(text||'');const m=t.match(/\[error\]\s*(-?\d+)/i);return m?Number(m[1]):null}
// A successful HTTP/decryption is not a successful login. Keep vendor status
// fields distinct; in particular [error]0 must never mask a nonzero $.ret.
// No response text, password or session material enters this diagnostic.
// Safe, shape-only inspection of a decrypted login reply. Never return
// cookie/token values, the raw response, or credential material.
function loginSessionHints(raw){
 const s=String(raw||'');
 return {
   tokenFieldPresent:/(?:^|[\r\n\s;,{])(?:var\s+)?[\"']?(?:TokenID|token|stok|tokenID)[\"']?\s*[:=]/i.test(s),
   cookieFieldPresent:/(?:^|[\r\n\s;,{])(?:JSESSIONID|sysauth|Authorization)[\"']?\s*[:=]/i.test(s)
 };
}
function parseLoginResult(raw){
 const text=String(raw||'');
 const ret=text.match(/\$\.ret\s*=\s*(-?\d+)/);
 const retCode=ret?Number(ret[1]):null;
 const errorCode=parseErrors(text);
 const rejected=(retCode!==null&&retCode!==0)||(errorCode!==null&&errorCode!==0);
 const code=(retCode!==null&&retCode!==0)?retCode:((errorCode!==null&&errorCode!==0)?errorCode:null);
 const status=rejected?'REJECTED':retCode===0||errorCode===0?'ZERO_ACK_ONLY':'NO_VENDOR_STATUS';
 const shape=/\[cgi\]/i.test(text)?'CGI_REPLY':/\[error\]/i.test(text)?'ERROR_ONLY':'NO_CGI_MARKER';
 return {retCode,errorCode,rejected,code,status,shape};
}

function parseWifi(text){
 const raw=String(text||''); const list=[];
 const re=/\[LAN_WLAN#([^#\]\r\n]+)#([^\]\r\n]+)\](\d+),(\d+)/ig;
 const found=Array.from(raw.matchAll(re));
 for(let i=0;i<found.length;i++){
   const m=found[i],chunk=raw.slice(m.index+m[0].length,i+1<found.length?found[i+1].index:raw.length);
   const val=key=>chunk.match(new RegExp('(?:^|\\r?\\n)\\s*'+key+'\\s*=\\s*([^\\r\\n]*)','i'))?.[1]?.trim()??null;
   list.push({stack:m[1],index:Number(m[3]),ssid:val('SSID'),band:val('X_TP_Band'),hasKey:val('X_TP_PreSharedKey')!==null});
 }
 const b24=list.filter(x=>/2[.,]?4\s*(?:g|ghz)?/i.test(x.band||''));
 const b5=list.filter(x=>/(?:^|[^0-9])5\s*(?:g|ghz)?(?:$|[^a-z])/i.test(x.band||''));
 const r24=b24.length===1?b24[0]:null,r5=b5.length===1?b5[0]:null;
 const verified=!!(r24&&r5&&r24.ssid&&r5.ssid&&validStack(r24.stack)&&validStack(r5.stack)&&r24.stack!==r5.stack);
 return {radio24:r24,radio5:r5,found:list.length,verifiedPhysicalContract:false,dynamicStacksVerified:verified};
}
function parseIdentity(raw){const txt=String(raw||'');const get=k=>txt.match(new RegExp('(?:^|\\r?\\n)\\s*'+k+'\\s*=\\s*([^\\r\\n]*)','i'))?.[1]?.trim()||'';
 const model=get('modelName'),hardware=get('hardwareVersion'),firmware=get('softwareVersion');
 const exactModel=/\bArcher\s*C20\b/i.test(model+' '+hardware);
 const exactHardware=/\bv5\b/i.test(hardware);
 const exactFirmware=/200821/i.test(firmware)&&/v6038\.0/i.test(firmware);
 return {model,hardware,firmware,exactModel,exactHardware,exactFirmware,allowed:exactModel&&exactHardware&&exactFirmware};
}
function parseWan(raw){const txt=String(raw||'');return {hasWanIpConn:/\[WAN_IP_CONN#/i.test(txt),hasAddressingType:/\bAddressingType\s*=/i.test(txt),dhcp:/\bAddressingType\s*=\s*DHCP/i.test(txt)};}
return Object.freeze({loginLowercase,loginLegacy,loginSessionHints,wifiRead,wifiReadFallback,wifiSet,wanRead,wanSetDhcp,versionRead,parseErrors,parseLoginResult,parseWifi,parseIdentity,parseWan});
});
