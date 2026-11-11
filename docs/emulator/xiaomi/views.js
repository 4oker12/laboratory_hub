/* UI profile adapter: MiWiFi R4A Global 3.0.24.
 * No DOM access, router calls, persistence or controller state mutations here.
 * Additional firmware families should implement a separate, validated profile. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.RouterLabXiaomiViews=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  function createMiWifiR4aViews(context) {
    const {core,scenarios,model,state,wizard,wizardStep,page}=context;
    const E=core.escapeHtml;
    function selectedModel(){ return model; }
  function opt(value, label, chosen) {
    return '<option value="' + E(value) + '"' + (String(value) === String(chosen) ? ' selected' : '') + '>' + E(label) + '</option>';
  }
  function check(value) { return value ? ' checked' : ''; }
  function field(name, label, value, type, extra, suffix) {
    const id = "f-" + name + "-" + (suffix || "default");
    return '<label for="' + E(id) + '">' + E(label) + '</label>' +
      '<input id="' + E(id) + '" name="' + E(name) + '" type="' + E(type || "text") +
      '" value="' + E(value == null ? "" : value) + '" ' + (extra || "") + '>';
  }
  function btn(text, cls) {
    return '<button type="submit" class="btn ' + (cls || "primary") + '">' + E(text) + '</button>';
  }

  function renderWizard() {
    const names = ["Приветствие", "Страна и язык", "Подключение к интернету", "Настройка Wi-Fi", "Пароль администратора"];
    let body = "";
    if (wizardStep === 0) {
      body = '<div class="empty"><div class="welcome-symbol">◎</div><h2>Спасибо за выбор Mi Router</h2><p>Мастер первой настройки ' + E(selectedModel().model) + ' · ' + E(selectedModel().firmware) + '.</p></div>' +
        '<div class="notice">Тренировочный сценарий. Настройки будут сохранены только в этом браузере; ни одного запроса к реальному роутеру.</div>';
    } else if (wizardStep === 1) {
      body = '<h2>Выбери регион и язык</h2><p>Как при первом запуске маршрутизатора.</p><div class="form-grid">' +
        '<label for="country">Страна</label><select id="country" name="country">' +
        opt("UA","Украина",wizard.country) + opt("PL","Польша",wizard.country) + opt("DE","Германия",wizard.country) + '</select>' +
        '<label for="language">Язык интерфейса</label><select id="language" name="language">' +
        opt("ru","Русский",wizard.language) + opt("uk","Українська",wizard.language) + opt("en","English",wizard.language) + '</select></div>';
    } else if (wizardStep === 2) {
      body = '<h2>Настройка подключения</h2><p>Для стандартного подключения IPoE у провайдера обычно выбирают DHCP.</p>' +
        '<div class="form-grid"><label for="wanType">Тип WAN</label><select name="wanType" id="wanType" data-wan-mode>' +
        opt("dhcp","DHCP (динамический IP)",wizard.wanType) + opt("pppoe","PPPoE (логин/пароль)",wizard.wanType) + '</select></div>' +
        '<div class="wan-details" data-pppoe-fields><div class="form-grid">' +
        field("pppoeUser","PPPoE логин",wizard.pppoeUser) +
        field("pppoePass","PPPoE пароль (тестовый)",wizard.pppoePass,"password") + '</div></div>' +
        '<p class="hint">Настоящего WAN и PPPoE-сервера в эмуляторе нет.</p>';
    } else if (wizardStep === 3) {
      body = '<h2>Настройка Wi-Fi</h2><p>Будут созданы сети 2,4 ГГц и 5 ГГц с суффиксом _5G.</p>' +
        '<div class="form-grid">' + field("ssid","Имя сети (SSID)",wizard.ssid,"text",'maxlength="32" required') +
        field("wifiPassword","Пароль Wi-Fi (учебный)",wizard.wifiPassword,"text",'minlength="8" maxlength="63" required') +
        '</div><div class="notice">Для обучения используй выдуманные имена и пароли. Не вводи данные реальных абонентов.</div>';
    } else {
      body = '<h2>Пароль администратора</h2><p>Отдельный пароль для входа в веб-интерфейс.</p>' +
        '<div class="form-grid">' + field("adminPassword","Новый учебный пароль",wizard.adminPassword,"text",'minlength="8" maxlength="63" required') +
        '</div><div class="notice">После сохранения откроется главная панель, а доступный сброс вернёт мастер к началу.</div>';
    }
    const steps = '<div class="wizard-steps">' + names.map((_, i) => '<span class="' + (i <= wizardStep ? "done" : "") + '"></span>').join("") + '</div>';
    return '<div class="wizard"><p class="hint">Первая настройка · Шаг ' + (wizardStep + 1) + ' из 5 · ' + names[wizardStep] + '</p>' +
      steps + '<form data-form="wizard" autocomplete="off">' + body +
      '<div class="wizard-actions">' +
      (wizardStep ? '<button type="button" class="btn light" data-back>Назад</button>' : "") +
      btn(wizardStep === 4 ? "Завершить настройку" : "Продолжить") +
      '</div></form></div>';
  }
  function renderLogin() {
    return '<div class="login"><h2>Вход в MiWiFi</h2><p>Настроенный ' + E(selectedModel().model) + '.</p>' +
      '<form data-form="login" autocomplete="off"><label for="demo-login-password">Пароль администратора (только демо)</label>' +
      '<input id="demo-login-password" name="password" type="password" placeholder="Введите тестовый пароль" required>' +
      btn("Войти") + '</form><div class="notice">Демо-пароль: <b>' + E(core.DEMO_PASSWORD) +
      '</b> (для выбранного профиля). Если изменён в мастере, используй свой учебный пароль.</div></div>';
  }
  function renderWifiCard(id, label, item) {
    const enabled = item.enabled && state.scenario !== "wifi-off";
    return '<div class="wifi-card"><div class="frequency">' + label +
      '<span>GHz</span></div><p>Имя Wi-Fi: <b>' + E(item.ssid) + '</b></p>' +
      '<p>Статус: <span class="pill ' + (enabled ? "" : "warning") + '">' + (enabled ? "Включена" : "Отключена") +
      '</span></p><p>Подключенные устройства: <b>0 (симуляция)</b></p>' +
      '<button type="button" class="btn small light" data-go="wifi">Настроить</button></div>';
  }
  function renderStatus() {
    return '<div class="panel"><h2>Состояние маршрутизатора</h2>' +
      '<div class="statusline bad">● ' + E(core.wanStatus(state)) + '</div>' +
      '<div class="notice warn">Состояние интернет-соединения учебное. Эмулятор не подключается к настоящей сети и не получает IP от провайдера.<br><b>Что проверить оператору:</b> ' + E(scenarios.requireScenario(state.scenario).diagnostic) + '</div>' +
      '<div class="cards">' +
      renderWifiCard("wifi24", "2.4", state.wifi24) +
      renderWifiCard("wifi5", "5", state.wifi5) +
      '</div></div><h3>Информация о роутере</h3>' +
      '<table class="summary-table"><tbody>' +
      row("Модель", selectedModel().model + " (" + selectedModel().hardware + ")") +
      row("Версия прошивки", selectedModel().firmware + " · " + selectedModel().region) +
      row("Тип подключения", state.wan.type.toUpperCase()) +
      row("IP WAN / шлюз / DNS", "— (не эмулируются)") +
      row("IP LAN", state.lan.ip) +
      row("Клиентов", "0 (симуляция)") +
      '</tbody></table>';
  }
  function row(label, value) { return '<tr><td>' + E(label) + '</td><td>' + E(value) + '</td></tr>'; }
  function renderSettings() {
    if (page === "wifi") return renderWifi();
    if (page === "wan") return renderWan();
    if (page === "security") return renderSecurity();
    if (page === "lan") return renderLan();
    return renderInfo();
  }
  function wifiForm(band, item, label) {
    return '<form data-form="wifi" data-band="' + band + '"><h3>Wi-Fi ' + label + '</h3>' +
      '<div class="form-grid"><label>Беспроводная сеть</label><label class="rowcheck"><input name="enabled" type="checkbox"' +
      check(item.enabled) + '> Включена</label>' +
      field("ssid","Название сети (SSID)",item.ssid,"text",'maxlength="32" required',band) +
      field("password","Пароль (учебный)",item.password,"text",'maxlength="63"',band) +
      '<label>Скрыть SSID</label><label class="rowcheck"><input name="hidden" type="checkbox"' +
      check(item.hidden) + '> Скрытая сеть</label>' +
      '<label for="channel-' + band + '">Канал</label><select name="channel" id="channel-' + band + '">' +
      opt("auto","Автоматически",item.channel) +
      (band === "24" ? [1,6,11] : [36,40,44,48,149]).map(c => opt(c,"Канал " + c,item.channel)).join("") +
      '</select><div></div><div>' + btn("Сохранить Wi-Fi " + label, "primary small") +
      '</div></div></form>';
  }
  function renderWifi() {
    return '<h2>Настройки Wi-Fi</h2><p>Включение сети, SSID, пароль, видимость, канал.</p>' +
      wifiForm("24",state.wifi24,"2,4 ГГц") + '<hr>' + wifiForm("5",state.wifi5,"5 ГГц") +
      '<div class="notice">Изменение Wi-Fi не разрывает твоё фактическое подключение: сохраняется только тренировочное состояние.</div>';
  }
  function renderWan() {
    const wan = state.wan;
    return '<h2>Настройки интернета</h2><p>Выбор типа подключения к провайдеру.</p>' +
      '<table class="summary-table"><tbody>' + row("Текущий тип", wan.type.toUpperCase()) +
      row("WAN IP", "— (нет реального канала)") + row("Состояние", core.wanStatus(state)) +
      '</tbody></table><h3>Параметры WAN</h3><form data-form="wan"><div class="form-grid">' +
      '<label for="wanType">Тип подключения</label><select id="wanType" name="type" data-wan-mode>' +
      opt("dhcp","DHCP (динамический IP)",wan.type) +
      opt("pppoe","PPPoE (логин и пароль)",wan.type) + '</select></div>' +
      '<div class="wan-details" data-pppoe-fields><div class="form-grid">' +
      field("username","PPPoE логин",wan.username) + field("password","PPPoE пароль (учебный)",wan.password,"text") +
      '</div></div><div class="wizard-actions">' + btn("Сохранить параметры WAN") +
      '</div></form><div class="notice">Для обычного IPoE/DHCP подключения SIMNET достаточно выбрать DHCP. Эта страница не запускает настоящую DHCP/PPPoE сессию.</div>';
  }
  function renderSecurity() {
    return '<h2>Безопасность</h2><p>Смена пароля входа в веб-интерфейс.</p>' +
      '<form data-form="security"><div class="form-grid">' +
      field("old","Текущий учебный пароль","","password",'required') +
      field("next","Новый учебный пароль","","password",'minlength="8" maxlength="63" required') +
      '<div></div><div>' + btn("Изменить пароль") + '</div></div></form>' +
      '<div class="notice">Настройка учебная. Для реального роутера открывай его штатный интерфейс.</div>';
  }
  function renderLan() {
    return '<h2>Локальная сеть</h2><p>Адрес локального шлюза и DHCP-сервер роутера.</p>' +
      '<form data-form="lan"><div class="form-grid">' +
      field("ip","LAN IP роутера",state.lan.ip,"text",'required inputmode="decimal"') +
      '<label>DHCP-сервер</label><label class="rowcheck"><input name="dhcp" type="checkbox"' +
      check(state.lan.dhcp) + '> Включён</label>' +
      '<div></div><div>' + btn("Сохранить LAN") + '</div></div></form>' +
      '<div class="notice">Изменение LAN IP здесь не переподключает браузер и не меняет IP твоего компьютера.</div>';
  }
  function renderInfo() {
    return '<h2>Сведения о роутере</h2><table class="summary-table"><tbody>' +
      row("Производитель", "Xiaomi") + row("Модель", selectedModel().model) +
      row("Аппаратная ревизия", selectedModel().hardware) + row("Прошивка", selectedModel().region + " " + selectedModel().firmware) +
      row("Состояние", state.inited ? "Настроен" : "Сброшен") +
      row("Режим", "Веб-демонстрация без оборудования") + '</tbody></table>';
  }
  function renderAdvanced() {
    if (page === "system") return '<h2>Система</h2><p>Сервисные операции маршрутизатора.</p>' +
      '<div class="two-column"><div class="metric"><small>Прошивка</small><strong>' + E(selectedModel().firmware) + '</strong></div>' +
      '<div class="metric"><small>Ревизия</small><strong>' + E(selectedModel().hardware) + '</strong></div></div><div class="divider"></div>' +
      '<button type="button" class="btn light" data-reboot>Учебная перезагрузка</button> ' +
      '<button type="button" class="btn light" data-factory-reset>Сброс к заводским настройкам</button>' +
      '<div class="notice">Перезагрузка и сброс влияют только на вкладку тренажёра.</div>';
    if (page === "dhcp") {
      const prefix = state.lan.ip.split(".").slice(0,3).join(".");
      return '<h2>DHCP локальной сети</h2><p>Параметры выдачи адресов домашним устройствам.</p>' +
        '<table class="summary-table"><tbody>' + row("DHCP-сервер",state.lan.dhcp ? "Включён" : "Выключен") +
        row("Шлюз",state.lan.ip) + row("Учебный диапазон",prefix + ".100 — " + prefix + ".199") +
        row("Выдано адресов","0 (симуляция)") + '</tbody></table><p><button class="btn small light" type="button" data-go="lan">Изменить параметры LAN</button></p>';
    }
    if (page === "devices") return '<h2>Подключённые устройства</h2><div class="empty">Подключённых клиентов нет.<p>Реальные MAC/IP и трафик в учебном симуляторе недоступны.</p></div>';
    return '<h2>QoS / Контроль полосы</h2><div class="notice warn">Раздел недоступен: в текущем stock rehost Xiaomi R4A QoS зависит от отсутствующего аппаратного/сетевого окружения.</div>';
  }

    return Object.freeze({renderWizard,renderLogin,renderStatus,renderSettings,renderAdvanced});
  }
  const profiles=Object.freeze({"miwifi-r4a-v1":createMiWifiR4aViews});
  function createViews(context) {
    if(!context||!context.model)throw new Error("Missing firmware view context");
    const factory=profiles[context.model.profile];
    if(!factory)throw new Error("No verified Xiaomi UI profile: "+context.model.profile);
    return factory(context);
  }
  return Object.freeze({createViews,SUPPORTED_PROFILES:Object.freeze(Object.keys(profiles))});
});
