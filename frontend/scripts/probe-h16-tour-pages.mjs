#!/usr/bin/env node
/**
 * Prove every page has its own first-run tour.
 *
 *   node scripts/probe-h16-tour-pages.mjs <baseUrl> <pngPath>
 *
 * Signs up a fresh HR (a genuine first visit for every page), then walks the
 * real routes and checks each one shows its own tour, stores its own flag, and
 * does NOT show it again on a second visit. Also opens a real request record to
 * confirm detail pages pick up the detail tour rather than the list tour.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const pngPath = process.argv[3] ?? '';
const password = 'StrongPass!2026';
const PORT = 9700 + Math.floor(Math.random() * 250);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h16-tourpages-'))}`,
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

const STATE = `(() => {
  const card = document.querySelector('.tour-card');
  return {
    visible: !!document.querySelector('.tour-layer'),
    step: (card && card.querySelector('.tour-step') || {}).textContent?.trim() || null,
    title: (card && card.querySelector('.tour-title') || {}).textContent?.trim() || null,
    body: (card && card.querySelector('.tour-body') || {}).textContent?.trim() || null,
    dots: card ? card.querySelectorAll('.tour-dot').length : 0,
    stored: Object.keys(window.localStorage).filter((key) => key.startsWith('hermes.tour.seen.')),
  };
})()`;
const skipTour = `(() => {
  const card = document.querySelector('.tour-card');
  if (!card) return false;
  const skip = [...card.querySelectorAll('button')].find((b) => /تخطي|Skip/.test(b.textContent || ''));
  if (skip) skip.click();
  return true;
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('input[type="email"]')`);
const freshEmail = `probe.pages.${Date.now()}@example.com`;
const signup = await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const response = await fetch('/api/v1/auth/signup', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({
      email: ${JSON.stringify(freshEmail)},
      code: ${JSON.stringify(process.env.H16_SUBSCRIPTION_CODE || '')},
      password: ${JSON.stringify(password)},
      password_confirm: ${JSON.stringify(password)},
      full_name: 'Tour Pages Probe',
    }),
  });
  return response.status;
})()`);
console.log(`  signup (fresh HR) : HTTP ${signup}`);

const ROUTES = [
  '/',
  '/requests',
  '/requests/new',
  '/timesheets',
  '/reviews',
  '/notifications',
  '/profile',
  '/attendance',
  '/attendance/history',
  '/attendance/corrections',
  '/tasks',
  '/admin',
  '/admin/people',
  '/admin/settings',
  '/admin/announcements',
];

const results = [];
for (const route of ROUTES) {
  await send('Page.navigate', { url: `${base}${route}` });
  await until(`!!document.querySelector('.app-shell')`);
  const appeared = await until(`!!document.querySelector('.tour-layer')`, 5000);
  const state = await evaluate(STATE);
  results.push({ route, appeared, ...state });
  const label = route === '/' ? 'shell' : route;
  console.log(`  ${label.padEnd(22)}: tour=${appeared ? 'yes' : 'NO '} dots=${state.dots} step=${state.step ?? '-'} title=${state.title ?? '-'}`);
  if (pngPath && route === '/admin/people' && appeared) {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    if (png.result?.data) {
      writeFileSync(pngPath, Buffer.from(png.result.data, 'base64'));
      console.log(`  → ${pngPath}`);
    }
  }
  await evaluate(skipTour);
  await sleep(350);
}

// a real detail page: it must use the detail tour, not the list tour
await send('Page.navigate', { url: `${base}/requests` });
await until(`!!document.querySelector('.app-shell')`);
await sleep(1200);
const detailHref = await evaluate(`(() => {
  const link = [...document.querySelectorAll('a[href^="/requests/"]')].find((node) => !node.getAttribute('href').endsWith('/new'));
  return link ? link.getAttribute('href') : null;
})()`);
let detail = null;
if (detailHref) {
  await send('Page.navigate', { url: `${base}${detailHref}` });
  await until(`!!document.querySelector('.app-shell')`);
  const appeared = await until(`!!document.querySelector('.tour-layer')`, 5000);
  detail = { href: detailHref, appeared, ...(await evaluate(STATE)) };
  console.log(`  ${detailHref.padEnd(22)}: tour=${appeared ? 'yes' : 'NO '} dots=${detail.dots} body=${(detail.body ?? '-').slice(0, 42)}`);
  await evaluate(skipTour);
  await sleep(300);
}

// second visits must stay quiet
const REVISITS = ['/requests', '/admin/settings', '/attendance'];
const revisits = [];
for (const route of REVISITS) {
  await send('Page.navigate', { url: `${base}${route}` });
  await until(`!!document.querySelector('.app-shell')`);
  await sleep(2200);
  const state = await evaluate(STATE);
  revisits.push({ route, visible: state.visible });
  console.log(`  revisit ${route.padEnd(15)}: tour=${state.visible ? 'YES (wrong)' : 'no (correct)'}`);
}

const stored = await evaluate(`Object.keys(window.localStorage).filter((key) => key.startsWith('hermes.tour.seen.')).length`);
const missing = results.filter((row) => !row.appeared).map((row) => row.route);
const shell = results.find((row) => row.route === '/');
const ok =
  missing.length === 0 &&
  shell.dots === 5 &&
  detail?.appeared === true &&
  /سجل واحد/.test(detail?.body ?? '') &&
  detail?.dots >= 2 &&
  revisits.every((row) => row.visible === false) &&
  stored >= ROUTES.length + 1;
console.log(`  stored flags      : ${stored} (${ROUTES.length} pages + detail expected)`);
console.log(`  pages without tour: ${missing.length ? JSON.stringify(missing) : 'none'}`);
console.log(ok ? '  ✓ every page has its own first-run tour, each shown once' : '  ✗ per-page tours are not as specified');
ws.close();
chrome.kill();
process.exit(ok ? 0 : 1);
