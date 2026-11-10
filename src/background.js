import {
  normalizeSettings,
  normalizeSites,
  patternFor,
  sameList,
  siteKeyFromPattern,
  siteKeyFromUrl,
} from './lib/sites.js';
import { restorePageVisibility } from './lib/restore.js';

const ALARM = 'aot-tick';
const SCRIPT_KEEPALIVE = 'aot-keepalive';
const SCRIPT_VISIBILITY = 'aot-visibility';
const KEEPALIVE_FILE = 'src/content/keepalive.js';
const VISIBILITY_FILE = 'src/content/visibility.js';
const MESSAGE_TIMEOUT_MS = 10_000;
const BADGE_COLOR = '#2b2b2b';

// ---------------------------------------------------------------- state ---

async function readState() {
  const data = await chrome.storage.local.get(['sites', 'settings']);
  return { sites: normalizeSites(data.sites), settings: normalizeSettings(data.settings) };
}

/** Keeps only sites for which the user actually granted host access. */
async function grantedOnly(sites) {
  const checks = await Promise.all(
    sites.map((key) =>
      chrome.permissions.contains({ origins: [patternFor(key)] }).catch(() => false),
    ),
  );
  return sites.filter((_, i) => checks[i]);
}

// Serialise every state-changing operation to avoid racing registrations.
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task, task);
  queue = run.catch((err) => console.warn('[AlwaysOnlineTab]', err));
  return run;
}

// -------------------------------------------------------------- syncing ---

async function syncContentScripts(sites, settings) {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ours = registered
    .map((s) => s.id)
    .filter((id) => id === SCRIPT_KEEPALIVE || id === SCRIPT_VISIBILITY);
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
  if (!sites.length) return;

  const matches = sites.map(patternFor);
  const scripts = [
    {
      id: SCRIPT_KEEPALIVE,
      js: [KEEPALIVE_FILE],
      matches,
      allFrames: true,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ];
  if (settings.keepVisible) {
    scripts.push({
      id: SCRIPT_VISIBILITY,
      js: [VISIBILITY_FILE],
      matches,
      allFrames: true,
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: true,
    });
  }
  await chrome.scripting.registerContentScripts(scripts);
}

async function syncAlarm(sites, settings) {
  const existing = await chrome.alarms.get(ALARM);
  if (!sites.length) {
    if (existing) await chrome.alarms.clear(ALARM);
    return;
  }
  if (existing && existing.periodInMinutes === settings.intervalMinutes) return;
  await chrome.alarms.create(ALARM, {
    delayInMinutes: 0.5,
    periodInMinutes: settings.intervalMinutes,
  });
}

async function sync() {
  const state = await readState();
  const sites = await grantedOnly(state.sites);
  const stored = await chrome.storage.local.get('sites');
  if (!Array.isArray(stored.sites) || !sameList(sites, stored.sites)) {
    await chrome.storage.local.set({ sites });
  }
  await syncContentScripts(sites, state.settings);
  await syncAlarm(sites, state.settings);
  await refreshAllBadges(sites);
  return { sites, settings: state.settings };
}

// ------------------------------------------------------------- tab work ---

async function matchingTabs(sites) {
  if (!sites.length) return [];
  const wanted = new Set(sites);
  const tabs = await chrome.tabs.query({});
  // tab.url is only visible for hosts the user granted, so this is safe.
  return tabs
    .map((tab) => ({ tab, key: tab.url ? siteKeyFromUrl(tab.url) : null }))
    .filter(({ key }) => key && wanted.has(key));
}

async function injectInto(tabId, settings) {
  const target = { tabId, allFrames: true };
  if (settings.keepVisible) {
    await chrome.scripting
      .executeScript({ target, files: [VISIBILITY_FILE], world: 'MAIN' })
      .catch(() => {});
  }
  await chrome.scripting.executeScript({ target, files: [KEEPALIVE_FILE] }).catch(() => {});
}

async function stillEnabled(key) {
  return chrome.permissions.contains({ origins: [patternFor(key)] }).catch(() => false);
}

async function restoreVisibility(tabId) {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: restorePageVisibility })
    .catch(() => {});
}

async function protectTab(tab) {
  if (tab.autoDiscardable !== false) {
    await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function tick() {
  const { sites, settings } = await readState();
  const entries = await matchingTabs(sites);
  if (!entries.length) return;

  const pinged = new Set();
  const results = {};

  await Promise.all(
    entries.map(async ({ tab, key }) => {
      // The user may have disabled the site while this tick was running.
      if (!(await stillEnabled(key))) return;
      await protectTab(tab);
      const wantsPing = settings.serverPing && !pinged.has(key);
      if (wantsPing) pinged.add(key);

      let reply = null;
      if (!tab.discarded) {
        try {
          reply = await withTimeout(
            chrome.tabs.sendMessage(tab.id, {
              type: 'aot:tick',
              simulate: settings.simulateActivity,
              ping: wantsPing,
              intervalMs: settings.intervalMinutes * 60_000,
            }),
            MESSAGE_TIMEOUT_MS,
          );
        } catch (err) {
          // No receiver yet (tab opened before enabling) -> inject for next tick.
          if (!String(err?.message).includes('timeout') && (await stillEnabled(key))) {
            await injectInto(tab.id, settings);
          }
        }
      }

      // The request is only ever made from inside the page, with the page's
      // own cookies. There is deliberately no fallback from the service
      // worker: a request without the session cookie can make the server
      // issue a new session and log the user out.
      if (!wantsPing || !reply || typeof reply.ok !== 'boolean') return;
      results[key] = {
        at: Date.now(),
        ok: reply.ok,
        redirected: reply.redirected === true,
        code: Number.isInteger(reply.code) ? reply.code : 0,
      };
    }),
  );

  if (Object.keys(results).length) {
    const { status = {} } = await chrome.storage.session.get('status');
    await chrome.storage.session.set({ status: { ...status, ...results } });
  }
}

// --------------------------------------------------------------- badges ---

async function setBadge(tabId, on) {
  await chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' }).catch(() => {});
}

async function refreshAllBadges(sites) {
  const wanted = new Set(sites);
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => setBadge(tab.id, Boolean(tab.url && wanted.has(siteKeyFromUrl(tab.url))))),
  );
}

// ------------------------------------------------------------- listeners ---

async function init() {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' }).catch(() => {});
  return sync();
}

chrome.runtime.onInstalled.addListener(() => serial(init));
chrome.runtime.onStartup.addListener(() => serial(init));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) serial(tick);
});

// The popup may close while the permission prompt is open. It records the
// user's intent in session storage before asking, and only a grant that
// matches that intent enables the site. A host grant made elsewhere (for
// example from Chrome's extensions menu) never turns the feature on.
chrome.permissions.onAdded.addListener(({ origins = [] }) => {
  const added = origins.map(siteKeyFromPattern).filter(Boolean);
  if (!added.length) return;
  serial(async () => {
    const { pendingEnable } = await chrome.storage.session.get('pendingEnable');
    const intended = added.filter((key) => key === pendingEnable);
    if (!intended.length) return;
    await chrome.storage.session.remove('pendingEnable');
    const { sites } = await readState();
    await chrome.storage.local.set({ sites: normalizeSites([...sites, ...intended]) });
  });
});

chrome.permissions.onRemoved.addListener(({ origins = [] }) => {
  const removed = new Set(origins.map(siteKeyFromPattern).filter(Boolean));
  serial(async () => {
    const { sites } = await readState();
    const kept = sites.filter((k) => !removed.has(k));
    if (kept.length !== sites.length) await chrome.storage.local.set({ sites: kept });
    // Always resync: revoking a broad grant from Chrome's menu removes
    // access without naming our per-site patterns.
    await sync();
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.sites && !changes.settings)) return;
  serial(async () => {
    const beforeList = normalizeSites(changes.sites?.oldValue);
    const before = new Set(beforeList);
    const { sites, settings } = await sync();
    const fresh = changes.sites ? sites.filter((k) => !before.has(k)) : [];
    const gone = changes.sites ? beforeList.filter((k) => !sites.includes(k)) : [];
    const oldVisible = normalizeSettings(changes.settings?.oldValue).keepVisible;
    const newVisible = normalizeSettings(changes.settings?.newValue).keepVisible;
    const visibilityTurnedOn = Boolean(changes.settings) && newVisible && !oldVisible;
    const visibilityTurnedOff = Boolean(changes.settings) && !newVisible && oldVisible;

    // Undo the page patch where it no longer belongs (best effort: only
    // possible while host access is still held).
    const undo = visibilityTurnedOff ? [...sites, ...gone] : gone;
    for (const { tab } of await matchingTabs(undo)) await restoreVisibility(tab.id);

    const targets = visibilityTurnedOn ? sites : fresh;
    if (!targets.length) return;
    for (const { tab } of await matchingTabs(targets)) {
      await protectTab(tab);
      await injectInto(tab.id, settings);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  readState().then(({ sites }) => {
    const on = Boolean(tab.url && sites.includes(siteKeyFromUrl(tab.url)));
    setBadge(tabId, on);
    if (on) protectTab(tab);
  });
});

// This extension exposes no message API to web pages or other extensions.
