// Pure helpers shared by the service worker and the popup.
// No chrome.* calls here so the logic can be unit tested in Node.

export const INTERVAL_CHOICES = Object.freeze([0.5, 1, 2, 3, 5, 10]);
export const MAX_SITES = 200;

const HOSTNAME_RE = /^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.)*[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$|^\[[0-9a-f:.]+\]$/;

export const DEFAULT_SETTINGS = Object.freeze({
  intervalMinutes: 1,
  simulateActivity: true,
  keepVisible: true,
  serverPing: true,
});

/**
 * Returns the site key ("scheme://hostname") for an http(s) URL, or null.
 * The port is intentionally ignored because Chrome match patterns cannot
 * express a single port; a site key therefore covers every port of a host.
 */
export function siteKeyFromUrl(url) {
  if (typeof url !== 'string' || url.length > 4096) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  // Reject wildcards and anything else that is not a plain host name or IP,
  // so a site key can never turn into a broad match pattern.
  if (!HOSTNAME_RE.test(parsed.hostname)) return null;
  return `${parsed.protocol}//${parsed.hostname}`;
}

export function isValidSiteKey(value) {
  return typeof value === 'string' && siteKeyFromUrl(`${value}/`) === value;
}

/** Chrome match pattern for a site key. */
export function patternFor(siteKey) {
  if (!isValidSiteKey(siteKey)) throw new TypeError('Invalid site key');
  return `${siteKey}/*`;
}

/** Inverse of patternFor; returns null for anything we did not request. */
export function siteKeyFromPattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.endsWith('/*')) return null;
  const key = pattern.slice(0, -2);
  if (key.includes('*')) return null;
  return isValidSiteKey(key) ? key : null;
}

export function hostOf(siteKey) {
  return isValidSiteKey(siteKey) ? new URL(`${siteKey}/`).host : '';
}

export function normalizeSites(raw) {
  if (!Array.isArray(raw)) return [];
  const unique = new Set();
  for (const item of raw) {
    if (isValidSiteKey(item)) unique.add(item);
    if (unique.size >= MAX_SITES) break;
  }
  return [...unique].sort();
}

export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const interval = Number(src.intervalMinutes);
  return {
    intervalMinutes: INTERVAL_CHOICES.includes(interval)
      ? interval
      : DEFAULT_SETTINGS.intervalMinutes,
    simulateActivity:
      typeof src.simulateActivity === 'boolean'
        ? src.simulateActivity
        : DEFAULT_SETTINGS.simulateActivity,
    keepVisible:
      typeof src.keepVisible === 'boolean' ? src.keepVisible : DEFAULT_SETTINGS.keepVisible,
    serverPing:
      typeof src.serverPing === 'boolean' ? src.serverPing : DEFAULT_SETTINGS.serverPing,
  };
}

/**
 * URL used for the keep-alive request: same origin and path, but without
 * query string or fragment, so one-time links (OAuth callbacks, magic links,
 * "?action=..." URLs) are never replayed.
 */
export function pingUrlFor(url) {
  if (!siteKeyFromUrl(url)) return null;
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/** Interprets a fetch() Response made with redirect: 'manual'. */
export function pingResult(res) {
  if (res.type === 'opaqueredirect') return { ok: true, code: 0 };
  return { ok: res.ok, code: res.status };
}

export function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
