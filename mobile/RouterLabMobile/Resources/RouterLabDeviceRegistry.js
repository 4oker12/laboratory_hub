/* RouterLab shared passive device identity and capability registry.
 * IP is an address, not a model. No network writes or secrets in this module.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RouterLabDeviceRegistry = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const PROFILES = Object.freeze([
    Object.freeze({id:'tplink-archer-c20',vendor:'TP-Link',model:'Archer C20',pattern:/\bArcher[\s-]*C20\b/i,adapter:'C20',active:true}),
    Object.freeze({id:'tplink-archer-c54',vendor:'TP-Link',model:'Archer C54',pattern:/\bArcher[\s-]*C54\b/i,adapter:'PENDING_C54',active:false}),
    Object.freeze({id:'netis-n2',vendor:'Netis',model:'N2',pattern:/\bNetis[\s-]+N2\b/i,adapter:'NETIS_FW4',active:true}),
    Object.freeze({id:'cudy-wr1200',vendor:'Cudy',model:'WR1200',pattern:/\bWR1200\b/i,adapter:'PENDING_CUDY',active:false}),
    Object.freeze({id:'cudy-wr1300',vendor:'Cudy',model:'WR1300',pattern:/\bWR1300\b/i,adapter:'PENDING_CUDY',active:false}),
    Object.freeze({id:'cudy-wr3000',vendor:'Cudy',model:'WR3000',pattern:/\bWR3000\b/i,adapter:'PENDING_CUDY',active:false})
  ]);
  const CAPABILITIES = Object.freeze({
    C20: Object.freeze({identity:'PILOT',login:'STOCK_PILOT',quickSetup:'EXPERIMENTAL',wanDhcp:'EXPERIMENTAL',wifiEdit:'EXPERIMENTAL'}),
    NETIS_FW4: Object.freeze({identity:'CGI_VERIFIED',login:'CGI_FW4',quickSetup:'FACTORY_ONLY',wanDhcp:'FACTORY_ONLY',wifiEdit:'NOT_VERIFIED'}),
    PENDING_C54: Object.freeze({identity:'PAGE_HINT',login:'NOT_VERIFIED',quickSetup:'NOT_VERIFIED',wanDhcp:'NOT_VERIFIED',wifiEdit:'NOT_VERIFIED'}),
    PENDING_CUDY: Object.freeze({identity:'PAGE_HINT',login:'NOT_VERIFIED',quickSetup:'NOT_VERIFIED',wanDhcp:'NOT_VERIFIED',wifiEdit:'NOT_VERIFIED'}),
    PENDING_GENERIC: Object.freeze({identity:'PAGE_HINT',login:'NOT_VERIFIED',quickSetup:'NOT_VERIFIED',wanDhcp:'NOT_VERIFIED',wifiEdit:'NOT_VERIFIED'})
  });
  function limit(value,max) {return typeof value==='string'?value.slice(0,max):'';}
  function familyFrom(s) {
    if(/\b(?:TP[\s-]?Link|Archer)\b/i.test(s))return 'TP-Link';
    if(/\bCudy\b/i.test(s))return 'Cudy';
    if(/\bNetis\b/i.test(s))return 'Netis';
    return '';
  }
  function sourceMatch(input,profile) {
    const title=limit(input.title,200),heading=limit(input.headings,600);
    const meta=limit(input.meta,500),body=limit(input.body,1600);
    for(const [source,value,strength] of [
      ['TITLE',title,4],['HEADING',heading,3],['META',meta,3],['BODY',body,2]
    ]) {
      if(!profile.pattern.test(value))continue;
      // Cudy model tokens are not globally unique. Require vendor branding.
      if(profile.vendor==='Cudy' && familyFrom(title+' '+heading+' '+meta+' '+body)!=='Cudy')continue;
      return {source,strength};
    }
    return null;
  }
  function revisionFor(profile,input) {
    const content=[input.title,input.headings,input.meta,input.body].map(x=>limit(x,1200)).join(' ');
    const model=profile.model.replace(/\s+/g,'\\s*');
    const match=content.match(new RegExp('\\b'+model+'\\b\\s*(?:\\(|[\\s,;/])\\s*(?:ver(?:sion)?[. :]*|v)(\\d+(?:\\.\\d+)?)','i')) ||
      content.match(/\b(?:hardware\s+version|hw\s+version|апаратна\s+версія|версия\s+устройства)\b[\s:]+(?:v|ver\.?\s*)?(\d+(?:\.\d+)?)/i);
    return match?'v'+match[1].slice(0,10):'';
  }
  function buildFor(input) {
    const content=[input.title,input.headings,input.meta,input.body].map(x=>limit(x,1000)).join(' ');
    const match=content.match(/\bBuild[\s:]+(\d{6,8})\b/i);
    return match?match[1]:'';
  }
  function genericCandidates(input) {
    // Identify further models by strict model-shaped strings, NOT by IP.
    // General-purpose identities are always read-only and never imply API support.
    const title=limit(input.title,200),heading=limit(input.headings,600);
    const meta=limit(input.meta,500),body=limit(input.body,1600);
    const overallFamily=familyFrom(title+' '+heading+' '+meta+' '+body);
    const known=new Set(PROFILES.map(p=>p.vendor+'|'+p.model.toUpperCase()));
    const found=[];
    for(const [source,value,strength] of [
      ['TITLE',title,4],['HEADING',heading,3],['META',meta,3],['BODY',body,2]
    ]) {
      for(const [vendor,id,regex,format] of [
        ['TP-Link','generic-tplink',/\bArcher[\s-]+((?:AX|BE|C|VR|A)\d{1,4}[A-Z0-9-]{0,7})\b/ig,x=>'Archer '+x.toUpperCase()],
        ['Cudy','generic-cudy',/\b(?:Cudy[\s-]+)?(WR\d{3,5})\b/ig,x=>x.toUpperCase()],
        ['Netis','generic-netis',/\bNetis[\s-]+(N\d{1,3})\b/ig,x=>x.toUpperCase()]
      ]) {
        if(vendor==='Cudy'&&overallFamily!=='Cudy')continue;
        if(vendor==='Netis'&&overallFamily!=='Netis')continue;
        let m;
        while((m=regex.exec(value))!==null) {
          const model=format(m[1]);
          if(known.has(vendor+'|'+model.toUpperCase()))continue;
          found.push({profile:{id,vendor,model,adapter:'PENDING_GENERIC',active:false},source,strength});
        }
      }
    }
    return found;
  }
  function fingerprint(input) {
    const evidence=input&&typeof input==='object'?input:{};
    const detected=[];
    for(const p of PROFILES){const m=sourceMatch(evidence,p);if(m)detected.push({profile:p,...m});}
    detected.push(...genericCandidates(evidence));
    const maxStrength=Math.max(0,...detected.map(m=>m.strength));
    const winners=detected.filter(m=>m.strength===maxStrength);
    if(winners.length===1){
      const {profile,source}=winners[0];
      return Object.freeze({
        status:'MODEL_CANDIDATE',id:profile.id,vendor:profile.vendor,model:profile.model,
        adapter:profile.adapter,evidence:source,revision:revisionFor(profile,evidence),
        build:buildFor(evidence),capabilities:CAPABILITIES[profile.adapter],
        authenticated:false,firmwareVerified:false,canWrite:false
      });
    }
    const vendor=familyFrom(limit(evidence.title,200)+' '+limit(evidence.headings,600));
    return Object.freeze({
      status:winners.length>1?'AMBIGUOUS':'VENDOR_ONLY',id:'',vendor,model:'',
      adapter:'NONE',evidence:winners.length>1?'MULTIPLE_MODELS':vendor?'VENDOR_MARKUP':'NO_IDENTITY',
      revision:'',build:'',capabilities:null,authenticated:false,firmwareVerified:false,canWrite:false
    });
  }
  function operation(profileId,op){
    const p=PROFILES.find(item=>item.id===profileId);
    if(!p||!['login','quickSetup','wanDhcp','wifiEdit'].includes(op))
      return {supported:false,reason:'UNSUPPORTED_DEVICE_OR_OPERATION'};
    return {supported:p.active,adapter:p.adapter,
      reason:p.active?'MODEL_ADAPTER_MUST_VERIFY_SESSION':'PROTOCOL_NOT_VERIFIED'};
  }
  return Object.freeze({PROFILES,CAPABILITIES,fingerprint,operation});
});
