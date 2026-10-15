"use strict";
/* Pure decision logic. No network calls, no secrets persistence. */
(function(scope){
  function normalize(s){return String(s||"").toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ").trim();}
  function classify(state) {
    const t=normalize(state.text), ids=new Set(state.ids||[]);
    const visible=state.fields||[];
    const passwords=visible.filter(f=>f.type==="password");
    const has=(id)=>ids.has(id);
    if (/archer c20/.test(normalize(state.title+" "+state.device)) &&
        /v5/.test(normalize(state.firmware+" "+state.device+" "+state.text))) {
      // device identified below, never by title alone when version is unknown
    }
    if (/(create|set|new|создайте|установите|придумайте|создание).{0,20}(password|парол)/i.test(t) && passwords.length >= 2)
      return "factory";
    if (passwords.length && /(log in|login|войти|вход в систему|авторизация)/.test(t) &&
        !/(быстрая настройка|quick setup|основные настройки)/.test(t)) return "login";
    if ((has("wl24gssid") || has("wl5gssid")) && /(настройки беспроводного|wireless settings|ssid)/.test(t))
      return (has("next") || has("next_button")) ? "wizard_wifi" : "edit_wifi";
    if (/(тип интернет-подключения|internet connection type)/.test(t) && has("save"))
      return "wizard_summary";
    if (/(vlan id|vlan идентификатор)/.test(t) && (has("next")||has("next_button")))
      return "wizard_vlan";
    if (/(выберите поставщика интернет-услуг|select.*internet service provider)/.test(t))
      return "wizard_isp";
    if (/(настройка интернета|internet settings|тип подключения wan|connection type)/.test(t) &&
        state.hasWanControl) return "wan";
    if ((has("ssid")||state.hasWifiControl) && !/быстрая настройка|quick setup/.test(t))
      return "edit_wifi";
    if (/quick setup|быстрая настройка/.test(t) && state.hasQuickSetupMenu) return "dashboard";
    return "unknown";
  }
  function verifyModel(state) {
    const v=normalize([state.title,state.device,state.firmware,state.text].join(" "));
    if (!/archer c20/.test(v)) return {ok:false,why:"Не обнаружен Archer C20. Изменения заблокированы."};
    if (!/(?:\bv5\b|версия устройства.{0,32}\bv5\b|hardware version.{0,32}\bv5\b)/.test(v))
      return {ok:false,why:"Не подтверждена аппаратная версия Archer C20 v5. Изменения заблокированы."};
    return {ok:true};
  }
  function validate(form, mode) {
    const errors=[];
    if (!["first","edit"].includes(mode)) errors.push("Некорректный режим");
    if (!["dhcp","pppoe","unchanged"].includes(form.wan)) errors.push("Укажите тип WAN");
    if (mode==="first" && form.wan==="unchanged") errors.push("Для First Run необходимо выбрать WAN");
    if (form.wan==="pppoe" && (!form.pppoeUser.trim() || !form.pppoePass)) errors.push("Для PPPoE нужны логин и пароль");
    for (const band of ["24","5"]) {
      const ssid=form["ssid"+band].trim(), pw=form["pass"+band];
      if (ssid && (ssid.length>32 || /[\x00-\x1f]/.test(ssid))) errors.push("SSID "+band+" должен быть до 32 символов без управляющих символов");
      if (pw && (pw.length<8 || pw.length>63)) errors.push("Пароль Wi-Fi "+band+" должен быть от 8 до 63 символов");
      if (mode==="first" && (!!ssid !== !!pw)) errors.push("В First Run укажите и SSID, и пароль сети "+band);
    }
    if (mode==="first" && !form.ssid24.trim() && !form.ssid5.trim()) errors.push("Для First Run задайте хотя бы одну Wi-Fi сеть");
    if (form.adminPass && form.adminPass.length<8) errors.push("Пароль администратора должен быть не короче 8 символов");
    return errors;
  }
  function sanitize(s){return String(s||"").slice(0,160).replace(/[<>&"']/g,"");}
  const api=Object.freeze({normalize,classify,verifyModel,validate,sanitize});
  scope.RouterLabC20Logic=api;
  if (typeof module!=="undefined" && module.exports) module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
