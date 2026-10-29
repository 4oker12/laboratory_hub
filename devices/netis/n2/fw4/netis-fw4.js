/* RouterLab / Netis N2 FW4 (N2-V4.0.1.4317).
 * Evidence-derived adapter. Never commit raw HAR files or captured secrets.
 * Not a standalone extension: use with the existing RouterLab UI.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RouterLabNetisFW4 = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  'use strict';
  const GET_APPS = new Set(['guide', 'base', 'routerState', 'wan_lan', 'wlan', 'igmp']);
  const FIRMWARE_PREFIX = 'N2-V4.';
  const MAX_RESPONSE_BYTES = 2_000_000;

  function safeParse(input) {
    if (typeof input !== 'string' || input.length > MAX_RESPONSE_BYTES)
      throw new Error('NETIS_RESPONSE_INVALID_LENGTH');
    // Firmware sends JSON-like text with trailing commas. Never eval router replies.
    let output = '', quoted = false, escaped = false;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (quoted) {
        output += c;
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') {
        quoted = true; output += c;
      } else if (c === ',') {
        let n = i + 1;
        while (n < input.length && /\s/.test(input[n])) n++;
        if (input[n] !== '}' && input[n] !== ']') output += c;
      } else output += c;
    }
    const parsed = JSON.parse(output);
    const guard = (v, depth = 0) => {
      if (depth > 80) throw new Error('NETIS_RESPONSE_TOO_DEEP');
      if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) {
          if (['__proto__', 'prototype', 'constructor'].includes(k))
            throw new Error('NETIS_RESPONSE_UNSAFE_KEY');
          guard(v[k], depth + 1);
        }
      }
    };
    guard(parsed);
    return parsed;
  }

  function encode64(text) {
    if (typeof text !== 'string' || !text.length) throw new Error('NETIS_EMPTY_SECRET');
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(text);
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }
  function checkSSID(value) {
    if (typeof value !== 'string' || !value.length || new TextEncoder().encode(value).length > 32)
      throw new Error('NETIS_SSID_INVALID');
    return value;
  }
  function checkPassword(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 63 || /[^\x20-\x7E]/.test(value))
      throw new Error('NETIS_WIFI_PASSWORD_INVALID');
    return value;
  }
  function fingerprint(data) {
    return !!data && data.model === 'N2' && typeof data.version === 'string' &&
      data.version.startsWith(FIRMWARE_PREFIX) && data.vender === 'CIS';
  }
  function stage(data) {
    if (!fingerprint(data)) return {mode:'UNSUPPORTED',phase:'UNSUPPORTED_FIRMWARE'};
    if (data.passwd === '0') return {mode:'FACTORY',phase:'QUICK_SETUP'};
    if (data.passwd === '1') return {mode:'CONFIGURED',phase:'AUTH_REQUIRED_OR_READY'};
    return {mode:'UNKNOWN',phase:'VERIFY_STATE'};
  }
  function params(data) {
    const o = new URLSearchParams();
    for (const [k,v] of Object.entries(data)) {
      if (v === undefined || v === null) throw new Error('NETIS_INVALID_FIELD_' + k);
      o.append(k, String(v));
    }
    return o.toString();
  }
  function decodeResult(data) {
    if (!Array.isArray(data) || typeof data[0] !== 'string')
      throw new Error('NETIS_UNEXPECTED_SET_REPLY');
    if (data[0] === 'SUCCESS') return {status:'REQUEST_OK'};
    if (data[0] === 'SETTING') return {status:'APPLY_PENDING',reason:'SETTING; readback required'};
    if (data[0] === 'LOCK') return {status:'LOCKED'};
    return {status:'REJECTED',code:data[0]};
  }
  function selectedRadio(payload, band) {
    const idx = Number(payload[band === '2g' ? 'wl2g_idx' : 'wl5g_idx']);
    if (!Number.isInteger(idx) || idx < 0 || !Array.isArray(payload.wlan) || !payload.wlan[idx])
      throw new Error('NETIS_RADIO_NOT_FOUND');
    return {index:idx, item:payload.wlan[idx]};
  }
  function buildFactoryDhcp(input, guide) {
    if (stage(guide).mode !== 'FACTORY') throw new Error('NETIS_NOT_FACTORY');
    const wl2 = selectedRadio(guide, '2g').index, wl5 = selectedRadio(guide, '5g').index;
    const ssid2g = checkSSID(input.ssid2g), ssid5g = checkSSID(input.ssid5g);
    const password = checkPassword(input.wifiPassword);
    if (typeof input.adminPassword !== 'string' || input.adminPassword.length < 1 || input.adminPassword.length > 64)
      throw new Error('NETIS_ADMIN_PASSWORD_INVALID');
    // Observed 2026-10-28 factory DHCP write. PPPoE/static are not verified.
    return {
      app:'wan_set_shortcut',firstSetup:1,quick_set:'ap',wl_link:0,
      wan:'mod',id:1,ifIndex:1,type:1,dhcp:0,dnsMode:0,
      wl_idx:0,wl2g_idx:wl2,wl5g_idx:wl5,wlanMode:0,autoUpdate:1,
      ssid2g:encode64(ssid2g),ssid5g:encode64(ssid5g),
      encrypt:4,wpaPsk:encode64(password),wpaPskFormat:0,wpaPskType:2,
      password:encode64(input.adminPassword)
    };
  }
  function toSharedFlow(data) {
    const s = stage(data);
    if (s.mode === 'FACTORY') return {mode:'FIRST_CONNECT',phase:'QUICK_SETUP',action:'CONFIGURE_FACTORY'};
    if (s.mode === 'CONFIGURED') return {mode:'KNOWN_PASSWORD',phase:'VERIFY_STATE',action:'CHECK_AUTH'};
    return {mode:'UNAVAILABLE',phase:s.phase,action:'DIAGNOSE'};
  }

  class NetisFW4Adapter {
    constructor({transport}) {
      if (typeof transport !== 'function') throw new Error('NETIS_TRANSPORT_REQUIRED');
      this.transport = transport;
    }
    async post(path, form) {
      const r = await this.transport({path,method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
        body:params(form)});
      if (!r || r.status !== 200 || typeof r.text !== 'string')
        throw new Error('NETIS_HTTP_INDETERMINATE');
      return safeParse(r.text);
    }
    async read(app) {
      if (!GET_APPS.has(app)) throw new Error('NETIS_READ_APP_NOT_ALLOWED');
      const payload = app === 'base' ? {app} : {mode_name:'skk_get',wl_link:0,app};
      return this.post('/cgi-bin/skk_get.cgi',payload);
    }
    async detect() {
      const base = await this.read('base');
      return {supported:fingerprint(base),model:base.model,version:base.version,stage:stage(base)};
    }
    async login(password) {
      return decodeResult(await this.post('/cgi-bin/login.cgi',{password:encode64(password)}));
    }
    async readWifi() {
      const data = await this.read('wlan');
      if (!fingerprint(data)) throw new Error('NETIS_FIRMWARE_MISMATCH');
      return {
        '2g': {index:selectedRadio(data,'2g').index,rfPower:String(selectedRadio(data,'2g').item.rfPower)},
        '5g': {index:selectedRadio(data,'5g').index,rfPower:String(selectedRadio(data,'5g').item.rfPower)}
      };
    }
    async setRadioPower(band,power,{confirmed=false}={}) {
      if (!confirmed) throw new Error('NETIS_WRITE_REQUIRES_CONFIRMATION');
      if (!['2g','5g'].includes(band) || ![2,50,100].includes(power))
        throw new Error('NETIS_RADIO_POWER_UNSUPPORTED');
      const before=await this.read('wlan');
      if (!fingerprint(before)) throw new Error('NETIS_FIRMWARE_MISMATCH');
      const idx=selectedRadio(before,band).index;
      const result=decodeResult(await this.post('/cgi-bin/skk_set.cgi',{
        mode_name:'skk_set',rfPower:power,multiple_ssid_set:'save',wl_idx:idx,app:'advance',wl_link:0
      }));
      if (result.status !== 'REQUEST_OK') return {write:result,status:result.status};
      const after=await this.read('wlan');
      const verified=String(selectedRadio(after,band).item.rfPower)===String(power);
      return {write:result,status:verified?'READBACK_OK':'READBACK_MISMATCH',persisted:false};
    }
    async readIgmp() {
      const x=await this.read('igmp');
      if (!fingerprint(x)) throw new Error('NETIS_FIRMWARE_MISMATCH');
      return {proxy:x.igmpProxyEnabled==='1',snooping:x.igmpSnoopEnabled==='1'};
    }
    async setIgmp({proxy,snooping,confirmed=false}) {
      if (!confirmed) throw new Error('NETIS_WRITE_REQUIRES_CONFIRMATION');
      if (typeof proxy!=='boolean'||typeof snooping!=='boolean') throw Error('NETIS_INVALID_IGMP');
      await this.readIgmp();
      const result=decodeResult(await this.post('/cgi-bin/skk_set.cgi',{
        app:'igmp',igmp_set:'save',igmpProxyEnabled:+proxy,igmpSnoopEnabled:+snooping,wl_link:0
      }));
      if (result.status!=='REQUEST_OK') return {write:result,status:result.status};
      const after=await this.readIgmp();
      return {write:result,
        status:(after.proxy===proxy&&after.snooping===snooping)?'READBACK_OK':'READBACK_MISMATCH',
        persisted:false};
    }
    async factoryDhcp(input,{confirmed=false}={}) {
      if (!confirmed) throw Error('NETIS_FACTORY_WRITE_REQUIRES_CONFIRMATION');
      const guide=await this.read('guide'), form=buildFactoryDhcp(input,guide);
      // Write can interrupt Wi-Fi/LAN. NEVER automatically retry first-run SET.
      try {
        const response=decodeResult(await this.post('/cgi-bin/skk_set.cgi',form));
        return {status:response.status,verified:false,requiresReconnect:true};
      } catch(err) {
        if (err.message==='NETIS_HTTP_INDETERMINATE'||err instanceof TypeError)
          return {status:'APPLY_UNCONFIRMED',verified:false,requiresReconnect:true};
        throw err;
      }
    }
    async readWan() {
      const data=await this.read('wan_lan');
      if (!fingerprint(data)) throw Error('NETIS_FIRMWARE_MISMATCH');
      return {type:data.wan?.[0]?.type??null,connected:data.connected??null,
        lanIp:data.lanIpAddr??null,dhcpEnabled:data.dhcpEnabled??null};
    }
  }
  function createFetchTransport({baseUrl,fetchImpl=(typeof fetch!=='undefined'?fetch:null)}) {
    if (!fetchImpl) throw new Error('NETIS_FETCH_UNAVAILABLE');
    const url=new URL(baseUrl);
    if (url.protocol!=='http:'||!/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname))
      throw Error('NETIS_PRIVATE_HTTP_ORIGIN_REQUIRED');
    if (url.username||url.password||url.pathname!=='/'||url.search||url.hash)
      throw Error('NETIS_INVALID_ORIGIN');
    return async ({path,method,headers,body}) => {
      if (!['/cgi-bin/skk_get.cgi','/cgi-bin/skk_set.cgi','/cgi-bin/login.cgi'].includes(path))
        throw Error('NETIS_PATH_NOT_ALLOWED');
      const res=await fetchImpl(new URL(path,url).href,{method,headers,body,
        credentials:'include',redirect:'error',cache:'no-store'});
      return {status:res.status,text:await res.text()};
    };
  }
  return Object.freeze({NetisFW4Adapter,createFetchTransport,safeParse,fingerprint,
    stage,toSharedFlow,decodeResult,buildFactoryDhcp,encode64});
});
