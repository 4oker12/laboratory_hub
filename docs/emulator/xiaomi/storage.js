/* Model-scoped, versioned state persistence.
 * Session storage is intentional: demo passwords never outlive the browser session.
 * Do not use this storage layer for real router credentials. */
(function(root,factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("./core.js") : root.RouterLabXiaomiDemo);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RouterLabXiaomiStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this,function(core) {
  "use strict";
  if (!core) throw new Error("Xiaomi core.js must load before storage.js");
  const prefix = "routerlab.xiaomi.demo.v1.";
  function keyFor(modelId) {
    if (!core.CATALOG.find(model => model.id === modelId)) {
      throw new Error("Unknown firmware; refusing to load/save simulator state.");
    }
    return prefix + modelId;
  }
  function browserStorage() {
    try {
      if (typeof sessionStorage !== "undefined") {
        const probe = prefix + "probe";
        sessionStorage.setItem(probe, "1");
        sessionStorage.removeItem(probe);
        return sessionStorage;
      }
    } catch (_) { /* Storage blocked by policy or private mode. */ }
    const mem = new Map();
    return {
      getItem: key => mem.has(key) ? mem.get(key) : null,
      setItem: (key,value) => mem.set(key,String(value)),
      removeItem: key => mem.delete(key)
    };
  }
  function createStore(backend) {
    const storage = backend || browserStorage();
    return Object.freeze({
      load(modelId) {
        const id = keyFor(modelId);
        try {
          const serialized = storage.getItem(id);
          if (!serialized || serialized.length > 20000) return null;
          const parsed = JSON.parse(serialized);
          return core.validateState(parsed) && parsed.modelId === modelId ? parsed : null;
        } catch (_) { return null; }
      },
      save(state) {
        if (!core.validateState(state)) throw new Error("Invalid simulator state; save refused.");
        try { storage.setItem(keyFor(state.modelId), JSON.stringify(state)); return true; }
        catch (_) { return false; }
      },
      reset(modelId) { try { storage.removeItem(keyFor(modelId)); return true; } catch (_) { return false; } },
      keyFor
    });
  }
  const active = createStore();
  return Object.freeze({createStore,load:active.load,save:active.save,reset:active.reset,keyFor});
});
