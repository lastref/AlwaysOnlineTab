// End-to-end check with a real Chromium (Chrome for Testing via puppeteer).
// Usage: npm i --no-save puppeteer && node test/e2e/run.js
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_TTL_MS = 45_000;
const CLIENT_IDLE_MS = 40_000;
const WAIT_MS = 110_000;
const SHOTS = process.env.SHOTS_DIR;

// Test copy of the extension: host access for 127.0.0.1 is pre-granted so no
// permission prompt is needed. "localhost" stays NOT granted (control group).
const ext = mkdtempSync(path.join(tmpdir(), 'aot-ext-'));
for (const p of ['manifest.json', 'src', '_locales', 'icons']) cpSync(path.join(ROOT, p), path.join(ext, p), { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

const server = await startServer({ serverTtlMs: SERVER_TTL_MS, clientIdleMs: CLIENT_IDLE_MS });
const port = server.address().port;
const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  enableExtensions: [ext],
  args: ['--no-first-run', '--lang=tr'],
});

let failed = false;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed = true;
};

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'));
  const sw = await swTarget.worker();
  for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.chrome?.storage?.local))); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('sw apis:', await sw.evaluate(() => Object.keys(globalThis.chrome || {}).sort().join(',')));
  await sw.evaluate(() =>
    chrome.storage.local.set({
      sites: ['http://127.0.0.1'],
      settings: { intervalMinutes: 0.5, simulateActivity: true, keepVisible: true, serverPing: true },
    }),
  );
  await new Promise((r) => setTimeout(r, 1000));
  const registered = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id)));
  check(registered.includes('aot-keepalive') && registered.includes('aot-visibility'), `content scripts registered: ${registered}`);

  const protectedPage = await browser.newPage();
  await protectedPage.goto(`http://127.0.0.1:${port}/login?label=protected`);
  const controlPage = await browser.newPage();
  await controlPage.goto(`http://localhost:${port}/login?label=control`);

  const hidden = await protectedPage.evaluate(() => [document.hidden, document.visibilityState]);
  check(hidden[0] === false && hidden[1] === 'visible', `protected page sees visible: ${hidden}`);

  console.log(`waiting ${WAIT_MS / 1000}s (server ttl ${SERVER_TTL_MS / 1000}s, client idle ${CLIENT_IDLE_MS / 1000}s)...`);
  await new Promise((r) => setTimeout(r, WAIT_MS));

  const state = await (await fetch(`http://127.0.0.1:${port}/debug`)).json();
  console.log(JSON.stringify(state));
  check(state.protected?.alive === true && !state.protected.clientLogout, 'protected session still alive');
  check(state.control?.alive === false, 'control session expired (proves the test app logs out)');
  check((await protectedPage.$eval('#state', (e) => e.textContent)) === 'logged in', 'protected page still shows logged in');
  check(protectedPage.url().endsWith('/app'), `protected page url ${protectedPage.url()}`);

  const discardable = await sw.evaluate(() => chrome.tabs.query({ url: 'http://127.0.0.1/*' }).then((t) => t.map((x) => x.autoDiscardable)));
  check(discardable.length > 0 && discardable.every((d) => d === false), `tab auto-discard disabled: ${discardable}`);

  const status = await sw.evaluate(() => chrome.storage.session.get('status'));
  check(status.status?.['http://127.0.0.1']?.ok === true, `ping status recorded: ${JSON.stringify(status.status)}`);

  const isNative = () =>
    Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get.toString().includes('[native code]');
  check((await protectedPage.evaluate(isNative)) === false, 'visibility patch active while enabled');
  await sw.evaluate(() =>
    chrome.storage.local.get('settings').then(({ settings }) =>
      chrome.storage.local.set({ settings: { ...settings, keepVisible: false } }),
    ),
  );
  await new Promise((r) => setTimeout(r, 1500));
  check((await protectedPage.evaluate(isNative)) === true, 'visibility patch reverted when option turned off');
  const ids = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id)));
  check(!ids.includes('aot-visibility'), `visibility script unregistered: ${ids}`);

  if (SHOTS) {
    await protectedPage.bringToFront();
    await sw.evaluate(() => chrome.action.openPopup());
    const popupTarget = await browser.waitForTarget((t) => t.url().endsWith('/popup/popup.html'), { timeout: 5000 });
    const popup = await popupTarget.asPage();
    await new Promise((r) => setTimeout(r, 500));
    await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await popup.screenshot({ path: path.join(SHOTS, 'popup-light.png') });
    await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await popup.screenshot({ path: path.join(SHOTS, 'popup-dark.png') });
    console.log(`screenshots in ${SHOTS}`);
  }
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await browser.close();
  server.close();
  rmSync(ext, { recursive: true, force: true });
}

console.log(failed ? 'E2E FAILED' : 'E2E PASSED');
process.exit(failed ? 1 : 0);
