/* RouterLab Adapter Hub v1
 * One editable policy table. Model choice selects a protocol family;
 * identity, firmware and login are separate proofs. Never execute writes
 * when an adapter is absent or a proof is missing.
 *
 * A real driver can implement the contract below without changing the UI:
 * probe, getSetupState, createAdminPassword, login, verifySession,
 * readWan, setWanDhcp, readWifi, setWifi, save, verifyChanges.
 */
(function(root, factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RouterLabAdapterHub=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const REQUIRED = Object.freeze([
    'probe','getSetupState','createAdminPassword','login','verifySession',
    'readWan','setWanDhcp','readWifi','setWifi','save','verifyChanges'
  ]);
  const READ = new Set(['probe','getSetupState','readWan','readWifi','verifySession']);
  const WRITE = new Set(['createAdminPassword','setWanDhcp','setWifi','save']);
  const AUTH = new Set(['readWan','readWifi','setWanDhcp','setWifi','save','verifyChanges']);
  const RULES = Object.freeze({
    'tplink-archer-c20':Object.freeze({
      driver:'tplink-c20-v5',protocol:'TPLINK_LEGACY_GDPR',hardware:['v5'],
      builds:['200821'],region:'',configStatus:'PILOT_EXISTING',
      userFlows:['FIRST_CONNECT','LOGIN','QUICK_SETUP','WIFI_EDITOR']
    }),
    'tplink-archer-c54':Object.freeze({
      driver:'tplink-c54-v1',protocol:'TPLINK_SU_VXWORKS',hardware:['v1','v1.0'],
      builds:['250811'],region:'EU',configStatus:'REVERSE_REQUIRED',
      userFlows:['FIRST_CONNECT','LOGIN','QUICK_SETUP','WIFI_EDITOR']
    }),
    'tplink-archer-c64':Object.freeze({
      driver:'tplink-c64-unverified',protocol:'UNKNOWN_TPLINK_C64',
      hardware:[],builds:[],region:'',configStatus:'REVERSE_REQUIRED',
      userFlows:['FIRST_CONNECT','LOGIN','QUICK_SETUP','WIFI_EDITOR']
    }),
    'netis-n2':Object.freeze({
      driver:'netis-fw4',protocol:'NETIS_CGI_FW4',hardware:[],
      builds:['N2-V4.0.1.4317'],region:'',configStatus:'PILOT_EXISTING',
      userFlows:['FIRST_CONNECT','LOGIN','QUICK_SETUP','WIFI_EDITOR']
    }),
    'cudy-wr1200':Object.freeze({
      driver:'cudy-luci-wr1200',protocol:'CUDY_LUCI',hardware:[],
      builds:[],region:'',configStatus:'MOBILE_DRIVER_REQUIRED',
      userFlows:['FIRST_CONNECT','LOGIN','QUICK_SETUP','WIFI_EDITOR']
    }),
    'cudy-wr1300':Object.freeze({
      driver:'cudy-luci-wr1300-v4',protocol:'CUDY_LUCI',hardware:['v4'],
      builds:[],region:'',configStatus:'MOBILE_DRIVER_REQUIRED',
      userFlows:['FIRST_CONNECT','LOGIN','QUICK_SETUP','WIFI_EDITOR']
    }),
    'cudy-wr3000':Object.freeze({
      driver:'cudy-luci-wr3000',protocol:'CUDY_LUCI',hardware:[],
      builds:[],region:'',configStatus:'MOBILE_DRIVER_REQUIRED',
      userFlows:['FIRST_CONNECT','LOGIN','QUICK_SETUP','WIFI_EDITOR']
    })
  });
  const FLOW = Object.freeze({
    INIT:['IDENTIFIED_MANUAL','IDENTIFIED_AUTO'],
    IDENTIFIED_AUTO:['FIRMWARE_CHECK','BLOCKED'],
    IDENTIFIED_MANUAL:['FIRMWARE_CHECK','BLOCKED'],
    FIRMWARE_CHECK:['FIRST_CONNECT','LOGIN_REQUIRED','BLOCKED'],
    FIRST_CONNECT:['PASSWORD_PENDING','BLOCKED'],
    PASSWORD_PENDING:['QUICK_SETUP','LOGIN_REQUIRED','BLOCKED'],
    LOGIN_REQUIRED:['LOGIN_PENDING','BLOCKED'],
    LOGIN_PENDING:['AUTHENTICATED','LOGIN_REQUIRED','BLOCKED'],
    AUTHENTICATED:['QUICK_SETUP','WIFI_EDITOR','BLOCKED'],
    QUICK_SETUP:['SAVE_PENDING','WIFI_EDITOR','BLOCKED'],
    WIFI_EDITOR:['SAVE_PENDING','BLOCKED'],
    SAVE_PENDING:['VERIFY_PENDING','BLOCKED'],
    VERIFY_PENDING:['READBACK_VERIFIED','BLOCKED'],
    READBACK_VERIFIED:['WIFI_EDITOR','QUICK_SETUP','BLOCKED'],
    BLOCKED:['FIRMWARE_CHECK']
  });
  function policy(profileId) {
    return RULES[profileId]||null;
  }
  function choose(profileId, source) {
    const rules=policy(profileId);
    if(!rules)return Object.freeze({ok:false,reason:'UNKNOWN_PROFILE'});
    const manual=source==='MANUAL';
    return Object.freeze({
      ok:true,profileId,driver:rules.driver,protocol:rules.protocol,
      configStatus:rules.configStatus,
      stage:manual?'IDENTIFIED_MANUAL':'IDENTIFIED_AUTO',
      evidence:manual?'MANUAL':'PAGE_HINT',
      identityVerified:false,firmwareVerified:false,authenticated:false,
      capabilities:RULES[profileId].userFlows,
      canWrite:false
    });
  }
  function versionGate(profileId, observed) {
    const rules=policy(profileId);
    if(!rules)return {ok:false,reason:'UNKNOWN_PROFILE'};
    const hw=String(observed?.hardware||'').toLowerCase();
    const build=String(observed?.build||'');
    const region=String(observed?.region||'').toUpperCase();
    if(rules.hardware.length&&!rules.hardware.includes(hw))
      return {ok:false,reason:'HARDWARE_NOT_VALIDATED'};
    if(rules.builds.length&&!rules.builds.includes(build))
      return {ok:false,reason:'FIRMWARE_BUILD_NOT_VALIDATED'};
    if(rules.region&&rules.region!==region)
      return {ok:false,reason:'REGION_NOT_VALIDATED'};
    return {ok:true,reason:'VERSION_MATCH_ONLY_NOT_AUTH_PROOF'};
  }
  function canCall(profileId, operation, proof, implemented) {
    if(!policy(profileId))return {allowed:false,reason:'UNKNOWN_PROFILE'};
    if(!REQUIRED.includes(operation))return {allowed:false,reason:'UNKNOWN_OPERATION'};
    // Passive same-origin probes establish identity; requiring identity
    // verification before a probe would create a circular dependency.
    if(operation==='probe') {
      return implemented===true && proof?.sameOrigin===true
        ? {allowed:true,reason:'PASSIVE_PROBE_ONLY'}
        : {allowed:false,reason:'PROBE_NOT_AVAILABLE_OR_ORIGIN_UNVERIFIED'};
    }
    if(!proof||proof.deviceMatched!==true)
      return {allowed:false,reason:'DEVICE_IDENTITY_NOT_VERIFIED'};
    const version=versionGate(profileId,proof);
    if(!version.ok)return {allowed:false,reason:version.reason};
    if(implemented!==true)
      return {allowed:false,reason:'ADAPTER_METHOD_NOT_IMPLEMENTED'};
    if(AUTH.has(operation)&&proof.sessionVerified!==true)
      return {allowed:false,reason:'SESSION_NOT_VERIFIED'};
    if(WRITE.has(operation)&&proof.writeContractVerified!==true)
      return {allowed:false,reason:'WRITE_CONTRACT_NOT_VERIFIED'};
    return {allowed:true,reason:'ADAPTER_METHOD_ELIGIBLE'};
  }
  function nextState(current, target, proof) {
    if(!FLOW[current]||!FLOW[current].includes(target))
      return {ok:false,reason:'INVALID_STATE_TRANSITION',state:current};
    if(target==='AUTHENTICATED'&&proof?.sessionVerified!==true)
      return {ok:false,reason:'SESSION_NOT_VERIFIED',state:current};
    if(target==='READBACK_VERIFIED'&&proof?.readbackVerified!==true)
      return {ok:false,reason:'READBACK_NOT_VERIFIED',state:current};
    if(target==='SAVE_PENDING'&&proof?.writeContractVerified!==true)
      return {ok:false,reason:'WRITE_CONTRACT_NOT_VERIFIED',state:current};
    return {ok:true,state:target};
  }
  // Drivers register explicitly. The manager never invents HTTP URLs or
  // adapts encrypted login payloads from a visually similar router.
  function createRouterRuntime() {
    const installed=new Map();
    function registerDriver(id, methods) {
      if(typeof id!=='string'||!id||!methods||typeof methods.probe!=='function')
        throw Error('INVALID_ADAPTER_CONTRACT');
      if(installed.has(id))throw Error('DUPLICATE_ADAPTER');
      installed.set(id,Object.freeze({...methods}));
    }
    function describe(profileId) {
      const p=policy(profileId);
      if(!p)return null;
      const impl=installed.get(p.driver);
      return Object.freeze({
        profileId,driver:p.driver,protocol:p.protocol,
        state:p.configStatus,
        implemented:REQUIRED.filter(op=>typeof impl?.[op]==='function'),
        missing:REQUIRED.filter(op=>typeof impl?.[op]!=='function')
      });
    }
    async function execute(profileId, op, args, proof) {
      const p=policy(profileId);
      const impl=p&&installed.get(p.driver);
      const gate=canCall(profileId,op,proof,typeof impl?.[op]==='function');
      if(!gate.allowed)return {ok:false,reason:gate.reason};
      // Every invocation is explicit, never a background retry.
      return {ok:true,result:await impl[op](args,proof)};
    }
    return Object.freeze({registerDriver,describe,execute});
  }
  return Object.freeze({RULES,REQUIRED,policy,choose,versionGate,canCall,nextState,createRouterRuntime});
});
