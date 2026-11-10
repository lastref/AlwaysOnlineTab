import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SETTINGS,
  hostOf,
  isValidSiteKey,
  normalizeSettings,
  normalizeSites,
  patternFor,
  pingUrlFor,
  siteKeyFromPattern,
  siteKeyFromUrl,
} from '../src/lib/sites.js';

test('siteKeyFromUrl accepts http(s) only and drops port/path', () => {
  assert.equal(siteKeyFromUrl('https://app.example.com/a/b?x=1#y'), 'https://app.example.com');
  assert.equal(siteKeyFromUrl('http://intranet.local:8080/login'), 'http://intranet.local');
  assert.equal(siteKeyFromUrl('http://[::1]:3000/'), 'http://[::1]');
  for (const bad of [
    'chrome://extensions',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'chrome-extension://abc/popup.html',
    'not a url',
    '',
    null,
    42,
    `https://a.com/${'x'.repeat(5000)}`,
  ]) {
    assert.equal(siteKeyFromUrl(bad), null, String(bad).slice(0, 40));
  }
});

test('site keys and patterns round-trip', () => {
  const key = 'https://example.com';
  assert.ok(isValidSiteKey(key));
  assert.equal(patternFor(key), 'https://example.com/*');
  assert.equal(siteKeyFromPattern(patternFor(key)), key);
  assert.equal(hostOf(key), 'example.com');
});

test('invalid site keys are rejected', () => {
  for (const bad of ['https://example.com/', 'https://*.example.com', 'ftp://x.com', 'example.com', 'https://a.com/path', {}]) {
    assert.equal(isValidSiteKey(bad), false, String(bad));
  }
  assert.throws(() => patternFor('https://*/'));
  assert.equal(siteKeyFromPattern('https://*/*'), null);
  assert.equal(siteKeyFromPattern('<all_urls>'), null);
  assert.equal(siteKeyFromPattern('https://*.example.com/*'), null);
});

test('normalizeSites dedupes, filters and sorts', () => {
  assert.deepEqual(
    normalizeSites(['https://b.com', 'https://a.com', 'https://b.com', 'bad', 7, 'https://x.com/']),
    ['https://a.com', 'https://b.com'],
  );
  assert.deepEqual(normalizeSites('nope'), []);
  const many = Array.from({ length: 500 }, (_, i) => `https://s${i}.com`);
  assert.equal(normalizeSites(many).length, 200);
});

test('normalizeSettings falls back to safe defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ intervalMinutes: 0.01, keepVisible: 'yes' }), DEFAULT_SETTINGS);
  assert.deepEqual(
    normalizeSettings({ version: 2, intervalMinutes: 5, simulateActivity: false, keepVisible: false, serverPing: true }),
    { version: 2, intervalMinutes: 5, simulateActivity: false, keepVisible: false, serverPing: true },
  );
  assert.equal(normalizeSettings({ intervalMinutes: '2' }).intervalMinutes, 2);
});


test('wildcard and odd hosts never become site keys', () => {
  for (const bad of ['https://*.example.com/', 'https://*/', 'http://a*b.com/', 'https://-bad.com/', 'https://a..b/']) {
    assert.equal(siteKeyFromUrl(bad), null, bad);
  }
  assert.equal(siteKeyFromUrl('https://xn--bcher-kva.example/'), 'https://xn--bcher-kva.example');
  assert.equal(siteKeyFromUrl('https://bücher.example/'), 'https://xn--bcher-kva.example');
  assert.equal(siteKeyFromUrl('http://192.168.1.10:8443/app'), 'http://192.168.1.10');
  assert.equal(siteKeyFromUrl('http://my_host/'), 'http://my_host');
});

test('pingUrlFor always targets the site root', () => {
  for (const input of [
    'https://a.com/logout',
    'https://a.com/%6C%6F%67%6F%75%74',
    'https://a.com/x/LogOutNow',
    'https://a.com/invite/AbCdEf0123456789',
    'https://a.com/users/42/delete?confirm=1',
    'https://a.com/oauth/callback?code=secret#frag',
    'https://a.com/dashboard',
  ]) {
    assert.equal(pingUrlFor(input), 'https://a.com/', input);
  }
  assert.equal(pingUrlFor('http://h.local:8080/app/'), 'http://h.local:8080/');
  assert.equal(pingUrlFor('chrome://settings'), null);
});

test('server ping is off by default and reset for settings saved before v2', () => {
  assert.equal(DEFAULT_SETTINGS.serverPing, false);
  assert.equal(normalizeSettings({ intervalMinutes: 1, serverPing: true }).serverPing, false);
  assert.equal(normalizeSettings({ version: 1, serverPing: true }).serverPing, false);
  assert.equal(normalizeSettings({ version: 2, serverPing: true }).serverPing, true);
});
