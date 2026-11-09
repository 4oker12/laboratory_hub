/* RouterLab Passive Unknown Device Probe v1
 * Runs AFTER existing C20/Netis protocol scripts. No fetch/XHR, no credentials,
 * no cookies/localStorage, no raw HTML, URL, MAC, SSID, or password collection.
 * Identity hints are NOT model verification and NEVER grant write access.
 */
(function (root, factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.RouterLabPassiveUnknownProbe=api;
  if(typeof window==='object' && typeof document==='object')api.attach(window);
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const VENDORS=Object.freeze([
    ['TP-Link',/\b(?:tp[\s-]?link|archer|deco)\b/i],
    ['Cudy',/\bcudy\b/i],
    ['Netis',/\bnetis\b/i],
    ['ASUS',/\basus\b/i],
    ['D-Link',/\bd[\s-]?link\b/i],
    ['Keenetic',/\bkeenetic\b/i],
    ['Xiaomi',/\b(?:xiaomi|redmi)\b/i],
    ['Huawei',/\bhuawei\b/i],
    ['Zyxel',/\bzyxel\b/i],
    ['Tenda',/\btenda\b/i],
    ['Mercusys',/\bmercusys\b/i],
    ['Netgear',/\bnetgear\b/i]
  ]);
  const MODEL_PATTERNS=Object.freeze([
    ['TP-Link',/\bArcher[\s-]+(?:AX|BE|C|A|VR)[0-9]{1,4}[A-Z0-9-]{0,6}\b/ig],
    ['TP-Link',/\bDeco[\s-]+(?:X|XE|BE|M|S)[0-9]{1,4}[A-Z0-9-]{0,5}\b/ig],
    ['Cudy',/\bWR[0-9]{3,5}(?:[\s-]*V[1-9])?\b/ig],
    ['Netis',/\bN[0-9]{1,4}\b/ig],
    ['ASUS',/\b(?:RT-(?:AX|AC|BE)[0-9]{2,4}[A-Z0-9-]*|TUF[\s-]+(?:AX|BE)[0-9]{3,4}[A-Z0-9-]*)\b/ig],
    ['D-Link',/\bDIR-[A-Z0-9-]{3,16}\b/ig],
    ['Mercusys',/\b(?:MR|MW|MB)[0-9]{2,4}[A-Z0-9-]*\b/ig],
    ['Tenda',/\b(?:AC|AX|RX)[0-9]{1,4}[A-Z0-9-]*\b/ig],
    ['Netgear',/\b(?:RAX|R|N)[0-9]{3,4}[A-Z0-9-]*\b/ig],
    ['Huawei',/\b(?:HG|EG|AX)[0-9]{3,5}[A-Z0-9-]*\b/ig],
    ['Zyxel',/\b(?:VMG|NBG|EX)[0-9]{3,5}[A-Z0-9-]*\b/ig],
    ['Xiaomi',/\b(?:Redmi[\s-]+Router[\s-]+)?(?:AX|BE)[0-9]{3,4}\b/ig]
  ]);
  function bounded(s,n){return typeof s==='string'?s.slice(0,n):'';}
  function vendorOf(s){return VENDORS.filter(([,r])=>r.test(s)).map(([v])=>v);}
  function staticHint(input) {
    const layers=[
      ['TITLE',bounded(input.title,180),4],
      ['META',bounded(input.meta,320),3],
      ['HEADING',bounded(input.headings,400),3],
      ['ASSET',bounded(input.assets,400),1]
    ];
    let vendor='',vendorSource='',rank=0,ambiguous=false;
    for(const [source,value,strength] of layers){
      const list=vendorOf(value);
      if(list.length!==1) {
        if(list.length>1 && strength>=rank)ambiguous=true;
        continue;
      }
      if(strength>rank){vendor=list[0];vendorSource=source;rank=strength;ambiguous=false;}
      else if(strength===rank && vendor!==list[0])ambiguous=true;
    }
    if(ambiguous){vendor='';vendorSource='AMBIGUOUS';}
    let models=[];
    for(const [source,value] of layers.slice(0,3)){
      for(const [family,pattern] of MODEL_PATTERNS){
        if(!vendor||vendor!==family)continue;
        for(const hit of value.matchAll(pattern)){
          const model=hit[0].trim().replace(/\s+/g,' ').slice(0,48);
          models.push({model,source});
        }
      }
    }
    const unique=[...new Map(models.map(x=>[x.model.toUpperCase(),x])).values()];
    const model=unique.length===1?unique[0].model:'';
    return {vendor,modelHint:model,
      evidence:model?unique[0].source:vendorSource||'NONE',
      ambiguous:unique.length>1||ambiguous};
  }
  function inspect(input){
    const p=staticHint(input||{});
    const path=bounded(input?.pagePath,120);
    const assets=bounded(input?.assets,400);
    const framework=input?.framework||'NONE';
    const family= framework==='TPLINK_SU'?'TPLINK_SU_CANDIDATE'
      :framework==='TPLINK_LEGACY'?'TPLINK_LEGACY_CANDIDATE'
      :/\/cgi-bin\/luci\b/i.test(path+' '+assets)?'LUCI_CANDIDATE'
      :/\/cgi-bin\/skk_(?:get|set)\.cgi/i.test(assets)?'NETIS_CGI_CANDIDATE'
      :'UNKNOWN_WEB';
    const count=Number.isInteger(input?.passwordCount)
      ?Math.max(0,Math.min(input.passwordCount,3)):0;
    const ui=count>=2?'MULTIPLE_PASSWORD_FIELDS'
      :count===1?'PASSWORD_FORM'
      :input?.hasSetupWord===true?'SETUP_TEXT_CANDIDATE':'STATE_UNKNOWN';
    const confidence=p.modelHint?'MODEL_HINT'
      :p.vendor?'VENDOR_HINT':'UNKNOWN';
    return Object.freeze({
      status:'WEB_PAGE_REACHABLE',
      vendor:p.vendor||'',
      modelHint:p.modelHint||'',
      confidence,evidence:p.evidence,
      family,ui,
      ambiguous:!!p.ambiguous,
      verified:false,authenticated:false,canWrite:false
    });
  }
  function readPage(w){
    const d=w.document;
    const title=bounded(d.title,180);
    const meta=Array.from(d.querySelectorAll('meta[name],meta[property]'))
      .filter(n=>/generator|model|device|product|brand/i.test(n.name||n.getAttribute('property')||''))
      .slice(0,5).map(n=>bounded(n.content,70)).join(' ').slice(0,320);
    const headings=Array.from(d.querySelectorAll('h1,h2'))
      .slice(0,6).map(n=>bounded(n.textContent,65)).join(' ').slice(0,400);
    // Only the *path* of already included scripts is examined; no HTTP requests.
    const assets=Array.from(d.querySelectorAll('script[src],link[href]'))
      .slice(0,18).map(n=>{
        const raw=n.getAttribute('src')||n.getAttribute('href')||'';
        // Drop query parameters and fragments. Do not transmit raw paths.
        try{return new URL(raw,w.location.href).pathname.slice(0,100)}
        catch(_){return ''}
      }).join(' ').slice(0,400);
    const dDollar=Object.getOwnPropertyDescriptor(w,'$');
    const dollar=dDollar&&dDollar.value;
    let framework='NONE';
    if(dollar&&typeof dollar==='function'||dollar&&typeof dollar==='object'){
      const su=Object.getOwnPropertyDescriptor(dollar,'su');
      const act=Object.getOwnPropertyDescriptor(dollar,'act');
      if(su&&su.value&&typeof su.value==='object')framework='TPLINK_SU';
      else if(act&&typeof act.value==='function')framework='TPLINK_LEGACY';
    }
    // Only count fields, NEVER read form values or action URLs.
    const passwordCount=d.querySelectorAll('input[type=password]').length;
    const hasSetupWord=/\b(?:quick[\s-]?setup|setup wizard|first[\s-]?run)\b/i.test(headings+' '+title);
    return inspect({title,meta,headings,assets,framework,
      pagePath:w.location.pathname,passwordCount,hasSetupWord});
  }
  function attach(w){
    if(w.__RouterLabPassiveUnknownProbeAttached)return;
    try{Object.defineProperty(w,'__RouterLabPassiveUnknownProbeAttached',{value:true})}catch(_){return;}
    let previous='';
    const report=()=>{
      let result;
      try{result=readPage(w)}catch(_){return;}
      const key=JSON.stringify(result);
      if(key===previous)return;
      previous=key;
      try{w.webkit?.messageHandlers?.routerlab?.postMessage({
        type:'routerPassiveObservation', ...result
      })}catch(_){}
    };
    if(w.document.body) report();
    else w.document.addEventListener('DOMContentLoaded',report,{once:true});
    // Bounded asynchronous DOM render sample; no polling or HTTP discovery.
    if(typeof w.setTimeout==='function'){
      w.setTimeout(report,600);
      w.setTimeout(report,1800);
    }
  }
  return Object.freeze({inspect,readPage,attach});
});
