// Runs in the page's MAIN world on sites the user enabled.
// Makes the page believe it is always visible and focused, so idle timers
// that pause or log out on hidden/background tabs do not fire.
// It has no access to extension APIs and sends nothing anywhere.
// The patch is reversible: the extension calls the restore hook when the
// site or the "keep tab visible" option is turned off.
(() => {
  const RESTORE = Symbol.for('mssoft.alwaysOnlineTab.restoreVisibility');
  if (typeof window[RESTORE] === 'function') return; // already patched

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

  Object.defineProperty(window, RESTORE, {
    configurable: true,
    value: () => {
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
      delete window[RESTORE];
    },
  });
})();
