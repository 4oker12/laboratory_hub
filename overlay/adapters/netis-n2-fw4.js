/* Netis N2 FW4 descriptor for the existing Router-Origin Overlay.
 * The actual Overlay UI and router-native session are owned by v0.8.22.
 * No separate setup.html and no hidden tabs/offscreen session fallback.
 */
(function(root,factory){
  const api=factory(
    typeof module==='object'&&module.exports
      ?require('../../../devices/netis/n2/fw4/netis-fw4.js')
      :root.RouterLabNetisFW4
  );
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RouterLabOverlayNetisN2FW4=api;
})(typeof globalThis==='object'?globalThis:this,(protocol)=>{
  'use strict';
  function driverFrom(context){
    if(!protocol?.NetisFW4Adapter)throw Error('NETIS_PROTOCOL_MISSING');
    if(typeof context?.transport!=='function')throw Error('NETIS_OVERLAY_TRANSPORT_MISSING');
    return new protocol.NetisFW4Adapter({transport:context.transport});
  }
  const descriptor=Object.freeze({
    id:'netis-n2-fw4-cis',
    label:'Netis N2 AC1200 · FW4',
    async probe(context){
      const result=await driverFrom(context).detect();
      if(!result?.supported)return {supported:false,why:'FIRMWARE_MISMATCH'};
      if(result.model!=='N2'||!String(result.version).startsWith('N2-V4.'))
        return {supported:false,why:'MODEL_NOT_CONFIRMED'};
      return Object.freeze({supported:true,model:result.model,version:result.version,
        vendor:'Netis',stage:result.stage,
        provenance:'2026-10-28 user HAR; readback not persistence'});
    },
    create(context,evidence){
      if(!evidence?.supported)throw Error('NETIS_EVIDENCE_REQUIRED');
      const driver=driverFrom(context);
      return Object.freeze({
        id:descriptor.id,
        model:'Netis N2',
        firmware:evidence.version,
        capabilities:Object.freeze({
          bootstrapDhcp:'HAR_OBSERVED_VERIFY_REQUIRED',
          login:'HAR_OBSERVED',
          wanRead:'HAR_OBSERVED',
          wifiRead:'HAR_OBSERVED',
          radioPower:'HAR_WRITE_READBACK',
          igmp:'HAR_WRITE_READBACK',
          wifiChange:'NOT_EVIDENCED',
          pppoeWrite:'NOT_EVIDENCED',
          staticWanWrite:'NOT_EVIDENCED',
          rebootPersistence:'NOT_EVIDENCED'
        }),
        async readStatus(){
          const result=await driver.detect();
          if(!result.supported)throw Error('NETIS_FIRMWARE_CHANGED');
          return {model:result.model,firmware:result.version,
            mode:result.stage?.mode,phase:result.stage?.phase};
        },
        readWan:()=>driver.readWan(),
        readWifi:()=>driver.readWifi(),
        readIgmp:()=>driver.readIgmp(),
        async login(password){return driver.login(password);},
        async configureFactoryDhcp(settings,opts={}) {
          return driver.factoryDhcp(settings,{confirmed:opts.confirmed===true});
        },
        async setRadioPower(band,power,opts={}) {
          return driver.setRadioPower(band,power,{confirmed:opts.confirmed===true});
        },
        async setIgmp(config,opts={}) {
          return driver.setIgmp({...config,confirmed:opts.confirmed===true});
        }
      });
    }
  });
  return Object.freeze({descriptor});
});