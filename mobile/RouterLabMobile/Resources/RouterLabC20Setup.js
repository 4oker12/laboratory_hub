/* RouterLab C20 mobile write pilot. Independent from proven stock-login pilot.
 * Reuses stock CGI $.act/$.exe and stock Quick Setup widgets. No raw CGI
 * packets, stored passwords, blind retries, or automatic router changes.
 */
(() => {
  'use strict';
  if (location.origin !== 'http://192.168.0.1' ||
      window.__RouterLabC20SetupAddon) return;
  Object.defineProperty(window,'__RouterLabC20SetupAddon',{value:true});
  const WIFI_FENCE='routerlab_c20_wifi_write_v1';
  const QUICK_FENCE='routerlab_c20_quick_step_v1';
  let running=false, initialized=false, baseline=null, baselineLoading=false, modified=false;
  const $id=id=>document.getElementById(id);
  const visible=e=>!!e&&e.getClientRects().length>0;
  const stamp=key=>{
    try{
      sessionStorage.setItem(key,JSON.stringify({at:Date.now(),stage:'SENT'}));
      if(!sessionStorage.getItem(key))throw Error('WIFI_FENCE_MISSING');
    }catch(_){throw Error('WIFI_FENCE_STORAGE_UNAVAILABLE')}
  };
  const fenced=key=>{try{return !!sessionStorage.getItem(key)}catch(_){return true}};
  const clear=key=>{try{sessionStorage.removeItem(key)}catch(_){}};
  const text=(el,msg)=>{if(el)el.textContent=msg};
  const validSSID=s=>typeof s==='string'&&!!s&&!/[\r\n\0]/.test(s)&&
    new TextEncoder().encode(s).length<=32;
  const validKey=s=>typeof s==='string'&&s.length>=8&&s.length<=63&&
    /^[\x20-\x7e]+$/.test(s);
  const stack=s=>/^\d+(?:,\d+){5}$/.test(String(s||''));
  const band=(rows,pattern)=>{
    const a=rows.filter(x=>pattern.test(String(x?.X_TP_Band||'')));
    return a.length===1&&validSSID(a[0]?.SSID)&&stack(a[0]?.__stack)?a[0]:null;
  };
  const mapWifi=rows=>{
    const a=band(rows,/2[.,]?4\s*(?:g|ghz)?/i);
    const b=band(rows,/(?:^|[^0-9])5\s*(?:g|ghz)?(?:$|[^a-z])/i);
    if(!a||!b||a.__stack===b.__stack)throw Error('WLAN_MAP_AMBIGUOUS');
    return {a,b};
  };
  const stockRead=object=>new Promise((resolve,reject)=>{
    const vendor=window.$;
    if(typeof vendor?.act!=='function'||typeof vendor?.exe!=='function'||
       vendor.as?.length||vendor.ds?.length)
      return reject(Error('VENDOR_QUEUE_BUSY'));
    let settled=false;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timeout);
      error?reject(Error(error)):resolve(value);
    };
    const timeout=setTimeout(()=>finish('READ_TIMEOUT'),7000);
    try{
      const attrs=object==='LAN_WLAN'
        ?['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled']
        :['enable','name','addressingType','X_TP_IPv4Enabled'];
      const rows=vendor.act(typeof window.ACT_GL==='number'?window.ACT_GL:5,
        object,'0,0,0,0,0,0','0,0,0,0,0,0',attrs);
      if(!Array.isArray(rows))return finish('READ_ROWS');
      const ack=vendor.exe(e=>finish(e&&e!==0?'READ_CGI_ERROR':null,rows));
      if(ack!==0&&ack!==undefined)finish('READ_REJECTED');
    }catch(_){finish('READ_EXCEPTION')}
  });
  const validC20=()=>/\bArcher\s*C20\b/i.test(document.title+' '+document.body?.innerText);
  const vendorQueue=()=>!!(window.$?.as?.length||window.$?.ds?.length);
  const wizardElement=id=>{
    const e=$id(id);
    if(visible(e))return e;
    return [...document.querySelectorAll('[id]')].find(e=>
      e.id?.toLowerCase()===id.toLowerCase()&&visible(e))||null;
  };
  function wizardStage(){
    const pane=wizardElement('quicksetup-process-content');
    const description=(pane?.innerText||'').slice(0,12000);
    if(wizardElement('save')&&/(?:обзор|summary|тип интернет.подключения)/i.test(description))
      return 'SUMMARY';
    if(wizardElement('wl24gssid')&&wizardElement('wl5gssid'))return 'WIRELESS';
    if(wizardElement('quicksetup_dsl_container'))return 'VLAN_DEFAULTS';
    if(wizardElement('quicksetup_isp_container')&&$id('select_wan_type'))return 'ISP_WAN';
    return 'UNKNOWN';
  }
  function vendorPick(id,desired){
    const select=$id(id),vendor=window.$;
    if(!select||typeof vendor!=='function')throw Error('ISP_WIDGET_MISSING');
    const eq=(a,b)=>String(a??'').trim().toLowerCase()===String(b??'').trim().toLowerCase();
    const options=[...select.options||[]].filter(o=>eq(o.text,desired)||eq(o.value,desired));
    if(options.length!==1)throw Error('ISP_OPTION_NOT_UNIQUE');
    const value=String(options[0].value);
    if(eq(vendor(select).data('value'),value))return;
    const wrapper=$id('_'+id);
    const trigger=wrapper?.querySelector('.tp-select .select-box');
    if(!trigger)throw Error('ISP_STOCK_DROPDOWN_MISSING');
    trigger.click();
    const items=[...wrapper.querySelectorAll('li.option-item[data-val]')]
      .filter(e=>eq(e.getAttribute('data-val'),value));
    if(items.length!==1)throw Error('ISP_STOCK_ITEM_NOT_UNIQUE');
    items[0].click();
    if(!eq(vendor(select).data('value'),value))throw Error('ISP_VENDOR_ACK_MISSING');
  }
  const next=(id)=>{
    const button=wizardElement(id);
    if(!button||button.disabled)throw Error('WIZARD_NEXT_MISSING');
    button.click(); // stock vendor click handler; no invented CGI packet.
  };
  function quickStep(config,stage){
    if(stage==='ISP_WAN'){
      // The user explicitly approved the physical stock sequence below.
      vendorPick('select_country','Украина');
      vendorPick('select_city','все');
      vendorPick('select_isp','Воля');
      const select=$id('select_wan_type');
      const candidates=[...select.options].filter(o=>
        /^(?:dhcp)$/i.test(o.value)||
        /динамическ.*ip|dynamic.*ip/i.test(o.text+' '+o.value));
      if(candidates.length!==1)throw Error('WAN_DHCP_NOT_UNIQUE');
      vendorPick('select_wan_type',candidates[0].value);
      next('next_button');return;
    }
    if(stage==='VLAN_DEFAULTS'){
      // Deliberately leave VLAN ID, priority and all defaults unchanged.
      next('next');return;
    }
    if(stage==='WIRELESS'){
      const names=[wizardElement('wl24gssid'),wizardElement('wl5gssid')];
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if(!setter||names.some(e=>!e))throw Error('WIFI_STOCK_FIELDS_MISSING');
      if(config.ssid24&&config.ssid5){
        for(const [field,value] of [[names[0],config.ssid24],[names[1],config.ssid5]]){
          setter.call(field,value);
          field.dispatchEvent(new Event('input',{bubbles:true}));
          field.dispatchEvent(new Event('change',{bubbles:true}));
          if(field.value!==value)throw Error('WIFI_STOCK_SSID_NOT_STABLE');
        }
      }
      if(config.password){
        const keys=[wizardElement('wl24gpwd'),wizardElement('wl5gpwd')];
        if(keys.some(e=>!e))throw Error('WIFI_STOCK_KEY_FIELDS_MISSING');
        for(const key of keys){
          setter.call(key,config.password);
          key.dispatchEvent(new Event('input',{bubbles:true}));
          key.dispatchEvent(new Event('change',{bubbles:true}));
        }
      }
      next('next');return;
    }
    if(stage==='SUMMARY'){
      const save=wizardElement('save');
      if(!save||save.disabled||!/\bgoSave\s*\(/.test(save.getAttribute('onclick')||''))
        throw Error('SUMMARY_STOCK_HANDLER_UNVERIFIED');
      const mode=wizardElement('conntype');
      if(!/динамическ.*ip|dynamic.*ip|dhcp/i.test(
          String(mode?.value||mode?.textContent||'')))
        throw Error('SUMMARY_DHCP_NOT_CONFIRMED');
      save.click();return;
    }
    throw Error('WIZARD_UNKNOWN_STAGE');
  }
  function message(panel,msg){text(panel.querySelector('[data-result]'),msg)}
  const sleep=t=>new Promise(resolve=>setTimeout(resolve,t));
  async function runQuick(panel) {
    if(running||window.__RouterLabReadOnlyClip)return;
    const confirm=panel.querySelector('[data-confirm]');
    if(!confirm.checked){message(panel,'Подтвердите применение настроек.');return}
    const input=name=>panel.querySelector('[data-'+name+']').value.trim();
    const ssid24=input('ssid24'),ssid5=input('ssid5'),password=panel.querySelector('[data-key]').value;
    if(Boolean(ssid24)!==Boolean(ssid5)||
       (ssid24&&(!validSSID(ssid24)||!validSSID(ssid5)))||
       (password&&!validKey(password))||
       (password&&(!ssid24||!ssid5))){
      message(panel,'Укажите оба SSID либо оставьте пустыми. Пароль: 8–63 ASCII.');
      return;
    }
    if(!validC20()){message(panel,'Не подтверждена модель Archer C20.');return}
    running=true;panel.querySelector('[data-run]').disabled=true;
    try{
      let stage=wizardStage();
      if(stage==='UNKNOWN'){
        message(panel,'Штатный Quick Setup не открыт. Запустите его в роутере; неизвестный экран не изменяем.');
        return;
      }
      const config={ssid24,ssid5,password};
      for(let i=0;i<6;i++){
        stage=wizardStage();
        if(stage==='UNKNOWN')throw Error('WIZARD_STAGE_NOT_CONFIRMED');
        const old=(()=>{try{return JSON.parse(sessionStorage.getItem(QUICK_FENCE)||'null')}catch(_){return {stage:'UNKNOWN'}}})();
        if(old&&Date.now()-old.at<900000&&old.stage===stage)
          throw Error('PREVIOUS_WIZARD_STEP_MAY_HAVE_BEEN_SENT');
        // Persist only stage / timestamp, never Wi-Fi credentials.
        try{sessionStorage.setItem(QUICK_FENCE,JSON.stringify({stage,at:Date.now()}))}
        catch(_){throw Error('WIZARD_FENCE_STORAGE_UNAVAILABLE')}
        quickStep(config,stage);
        if(stage==='WIRELESS')panel.querySelector('[data-key]').value='';
        if(stage==='SUMMARY'){
          message(panel,'Save вызван один раз. Возможен обрыв Wi-Fi. Переподключитесь и проверьте WAN/WLAN.');
          return;
        }
        let advanced=false;
        for(let k=0;k<20;k++){
          await sleep(250);
          const after=wizardStage();
          if(after!=='UNKNOWN'&&after!==stage){
            advanced=true;clear(QUICK_FENCE);break;
          }
        }
        if(!advanced)throw Error('WIZARD_TRANSITION_NOT_CONFIRMED_NO_RETRY');
      }
      throw Error('WIZARD_STEP_LIMIT');
    }catch(e){message(panel,'Остановлено: '+String(e.message||'UNKNOWN')+'. Повтор автоматически не выполняется.')}
    finally{running=false;panel.querySelector('[data-run]').disabled=false;confirm.checked=false;
      panel.querySelector('[data-key]').value='';}
  }
  async function writeWifi(panel,shadow){
    if(running||window.__RouterLabReadOnlyClip)return;
    if(!panel.querySelector('[data-confirm]').checked){
      message(panel,'Сначала подтвердите изменение Wi-Fi.');return;
    }
    if(fenced(WIFI_FENCE)){message(panel,'Предыдущая запись ожидает проверки. Повторять нельзя.');return}
    const ssid24=panel.querySelector('[data-ssid24]').value.trim();
    const ssid5=panel.querySelector('[data-ssid5]').value.trim();
    const password=panel.querySelector('[data-key]').value;
    if(!validSSID(ssid24)||!validSSID(ssid5)||(password&&!validKey(password))){
      message(panel,'SSID: 1–32 байта; новый пароль: 8–63 ASCII-символа.');return;
    }
    const dashboard=shadow.getElementById('dashboard');
    if(!visible(dashboard)||!validC20()||!baseline||Date.now()-baseline.at>120000){
      message(panel,'Требуется свежее подтверждённое чтение Wi-Fi. Нажмите «Проверить состояние».');return
    }
    running=true;panel.querySelector('[data-run]').disabled=true;
    let submitted=false;
    try{
      const fresh=mapWifi(await stockRead('LAN_WLAN'));
      if(fresh.a.SSID!==baseline.a.SSID||fresh.b.SSID!==baseline.b.SSID||
         fresh.a.__stack!==baseline.a.__stack||fresh.b.__stack!==baseline.b.__stack)
        throw Error('WIFI_BASELINE_CHANGED');
      const aSet={},bSet={};
      if(fresh.a.SSID!==ssid24)aSet.SSID=ssid24;
      if(fresh.b.SSID!==ssid5)bSet.SSID=ssid5;
      if(password){aSet.X_TP_PreSharedKey=password;bSet.X_TP_PreSharedKey=password;}
      if(!Object.keys(aSet).length&&!Object.keys(bSet).length){
        message(panel,'Текущие настройки уже соответствуют указанным.');return;
      }
      const vendor=window.$,op=typeof window.ACT_SET==='number'?window.ACT_SET:2;
      if(vendorQueue())throw Error('VENDOR_QUEUE_BUSY');
      // Fence BEFORE first mutating call. Timeout/interruption is UNKNOWN.
      stamp(WIFI_FENCE);submitted=true;
      if(Object.keys(aSet).length)vendor.act(op,'LAN_WLAN',fresh.a.__stack,null,aSet);
      if(Object.keys(bSet).length)vendor.act(op,'LAN_WLAN',fresh.b.__stack,null,bSet);
      panel.querySelector('[data-key]').value='';
      const ack=await new Promise(resolve=>{
        let settled=false;
        const done=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value)};
        const timer=setTimeout(()=>done('UNKNOWN_TIMEOUT'),11000);
        try{const code=vendor.exe(value=>done(value===0?'ACK_ZERO':'ERROR'));
          if(code!==0&&code!==undefined)done('ERROR');
        }catch(_){done('UNKNOWN_AFTER_SEND')}
      });
      if(ack!=='ACK_ZERO'){
        message(panel,'Результат записи неизвестен. Повторная отправка запрещена.');return
      }
      try{
        const after=mapWifi(await stockRead('LAN_WLAN'));
        if(after.a.SSID===ssid24&&after.b.SSID===ssid5){
          message(panel,'Новые SSID записаны в конфигурацию. Применение Wi-Fi и новый пароль ещё не подтверждены.');
          panel.querySelector('[data-reboot]').style.display='inline-block';
        }else message(panel,'Подтверждение новых SSID отсутствует. Не отправляйте повторно.');
      }catch(_){message(panel,'Связь потеряна после записи. Переподключитесь и проверьте изменения.')}
    }catch(e){
      message(panel,submitted?'Результат после отправки неизвестен — повторять нельзя.'
        :'Запись не началась: '+String(e.message||'PREFLIGHT_FAILED'));
    }finally{
      running=false;panel.querySelector('[data-run]').disabled=false;
      panel.querySelector('[data-confirm]').checked=false;
      panel.querySelector('[data-key]').value='';
    }
  }
  function attachAddon(host){
    if(initialized)return;
    const shadow=host.shadowRoot;
    if(!shadow||!validC20())return;
    initialized=true;
    const card=document.createElement('section');
    card.id='c20-mobile-setup-addon';
    card.innerHTML=String.raw`
      <style>#c20-mobile-setup-addon .rl-card{background:#fff;border:1px solid #dbe4ec;
        border-radius:14px;padding:16px;margin:12px 0;color:#14212d}
        #c20-mobile-setup-addon input[type=text],
        #c20-mobile-setup-addon input[type=password]{width:100%;font-size:16px;
        padding:12px;border:1px solid #a8b8c6;border-radius:9px;margin:5px 0 10px}
        #c20-mobile-setup-addon input[type=checkbox]{width:auto}
        #c20-mobile-setup-addon label{display:block;font-size:13px}
        #c20-mobile-setup-addon button{background:#11639c;color:white;
        padding:11px 13px;border:0;border-radius:9px;margin:5px}
        #c20-mobile-setup-addon button:disabled{opacity:.5}
        #c20-mobile-setup-addon [data-result]{font-size:13px;white-space:pre-wrap}
      </style>
      <div class="rl-card" data-wifi-panel style="display:none">
        <strong>Изменить Wi-Fi</strong>
        <label>Имя сети 2,4 ГГц<input data-ssid24 type="text" autocomplete="off"></label>
        <label>Имя сети 5 ГГц<input data-ssid5 type="text" autocomplete="off"></label>
        <label>Новый пароль Wi-Fi (оставьте пустым, если не меняете)<input data-key type="password" autocomplete="new-password"></label>
        <label><input data-confirm type="checkbox"> Подтверждаю изменение обеих сетей</label>
        <button data-run type="button">Сохранить Wi-Fi</button>
        <button data-open-quick type="button">Быстрая настройка: DHCP + Wi-Fi</button>
        <button data-reboot type="button" style="display:none">Применить через перезагрузку</button>
        <button data-recheck type="button">Проверить запись</button>
        <p data-result></p>
      </div>
      <div class="rl-card" data-quick-panel style="display:none">
        <strong>Быстрая настройка C20</strong>
        <p>Страна Украина → регион все → профиль Воля → DHCP → VLAN без изменений → Wi-Fi → сохранить</p>
        <p data-stage></p>
        <label>Имя Wi-Fi 2,4 ГГц (необязательно)<input data-ssid24 type="text" autocomplete="off"></label>
        <label>Имя Wi-Fi 5 ГГц (необязательно)<input data-ssid5 type="text" autocomplete="off"></label>
        <label>Новый пароль Wi-Fi (необязательно)<input data-key type="password" autocomplete="new-password"></label>
        <label><input data-confirm type="checkbox"> Подтверждаю быструю настройку WAN DHCP и Wi-Fi</label>
        <button data-run type="button">Настроить автоматически</button>
        <p data-result></p>
      </div>
    `;
    shadow.querySelector('.content')?.appendChild(card);
    const wifi=card.querySelector('[data-wifi-panel]');
    const quick=card.querySelector('[data-quick-panel]');
    wifi.querySelector('[data-run]').addEventListener('click',()=>writeWifi(wifi,shadow));
    wifi.querySelector('[data-open-quick]').addEventListener('click',async()=>{
      if(running||window.__RouterLabReadOnlyClip||!visible(shadow.getElementById('dashboard')))return;
      if(wizardStage()!=='UNKNOWN'){
        message(wifi,'Штатный мастер уже открыт. Продолжите в блоке «Быстрая настройка».');
        return;
      }
      // Exact physical stock navigation control from the original C20
      // extension (content.js). A mere menu label is NOT wizard evidence.
      const menu=$id('qs');
      const candidates=menu?[...menu.querySelectorAll('span,a')].filter(visible):[];
      const target=candidates.length===1?candidates[0]:
        (candidates.length===0&&visible(menu)?menu:null);
      if(!target){
        message(wifi,'Штатный пункт Quick Setup (#qs) не найден однозначно. Настройки не менялись.');
        return;
      }
      message(wifi,'Открываем штатный мастер. Пока ничего не сохраняем.');
      target.click();
      for(let i=0;i<15;i++){
        await sleep(250);
        if(wizardStage()!=='UNKNOWN'){
          message(wifi,'Мастер открыт. Подтвердите параметры в блоке ниже.');
          return;
        }
      }
      message(wifi,'Переход в мастер не подтверждён. Повторный клик не выполняется.');
    });
    quick.querySelector('[data-run]').addEventListener('click',()=>runQuick(quick));
    wifi.querySelector('[data-reboot]').addEventListener('click',()=>{
      if(!fenced(WIFI_FENCE))return;
      const button=$id('topReboot');
      if(!visible(button)){message(wifi,'Штатная кнопка перезагрузки не найдена.');return}
      wifi.querySelector('[data-reboot]').style.display='none';
      button.click(); // use stock confirmation flow if it appears
      message(wifi,'Запрошена штатная перезагрузка. Подключитесь к Wi-Fi заново.');
    });
    wifi.querySelector('[data-recheck]').addEventListener('click',async()=>{
      try{
        baseline={...mapWifi(await stockRead('LAN_WLAN')),at:Date.now()};
        // A new protected read is not proof of password or on-air apply.
        message(wifi,'Текущие SSID прочитаны. Проверьте подключение к новой Wi-Fi сети.');
        clear(WIFI_FENCE);
      }catch(_){message(wifi,'Защищённое чтение недоступно. Блокировка записи сохраняется.')}
    });
    const sync=()=>{
      if(!document.body.contains(host))return;
      const stage=wizardStage(),authDashboard=visible(shadow.getElementById('dashboard'));
      if(stage!=='UNKNOWN'){
        quick.style.display='block';
        text(quick.querySelector('[data-stage]'),'Текущий этап: '+stage);
      }else quick.style.display='none';
      wifi.style.display=authDashboard?'block':'none';
      if(authDashboard&&!modified&&!baseline&&!baselineLoading){
        const a=shadow.getElementById('ssid24')?.textContent;
        const b=shadow.getElementById('ssid5')?.textContent;
        if(a&&b&&a!=='Нет данных'&&b!=='Нет данных'){
          wifi.querySelector('[data-ssid24]').value=a;
          wifi.querySelector('[data-ssid5]').value=b;
          // Baseline timestamp and dynamic stacks must come from a REAL
          // protected vendor read, not from text shown in a dashboard.
          baselineLoading=true;
          stockRead('LAN_WLAN').then(rows=>{
            baseline={...mapWifi(rows),at:Date.now()};
          }).catch(()=>{}).finally(()=>{baselineLoading=false});
        }
      }
      if(authDashboard&&fenced(WIFI_FENCE))
        message(wifi,'Есть неподтверждённая запись. Проверьте состояние перед новой попыткой.');
    };
    wifi.querySelectorAll('input[type=text],input[type=password]').forEach(e=>
      e.addEventListener('input',()=>{modified=true}));
    sync();
    let ticks=0;
    const timer=setInterval(()=>{if(++ticks>120){clearInterval(timer);return}sync()},500);
    window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  }
  let ticks=0;
  const timer=setInterval(()=>{
    const host=$id('routerlab-tplink-c20-ios');
    if(host&&document.body.contains(host)){clearInterval(timer);attachAddon(host)}
    if(++ticks>45)clearInterval(timer);
  },200);
})();
