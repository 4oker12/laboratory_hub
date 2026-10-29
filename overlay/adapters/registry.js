/* RouterLab router-origin overlay: pure multi-vendor adapter registry.
 * This module does not render UI, open tabs, create sessions, or touch C20 code.
 * Intended to be loaded by the physically validated v0.8.22 overlay host.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RouterLabOverlayRegistry=api;
})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  const NON_PRIVILEGED=['detect','readStatus','readWan','readWifi'];
  const SECURE_ORIGIN=/^http:\/\/(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{1,5})?$/;
  function assertRouterOrigin(context){
    const routerOrigin=context?.routerOrigin;
    if(typeof routerOrigin!=='string'||!SECURE_ORIGIN.test(routerOrigin))
      throw Error('OVERLAY_ROUTER_ORIGIN_INVALID');
    if(typeof context.pageOrigin==='string'&&routerOrigin!==context.pageOrigin)
      throw Error('OVERLAY_ROUTER_ORIGIN_MISMATCH');
    if(typeof context.transport!=='function')
      throw Error('OVERLAY_ROUTER_ORIGIN_TRANSPORT_REQUIRED');
  }
  function makeRegistry(){
    const list=[];
    function register(descriptor){
      if(!descriptor||typeof descriptor.id!=='string'||!/^[a-z0-9][a-z0-9-]{2,63}$/.test(descriptor.id))
        throw Error('OVERLAY_ADAPTER_ID_INVALID');
      if(list.some(x=>x.id===descriptor.id))throw Error('OVERLAY_ADAPTER_DUPLICATE');
      if(typeof descriptor.probe!=='function'||typeof descriptor.create!=='function')
        throw Error('OVERLAY_ADAPTER_CONTRACT_INVALID');
      list.push(Object.freeze({id:descriptor.id,label:String(descriptor.label||descriptor.id),
        probe:descriptor.probe,create:descriptor.create}));
    }
    async function detect(context){
      assertRouterOrigin(context);
      const failures=[];
      for(const descriptor of list){
        try{
          const evidence=await descriptor.probe(context); // read-only, never auth/write
          if(!evidence?.supported)continue;
          const adapter=descriptor.create(context,evidence);
          if(!adapter||typeof adapter.readStatus!=='function')
            throw Error('OVERLAY_ADAPTER_READ_REQUIRED');
          return Object.freeze({id:descriptor.id,label:descriptor.label,evidence,
            adapter});
        }catch(err){failures.push({id:descriptor.id,error:String(err?.message||err)});}
      }
      return {id:null,adapter:null,evidence:null,
        status:'UNSUPPORTED_OR_UNREACHABLE',diagnostics:failures};
    }
    return Object.freeze({register,detect,ids:()=>list.map(x=>x.id)});
  }
  return Object.freeze({makeRegistry,assertRouterOrigin,NON_PRIVILEGED});
});