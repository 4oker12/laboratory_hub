/* Xiaomi R4A operator training GUI. Deliberately offline; never sends credentials or requests. */
(function () {
  "use strict";
  const core = window.RouterLabXiaomiDemo;
  const catalog = window.RouterLabXiaomiCatalog;
  const scenarios = window.RouterLabXiaomiScenarios;
  const store = window.RouterLabXiaomiStore;
  if (!core || !catalog || !scenarios || !store) {
    throw new Error("Xiaomi emulator dependencies are not loaded in the documented order");
  }
  const $ = id => document.getElementById(id);
  const E = core.escapeHtml;
  let state = store.load(catalog.MODELS[0].id) || core.makeState("factory", catalog.MODELS[0].id);
  let tab = "status";
  let page = "wifi";
  let wizardStep = 0;
  let loggedIn = false;
  let wizard = {
    country: "UA", language: "ru", wanType: "dhcp",
    pppoeUser: "", pppoePass: "", ssid: "RouterLab",
    wifiPassword: "RouterLabWifi88", adminPassword: "RouterLabAdmin88"
  };

  const menus = {
    settings: [
      ["wifi", "◉", "Настройки Wi-Fi"],
      ["wan", "◎", "Параметры сети"],
      ["security", "♙", "Безопасность"],
      ["lan", "▦", "Локальная сеть"],
      ["info", "ⓘ", "Сведения"]
    ],
    advanced: [
      ["system", "⚙", "Система"],
      ["dhcp", "▤", "DHCP"],
      ["devices", "▣", "Устройства"],
      ["qos", "⇅", "QoS (недоступно)"]
    ]
  };
  function persist() { return store.save(state); }
  function selectedModel() { return catalog.requireModel(state.modelId); }
  function updateFirmwarePicker() {
    const selected = $("model-select").value;
    const versions = catalog.firmwareFor(selected);
    $("firmware-select").innerHTML = versions.map(model =>
      '<option value="' + E(model.id) + '">' + E(model.firmware + " · " + model.region) + '</option>').join("");
    $("open-demo").disabled = versions.length === 0;
  }
  function initCatalog() {
    $("model-select").innerHTML = catalog.families().map(item =>
      '<option value="' + E(item.familyId) + '">' + E(item.model + " (" + item.hardware + ")") + '</option>').join("");
    $("model-select").addEventListener("change", updateFirmwarePicker);
    updateFirmwarePicker();
    $("scenario-select").innerHTML = scenarios.ALL.map(item =>
      '<option value="' + E(item.id) + '">' + E(item.title) + '</option>').join("");
  }
  function message(text, success) {
    const box = $("message");
    box.textContent = text;
    box.classList.toggle("success", !!success);
    box.hidden = !text;
  }
  function clearMessage() { message("", false); }
  function openDemo(profile) {
    const firmwareId = $("firmware-select").value;
    state = core.makeState(profile, firmwareId);
    persist();
    loggedIn = false;
    wizardStep = 0;
    tab = "status";
    page = "wifi";
    clearMessage();
    $("simulator").hidden = false;
    location.hash = "emulator";
    render();
    $("simulator").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function closeDemo() {
    $("simulator").hidden = true;
    clearMessage();
    location.hash = "catalog";
  }
  function setState(next, msg) {
    state = next;
    persist();
    render();
    message(msg, true);
  }
  function render() {
    const model = selectedModel();
    const view = window.RouterLabXiaomiViews.createViews({
      model, state, page, wizardStep, wizard, core, scenarios
    });
    $("router-name").textContent = state.routerName;
    $("router-footer-label").textContent = "MiWiFi · " + model.model + " · " + model.firmware + " " + model.region;
    $("scenario-select").value = state.scenario;
    const inside = !!state.inited && loggedIn;
    $("primary-nav").hidden = !inside;
    $("logout").hidden = !inside;
    $("network-flow").hidden = !(inside && tab === "status");
    $("sub-nav").hidden = !(inside && tab !== "status");
    for (const button of $("primary-nav").querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.tab === tab);
    }
    if (inside && tab !== "status") {
      $("sub-nav").innerHTML = menus[tab].map(x =>
        '<button type="button" data-page="' + x[0] + '" class="' + (page === x[0] ? "active" : "") + '"' +
        (x[0] === "qos" ? ' aria-disabled="true" title="Недоступно в RouterLab"' : "") + '>' +
        '<span class="subicon">' + x[1] + '</span>' + x[2] + '</button>').join("");
    }
    if (!state.inited) $("screen").innerHTML = view.renderWizard();
    else if (!loggedIn) $("screen").innerHTML = view.renderLogin();
    else if (tab === "status") $("screen").innerHTML = view.renderStatus();
    else if (tab === "settings") $("screen").innerHTML = view.renderSettings();
    else $("screen").innerHTML = view.renderAdvanced();
    syncWanVisibility();
  }
  function syncWanVisibility() {
    const el = $("screen").querySelector("[data-wan-mode]");
    const details = $("screen").querySelector("[data-pppoe-fields]");
    if (el && details) {
      details.hidden = el.value !== "pppoe";
      details.querySelectorAll("input").forEach(input => { input.disabled = details.hidden; });
    }
  }
  function wizardSubmit(form) {
    const v = key => form.elements.namedItem(key)?.value;
    if (wizardStep === 1) { wizard.country = v("country"); wizard.language = v("language"); }
    if (wizardStep === 2) {
      wizard.wanType = v("wanType");
      if (wizard.wanType === "pppoe") {
        wizard.pppoeUser = v("pppoeUser");
        wizard.pppoePass = v("pppoePass");
        if (!wizard.pppoeUser || !wizard.pppoePass) throw new Error("Введи учебные PPPoE логин и пароль.");
      }
    }
    if (wizardStep === 3) {
      wizard.ssid = v("ssid"); wizard.wifiPassword = v("wifiPassword");
      if (wizard.wifiPassword.length < 8) throw new Error("Пароль Wi-Fi: минимум 8 символов.");
    }
    if (wizardStep === 4) {
      wizard.adminPassword = v("adminPassword");
      state = core.completeWizard(state, wizard);
      loggedIn = true;
      tab = "status"; persist(); render();
      message("Первичная настройка завершена. Изменения существуют только в симуляторе.", true);
      return;
    }
    wizardStep++; clearMessage(); render();
  }
  $("open-demo").addEventListener("click", () => openDemo($("profile-select").value));
  $("close-demo").addEventListener("click", closeDemo);
  $("restart-demo").addEventListener("click", () => openDemo($("profile-select").value));
  $("scenario-select").addEventListener("change", e => {
    try { setState(core.setScenario(state,e.target.value), "Загружен учебный сценарий."); }
    catch (error) { message(error.message); }
  });
  $("logout").addEventListener("click", () => { loggedIn = false; clearMessage(); render(); });
  $("primary-nav").addEventListener("click", e => {
    const button = e.target.closest("[data-tab]");
    if (!button) return;
    tab = button.dataset.tab;
    page = tab === "advanced" ? "system" : "wifi";
    clearMessage(); render();
  });
  $("sub-nav").addEventListener("click", e => {
    const button = e.target.closest("[data-page]");
    if (!button) return;
    page = button.dataset.page; clearMessage(); render();
  });
  $("screen").addEventListener("change", e => {
    if (e.target.matches("[data-wan-mode]")) syncWanVisibility();
  });
  $("screen").addEventListener("click", e => {
    const go = e.target.closest("[data-go]");
    if (go) { tab = "settings"; page = go.dataset.go; clearMessage(); render(); return; }
    if (e.target.closest("[data-back]")) { wizardStep = Math.max(0,wizardStep - 1); clearMessage(); render(); return; }
    if (e.target.closest("[data-reboot]")) { loggedIn = false; clearMessage(); render(); message("Виртуальная перезагрузка. Введи пароль для повторного входа.",true); return; }
    if (e.target.closest("[data-factory-reset]")) {
      if (window.confirm("Сбросить все учебные настройки и снова пройти мастер?")) openDemo("factory");
    }
  });
  $("screen").addEventListener("submit", e => {
    const form = e.target;
    if (!form.matches("form[data-form]")) return;
    e.preventDefault();
    try {
      clearMessage();
      const type = form.dataset.form;
      const v = key => form.elements.namedItem(key)?.value;
      if (type === "wizard") wizardSubmit(form);
      if (type === "login") {
        if (v("password") !== state.adminPassword) throw new Error("Неверный учебный пароль администратора.");
        loggedIn = true; render(); message("Вход выполнен в учебном режиме.",true);
      }
      if (type === "wifi") setState(core.setWifi(state,form.dataset.band,{
        enabled: !!form.elements.namedItem("enabled").checked,
        ssid: v("ssid"), password: v("password"),
        hidden: !!form.elements.namedItem("hidden").checked, channel: v("channel")
      }),"Учебные настройки Wi-Fi сохранены.");
      if (type === "wan") setState(core.setWan(state,{
        type:v("type"),username:v("username")||"",password:v("password")||""
      }),"WAN-конфигурация обновлена (без подключения к провайдеру).");
      if (type === "lan") setState(core.setLan(state,{
        ip:v("ip"),dhcp:!!form.elements.namedItem("dhcp").checked
      }),"Учебная конфигурация LAN сохранена.");
      if (type === "security") {
        if (v("old") !== state.adminPassword) throw new Error("Текущий пароль не совпадает.");
        if ((v("next") || "").length < 8) throw new Error("Минимум 8 символов.");
        state.adminPassword = v("next"); state.revision++; persist(); render();
        message("Учебный пароль изменён.",true);
      }
    } catch (error) { message(error.message, false); }
  });
  initCatalog();
  if (location.hash === "#emulator") { $("simulator").hidden = false; render(); }
})();
