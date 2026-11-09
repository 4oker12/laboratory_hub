/* RouterLab Archer C64 read-only device identity.
 * Evidence: private physical-device HAR, C64 V1.0, firmware 1.13.2
 * Build 230824; HTTP_READ=2 and DEVICE_DATA_ID=0 in stock MERProxy.
 *
 * This driver sends ONE explicitly user-initiated same-origin read request.
 * It never sends AUTH, password, WAN/WLAN SET, or other CGI commands.
 * No cookies, tokens, or raw response bodies are included in diagnostics.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RouterLabC64ReadOnly=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const READ_PATH='/?code=2&asyn=1';
  const DEVICE_BLOCK='0|1,0,0';
  const MAX_RESPONSE=8192;

  function privateIPv4(host){
    if(typeof host!=='string'||!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host))return false;
    const v=host.split('.').map(Number);
    if(v.some(n=>n>255))return false;
    return v[0]===10 || (v[0]===172&&v[1]>=16&&v[1]<=31)
      || (v[0]===192&&v[1]===168);
  }
  function decode(value){
    try{return decodeURIComponent(value.replace(/\+/g,'%20'));}
    catch(_){return '';}
  }
  function parseDeviceInfo(raw){
    if(typeof raw!=='string'||raw.length<40||raw.length>MAX_RESPONSE)
      return Object.freeze({ok:false,reason:'INVALID_RESPONSE_SIZE'});
    const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(lines[0]!=='00000'||lines[1]!=='id 0|1,0,0')
      return Object.freeze({ok:false,reason:'WRONG_DEVICE_BLOCK_OR_STATUS'});
    const fields=Object.create(null);
    const allowed=new Set(['modelName','hardVer','softVer']);
    for(const line of lines.slice(2)){
      const p=line.indexOf(' ');
      if(p<1)continue;
      const key=line.slice(0,p);
      if(!allowed.has(key)||fields[key])continue;
      fields[key]=decode(line.slice(p+1).slice(0,160));
    }
    const model=fields.modelName||'';
    if(!/^Archer C64$/i.test(model))
      return Object.freeze({ok:false,reason:'MODEL_MISMATCH'});
    const hard=fields.hardVer||'';
    const hw=hard.match(/^Archer C64\s+(?:V|Ver\.?\s*)?(\d+(?:\.\d+)?)$/i);
    if(!hw)return Object.freeze({ok:false,reason:'HARDWARE_REVISION_UNKNOWN'});
    const firmware=fields.softVer||'';
    const build=firmware.match(/\bBuild\s+(\d{6,8})\b/i)?.[1]||'';
    if(!build||!/^[a-zA-Z0-9 .()_-]{6,120}$/.test(firmware))
      return Object.freeze({ok:false,reason:'FIRMWARE_FORMAT_UNKNOWN'});
    const hardware='V'+hw[1];
    return Object.freeze({
      ok:true,model:'Archer C64',hardware,build,firmware,
      proof:'SAME_ORIGIN_MER_DEVICE_BLOCK',
      firmwareProtocolVerified:false,authenticated:false,canWrite:false
    });
  }
  function allowedContext(w,opts){
    try{
      if(!w?.location||!['http:','https:'].includes(w.location.protocol)
        ||!privateIPv4(w.location.hostname)
        ||opts?.profileId!=='tplink-archer-c64'||opts?.userInitiated!==true)
        return Object.freeze({ok:false,reason:'UNSAFE_OR_UNCONFIRMED_CONTEXT'});
      const d=w?.RouterLabC64Driver?.detect(w.document,w);
      if(d?.framework!=='TPLINK_SU_CANDIDATE')
        return Object.freeze({ok:false,reason:'TP_LINK_SU_NOT_DETECTED'});
      return Object.freeze({ok:true});
    }catch(_){
      return Object.freeze({ok:false,reason:'CONTEXT_CHECK_FAILED'});
    }
  }
  async function readIdentity(w,opts){
    const gate=allowedContext(w,opts);
    if(!gate.ok)return gate;
    const controller=typeof w.AbortController==='function'
      ?new w.AbortController():null;
    // The user invokes this once; bound request time is independent of
    // vendor UI animation and login sessions.
    const timer=w.setTimeout&&controller
      ?w.setTimeout(()=>controller.abort(),5000):null;
    try{
      const r=await w.fetch(READ_PATH,{
        method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},
        body:DEVICE_BLOCK,credentials:'same-origin',redirect:'error',
        cache:'no-store',...(controller?{signal:controller.signal}:{})
      });
      if(!r||r.status!==200)
        return Object.freeze({ok:false,reason:'HTTP_READ_FAILED'});
      const raw=await r.text();
      return parseDeviceInfo(raw);
    }catch(_){
      return Object.freeze({ok:false,reason:'NETWORK_OR_TIMEOUT'});
    }finally{
      if(timer!=null&&w.clearTimeout)w.clearTimeout(timer);
    }
  }
  return Object.freeze({parseDeviceInfo,privateIPv4,allowedContext,readIdentity});
});
