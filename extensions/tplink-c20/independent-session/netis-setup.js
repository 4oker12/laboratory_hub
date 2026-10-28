/* Netis N2 FW4 controller for the SAME RouterLab setup.html/setup.css.
 * No device credentials are retained after request submission or logged.
 */
'use strict';
(() => {
  const current = new URLSearchParams(location.search).get('device');
  const isNetis = current === 'netis';
  const el = id => document.getElementById(id);
  el('deviceNetis').onclick = () => {
    if (!isNetis) location.href = 'setup.html?device=netis';
  };
  el('deviceTplink').onclick = () => {
    if (isNetis) location.href = 'setup.html?device=c20';
  };
  if (!isNetis) return;

  const trace = [];
  let phase = 'DISCOVER',busy = false, detected = null,snapshot = null;
  const hide = (id,hidden=true) => el(id).classList.toggle('hidden',hidden);
  const setText = (id,text) => {el(id).textContent=String(text)};
  const log = (event,extra='') => {
    const stamp = new Date().toISOString();
    // Constant/status-only messages. Never log request bodies, SSIDs or passwords.
    trace.push(stamp+' '+event+(extra?' '+extra:''));
    if (trace.length>120) trace.shift();
    setText('log',trace.join('\n'));
  };
  const status = (label,sub='') => {
    setText('status',label);
    setText('substatus',sub);
    setText('pill',phase);
  };
  function render() {
    for (const id of ['first','stateCheck','known','quick','editor','netisFactory','netisLogin','netisStatus'])
      hide(id);
    hide('verify');hide('reboot');hide('confirmWifi');hide('vendor');hide('showVendor');
    hide('netisFactory',phase!=='FACTORY');
    hide('netisLogin',phase!=='LOGIN');
    hide('netisStatus',phase!=='READ_READY');
    el('primary').disabled=busy;
    el('retry').disabled=busy;
    el('primary').textContent = phase==='FACTORY'?'Настроить WAN DHCP и Wi-Fi':
      phase==='LOGIN'?'Войти и прочитать настройки':
      phase==='READ_READY'?'Обновить WAN/Wi-Fi':'Определить Netis N2';
  }
  async function rpc(type,fields={}) {
    const r = await chrome.runtime.sendMessage({type:'netis.'+type,...fields});
    if(!r || !r.ok) throw Error(r?.error||'NETIS_RPC_UNAVAILABLE');
    return r.data;
  }
  async function run(fn) {
    if(busy) return;
    busy=true;render();
    try {await fn();}
    catch(e) {
      log('ERROR',String(e.message||'NETIS_ERROR').slice(0,100));
      status('Ошибка операции',String(e.message||'NETIS_ERROR').slice(0,130));
    }
    finally {busy=false;render();}
  }
  function resetSnapshot(){snapshot=null;}
  async function discover() {
    resetSnapshot();phase='DISCOVER';render();
    status('Определяем Netis N2 FW4…','Проверка только чтением через локальный CGI.');
    const device=await rpc('detect');
    if(!device.supported) {
      phase='UNSUPPORTED';
      status('Неподдерживаемый роутер','Запись отключена. Требуется Netis N2 FW4 для CIS.');
      log('UNSUPPORTED_MODEL');
      return;
    }
    detected=device;
    log('DEVICE_CONFIRMED','N2 FW4 CIS');
    if(device.stage.mode==='FACTORY'){
      phase='FACTORY';status('Заводское состояние','Мастер DHCP и Wi-Fi доступен. Для записи потребуется подтверждение.');
    } else if(device.stage.mode==='CONFIGURED'){
      phase='LOGIN';status('Настройки уже созданы','Введите пароль администратора для подтверждения чтения.');
    } else {
      phase='UNSUPPORTED';status('Неопределённое состояние','Сначала нужно уточнить стадию прошивки.');
    }
  }
  function renderSnapshot(data) {
    snapshot=data;
    const wan=data.wan||{}, wifi=data.wifi||{}, igmp=data.igmp||{};
    setText('netisSummary',[
      'Прошивка: '+(data.firmware||'N2 FW4'),
      'WAN тип: '+(wan.type===1||wan.type==='1'?'DHCP':wan.type??'неизвестен'),
      'LAN IP: '+(wan.lanIp||'не получен'),
      'Мощность 2,4 ГГц: '+(wifi['2g']?.rfPower??'—'),
      'Мощность 5 ГГц: '+(wifi['5g']?.rfPower??'—'),
      'IGMP Proxy: '+(igmp.proxy?'включён':'выключен'),
      'IGMP Snooping: '+(igmp.snooping?'включён':'выключен'),
      'Проверка сохранения после рестарта: НЕ ПРОВЕДЕНА'
    ].join('\n'));
    for(const [id,power] of [['netisPower24',wifi['2g']?.rfPower],['netisPower5',wifi['5g']?.rfPower]]) {
      if([...el(id).options].some(o=>o.value===String(power))) el(id).value=String(power);
    }
    el('netisProxy').checked=!!igmp.proxy;
    el('netisSnooping').checked=!!igmp.snooping;
    phase='READ_READY';
    status('Чтение WAN/Wi-Fi/IGMP подтверждено',
      'CGI ответил после входа. Сохранение после перезагрузки и границы сессии ещё не проверены.');
    log('READBACK_OK','WAN WLAN IGMP');
  }
  async function refreshSnapshot() {
    renderSnapshot(await rpc('snapshot'));
  }
  async function login() {
    const password=el('netisPassword').value;
    if(!password){status('Введите пароль администратора');return;}
    el('netisPassword').value='';
    log('LOGIN_SUBMITTED');
    const result=await rpc('login',{password});
    if(result.status!=='LOGIN_ACCEPTED'||!result.readConfirmed){
      status('Вход не подтверждён','Не повторяйте пароль автоматически. Проверьте состояние и попробуйте вручную.');
      log('LOGIN_NOT_CONFIRMED',result.status);
      return;
    }
    await refreshSnapshot();
  }
  async function factory() {
    const admin=el('netisAdmin').value,confirmAdmin=el('netisAdmin2').value;
    const password=el('netisWifiPassword').value,confirmWifi=el('netisWifiPassword2').value;
    const ssid2g=el('netisSsid24').value.trim(),ssid5g=el('netisSsid5').value.trim();
    if(!admin||admin!==confirmAdmin){status('Пароли администратора не совпадают');return;}
    if(!password||password!==confirmWifi){status('Пароли Wi-Fi не совпадают');return;}
    if(!ssid2g||!ssid5g){status('Укажите оба SSID');return;}
    if(!confirm('Выполнить заводскую настройку WAN DHCP и Wi-Fi на Netis N2? Соединение может оборваться. Команда будет отправлена только один раз.'))return;
    el('netisAdmin').value=el('netisAdmin2').value='';
    el('netisWifiPassword').value=el('netisWifiPassword2').value='';
    log('FACTORY_DHCP_SUBMITTED_ONCE');
    const result=await rpc('factoryDhcp',{settings:{
      adminPassword:admin,wifiPassword:password,ssid2g,ssid5g
    },confirmed:true});
    phase='APPLY_PENDING';resetSnapshot();
    status(result.status==='APPLY_UNCONFIRMED'?'Применение не подтверждено':'Команда настройки передана',
      'Переподключитесь к роутеру и нажмите «Обновить состояние». Автоматического повтора SET нет.');
    log('FACTORY_RESULT',result.status);
  }
  async function setPowers() {
    if(phase!=='READ_READY'||!snapshot)throw Error('NETIS_READ_REQUIRED');
    const desired={'2g':Number(el('netisPower24').value),'5g':Number(el('netisPower5').value)};
    const delta=Object.keys(desired).filter(k=>String(snapshot.wifi?.[k]?.rfPower)!==String(desired[k]));
    if(!delta.length){status('Мощность не изменилась');return;}
    if(!confirm('Изменить мощность '+delta.join(', ')+' на тестовом Netis? Применение может повлиять на Wi-Fi.'))return;
    for(const band of delta){
      const result=await rpc('radioPower',{band,power:desired[band],confirmed:true});
      log('RADIO_'+band,result.status);
      if(result.status!=='READBACK_OK'){
        status('Применение Wi-Fi не подтверждено','Повторно команду автоматически не отправляем.');
        return;
      }
    }
    await refreshSnapshot();
  }
  async function setIgmp() {
    if(phase!=='READ_READY'||!snapshot)throw Error('NETIS_READ_REQUIRED');
    const proxy=el('netisProxy').checked,snooping=el('netisSnooping').checked;
    if(proxy===snapshot.igmp.proxy&&snooping===snapshot.igmp.snooping){
      status('Параметры IGMP не изменились');return;
    }
    if(!confirm('Изменить IGMP Proxy/Snooping на тестовом Netis? Это может повлиять на IPTV.'))return;
    const result=await rpc('igmp',{proxy,snooping,confirmed:true});
    log('IGMP_RESULT',result.status);
    if(result.status==='READBACK_OK')await refreshSnapshot();
    else status('IGMP не подтверждён чтением','Не выполняйте автоматический повтор SET.');
  }
  const info=document.querySelector('header p');
  if(info)info.textContent='Netis N2 FW4 (CIS). Единый интерфейс RouterLab для заводского DHCP-мастера, входа и чтения WAN/Wi-Fi.';
  const note=el('log').closest('.panel')?.querySelector('p.muted');
  if(note)note.textContent='Netis работает через локальный CGI. Чтение после входа и readback проверяются отдельно. Пароли и содержимое запросов в технический журнал не записываются.';
  setText('deviceLabel','Netis N2 · FW4');
  setText('routerName','Netis N2 AC1200');
  setText('routerFooter','RouterLab · Netis N2 · FW4 · управление локально');
  el('primary').onclick=()=>run(async()=>{
    if(phase==='FACTORY')return factory();
    if(phase==='LOGIN')return login();
    if(phase==='READ_READY')return refreshSnapshot();
    return discover();
  });
  el('retry').onclick=()=>run(discover);
  el('netisSetPower').onclick=()=>run(setPowers);
  el('netisSetIgmp').onclick=()=>run(setIgmp);
  el('copy').onclick=()=>navigator.clipboard.writeText(trace.join('\n')).catch(()=>{});
  render();
  run(discover);
})();