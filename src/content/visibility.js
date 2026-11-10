// Runs in the page's MAIN world on sites the user enabled.
// Makes the page believe it is always visible and focused, so idle timers
// that pause or log out on hidden/background tabs do not fire.
// It has no access to extension APIs and sends nothing anywhere.
//
// Fail-closed teardown: the patch only stays while the extension's isolated
// content script keeps sending heartbeats. If they stop (site disabled,
// access revoked, extension removed) it removes itself. It also removes
// itself on an explicit restore event. No function is exposed on window.
(() => {
  const MARKER = Symbol.for('mssoft.alwaysOnlineTab.visibility');
  if (window[MARKER]) return; // already patched in this document
  try {
    Object.defineProperty(window, MARKER, { configurable: true, value: true });
  } catch {
    return;
  }

  const MIN_GAP_MS = 2 * 60_000;
  const MAX_GAP_MS = 30 * 60_000;
  let allowedGap = MAX_GAP_MS;
  let lastBeat = Date.now();

  const saved = [];
  const patch = (proto, prop, descriptor) => {
    const previous = Object.getOwnPropertyDescriptor(proto, prop);
    try {
      Object.defineProperty(proto, prop, { configurable: true, ...descriptor });
      saved.push([proto, prop, previous]);
    } catch {
      /* property not configurable in this browser: ignore */
    }
  };

  patch(Document.prototype, 'hidden', { enumerable: true, get: () => false });
  patch(Document.prototype, 'webkitHidden', { enumerable: true, get: () => false });
  patch(Document.prototype, 'visibilityState', { enumerable: true, get: () => 'visible' });
  patch(Document.prototype, 'webkitVisibilityState', { enumerable: true, get: () => 'visible' });
  patch(Document.prototype, 'hasFocus', {
    writable: true,
    value: function hasFocus() {
      return true;
    },
  });

  // Swallow page-level visibility/blur notifications only. Element-level
  // blur events (form validation etc.) are left untouched.
  const TYPES = ['visibilitychange', 'webkitvisibilitychange', 'blur'];
  const swallow = (event) => {
    if (event.target === document || event.target === window) {
      event.stopImmediatePropagation();
    }
  };
  for (const type of TYPES) window.addEventListener(type, swallow, true);

  const onBeat = (event) => {
    lastBeat = Date.now();
    const interval = Number(event.detail);
    if (Number.isFinite(interval) && interval > 0) {
      allowedGap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, interval * 3));
    }
  };

  let timer = 0;
  const restore = () => {
    for (const [proto, prop, previous] of saved.reverse()) {
      try {
        if (previous) Object.defineProperty(proto, prop, previous);
        else delete proto[prop];
      } catch {
        /* ignore */
      }
    }
    saved.length = 0;
    for (const type of TYPES) window.removeEventListener(type, swallow, true);
    document.removeEventListener('mssoft-aot-heartbeat', onBeat);
    document.removeEventListener('mssoft-aot-restore', restore);
    clearInterval(timer);
    delete window[MARKER];
  };

  document.addEventListener('mssoft-aot-heartbeat', onBeat);
  document.addEventListener('mssoft-aot-restore', restore);
  timer = setInterval(() => {
    if (Date.now() - lastBeat > allowedGap) restore();
  }, 30_000);
})();
