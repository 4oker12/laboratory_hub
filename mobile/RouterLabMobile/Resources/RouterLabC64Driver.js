/* RouterLab Archer C64 passive iOS adapter.
 * Research baseline: C64 EU V1 (NOT asserted to be the user's revision).
 * Also reports V2 candidates; never sends a request or writes settings.
 * Does not borrow C54 or C20 login/CGI protocol without live evidence.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RouterLabC64Driver=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const n=(v,max)=>typeof v==='string'?v.slice(0,max):'';
  const VALUE_KEYS=['modelName','model','deviceModel','productModel','productName','hardwareVersion','hwVersion','firmwareVersion','softwareVersion','buildVersion'];
  function readOwnData(object){
    const values=[];
    if(!object||typeof object!=='object')return values;
    for(const key of VALUE_KEYS){
      try{
        const descriptor=Object.getOwnPropertyDescriptor(object,key);
        if(!descriptor||typeof descriptor.value!=='string')continue;
        const value=n(descriptor.value,100);
        // Only identity-shaped values; no arbitrary strings in report.
        if(/\bArcher[\s-]*C64\b|\b(?:hardware|firmware|software|build)\b|\bv(?:1|2)(?:\.\d+)?\b/i.test(value))
          values.push(value);
      }catch(_){}
    }
    return values;
  }
  function pageEvidence(doc,win){
    if(!doc)return {title:'',heads:'',meta:'',passiveGlobals:[],path:''};
    const title=n(doc.title,180);
    const heads=Array.from(doc.querySelectorAll('h1,h2,[id*=model],[class*=model]'))
      .slice(0,10).map(x=>n(x.textContent,95)).join(' ').slice(0,800);
    const meta=Array.from(doc.querySelectorAll('meta[name],meta[property]'))
      .filter(x=>/device|model|product|generator|firmware/i.test(x.name||x.getAttribute('property')||''))
      .slice(0,6).map(x=>n(x.content,90)).join(' ').slice(0,500);
    const passiveGlobals=[];
    for(const key of ['deviceInfo','sysInfo','routerInfo','routerData','g_deviceInfo']){
      try{const o=Object.getOwnPropertyDescriptor(win||{},key);passiveGlobals.push(...readOwnData(o?.value));}
      catch(_){}
    }
    // Only short, model-relevant values from explicitly named JSON fields.
    for(const node of Array.from(doc.querySelectorAll('script[type="application/json"]')).slice(0,2)){
      try{
        if((node.textContent||'').length>10000)continue;
        const obj=JSON.parse(node.textContent);
        passiveGlobals.push(...readOwnData(obj));
        passiveGlobals.push(...readOwnData(obj?.device));
      }catch(_){}
    }
    return {title,heads,meta,passiveGlobals,
      path:n(win?.location?.pathname,90)};
  }
  function detect(doc,win){
    const e=pageEvidence(doc,win);
    // Raw page body is used only locally while matching strictly bounded
    // firmware tokens; no page text enters diagnostics or native messages.
    const all=[e.title,e.heads,e.meta,...e.passiveGlobals,
      n(doc?.body?.innerText,1600)].join(' ');
    const c64=/\bArcher[\s-]*C64\b/i.test(all);
    const conflicting=/\bArcher[\s-]*(?:C54|C20|AX23|C80)\b/i.test(all);
    let hardware='';
    const v1=all.match(/\bArcher[\s-]*C64\s*(?:\(\s*(?:EU|RU|US)\s*\))?\s*(?:v(?:er)?\.?\s*)?(1(?:\.\d+)?)\b/i);
    const version=all.match(/\b(?:Hardware\s+Version|Hardware\s+Ver\.?|HW\s*Version|Апаратна\s+версія|Версия\s+устройства|Версія\s+пристрою)\s*[:=]?\s*(?:V|Ver\.?\s*)?(\d+(?:\.\d+)?)\b/i);
    const token=version?.[1]||v1?.[1]||'';
    if(token)hardware='V'+token;
    const build=(all.match(/\bBuild\s*[:=]?\s*(\d{6,8})\b/i)||[])[1]||'';
    const region=(all.match(/\bArcher[\s-]*C64\s*\((EU|RU|US)\)/i)||[])[1]?.toUpperCase()||'';
    const framework=typeof win?.$?.su==='object'?'TPLINK_SU_CANDIDATE':
      typeof win?.$?.act==='function'?'TPLINK_LEGACY_CANDIDATE':
      'UNKNOWN';
    const passwordInputs=Array.from(doc?.querySelectorAll('input[type=password]')||[]);
    const active=passwordInputs.filter(x=>!x.disabled&&(!x.getClientRects||x.getClientRects().length>0));
    const headings=e.heads+' '+e.title;
    const stage=active.length>=2?'FACTORY_PASSWORD_CANDIDATE':
      active.length===1?'LOGIN_CANDIDATE':
      /\bquick[\s-]*setup|\bsetup wizard|быстрая настройка|швидке налаштування/i.test(headings)
      ?'QUICK_SETUP_CANDIDATE':'UNKNOWN';
    const revisionKnown=/^V[12](?:\.\d+)?$/.test(hardware);
    return Object.freeze({
      model:'Archer C64',
      modelCandidate:c64&&!conflicting,
      conflict:conflicting,
      hardware,build,region,framework,stage,
      firmwareKnown:!!(revisionKnown&&build&&region),
      authenticated:false,sessionVerified:false,writeContractVerified:false,
      canWrite:false,transport:'PASSIVE_ONLY',
      reason:conflicting?'CONFLICTING_MODEL':c64?'C64_PASSIVE_CANDIDATE':'C64_NOT_VISIBLE',
      researchBaseline:'V1_UNVERIFIED'
    });
  }
  // Browser-surface evidence for the ACTUAL C64 login page. Strictly
  // structural: no strings from input values, cookies, tokens, request URLs,
  // page contents or vendor API responses are returned.
  function inspectLoginSurface(doc,w){
    if(!doc)return Object.freeze({form:'UNKNOWN',passwordFields:0,
      textInputs:0,framework:'UNKNOWN',suFeatures:[],assetClasses:[],
      readOnly:true,credentialValuesRead:false});
    const count=selector=>{
      try{return Math.min(9,doc.querySelectorAll(selector).length)}
      catch(_){return 0}
    };
    const forms=count('form');
    const passwordFields=count('input[type=password]');
    const textInputs=count('input[type=text]');
    const buttons=count('button, input[type=submit]');
    const featureNames=['Proxy','encryptor','Encryptor','url','modelManager',
      'serviceManager','storeManager','rsa','aes','encrypt','DataStore',
      'Dialog','Login','Request','Ajax'];
    let su=null;
    try{
      const dollar=Object.getOwnPropertyDescriptor(w||{},'
    return Object.freeze({
      probe:async()=>detect(w?.document,w),
      getSetupState:async()=>({state:detect(w?.document,w).stage,verified:false})
    });
  }
  return Object.freeze({detect,pageEvidence,inspectLoginSurface,createBrowserDriver});
});
);
      const suDesc=dollar&&dollar.value&&Object.getOwnPropertyDescriptor(dollar.value,'su');
      su=suDesc?.value&&typeof suDesc.value==='object'?suDesc.value:null;
    }catch(_){}
    const suFeatures=[];
    if(su)for(const feature of featureNames){
      try{
        const desc=Object.getOwnPropertyDescriptor(su,feature);
        if(desc&&('value' in desc)&&desc.value!=null)suFeatures.push(feature);
      }catch(_){}
    }
    const classes=new Set();
    try{
      const scripts=Array.from(doc.querySelectorAll('script[src]')).slice(0,80);
      for(const script of scripts){
        // Read the source attribute and classify only its pathname.
        // Never return path/query/fragments, URL, or hostname.
        const raw=n(script.getAttribute('src'),240);
        let p;
        try{p=new URL(raw,w?.location?.href||'http://127.0.0.1/').pathname.toLowerCase()}
        catch(_){continue}
        if(/(?:^|\/)(?:login|auth|signin)(?:[\/._-]|$)/.test(p))classes.add('LOGIN_MODULE');
        if(/(?:^|[\/._-])(?:rsa|aes|encrypt|crypto)(?:[\/._-]|$)/.test(p))classes.add('CRYPTO_MODULE');
        if(/(?:^|\/)(?:quick.?setup|wizard)(?:[\/._-]|$)/.test(p))classes.add('SETUP_MODULE');
        if(/(?:^|\/)(?:proxy|store|model)(?:[\/._-]|$)/.test(p))classes.add('MODEL_PROXY_MODULE');
        if(/(?:^|\/)(?:su|tp-link)(?:[\/._-]|$)/.test(p))classes.add('TP_LINK_FRAMEWORK_ASSET');
      }
    }catch(_){}
    return Object.freeze({
      form:passwordFields>1?'CREATE_PASSWORD_CANDIDATE':
        passwordFields===1?'LOGIN_PASSWORD_CANDIDATE':
        forms>0?'FORM_NO_PASSWORD':'UNKNOWN',
      passwordFields,textInputs,buttons,forms,
      framework:su?'TP_LINK_SU':'UNKNOWN',
      suFeatures:Object.freeze(suFeatures),
      assetClasses:Object.freeze([...classes].sort()),
      readOnly:true,credentialValuesRead:false
    });
  }

  function createBrowserDriver(w){
    return Object.freeze({
      probe:async()=>detect(w?.document,w),
      getSetupState:async()=>({state:detect(w?.document,w).stage,verified:false})
    });
  }
  return Object.freeze({detect,pageEvidence,createBrowserDriver});
});
