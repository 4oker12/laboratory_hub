/* RouterLab Xiaomi operator emulator. Training data only; no router/network calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RouterLabXiaomiDemo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const CATALOG = Object.freeze([{
    id: "xiaomi-r4a-3.0.24-int",
    brand: "Xiaomi",
    model: "Mi Router 4A Gigabit Edition",
    hardware: "R4A",
    firmware: "3.0.24",
    region: "Global / International",
    implementation: "visual-training",
    stockRuntime: "http://127.0.0.1:18090/"
  }]);
  const DEMO_PASSWORD = "RouterLab88";
  const STORAGE_KEY = "routerlab.xiaomi.operator.emulator.v1";

  function makeState(profile) {
    const factory = profile === "factory";
    return {
      schema: 1, modelId: CATALOG[0].id, profile: factory ? "factory" : "configured",
      inited: !factory, country: "UA", language: "ru",
      adminPassword: DEMO_PASSWORD, routerName: "Mi Router 4A Gigabit",
      wan: { type: "dhcp", username: "", password: "" },
      wifi24: { enabled: true, ssid: factory ? "Xiaomi_XXXX" : "RouterLab_24", password: factory ? "" : DEMO_PASSWORD, hidden: false, channel: "auto" },
      wifi5: { enabled: true, ssid: factory ? "Xiaomi_XXXX_5G" : "RouterLab_5G", password: factory ? "" : DEMO_PASSWORD, hidden: false, channel: "auto" },
      lan: { ip: "192.168.31.1", dhcp: true },
      scenario: "no-wan", revision: 0
    };
  }
  function copy(s) { return JSON.parse(JSON.stringify(s)); }
  function validateState(s) {
    if (!s || s.schema !== 1 || s.modelId !== CATALOG[0].id ||
        !s.wan || !s.wifi24 || !s.wifi5 || !s.lan ||
        !["factory", "configured"].includes(s.profile)) return false;
    return true;
  }
  function nonempty(text, label, max) {
    const v = String(text == null ? "" : text).trim();
    if (!v || v.length > max) throw new Error(label + ": укажи от 1 до " + max + " символов.");
    return v;
  }
  function setWan(previous, values) {
    const s = copy(previous);
    const type = String(values.type || "").toLowerCase();
    if (!["dhcp", "pppoe"].includes(type)) throw new Error("В этой учебной версии доступны DHCP и PPPoE.");
    s.wan.type = type;
    s.wan.username = type === "pppoe" ? nonempty(values.username, "PPPoE логин", 100) : "";
    s.wan.password = type === "pppoe" ? nonempty(values.password, "PPPoE пароль", 100) : "";
    s.scenario = type === "pppoe" ? "pppoe-error" : "no-wan";
    s.revision++;
    return s;
  }
  function setWifi(previous, band, values) {
    const s = copy(previous);
    const field = band === "5" ? "wifi5" : band === "24" ? "wifi24" : null;
    if (!field) throw new Error("Неизвестный диапазон Wi-Fi.");
    const enabled = !!values.enabled;
    const ssid = nonempty(values.ssid, "Имя Wi-Fi", 32);
    const password = String(values.password || "");
    if (enabled && (password.length < 8 || password.length > 63)) {
      throw new Error("Учебный пароль Wi-Fi должен содержать от 8 до 63 символов.");
    }
    s[field] = { enabled, ssid, password, hidden: !!values.hidden, channel: String(values.channel || "auto") };
    s.revision++;
    return s;
  }
  function completeWizard(previous, form) {
    if (previous.inited) throw new Error("Первичная настройка уже завершена. Используй сброс.");
    let s = copy(previous);
    s.country = String(form.country || "UA");
    s.language = String(form.language || "ru");
    s = setWan(s, { type: form.wanType, username: form.pppoeUser, password: form.pppoePass });
    const name = nonempty(form.ssid, "Имя Wi-Fi", 32);
    const password = String(form.wifiPassword || "");
    s = setWifi(s, "24", { enabled: true, ssid: name, password });
    s = setWifi(s, "5", { enabled: true, ssid: (name + "_5G").slice(0, 32), password });
    const adminPassword = String(form.adminPassword || "");
    if (adminPassword.length < 8 || adminPassword.length > 63) {
      throw new Error("Учебный пароль администратора: от 8 до 63 символов.");
    }
    s.adminPassword = adminPassword;
    s.inited = true;
    s.profile = "configured";
    s.scenario = "no-wan";
    s.revision++;
    return s;
  }
  function setLan(previous, values) {
    const s = copy(previous);
    const ip = String(values.ip || "").trim();
    const parts = ip.split(".");
    if (parts.length !== 4 || !parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255) ||
        Number(parts[0]) === 0 || Number(parts[0]) >= 224 || Number(parts[3]) === 0 || Number(parts[3]) === 255) {
      throw new Error("Нужен корректный IPv4-адрес LAN, например 192.168.31.1.");
    }
    s.lan = { ip, dhcp: !!values.dhcp };
    s.revision++;
    return s;
  }
  function setScenario(previous, scenario) {
    if (!["no-wan", "dhcp-fail", "pppoe-error", "wifi-off"].includes(scenario)) {
      throw new Error("Неизвестный учебный сценарий.");
    }
    const s = copy(previous);
    s.scenario = scenario;
    s.revision++;
    return s;
  }
  function wanStatus(state) {
    const descriptions = {
      "no-wan": "Нет физического подключения WAN (симуляция)",
      "dhcp-fail": "DHCP: адрес не получен (симуляция)",
      "pppoe-error": "PPPoE: ошибка авторизации (симуляция)",
      "wifi-off": "Wi-Fi отключён в учебном сценарии"
    };
    return descriptions[state.scenario] || descriptions["no-wan"];
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  return {
    CATALOG, DEMO_PASSWORD, STORAGE_KEY, makeState, validateState,
    setWan, setWifi, setLan, setScenario, completeWizard, wanStatus, escapeHtml
  };
});
