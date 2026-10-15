#!/usr/bin/env node
/**
 * Prove the first-run tour behaves: appears for a brand-new identity, walks its
 * steps, stays away after finishing, and can be replayed from the profile menu.
 *
 *   node scripts/probe-h16-tour.mjs <baseUrl> <pngPath>
 *
 * A fresh HR account is signed up each run, so "first visit" is real rather
 * than simulated. The flag is then checked in localStorage and the page is
 * reloaded to prove the tour does NOT come back — that is the whole point of a
 * first-run tour, and it is the part a screenshot cannot show.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const pngPath = process.argv[3] ?? '';
const password = 'StrongPass!2026';
const PORT = 9500 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h16-tour-'))}`,
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

const TOUR_STATE = `(() => {
  const layer = document.querySelector('.tour-layer');
  const card = document.querySelector('.tour-card');
  const ring = document.querySelector('.tour-spotlight');
  const buttons = card ? [...card.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : [];
  return {
    visible: !!layer,
    step: (card && card.querySelector('.tour-step') || {}).textContent?.trim() || null,
    title: (card && card.querySelector('.tour-title') || {}).textContent?.trim() || null,
    buttons,
    dots: card ? card.querySelectorAll('.tour-dot').length : 0,
    ring: ring ? { top: Math.round(ring.getBoundingClientRect().top), left: Math.round(ring.getBoundingClientRect().left), width: Math.round(ring.getBoundingClientRect().width) } : null,
    card: card ? { top: Math.round(card.getBoundingClientRect().top), left: Math.round(card.getBoundingClientRect().left), width: Math.round(card.getBoundingClientRect().width) } : null,
    stored: Object.keys(window.localStorage).filter((key) => key.startsWith('hermes.tour.seen.')),
  };
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// fresh identity → a genuine first visit
await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('input[type="email"]')`);
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
      code: ${JSON.stringify(process.env.H16_SUBSCRIPTION_CODE || '')},
      password: ${JSON.stringify(password)},
      password_confirm: ${JSON.stringify(password)},
      full_name: 'Tour Probe',
    }),
  });
  return response.status;
})()`);
console.log(`  signup (fresh HR)     : HTTP ${signup}  ${freshEmail}`);

await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-shell')`);
const appeared = await until(`!!document.querySelector('.tour-layer')`, 8000);
const first = await evaluate(TOUR_STATE);
console.log(`  first visit           : ${JSON.stringify(first)}`);
console.log(`  auto-appeared         : ${appeared ? 'yes' : 'no'}`);

if (pngPath && appeared) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  if (png.result?.data) {
    writeFileSync(pngPath, Buffer.from(png.result.data, 'base64'));
    console.log(`  → ${pngPath}`);
  }
}

// walk to the last step
let state = first;
let guard = 0;
while (state.visible && guard++ < 8) {
  const last = state.buttons.some((label) => label.includes('تمام') || label.includes('Got it'));
  if (last) break;
  await evaluate(`(() => {
    const card = document.querySelector('.tour-card');
    const next = [...card.querySelectorAll('button')].find((b) => /التالي|Next/.test(b.textContent || ''));
    if (next) next.click();
    return true;
  })()`);
  await sleep(400);
  state = await evaluate(TOUR_STATE);
}
console.log(`  last step             : step=${state.step} buttons=${JSON.stringify(state.buttons)}`);

// finish it
await evaluate(`(() => {
  const card = document.querySelector('.tour-card');
  const done = [...card.querySelectorAll('button')].find((b) => /تمام|Got it/.test(b.textContent || ''));
  if (done) done.click();
  return true;
})()`);
await sleep(500);
const afterFinish = await evaluate(TOUR_STATE);
console.log(`  after finish          : visible=${afterFinish.visible} stored=${JSON.stringify(afterFinish.stored)}`);

// the actual requirement: it must not come back
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-shell')`);
await sleep(2200);
const afterReload = await evaluate(TOUR_STATE);
console.log(`  after reload          : visible=${afterReload.visible}  (must be false)`);

// and it must be replayable on demand
await evaluate(`(() => {
  const trigger = document.querySelector('.profile-trigger');
  if (trigger) trigger.click();
  return true;
})()`);
await sleep(400);
const replayed = await evaluate(`(() => {
  const item = [...document.querySelectorAll('.profile-menu-item')].find((node) => /دليل الاستخدام|Product tour/.test(node.textContent || ''));
  if (!item) return false;
  item.click();
  return true;
})()`);
await sleep(700);
const afterReplay = await evaluate(TOUR_STATE);
console.log(`  replay from menu      : clicked=${replayed} visible=${afterReplay.visible}`);

const ok =
  appeared === true &&
  first.dots > 1 &&
  first.buttons.some((label) => label.includes('تخطي') || label.includes('Skip')) &&
  afterFinish.visible === false &&
  afterFinish.stored.length === 1 &&
  afterReload.visible === false &&
  afterReplay.visible === true;
console.log(ok ? '  ✓ first-run tour behaves exactly as specified' : '  ✗ tour behaviour is not as specified');
ws.close();
chrome.kill();
process.exit(ok ? 0 : 1);
