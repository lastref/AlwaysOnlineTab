import {
  INTERVAL_CHOICES,
  hostOf,
  normalizeSettings,
  normalizeSites,
  patternFor,
  siteKeyFromUrl,
} from '../lib/sites.js';
import { restorePageVisibility } from '../lib/restore.js';

const $ = (id) => document.getElementById(id);
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const uiLang = chrome.i18n.getUILanguage();
const timeFormat = new Intl.DateTimeFormat(uiLang, { hour: '2-digit', minute: '2-digit' });

let currentKey = null;

function applyI18n() {
  document.documentElement.lang = uiLang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
}

function intervalLabel(minutes) {
  return minutes < 1
    ? t('seconds', [String(Math.round(minutes * 60))])
    : t('minutes', [String(minutes)]);
}

async function readState() {
  const local = await chrome.storage.local.get(['sites', 'settings']);
  const session = await chrome.storage.session.get('status').catch(() => ({}));
  return {
    sites: normalizeSites(local.sites),
    settings: normalizeSettings(local.settings),
    status: session.status && typeof session.status === 'object' ? session.status : {},
  };
}

function statusText(enabled, entry) {
  if (!enabled) return { text: t('statusOff'), warn: false };
  if (!entry || typeof entry.at !== 'number') return { text: t('statusWaiting'), warn: false };
  const time = timeFormat.format(new Date(entry.at));
  if (entry.ok) return { text: t('statusOk', [time]), warn: false };
  const code = entry.code ? `HTTP ${entry.code}` : t('networkError');
  return { text: t('statusFailed', [time, code]), warn: true };
}

function renderSites(sites) {
  const list = $('sites');
  list.replaceChildren();
  for (const key of sites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = hostOf(key);
    name.title = key;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = t('remove');
    remove.addEventListener('click', () => disableSite(key));
    li.append(name, remove);
    list.append(li);
  }
  $('count').textContent = sites.length ? `(${sites.length})` : '';
  $('empty').hidden = sites.length > 0;
}

async function render() {
  const { sites, settings, status } = await readState();
  const toggle = $('toggle');

  if (currentKey) {
    const enabled = sites.includes(currentKey);
    $('host').textContent = hostOf(currentKey);
    toggle.disabled = false;
    toggle.checked = enabled;
    const s = statusText(enabled, status[currentKey]);
    $('status').textContent = s.text;
    $('status').classList.toggle('warn', s.warn);
  } else {
    $('host').textContent = t('unsupportedPage');
    $('status').textContent = t('unsupportedHint');
    toggle.disabled = true;
    toggle.checked = false;
  }

  $('interval').value = String(settings.intervalMinutes);
  $('simulateActivity').checked = settings.simulateActivity;
  $('keepVisible').checked = settings.keepVisible;
  $('serverPing').checked = settings.serverPing;
  renderSites(sites);
}

async function enableSite(key) {
  // Record the user's intent first (not awaited) so the service worker can
  // finish enabling even if this popup closes during the permission prompt.
  const intent = chrome.storage.session.set({ pendingEnable: key });
  // Must be the first await so it stays inside the user gesture.
  const granted = await chrome.permissions.request({ origins: [patternFor(key)] });
  await intent.catch(() => {});
  if (!granted) {
    await chrome.storage.session.remove('pendingEnable').catch(() => {});
    return;
  }
  const { sites } = await readState();
  await chrome.storage.local.set({ sites: normalizeSites([...sites, key]) });
  await chrome.storage.session.remove('pendingEnable').catch(() => {});
}

async function disableSite(key) {
  // Give Chrome back the right to discard these tabs while we can still see them.
  // Undo every page change while host access is still held.
  const tabs = await chrome.tabs.query({ url: patternFor(key) }).catch(() => []);
  await Promise.all(
    tabs.map((tab) =>
      Promise.all([
        chrome.tabs.update(tab.id, { autoDiscardable: true }).catch(() => {}),
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id, allFrames: true },
            world: 'MAIN',
            func: restorePageVisibility,
          })
          .catch(() => {}),
      ]),
    ),
  );
  const { sites } = await readState();
  await chrome.storage.local.set({ sites: sites.filter((k) => k !== key) });
  await chrome.permissions.remove({ origins: [patternFor(key)] }).catch(() => {});
}

async function saveSettings() {
  const settings = normalizeSettings({
    intervalMinutes: Number($('interval').value),
    simulateActivity: $('simulateActivity').checked,
    keepVisible: $('keepVisible').checked,
    serverPing: $('serverPing').checked,
  });
  await chrome.storage.local.set({ settings });
}

async function init() {
  applyI18n();

  const select = $('interval');
  for (const minutes of INTERVAL_CHOICES) {
    const option = document.createElement('option');
    option.value = String(minutes);
    option.textContent = intervalLabel(minutes);
    select.append(option);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentKey = tab?.url ? siteKeyFromUrl(tab.url) : null;

  $('toggle').addEventListener('change', (event) => {
    if (!currentKey) return;
    const action = event.target.checked ? enableSite(currentKey) : disableSite(currentKey);
    action.catch(() => {}).finally(render);
  });
  for (const id of ['interval', 'simulateActivity', 'keepVisible', 'serverPing']) {
    $(id).addEventListener('change', () => saveSettings().finally(render));
  }
  chrome.storage.onChanged.addListener(() => render());

  await render();
}

init();
