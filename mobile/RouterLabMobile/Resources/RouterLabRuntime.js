/* RouterLab Mobile v0.1 — same-origin stock UI recorder/replay runtime.
 * Runs in the WKWebView PAGE content world. Never sends input secrets to native logs.
 * It does not implement vendor-specific router commands.
 */
(() => {
  'use strict';
  if (window.__RouterLabMobile) return;

  const bridge = window.webkit?.messageHandlers?.routerlab;
  const post = (message) => {
    try {
      if (typeof window.__RouterLabSafariPost === 'function') window.__RouterLabSafariPost(message);
      else bridge?.postMessage(message);
    } catch (_) {}
  };
  let mode = 'idle';
  let replayGeneration = 0;
  let lastChange = '';
  let indicator;

  function cssEsc(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch);
  }

  function selectorFor(el) {
    if (!(el instanceof Element)) return null;
    if (el.id && document.querySelectorAll('#' + cssEsc(el.id)).length === 1) {
      return '#' + cssEsc(el.id);
    }
    const attrs = ['data-testid', 'name', 'aria-label'];
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (!value || value.length > 120) continue;
      const candidate = el.tagName.toLowerCase() + '[' + attr + '=' + JSON.stringify(value) + ']';
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (_) {}
    }
    const parts = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + cssEsc(node.id)); break; }
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(x => x.tagName === node.tagName) : [];
      const idx = siblings.indexOf(node) + 1;
      parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + idx + ')' : ''));
      if (parts.length > 12) break;
    }
    return parts.join(' > ');
  }

  function classification(el) {
    const key = [el.id, el.name, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label')]
      .filter(Boolean).join(' ').toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (/ssid|network.?name|wifi.?name/.test(key)) return 'wifiSSID';
    if (/pppoe|wan.*user|broadband.*user/.test(key)) return 'wanUsername';
    if (/pppoe.*pass|wan.*pass|broadband.*pass/.test(key)) return 'wanPassword';
    if (/wpa|wifi.*pass|wireless.*pass|pre.?shared|psk|security.?key/.test(key)) return 'wifiPassword';
    if (type === 'password' || /pass|secret|token|private.?key|pin|credential/.test(key)) return 'adminPassword';
    if (type === 'hidden') return 'skip';
    return null;
  }

  function onChange(e) {
    if (mode !== 'record') return;
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    if (el.closest('#routerlab-mobile-indicator, #routerlab-safari-controls')) return;
    const selector = selectorFor(el);
    if (!selector) return;
    const placeholder = classification(el);
    if (placeholder === 'skip') return;
    const isCheck = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
    const step = {
      kind: isCheck ? 'check' : 'set', selector,
      placeholder: placeholder || null,
      value: placeholder ? null : String(isCheck ? el.checked : el.value).slice(0, 256),
      path: location.pathname,
      label: (el.getAttribute('aria-label') || el.name || el.id || el.tagName).slice(0, 100)
    };
    const fingerprint = JSON.stringify(step);
    if (fingerprint === lastChange) return;
    lastChange = fingerprint;
    post({ type: 'step', step });
  }

  function onClick(e) {
    if (mode !== 'record') return;
    const target = e.target;
    if (!(target instanceof Element) || target.closest('#routerlab-mobile-indicator, #routerlab-safari-controls')) return;
    const el = target.closest('button, a, input[type="button"], input[type="submit"], [role="button"]');
    if (!el || el.closest('#routerlab-mobile-indicator, #routerlab-safari-controls')) return;
    const selector = selectorFor(el);
    if (!selector) return;
    post({ type: 'step', step: {
      kind: 'click', selector, value: null, placeholder: null,
      path: location.pathname,
      label: ((el.innerText || el.value || el.title || el.id || 'click') + '').trim().slice(0, 100)
    }});
  }

  function onSubmit(e) {
    if (mode !== 'record' || e.submitter) return; // A submitter click is already recorded.
    const selector = selectorFor(e.target);
    if (selector) post({ type: 'step', step: { kind:'submit', selector, path:location.pathname, label:'Submit' }});
  }

  function setMode(next) {
    if (!['idle', 'record', 'replay'].includes(next)) return;
    mode = next;
    renderIndicator();
  }

  function renderIndicator() {
    if (!document.documentElement) return;
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'routerlab-mobile-indicator';
      indicator.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;pointer-events:none';
      const shadow = indicator.attachShadow({ mode: 'closed' });
      const tag = document.createElement('div');
      tag.id = 'state';
      tag.style.cssText = 'font:600 11px -apple-system,system-ui,sans-serif;border-radius:99px;padding:6px 11px;background:#17202a;color:white;box-shadow:0 2px 12px #0005';
      shadow.appendChild(tag);
      indicator._label = tag;
      document.documentElement.appendChild(indicator);
    }
    indicator._label.textContent = mode === 'record' ? 'RouterLab ● REC' : mode === 'replay' ? 'RouterLab ▶ REPLAY' : 'RouterLab · READY';
    indicator._label.style.background = mode === 'record' ? '#a31b1b' : mode === 'replay' ? '#205f96' : '#17202a';
  }

  async function waitFor(selector, timeoutMs = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      let el;
      try { el = document.querySelector(selector); } catch (_) { throw new Error('Invalid CSS selector'); }
      if (el && el.isConnected && !el.disabled) return el;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Element not found/disabled: ' + selector.slice(0, 110));
  }

  function setNativeValue(el, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (descriptor?.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function play(payload) {
    if (!payload || !Array.isArray(payload.steps)) throw new Error('Invalid playback payload');
    const generation = ++replayGeneration;
    setMode('replay');
    const start = Number(payload.start) || 0;
    const secrets = payload.secrets || {};
    for (let i = start; i < payload.steps.length; i++) {
      if (generation !== replayGeneration || mode !== 'replay') return;
      const step = payload.steps[i];
      try {
        if (!step?.selector || !['set', 'check', 'click', 'submit'].includes(step.kind)) throw new Error('Unsupported recorded step');
        // Do not replay on an unexpected route, even if the CSS selector happens to match.
        if (step.path && step.path !== location.pathname) throw new Error('Page mismatch: expected ' + step.path + ', got ' + location.pathname);
        const el = await waitFor(step.selector);
        if (step.kind === 'set') {
          const value = step.placeholder ? secrets[step.placeholder] : step.value;
          if (value === undefined || value === null || (step.placeholder && value === '')) {
            throw new Error('Missing input: ' + step.placeholder);
          }
          setNativeValue(el, String(value));
        } else if (step.kind === 'check') {
          const expected = step.value === 'true';
          if (el.checked !== expected) el.click();
        } else if (step.kind === 'submit') {
          if (typeof el.requestSubmit !== 'function') throw new Error('requestSubmit unavailable');
          post({ type: 'advance', next: i + 1 });
          el.requestSubmit();
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        // Persist a checkpoint BEFORE a click that might unload the page.
        post({ type: 'advance', next: i + 1 });
        if (step.kind === 'click') el.click();
        await new Promise(resolve => setTimeout(resolve, 160));
      } catch (e) {
        post({ type: 'replayError', index: i, message: String(e.message || e).slice(0, 220) });
        setMode('idle');
        return;
      }
    }
    post({ type: 'replayComplete' });
    setMode('idle');
  }

  // Read-only, allowlisted fingerprint. Never send the page's raw DOM, SSID,
  // password, MAC, serial number, cookies or arbitrary text to the native side.
  function probe() {
    const title = String(document.title || '').slice(0, 100);
    const visible = String(document.body?.innerText || '').slice(0, 18000);
    const combined = title + '\n' + visible;
    const c20 = /(?:Archer\s*C20\b|\bTP-Link\s+C20\b)/i.test(combined);
    const revision = c20 && /(?:Archer\s*C20\s*v5\b|(?:hardware\s+version|версия\s+устройства|апаратна\s+версія)[^\n]{0,90}\bv5\b)/i.test(combined) ? 'v5' : '';
    const build = c20 ? (combined.match(/\bBuild\s+(\d{6})\b/i) || [])[1] || '' : '';
    const detected = c20 ? 'Archer C20' : '';
    post({type:'deviceInfo', model:detected, revision, build,
      // This is a hint only; presence of a password field does not prove login state.
      passwordFieldVisible: !!document.querySelector('input[type="password"]') });
    return {model:detected, revision, build};
  }

  function stop() { replayGeneration++; setMode('idle'); }

  document.addEventListener('change', onChange, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  window.__RouterLabMobile = Object.freeze({ setMode, play, stop, probe });
  renderIndicator();
  post({ type: 'ready', path: location.pathname, title: document.title.slice(0, 100) });
  probe();
})();