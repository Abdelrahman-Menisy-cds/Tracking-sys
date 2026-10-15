#!/usr/bin/env node
/**
 * Measure one page's layout: are the cards on one line, are the filter fields
 * on one line, does any table cell wrap so the columns stop lining up?
 *
 *   node scripts/probe-h16-settings-layout.mjs <baseUrl> <route> <pngPath> [email] [password]
 *
 * Signs in like the other probes (form login, then a fresh HR signup when the
 * stored probe password has drifted), shoots the page full-height, and prints
 * the measurements as JSON so a layout claim is a number, not an opinion.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const route = process.argv[3] ?? '/admin/settings';
const pngPath = process.argv[4] ?? '';
const email = process.argv[5] ?? 'p0.hr.31182@example.com';
const password = process.argv[6] ?? 'StrongPass!2026';
const PORT = 9500 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h16-layout-'))}`,
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
const until = async (expression, ms = 25000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await evaluate(expression).catch(() => false);
    if (value) return true;
    await sleep(250);
  }
  return false;
};

const MEASURE = `(() => {
  const box = (node) => {
    const rect = node.getBoundingClientRect();
    return { top: Math.round(rect.top), height: Math.round(rect.height), width: Math.round(rect.width) };
  };
  const cards = [...document.querySelectorAll('.dashboard-grid > *')].map((node) => ({
    title: (node.querySelector('h2, h3') || {}).textContent?.trim().slice(0, 26) || '',
    ...box(node),
  }));
  const fields = [...document.querySelectorAll('.filter-toolbar .field')].map((node) => ({
    label: (node.querySelector('.field-label') || {}).textContent?.trim().slice(0, 18) || '',
    ...box(node),
  }));
  const tables = [...document.querySelectorAll('table')].map((table) => {
    const cells = [...table.querySelectorAll('tbody td, thead th')];
    const wrapped = cells.filter((cell) => cell.getClientRects().length > 1 || cell.scrollHeight > cell.clientHeight + 2);
    const rows = [...table.querySelectorAll('tbody tr')];
    const wrap = table.parentElement;
    return {
      caption: (table.querySelector('caption') || {}).textContent?.trim().slice(0, 34) || '',
      columns: table.querySelectorAll('thead th').length,
      rows: rows.length,
      rowHeights: [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)))].slice(0, 6),
      wrappedCells: wrapped.length,
      wrappedSample: wrapped.slice(0, 5).map((cell) => (cell.textContent || '').trim().slice(0, 22)),
      tableWidth: Math.round(table.getBoundingClientRect().width),
      wrapperScrolls: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : false,
    };
  });
  const overflow = [...document.querySelectorAll('body *')].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
  });
  return {
    cards,
    fields,
    tables,
    overflowCount: overflow.length,
    overflowSample: overflow.slice(0, 6).map((node) => node.tagName.toLowerCase() + '.' + String(node.className || '').split(' ')[0]),
    pageWidth: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  };
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('input[type="email"]')`);

const fillLogin = `(() => {
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setValue(document.querySelector('input[type="email"]'), ${JSON.stringify(email)});
  setValue(document.querySelector('input[type="password"]'), ${JSON.stringify(password)});
  return true;
})()`;
const pressLogin = `(() => {
  const submit = document.querySelector('.login-submit')
    || [...document.querySelectorAll('button')].find((node) => /دخول|Sign in|Log in/i.test(node.textContent || ''));
  if (!submit) return false;
  submit.click();
  return true;
})()`;
let signedIn = false;
for (let attempt = 0; attempt < 3 && !signedIn; attempt++) {
  await evaluate(fillLogin);
  await evaluate(pressLogin);
  signedIn = await until(`location.pathname !== '/login'`, 9000);
  if (!signedIn) await sleep(1000);
}

if (!signedIn && process.env.H16_SUBSCRIPTION_CODE) {
  const freshEmail = `probe.hr.${Date.now()}@example.com`;
  const signup = await evaluate(`(async () => {
    const readCookie = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
    await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
    const response = await fetch('/api/v1/auth/signup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
      body: JSON.stringify({
        email: ${JSON.stringify(freshEmail)},
        code: ${JSON.stringify(process.env.H16_SUBSCRIPTION_CODE)},
        password: ${JSON.stringify(password)},
        password_confirm: ${JSON.stringify(password)},
        full_name: 'HR Probe',
      }),
    });
    return response.status;
  })()`);
  console.log(`  signup fallback       : HTTP ${signup}`);
  await sleep(400);
  signedIn = true;
}
console.log(`  session               : ${signedIn ? 'ok' : 'FAILED'}`);
if (!signedIn) {
  ws.close();
  chrome.kill();
  process.exit(1);
}

await send('Page.navigate', { url: `${base}${route}` });
await until(`!!document.querySelector('.page, .page-header')`);
await sleep(1800);
const report = await evaluate(MEASURE);
console.log(JSON.stringify(report, null, 1));

if (pngPath) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (png.result?.data) {
    writeFileSync(pngPath, Buffer.from(png.result.data, 'base64'));
    console.log(`  → ${pngPath}`);
  }
}

// full-width children (the leave section spans both columns) are not "cards on
// one line", so only the column-sized ones are compared
const columnCards = report.cards.filter((card) => card.width < 700);
const distinctCardTops = new Set(columnCards.map((card) => card.top)).size;
const cardHeights = [...new Set(columnCards.map((card) => card.height))];
const distinctFieldTops = new Set(report.fields.map((field) => field.top)).size;
const wrapped = report.tables.reduce((total, table) => total + table.wrappedCells, 0);
console.log(`  cards on one line     : ${distinctCardTops <= 1 ? 'yes' : `no (${distinctCardTops} tops)`}  heights=${JSON.stringify(cardHeights)}`);
console.log(`  filter fields on line : ${distinctFieldTops <= 1 ? 'yes' : `no (${distinctFieldTops} tops)`}`);
console.log(`  wrapped table cells   : ${wrapped}`);
ws.close();
chrome.kill();
process.exit(0);
