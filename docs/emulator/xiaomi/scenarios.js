/* Operator training situations, never observed device telemetry. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.RouterLabXiaomiScenarios=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const data=[
    {id:"no-wan",title:"WAN кабель отключён",status:"Нет физического подключения WAN (симуляция)",impact:"Интернет недоступен",diagnostic:"Проверь питание ONU, Ethernet между ONU и WAN-портом роутера и индикацию портов."},
    {id:"dhcp-fail",title:"DHCP не выдал адрес",status:"DHCP: адрес не получен (симуляция)",impact:"WAN IP отсутствует",diagnostic:"Проверь WAN DHCP, MAC-адрес клиента, VLAN/доступ, DHCP-сессию на BNG и блокировки."},
    {id:"pppoe-error",title:"PPPoE ошибка",status:"PPPoE: ошибка авторизации (симуляция)",impact:"PPPoE не установлено",diagnostic:"Проверь выбранный тип подключения. Для IPoE/DHCP этот режим обычно не нужен."},
    {id:"wifi-off",title:"Wi-Fi отключён",status:"Wi-Fi отключён в учебном сценарии",impact:"Беспроводные клиенты не увидят SSID",diagnostic:"Проверь радиомодуль, включение SSID, диапазон 2,4/5 ГГц и настройки видимости."}
  ];
  const ALL=Object.freeze(data.map(x=>Object.freeze(x)));
  function find(id){return ALL.find(x=>x.id===id)||null;}
  function requireScenario(id){const result=find(id);if(!result)throw new Error("Неизвестный учебный сценарий.");return result;}
  return Object.freeze({ALL,find,requireScenario});
});
