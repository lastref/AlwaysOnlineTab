// Runs in the page's MAIN world on sites the user enabled.
// Makes the page believe it is always visible and focused, so idle timers
// that pause or log out on hidden/background tabs do not fire.
// It has no access to extension APIs and sends nothing anywhere.
(() => {
  const define = (proto, prop, getter) => {
    try {
      Object.defineProperty(proto, prop, { configurable: true, enumerable: true, get: getter });
    } catch {
      /* property not configurable in this browser: ignore */
    }
  };

  define(Document.prototype, 'hidden', () => false);
  define(Document.prototype, 'webkitHidden', () => false);
  define(Document.prototype, 'visibilityState', () => 'visible');
  define(Document.prototype, 'webkitVisibilityState', () => 'visible');

  try {
    Document.prototype.hasFocus = function hasFocus() {
      return true;
    };
  } catch {
    /* ignore */
  }

  // Swallow page-level visibility/blur notifications only. Element-level
  // blur events (form validation etc.) are left untouched.
  const swallow = (event) => {
    if (event.target === document || event.target === window) {
      event.stopImmediatePropagation();
    }
  };
  for (const type of ['visibilitychange', 'webkitvisibilitychange', 'blur']) {
    window.addEventListener(type, swallow, true);
  }
})();
