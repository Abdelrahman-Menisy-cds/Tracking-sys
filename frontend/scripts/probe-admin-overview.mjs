#!/usr/bin/env node
/**
 * Drives the HR «نظرة عامة» tab (route /admin) over CDP and prints what it
 * ACTUALLY renders - never what it should:
 *
 *   1. the real day: the snapshot card's date + schedule in force, the
 *      per-state counts from the summary strip, and every employee row;
 *   2. the failure path: the snapshot read is blocked at the network layer, so
 *      the page must show a real error with a retry - and, once the block is
 *      lifted, the retry must actually re-read and paint the table;
 *   3. the same page in English + dark, to prove direction and theme.
 *
 * A throwaway Chrome profile, Node's global WebSocket, no npm packages.
 *   node scripts/probe-admin-overview.mjs [baseUrl] [outDir]
 * Login is the demo HR account; override with PROBE_EMAIL / PROBE_PASSWORD.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '');
const outDir = process.argv[3] ?? '/tmp/admin-overview-proof';
const EMAIL = process.env.PROBE_EMAIL ?? 'hr@demo.local';
const PASSWORD = process.env.PROBE_PASSWORD ?? 'demo1234';
const PORT = 9401 + Math.floor(Math.random() * 120);

mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'probe-admin-'))}`,
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
    if (page) {
      wsUrl = page.webSocketDebuggerUrl;
      break;
    }
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
await new Promise((resolve) => {
  const done = () => (ws.readyState === WebSocket.OPEN ? resolve() : setTimeout(done, 50));
  done();
});

let messageId = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
  }
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
const waitFor = async (expression, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const value = await evaluate(expression).catch(() => false);
    if (value) return value;
    await sleep(250);
  }
  return false;
};
const shot = async (name) => {
  const reply = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (!reply.result?.data) return null;
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(reply.result.data, 'base64'));
  return file;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

/* --- sign in for real (session cookie on this origin), then open /admin --- */
await send('Page.navigate', { url: `${base}/login` });
await waitFor('!!document.querySelector("form")');
const loginStatus = await evaluate(`(async () => {
  const csrf = await (await fetch('/api/v1/auth/csrf', { credentials: 'include' })).json();
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf.data.csrftoken },
    body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} }),
  });
  return response.status;
})()`);
console.log(`login: HTTP ${loginStatus}`);

/* What the page renders, as text. */
const READ_STATE = `(() => {
  const text = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : null);
  const card = document.querySelector('.page .work-surface');
  return {
    heading: text(card && card.querySelector('.section-heading h2')),
    meta: text(card && card.querySelector('.page-meta')),
    summary: [...document.querySelectorAll('.page .summary-item')].map((el) => ({
      label: text(el.querySelector('.summary-label')),
      value: text(el.querySelector('.summary-value')),
    })),
    caption: text(document.querySelector('.table-caption')),
    columns: [...document.querySelectorAll('.table-wrap thead th')].map((th) => th.textContent.trim()),
    rows: [...document.querySelectorAll('.table-wrap tbody tr')].map((tr) =>
      [...tr.querySelectorAll('th,td')].map((cell) => cell.textContent.replace(/\\s+/g, ' ').trim())),
    historyLink: text(document.querySelector('.page a[href="/attendance/history"]')),
    scopeNote: text(document.querySelector('.page .banner-info')),
    error: text(document.querySelector('.error-region p')),
    retry: text(document.querySelector('.error-region button')),
    empty: text(document.querySelector('.empty-region p')),
    dir: document.documentElement.dir,
    theme: document.documentElement.dataset.theme || '(unset)',
    staleBanner: !!document.body.textContent.includes('لا توجد نقطة نهاية للحضور'),
  };
})()`;

const openAdmin = async () => {
  await send('Page.navigate', { url: `${base}/admin` });
  await waitFor('!!document.querySelector(".page-header") && !document.querySelector(".skeleton-row")');
  await sleep(400);
};

/* --- 1. the real day --- */
await openAdmin();
const live = await evaluate(READ_STATE);
const liveShot = await shot('overview-ar-light');
console.log('\n=== 1. /admin live (ar, light) ===');
console.log(`  heading     : ${live.heading}`);
console.log(`  day+schedule: ${live.meta}`);
console.log(`  scope note  : ${live.scopeNote}`);
console.log(`  counts      : ${live.summary.map((s) => `${s.label}=${s.value}`).join('  ')}`);
console.log(`  table caption: ${live.caption}`);
console.log(`  columns     : ${live.columns.join(' | ')}`);
console.log(`  rows        : ${live.rows.length}`);
for (const row of live.rows.slice(0, 4)) console.log(`     · ${row.join(' | ')}`);
if (live.rows.length > 4) console.log(`     · … ${live.rows.length - 4} more`);
console.log(`  history link: ${live.historyLink}`);
console.log(`  empty state : ${live.empty}`);
console.log(`  dir/theme   : ${live.dir} / ${live.theme}`);
console.log(`  stale banner present: ${live.staleBanner}`);
console.log(`  screenshot  : ${liveShot}`);

/* --- 2. the read fails: a real error with a retry, then the retry recovers --- */
await send('Network.setBlockedURLs', { urls: ['*attendance/snapshot*'] });
await openAdmin();
const failed = await evaluate(READ_STATE);
const failedShot = await shot('overview-ar-light-error');
console.log('\n=== 2. snapshot read blocked (ar, light) ===');
console.log(`  error       : ${failed.error}`);
console.log(`  retry button: ${failed.retry}`);
console.log(`  rows rendered: ${failed.rows.length}  (must be 0 - no invented empty day)`);
console.log(`  stale banner present: ${failed.staleBanner}`);
console.log(`  screenshot  : ${failedShot}`);

await send('Network.setBlockedURLs', { urls: [] });
await evaluate('document.querySelector(".error-region button").click()');
const recovered = await waitFor('!!document.querySelector(".table-wrap tbody tr")');
const afterRetry = await evaluate(READ_STATE);
console.log('\n=== 2b. retry clicked, block lifted ===');
console.log(`  recovered   : ${Boolean(recovered)}`);
console.log(`  counts      : ${afterRetry.summary.map((s) => `${s.label}=${s.value}`).join('  ')}`);
console.log(`  rows        : ${afterRetry.rows.length}`);
console.log(`  error gone  : ${afterRetry.error === null}`);

/* --- 3. English + dark: direction and theme --- */
await evaluate('window.localStorage.setItem("tracking-sys.locale", "en")');
/* The app's appearance is its own stored preference (default light), not the
   OS media query - so dark has to be asked for the way a user asks for it. */
await evaluate('window.localStorage.setItem("tracking-sys.appearance", "dark")');
await openAdmin();
const english = await evaluate(READ_STATE);
const englishShot = await shot('overview-en-dark');
console.log('\n=== 3. /admin (en, dark) ===');
console.log(`  heading     : ${english.heading}`);
console.log(`  day+schedule: ${english.meta}`);
console.log(`  counts      : ${english.summary.map((s) => `${s.label}=${s.value}`).join('  ')}`);
console.log(`  columns     : ${english.columns.join(' | ')}`);
console.log(`  row sample  : ${(english.rows[0] ?? []).join(' | ')}`);
console.log(`  rows        : ${english.rows.length}`);
console.log(`  dir/theme   : ${english.dir} / ${english.theme}`);
console.log(`  screenshot  : ${englishShot}`);

if (consoleErrors.length) console.log(`\nconsole errors: ${consoleErrors.slice(0, 5).join(' | ')}`);

const ok =
  live.rows.length > 0 &&
  live.summary.length === 5 &&
  !live.staleBanner &&
  failed.error !== null &&
  failed.retry !== null &&
  failed.rows.length === 0 &&
  !failed.staleBanner &&
  Boolean(recovered) &&
  afterRetry.rows.length === live.rows.length &&
  english.dir === 'ltr';
console.log(`\nRESULT: ${ok ? 'PASS' : 'FAIL'}`);

ws.close();
chrome.kill();
process.exit(ok ? 0 : 1);
