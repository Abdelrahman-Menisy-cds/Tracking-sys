#!/usr/bin/env node
/**
 * H39 phase 2 - proves the work-schedule card end to end against the LIVE
 * server: login (HR) -> /admin/settings -> empty state + add button -> the
 * dialog opens with the 7-row week form -> empty submit refused, Esc closes ->
 * fill a full week -> the dialog closes, the card shows the schedule in force
 * -> reload -> STILL there (server-persisted, not page state).
 *
 *   node scripts/probe-h39-schedule-dialog.mjs <baseUrl> [email] [password]
 *   node scripts/probe-h39-schedule-dialog.mjs <baseUrl> --offline-list
 *
 * The --offline-list invocation is DRIVER-SIDE (labelled): work-schedules list
 * requests are intercepted at the CDP layer and answered 500, proving the card
 * renders the failure block + retry and NEVER the honest-empty copy - i.e.
 * no-data is not rendered as failure and failure is not rendered as no-data.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args[0] ?? 'http://localhost:8080').replace(/\/$/, '');
const offlineList = args.some((arg) => /^--offline-list/.test(arg));
const email = offlineList ? 'hr@demo.local' : args[1] || 'hr@demo.local';
const password = offlineList ? 'demo1234' : args[2] || 'demo1234';
const PORT = 9500 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h39-card-'))}`,
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
const pausedQueue = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Fetch.requestPaused') {
    pausedQueue.push(message.params);
    return;
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
/** The next paused request, or null after the grace period. */
const nextPaused = async (graceMs = 1800) => {
  const immediate = pausedQueue.shift();
  if (immediate) return immediate;
  await sleep(graceMs);
  return pausedQueue.shift() ?? null;
};
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
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
for (let attempt = 0; attempt < 4 && !signedIn; attempt++) {
  await evaluate(fillLogin);
  await evaluate(pressLogin);
  signedIn = await until(`location.pathname !== '/login'`, 9000);
  if (!signedIn) await sleep(1200);
}
console.log(`  login                 : ${signedIn ? 'ok' : 'FAILED'}`);
if (!signedIn) {
  ws.close();
  chrome.kill();
  process.exit(1);
}

const HELPERS = `
window.__h39 = {
  byText: (needle, selector) => [...document.querySelectorAll(selector)]
    .find((node) => (node.textContent || '').trim().includes(needle)),
  dialog: () => document.querySelector('.dialog[role="dialog"][aria-modal="true"]'),
  card: () => document.getElementById('settings-schedule'),
  cardText: () => (window.__h39.card()?.innerText || '').replace(/\\n+/g, ' | '),
  setValue: (selector, value) => {
    const element = document.querySelector(selector);
    if (!element) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
};
true`;

async function visitSettings(initialLoad = true) {
  if (initialLoad) {
    await send('Page.navigate', { url: `${base}/admin/settings` });
  }
  await until(`!!document.getElementById('settings-schedule')`);
  await sleep(1400);
  await evaluate(HELPERS);
}

const saveShot = async (kind) => {
  try {
    const dir = join(process.cwd(), 'docs/screenshots');
    mkdirSync(dir, { recursive: true });
    const file = kind === 'failure' ? 'h39-schedule-failure.png' : 'h39-schedule-card.png';
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (!shot.result?.data) return 'no image data came back';
    writeFileSync(join(dir, file), Buffer.from(shot.result.data, 'base64'));
    return `-> docs/screenshots/${file}`;
  } catch (failure) {
    return String(failure).slice(0, 140);
  }
};

if (offlineList) {
  /* ---------- driver-mock: the list read is forced to fail ---------- */
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*api/v1/work-schedules*', requestStage: 'Request' }],
  });
  await visitSettings();
  for (let fulfilledCount = 0; fulfilledCount < 6; fulfilledCount++) {
    const paused = await nextPaused();
    if (!paused) break;
    const body = JSON.stringify({ error: { code: 'server_error', message: 'Simulated outage (driver-side).', fields: {} } });
    await send('Fetch.fulfillRequest', { requestId: paused.requestId, responseCode: 500, body: Buffer.from(body).toString('base64') });
  }
  const failureState = await evaluate(`(() => {
    const card = window.__h39.card();
    return card ? {
      text: window.__h39.cardText(),
      emptySpread: /لا يوجد جدول دوام بعد/.test(card.innerText),
      failureShown: /خطأ من الخادم/.test(card.innerText),
      hasRetry: !![...(card.querySelectorAll('button') || [])].find((node) => (node.textContent || '').includes('إعادة المحاولة')),
    } : null;
  })()`);
  console.log(`  failure block         : ${JSON.stringify(failureState)}  [driver-mock: list forced to fail]`);
  console.log(`  shot                  : ${await saveShot('failure')}`);
  const failureOk =
    failureState !== null &&
    failureState.emptySpread === false &&
    failureState.failureShown === true &&
    failureState.hasRetry === true;
  console.log(
    failureOk
      ? '  ✓ a failed read shows the real reason + retry, never the no-data sentence'
      : '  ✗ the failure state is not honest',
  );
  ws.close();
  chrome.kill();
  process.exit(failureOk ? 0 : 1);
}

/* ---------------- live flow: empty -> dialog -> save -> reload ---------------- */
await visitSettings();
const cardText = await evaluate(`window.__h39.cardText()`);
const initial = await evaluate(`(() => {
  const card = window.__h39.card();
  const addButton = [...(card?.querySelectorAll('button') || [])].find((node) => (node.textContent || '').includes('إضافة جدول دوام'));
  return {
    cardText: window.__h39.cardText(),
    hasSkeleton: !!card?.querySelector('.skeleton'),
    hasAddButton: !!addButton,
    emptyStateShown: /لا يوجد جدول دوام بعد/.test(card?.innerText || ''),
    activeShown: card?.querySelector('.schedule-name')?.textContent ?? null,
  };
})()`);
console.log(`  card before add       : ${JSON.stringify(initial)}`);

const clicked = await evaluate(`(() => {
  const button = window.__h39.byText('إضافة جدول دوام', 'button');
  if (!button) return false;
  button.click();
  return true;
})()`);
await sleep(700);
const opened = await evaluate(`(() => {
  const node = window.__h39.dialog();
  return {
    addButtonClicked: ${clicked},
    dialogFound: !!node,
    title: node?.querySelector('h2')?.textContent ?? null,
    dayRows: node?.querySelectorAll('.schedule-day-name').length ?? 0,
    timeInputs: node ? node.querySelectorAll('input[type="time"]').length : 0,
    numberInputs: node ? node.querySelectorAll('input[type="number"]').length : 0,
    checkboxes: node ? node.querySelectorAll('input[type="checkbox"]').length : 0,
    restDisabled: [...(node?.querySelectorAll('input[type="time"]') || [])].filter((element) => element.disabled).length,
  };
})()`);
console.log(`  dialog opened         : ${JSON.stringify(opened)}`);

// Esc closes the dialog.
await evaluate(`(() => {
  const heading = window.__h39.dialog()?.querySelector('h2');
  heading?.focus();
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
})()`);
await sleep(500);
const escClosed = await evaluate(`!window.__h39.dialog()`);
console.log(`  esc closes dialog     : ${escClosed}`);

// Reopen; an empty-named submit is refused in place and the dialog stays open.
await evaluate(`(() => { window.__h39.byText('إضافة جدول دوام', 'button')?.click(); return true; })()`);
await sleep(500);
await evaluate(`(() => {
  const save = [...window.__h39.dialog().querySelectorAll('button')].find((button) => (button.textContent || '').includes('حفظ'));
  save.click();
  return true;
})()`);
await sleep(600);
const refused = await evaluate(`(() => ({
  dialogStillOpen: !!window.__h39.dialog(),
  refusalShown: !!window.__h39.dialog()?.querySelector('.field-error'),
  refusalText: window.__h39.dialog()?.querySelector('.field-error')?.textContent ?? null,
}))()`);
console.log(`  empty submit refused  : ${JSON.stringify(refused)}`);

// A range contradiction (to < from) is refused client-side, next to the field.
await evaluate(`(() => {
  window.__h39.setValue('#schedule-form-name', 'جدول الديمو');
  window.__h39.setValue('#schedule-form-effective-from', '2026-01-01');
  window.__h39.setValue('#schedule-form-effective-to', '2025-12-31');
  return true;
})()`);
await evaluate(`(() => {
  const save = [...window.__h39.dialog().querySelectorAll('button')].find((button) => (button.textContent || '').includes('حفظ'));
  save.click();
  return true;
})()`);
await sleep(600);
const refusals = await evaluate(`(() => ({
  dialogStillOpen: !!window.__h39.dialog(),
  rangeRefusal: window.__h39.dialog()?.innerText.includes('تاريخ النهاية لا يسبق تاريخ البداية') ?? false,
}))()`);
console.log(`  bad range refused     : ${JSON.stringify(refusals)}`);

// Fix the range and save for real.
await evaluate(`(() => {
  window.__h39.setValue('#schedule-form-effective-to', '2026-12-31');
  return true;
})()`);
await evaluate(`(() => {
  const save = [...window.__h39.dialog().querySelectorAll('button')].find((button) => (button.textContent || '').includes('حفظ'));
  save.click();
  return true;
})()`);
const closed = await until(`!!window.__h39.dialog() === false`, 15000);
await sleep(1000);
const afterSave = await evaluate(`(() => ({
  cardText: window.__h39.cardText(),
  savedNotice: /تم حفظ/.test(window.__h39.cardText()),
  activeShown: window.__h39.card()?.querySelector('.schedule-name')?.textContent ?? null,
  dayRows: window.__h39.card()?.querySelectorAll('.compact-row').length ?? 0,
}))()`);
console.log(`  after save            : ${JSON.stringify(afterSave)}`);
console.log(`  shot                  : ${await saveShot('card')}`);

// The reload proof: a fresh page load must still show the server-stored row.
await send('Page.navigate', { url: `${base}/admin/settings` });
await visitSettings(false);
const afterReload = await evaluate(`(() => ({
  cardText: window.__h39.cardText(),
  activeShown: window.__h39.card()?.querySelector('.schedule-name')?.textContent ?? null,
  dayRows: window.__h39.card()?.querySelectorAll('.compact-row').length ?? 0,
}))()`);
console.log(`  after reload          : ${JSON.stringify(afterReload)}`);

const liveOk =
  signedIn &&
  initial.hasAddButton === true &&
  initial.hasSkeleton === false &&
  (initial.emptyStateShown === true || initial.activeShown !== null) &&
  opened.dialogFound === true &&
  opened.dayRows === 7 &&
  opened.timeInputs === 14 &&
  opened.numberInputs === 7 &&
  opened.checkboxes === 8 &&
  opened.restDisabled === 4 &&
  escClosed === true &&
  refused.dialogStillOpen === true &&
  refused.refusalShown === true &&
  refusals.dialogStillOpen === true &&
  refusals.rangeRefusal === true &&
  closed === true &&
  afterSave.activeShown !== null &&
  afterSave.savedNotice === true &&
  afterSave.dayRows === 7 &&
  afterReload.activeShown !== null &&
  afterReload.dayRows === 7;
console.log(
  liveOk
    ? '  ✓ the schedule card completes: button → dialog → save → card → survives reload'
    : '  ✗ the schedule card behaviour is not as specified',
);
console.log(`  live card text        : ${cardText}`);
ws.close();
chrome.kill();
process.exit(liveOk ? 0 : 1);
