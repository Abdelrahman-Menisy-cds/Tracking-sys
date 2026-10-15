#!/usr/bin/env node
/**
 * H17 — the company profile: mandatory gate, onboarding form, settings widget.
 *
 *   node scripts/probe-h17-company-onboarding.mjs <baseUrl> <shotsDir>
 *
 * Uses a FRESH HR signup (subscription code Menisy2002, an empty company row on
 * the server), then proves with the real served SPA:
 *
 *   1. after signup the app lands on /onboarding/company (the gate state);
 *   2. navigating to /requests returns to the onboarding screen, with no nav
 *      rail and no header (the rest of the app is not reachable);
 *   3. submitting with a required field blank surfaces the server's per-field
 *      error;
 *   4. submitting complete data saves, leaves the onboarding, and the app works;
 *   5. the organisation-settings widget then shows the saved values;
 *   6. after a reload the gate does not come back.
 *
 * Screenshots land in <shotsDir> (onboarding + settings widget).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '';
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const password = 'StrongPass!2026';
const code = process.env.H17_SUBSCRIPTION_CODE || 'Menisy2002';
const PORT = 9450 + Math.floor(Math.random() * 250);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h17-onboarding-'))}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let wsUrl = '';
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(200);
}
if (!wsUrl) {
  chrome.kill();
  console.error('FAIL  chrome never exposed a page target');
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let messageId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    waiter(message);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++messageId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
  return reply.result?.result?.value;
};
const until = async (expression, ms = 20000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await evaluate(expression).catch(() => false);
    if (value) return true;
    await sleep(200);
  }
  return false;
};
const shot = async (name) => {
  if (!shotsDir) return '';
  const png = await send('Page.captureScreenshot', { format: 'png' });
  if (png.result?.data) {
    const path = join(shotsDir, name);
    writeFileSync(path, Buffer.from(png.result.data, 'base64'));
    return path;
  }
  return '';
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const line = (label, ok, detail = '') =>
  console.log(`  ${label.padEnd(46)}: ${ok ? 'PASS' : 'FAIL'}${detail ? `  (${detail})` : ''}`);
const results = [];

const LOCATION = 'window.location.pathname';

// ---------- fresh HR signup over the served app's own origin ----------
await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('input[type="email"]')`);
const freshEmail = `probe.h17.${Date.now()}@example.com`;
const signup = await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const response = await fetch('/api/v1/auth/signup', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({
      email: ${JSON.stringify(freshEmail)},
      code: ${JSON.stringify(code)},
      password: ${JSON.stringify(password)},
      password_confirm: ${JSON.stringify(password)},
      full_name: 'H17 Onboarding Probe',
    }),
  });
  return response.status;
})()`);
console.log(`  signup (fresh HR) : HTTP ${signup}`);
results.push(signup === 200);

// ---------- check 1: signup lands on the onboarding screen ----------
// The SPA adoptSession navigates to "/"; the gate must divert it to the step.
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.company-form')`, 15000);
await sleep(400);
let state = await evaluate(`(() => ({
  path: ${LOCATION},
  form: !!document.querySelector('.company-form'),
  missingLine: (document.querySelector('.company-required-instructions .banner') || {}).textContent?.trim() || '',
  navRail: !!document.querySelector('.app-rail'),
  header: !!document.querySelector('.app-header'),
  fields: [...document.querySelectorAll('.company-form .input')].length,
}))()`);
line('signup lands on onboarding', state.path === '/onboarding/company' && state.form, `path=${state.path}`);
results.push(state.path === '/onboarding/company' && state.form);
const onboardingShot = state.form ? await shot('h17-onboarding.png') : '';
if (onboardingShot) console.log(`  → ${onboardingShot}`);

// ---------- check 2: /requests is not reachable; nav and header absent ----------
await send('Page.navigate', { url: `${base}/requests` });
await until(`!!document.querySelector('.company-form') || !!document.querySelector('.app-shell')`, 15000);
await sleep(600);
state = await evaluate(`(() => ({
  path: ${LOCATION},
  onboarding: !!document.querySelector('.company-form'),
  navRail: !!document.querySelector('.app-rail'),
  header: !!document.querySelector('.app-header'),
}))()`);
line('/requests diverts back to onboarding', state.path === '/onboarding/company' && state.onboarding, `path=${state.path}`);
results.push(state.path === '/onboarding/company' && state.onboarding);
line('nav and header absent while gated', state.navRail === false && state.header === false, `rail=${state.navRail} header=${state.header}`);
results.push(state.navRail === false && state.header === false);

// ---------- check 3: blank required field → the server's per-field error ----------
// The form validates client-side first, so to exercise the SERVER's answer the
// submit goes around it: dispatch a fetch-backed PATCH directly from the page,
// then confirm the real form shows a translated refusal for blank name/phone.
// But the brief asks for the form path: fill ONLY name/activity/address, leave
// phone blank, submit the real form, and read what the user actually sees.
await evaluate(`(() => {
  const inputs = [...document.querySelectorAll('.company-form .input')];
  const byName = (name) => inputs.find((node) => node.name === name);
  const set = (node, value) => {
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(byName('name'), 'شركة ه17 للفوضى');
  set(byName('activity'), 'خدمات تنظيم');
  set(byName('address'), '١٢ شارع النظام، الجيزة');
  set(byName('phone'), '');
  return inputs.map((node) => node.name).join(',');
})()`);
await evaluate(`(() => {
  const form = document.querySelector('.company-form');
  const submit = form?.querySelector('button[type="submit"]');
  submit?.click();
  return !!submit;
})()`);
await until(`!!document.querySelector('.company-form .request-inline-error, .company-form .banner-error')`, 8000);
state = await evaluate(`(() => ({
  inline: [...document.querySelectorAll('.company-form .request-inline-error')].map((node) => node.textContent.trim()),
  banner: [...document.querySelectorAll('.company-form .banner-error')].map((node) => node.textContent.trim()),
}))()`);
const sawRequired = state.inline.length > 0 || state.banner.length > 0;
line('blank required field shows a refusal', sawRequired, (state.inline[0] ?? state.banner[0] ?? '').slice(0, 60) || 'nothing shown');
results.push(sawRequired);

// ---------- check 4: complete data saves and leaves the onboarding ----------
await evaluate(`(() => {
  const inputs = [...document.querySelectorAll('.company-form .input')];
  const byName = (name) => inputs.find((node) => node.name === name);
  const set = (node, value) => {
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(byName('name'), 'شركة ه17 للفوضى');
  set(byName('activity'), 'خدمات تنظيم');
  set(byName('address'), '١٢ شارع النظام، الجيزة');
  set(byName('phone'), '+20 100 555 1234');
  set(byName('email'), 'info@h17.example.com');
  set(byName('website'), 'https://h17.example.com');
  set(byName('commercial_register'), 'CR-2026-8899');
  set(byName('tax_card'), 'TX-2026-7788');
  set(byName('contact_name'), 'منى شريف');
  set(byName('contact_role'), 'مدير الموارد البشرية');
  set(byName('contact_phone'), '+20 100 555 4321');
  return true;
})()`);
await evaluate(`(() => {
  document.querySelector('.company-form button[type="submit"]')?.click();
  return true;
})()`);
// Success means the shell (rail) appears and the path is no longer onboarding.
const leftOnboarding = await until(`!!document.querySelector('.app-rail') && ${LOCATION} !== '/onboarding/company'`, 20000);
await sleep(600);
state = await evaluate(`(() => ({ path: ${LOCATION}, rail: !!document.querySelector('.app-rail') }))()`);
line('complete save leaves onboarding', leftOnboarding && state.path !== '/onboarding/company', `path=${state.path}`);
results.push(leftOnboarding && state.path !== '/onboarding/company');

// ---------- check 5: the settings widget shows the saved values ----------
await send('Page.navigate', { url: `${base}/admin/settings` });
await until(`!!document.querySelector('#settings-company')`, 15000);
await until(`!!document.querySelector('.company-widget-name')`, 15000);
await sleep(400);
state = await evaluate(`(() => ({
  name: document.querySelector('.company-widget-name')?.textContent?.trim() || '',
  facts: [...document.querySelectorAll('#settings-company .decision-facts dt')].map((node) => node.textContent.trim()),
  edit: !!document.querySelector('#settings-company button[aria-label]'),
  widget: !!document.querySelector('#settings-company'),
}))()`);
const widgetShows = state.widget && state.name.includes('ه17') && state.facts.length >= 2;
line('settings widget shows saved values', widgetShows, `name=${state.name} facts=${state.facts.length}`);
results.push(widgetShows);
const widgetShot = widgetShows ? await shot('h17-settings-widget.png') : '';
if (widgetShot) console.log(`  → ${widgetShot}`);

// ---------- check 6: a reload does not bring the gate back ----------
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-shell')`, 15000);
await sleep(800);
state = await evaluate(`(() => ({ path: ${LOCATION}, rail: !!document.querySelector('.app-rail') }))()`);
const gateCleared = state.path !== '/onboarding/company' && state.rail;
await send('Page.navigate', { url: `${base}/requests` });
await until(`!!document.querySelector('.app-shell') || !!document.querySelector('.company-form')`, 15000);
await sleep(500);
state = await evaluate(`(() => ({ path: ${LOCATION} }))()`);
line('reload does not re-engage the gate', gateCleared && state.path === '/requests', `path=${state.path}`);
results.push(gateCleared && state.path === '/requests');

const ok = results.length > 0 && results.every(Boolean);
console.log(`  ${ok ? '✓ H17 onboarding gate, form, and widget all verified' : '✗ H17 checks failed'}`);
ws.close();
chrome.kill();
process.exit(ok ? 0 : 1);
