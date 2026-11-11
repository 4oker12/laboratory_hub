/* Declarative firmware catalog for the OFFLINE educational Xiaomi emulator.
 * One entry per validated hardware + firmware combination. Do not claim
 * firmware support without evidence from the matching stock image. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.RouterLabXiaomiCatalog=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const MODELS=Object.freeze([
    Object.freeze({
      id:"xiaomi-r4a-3.0.24-int",
      familyId:"mi-router-4a-gigabit",
      brand:"Xiaomi",
      family:"Mi Router",
      model:"Mi Router 4A Gigabit Edition",
      hardware:"R4A",
      firmware:"3.0.24",
      region:"Global / International",
      stockSha256:"609b5b59b7b00365451fa358b5a79e0e4078b8a9a7aeb6a994a641287a093548",
      profile:"miwifi-r4a-v1",
      simulator:"visual-training",
      stockRuntime:"http://127.0.0.1:18090/",
      capabilities:Object.freeze({
        firstRun:true,login:true,wanDhcp:true,wanPppoe:true,
        wifi24:true,wifi5:true,lan:true,reset:true,
        realWan:false,radio:false,qos:false
      })
    })
  ]);
  function find(id){return MODELS.find(x=>x.id===id)||null;}
  function requireModel(id){
    const item=find(id);
    if(!item)throw new Error("Неподдерживаемая модель или прошивка: "+String(id));
    return item;
  }
  function families(){
    return MODELS.filter((x,i)=>MODELS.findIndex(y=>y.familyId===x.familyId)===i)
      .map(x=>({familyId:x.familyId,brand:x.brand,model:x.model,hardware:x.hardware}));
  }
  function firmwareFor(familyId){return MODELS.filter(x=>x.familyId===familyId);}
  return Object.freeze({MODELS,find,requireModel,families,firmwareFor});
});
