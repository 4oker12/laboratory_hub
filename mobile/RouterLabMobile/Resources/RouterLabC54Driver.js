/* Archer C54 EU V1 stock-page passive driver.
 * Authority: vendor EU V1 250811 static stock analysis (VxWorks + $.su).
 * No model-specific CGI/auth/write contract has been validated on hardware.
 * NEVER infer C20's /cgi_gdpr or AES/RSA format from shared TP-Link branding.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RouterLabC54Driver=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function cleanText(text,max){
    return typeof text==='string'?text.slice(0,max):'';
  }
  function probePage(page) {
    const doc=page?.document;
    const w=page?.window;
    if(!doc)return Object.freeze({compatible:false,reason:'NO_DOCUMENT'});
    const title=cleanText(doc.title,160);
    const headers=Array.from(doc.querySelectorAll('h1,h2,[class*=model],[id*=model]'))
      .slice(0,10).map(n=>cleanText(n.textContent,120)).join(' ');
    const body=cleanText(doc.body?.innerText,2000);
    const content=[title,headers,body].join(' ');
    const model=/\bArcher[\s-]*C54\b/i.test(content);
    const conflicting=/\bArcher[\s-]*(?:C20|AX23|AX55|C80)\b/i.test(content);
    // Stock UI uses $.su for C54 candidate firmware; not an identity proof.
    const su=typeof w?.$?.su==='object';
    const hardware=(content.match(/\b(?:hardware\s+version|hw\s+version|апаратна\s+версія|версия\s+устройства)\s*:?\s*(?:v|ver\.?\s*)?(\d+(?:\.\d+)?)/i)||[])[1]||'';
    const build=(content.match(/\bBuild\s+(\d{6,8})\b/i)||[])[1]||'';
    const region=(content.match(/\b(?:C54|Archer C54)\s*\((EU|US|RU)\)/i)||[])[1]||'';
    const check=conflicting?'MODEL_CONFLICT':model?'C54_PAGE_MODEL':'C54_MODEL_NOT_EXPOSED';
    return Object.freeze({
      compatible:model&&!conflicting,
      reason:check,
      model:'Archer C54',
      protocol:'TPLINK_SU_VXWORKS',
      framework:su?'TPLINK_SU':'NOT_OBSERVED',
      hardware:hardware?'v'+hardware.toLowerCase():'',
      build,region:region.toUpperCase(),
      state:detectSetupState(doc),
      // No authentication or write proof is ever emitted by a passive probe.
      sessionVerified:false,writeContractVerified:false,readbackVerified:false
    });
  }
  function detectSetupState(doc) {
    if(!doc)return 'UNKNOWN';
    const inputs=Array.from(doc.querySelectorAll('input[type=password]'))
      .filter(e=>!e.disabled && (!e.getClientRects || e.getClientRects().length>0));
    const text=cleanText(doc.body?.innerText,2500);
    if(inputs.length>=2&&/(?:create|new|set|созда|новый|новий).{0,55}(?:password|парол)/i.test(text))
      return 'FACTORY_PASSWORD_CANDIDATE';
    if(inputs.length>=1&&/(?:login|log in|sign in|вход|увійти|авторизац)/i.test(text))
      return 'LOGIN_REQUIRED_CANDIDATE';
    if(/(?:quick setup|быстрая настройка|швидке налаштування)/i.test(text))
      return 'QUICK_SETUP_CANDIDATE';
    return 'UNKNOWN';
  }
  function createBrowserDriver(w) {
    return Object.freeze({
      probe: async()=>probePage({window:w,document:w.document}),
      // getSetupState is a hint, not an authenticated protected state read.
      getSetupState:async()=>({state:detectSetupState(w.document),verified:false})
      // Missing: createAdminPassword/login/verifySession/readWan/setWanDhcp/
      // readWifi/setWifi/save/verifyChanges until real C54 protocol evidence.
    });
  }
  return Object.freeze({probePage,detectSetupState,createBrowserDriver});
});
