/* RouterLab AX23 stock SU framework software-device bridge.
 * The original TP-Link HTML, views, quick-setup controllers and authentication
 * remain in place. Only the hardware-independent model forms are delegated to
 * a persistent, LOCAL software device. Never installed on physical hardware.
 */
(function (root, $) {
  "use strict";
  var settings = root.__ROUTERLAB_AX23_SOFTDEVICE__;
  if (!settings || !$ || !$.su || !$.su.Connection) return;
  if (root.location.hostname !== "127.0.0.1" &&
      root.location.hostname !== "localhost") return;
  if (!Number.isInteger(settings.port) || settings.port < 1024 ||
      settings.port > 65535 ||
      typeof settings.key !== "string" || settings.key.length < 32) return;

  var ROUTES = {
    quick_setup: ["quick_setup"],
    network: ["wan_ipv4_status", "wan_ipv4_dynamic"],
    wireless: ["wireless_2g", "wireless_5g", "region"],
    firmware: ["upgrade"],
    status: ["internet", "all"],
    system: ["sysmode"],
    time: ["settings"],
    cloud_account: ["check_upgrade"]
  };
  var endpoint = "http://127.0.0.1:" + settings.port + "/v1/form";
  var originalRequest = $.su.Connection.prototype.request;

  function routeFor(input) {
    if (!input) return null;
    var str = input && input.toString ? input.toString() : String(input);
    var url;
    try { url = new URL(str, root.location.href); } catch (_) { return null; }
    if (url.origin !== root.location.origin) return null;
    var currentToken = null;
    try {
      currentToken = root.localStorage.getItem("token");
    } catch (_) { return null; }
    // The original TP-Link main.js writes BOTH the browser token and
    // $.su.url.stok following genuine vendor login. Their exact identity
    // must match the authenticated LuCI URI; a fabricated URL alone fails.
    if (!currentToken || !$.su.url ||
        $.su.url.stok !== currentToken) return null;
    var loginPart = /\/cgi-bin\/luci\/;stok=([a-fA-F0-9]{16,80})\//.exec(url.pathname);
    if (!loginPart || loginPart[1] !== currentToken) return null;
    var parts = /\/admin\/([a-z_]+)$/.exec(url.pathname);
    var group = parts && parts[1];
    var form = url.searchParams.get("form");
    if (!group || !Object.prototype.hasOwnProperty.call(ROUTES, group) ||
        ROUTES[group].indexOf(form) < 0) return null;
    return {group: group, form: form};
  }

  function copyModelPayload(data) {
    var out = Object.create(null);
    if (!data || typeof data !== "object" || Array.isArray(data)) return out;
    Object.keys(data).forEach(function (key) {
      if (key === "operation" || !/^[a-z][a-z0-9_]{0,95}$/.test(key)) return;
      var val = data[key];
      if (val === undefined || typeof val === "function") return;
      out[key] = val;
    });
    return out;
  }

  $.su.Connection.prototype.request = function (options) {
    var src = options && (options.url || (options.ajax && options.ajax.url));
    var route = routeFor(src);
    if (!route) return originalRequest.apply(this, arguments);
    var op = options.data && options.data.operation || "read";
    if (op === "load") op = "read";
    if (op !== "read" && op !== "write")
      return originalRequest.apply(this, arguments);

    // IPFProxy's existing success callback reads options.noneEncrypt.
    // The response is software-only, never a claimed vendor-encrypted reply.
    // Genuine TP-Link authentication is not intercepted.
    options.noneEncrypt = true;
    var controller = new AbortController();
    this.ajaxRequest = {abort: function () { controller.abort(); }};
    var done = false;
    var request = {
      group: route.group,
      form: route.form,
      operation: op,
      data: op === "write" ? copyModelPayload(options.data) : {}
    };

    fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-RouterLab-Key": settings.key
      },
      body: JSON.stringify(request),
      signal: controller.signal,
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("SOFTWARE_DEVICE_HTTP_" + r.status);
      return r.json();
    }).then(function (reply) {
      if (done || controller.signal.aborted) return;
      done = true;
      if (!reply || typeof reply !== "object" ||
          typeof reply.success !== "boolean") {
        throw new Error("SOFTWARE_DEVICE_INVALID_RESPONSE");
      }
      if (typeof options.success === "function")
        options.success(reply, "success", {status: 200});
    }).catch(function (error) {
      if (done || controller.signal.aborted) return;
      done = true;
      if (typeof options.error === "function")
        options.error({status: 503, readyState: 4}, "error",
                      "RouterLab software device unavailable");
      else if (typeof options.fail === "function")
        options.fail({errorCode: "SOFTDEVICE_UNAVAILABLE"}, "error");
    });
    return this.ajaxRequest;
  };

  root.RouterLabAX23SoftwareDevice = Object.freeze({
    enabled: true,
    mode: "software-only",
    hardwareApplied: false,
    backendPort: settings.port,
    nativeAuthentication: true,
    supportedForms: Object.keys(ROUTES).reduce(function (n, key) {
      return n + ROUTES[key].length;
    }, 0)
  });
})(window, window.jQuery);
