// Runs in the extension's isolated world on sites the user enabled.
// It only reacts to messages coming from this extension's service worker.
(() => {
  if (globalThis.__alwaysOnlineTabLoaded) return;
  globalThis.__alwaysOnlineTabLoaded = true;

  const isTop = window === window.top;
  const FETCH_TIMEOUT_MS = 20_000;

  function simulateActivity() {
    const target = document.body || document.documentElement;
    if (!target) return;

    const x = Math.round(window.innerWidth / 2 + (Math.random() * 6 - 3));
    const y = Math.round(window.innerHeight / 2 + (Math.random() * 6 - 3));
    const mouse = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };

    target.dispatchEvent(
      new PointerEvent('pointermove', { ...mouse, pointerType: 'mouse', isPrimary: true }),
    );
    target.dispatchEvent(new MouseEvent('mousemove', mouse));

    // A lone Shift press produces no input and triggers no shortcuts.
    const key = { bubbles: true, cancelable: true, composed: true, key: 'Shift', code: 'ShiftLeft' };
    document.dispatchEvent(new KeyboardEvent('keydown', { ...key, shiftKey: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', key));

    window.dispatchEvent(new Event('scroll'));
  }

  // Always the site root: the page's own path is never re-requested, so no
  // action or one-time link can be replayed.
  async function ping() {
    const url = `${location.origin}/`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      res.body?.cancel().catch(() => {});
      // A redirect usually means "go to the login page": report it as such.
      if (res.type === 'opaqueredirect') return { ok: false, code: 0, redirected: true };
      return { ok: res.ok, code: res.status };
    } catch {
      return { ok: false, code: 0 };
    }
  }

  document.dispatchEvent(new CustomEvent('mssoft-aot-heartbeat', { detail: 0 }));

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Accept only the service worker of this very extension.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (!message || message.type !== 'aot:tick') return false;

    // Heartbeat for the MAIN-world visibility patch: without it the patch
    // removes itself (e.g. after the user revokes access).
    const intervalMs = Number.isFinite(message.intervalMs) ? message.intervalMs : 0;
    document.dispatchEvent(new CustomEvent('mssoft-aot-heartbeat', { detail: intervalMs }));

    if (message.simulate === true) simulateActivity();
    if (!isTop) return false;

    if (message.ping !== true) {
      sendResponse({ ok: true, code: 0, skipped: true });
      return false;
    }
    ping().then(sendResponse);
    return true;
  });
})();
