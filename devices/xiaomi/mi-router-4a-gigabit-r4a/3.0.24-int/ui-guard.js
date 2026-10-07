(() => {
  'use strict';

  const unsupported = [
    {
      test: /\/web\/(?:pro)?setting\/qos(?:\/|$|\?)/i,
      label: 'RouterLab: unavailable in emulator'
    }
  ];

  function matchUnsupported(href) {
    return unsupported.find((item) => item.test.test(href || '')) || null;
  }

  function disableLink(a, rule) {
    if (!a || a.dataset.routerlabDisabled === '1') return;
    a.dataset.routerlabDisabled = '1';
    a.setAttribute('aria-disabled', 'true');
    a.setAttribute('title', rule.label);
    a.style.pointerEvents = 'none';
    a.style.cursor = 'not-allowed';
    a.style.opacity = '0.42';
    a.style.filter = 'grayscale(1)';

    const parent = a.closest('li, td');
    if (parent) {
      parent.style.opacity = '0.55';
      parent.style.cursor = 'not-allowed';
      parent.setAttribute('title', rule.label);
    }
  }

  function apply() {
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const rule = matchUnsupported(href);
      if (rule) disableLink(a, rule);
    });
  }

  document.addEventListener('click', (event) => {
    const a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a) return;
    const rule = matchUnsupported(a.getAttribute('href') || '');
    if (!rule) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();