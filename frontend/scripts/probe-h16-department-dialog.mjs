#!/usr/bin/env node
/**
 * Proves the add-department fields appear ONLY after pressing the button.
 *
 *   node scripts/probe-h16-department-dialog.mjs <baseUrl> [email] [password]
 *
 * Text-driven on purpose: it finds the dialog by the labels inside it rather
 * than by a class name, so it keeps working whatever the dialog markup is, and
 * it prints what it actually found (role, class) so the assertion is auditable.
 * Steps: no fields before the click → click → the three fields exist in a
 * dialog → submitting empty shows the refusal and keeps the dialog open →
 * filling it creates the department (+1 department card) and closes the dialog.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const email = process.argv[3] ?? 'p0.hr.31182@example.com';
const password = process.argv[4] ?? 'StrongPass!2026';
const PORT = 9500 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h16-dlg-'))}`,
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

/** Helpers injected into the page once, then reused by every probe below. */
const HELPERS = `
window.__h16 = {
  byText: (needle, selector) => [...document.querySelectorAll(selector)]
    .find((node) => (node.textContent || '').trim().includes(needle)),
  dialog: () => document.querySelector('[role="dialog"], .dialog, .modal, dialog'),
  dialogTitle: () => {
    const node = window.__h16.dialog();
    return node ? (node.textContent || '').trim().slice(0, 60) : null;
  },
  labels: () => [...document.querySelectorAll('.field-label')].map((node) => (node.textContent || '').trim()),
};
true`;

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
for (let attempt = 0; attempt < 4 && !signedIn; attempt++) {
  await evaluate(fillLogin);
  await evaluate(pressLogin);
  signedIn = await until(`location.pathname !== '/login'`, 9000);
  if (!signedIn) await sleep(1200);
}
console.log(`  login                 : ${signedIn ? 'ok' : 'FAILED'}`);
if (!signedIn) {
  // The probe account's password can drift (someone changes it in the UI), and
  // signup is what the product itself uses, so fall back to a brand-new HR
  // account. The subscription code is never baked into the repo: it comes from
  // the environment, and without it this branch is skipped.
  const subscriptionCode = process.env.H16_SUBSCRIPTION_CODE || '';
  if (subscriptionCode) {
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
          code: ${JSON.stringify(subscriptionCode)},
          password: ${JSON.stringify(password)},
          password_confirm: ${JSON.stringify(password)},
          full_name: 'HR Probe',
        }),
      });
      return { status: response.status, body: (await response.text()).slice(0, 200) };
    })()`);
    console.log(`  signup fallback       : ${JSON.stringify(signup)}`);
    await sleep(500);
    // the SPA only learns about the new session on a fresh boot
    await send('Page.navigate', { url: `${base}/admin/people` });
    await until(`!!document.querySelector('.page, .page-header')`);
    signedIn = await evaluate(
      `fetch('/api/v1/auth/me', { credentials: 'same-origin' }).then((response) => response.ok)`,
    ).catch(() => false);
    console.log(`  session after signup  : ${signedIn ? 'ok' : 'FAILED'}`);
  }
}
if (!signedIn) {
  ws.close();
  chrome.kill();
  process.exit(1);
}

await send('Page.navigate', { url: `${base}/admin/people` });
await until(`!!document.querySelector('.page, .page-header')`);
await sleep(1500);
await evaluate(HELPERS);

const before = await evaluate(`(() => {
  const labels = window.__h16.labels();
  return {
    fields: document.querySelectorAll('.field').length,
    departmentCards: document.querySelectorAll('.work-surface').length,
    exportLabels: labels.filter((label) => /الكود|Code/.test(label)).length,
    hasDialog: !!window.__h16.dialog(),
    addButton: !!window.__h16.byText('إضافة قسم', 'button'),
  };
})()`);
console.log(`  before click          : ${JSON.stringify(before)}`);

const clicked = await evaluate(`(() => {
  const button = window.__h16.byText('إضافة قسم', 'button');
  if (!button) return false;
  button.click();
  return true;
})()`);
await sleep(600);

const opened = await evaluate(`(() => {
  const node = window.__h16.dialog();
  const labels = window.__h16.labels();
  return {
    addButtonClicked: ${clicked},
    dialogFound: !!node,
    dialogRole: node ? node.getAttribute('role') : null,
    dialogClass: node ? String(node.className) : null,
    title: window.__h16.dialogTitle(),
    codeField: labels.includes('الكود'),
    arabicField: labels.includes('الاسم بالعربي'),
    englishField: labels.includes('الاسم بالإنجليزي'),
    inputsInDialog: node ? node.querySelectorAll('input').length : 0,
    actionsInDialog: node ? node.querySelectorAll('.dialog-actions button').length : 0,
    fieldsNow: document.querySelectorAll('.field').length,
  };
})()`);
console.log(`  after click           : ${JSON.stringify(opened)}`);

// submitting empty must be refused and must keep the dialog open
await evaluate(`(() => {
  const node = window.__h16.dialog();
  const submit = [...node.querySelectorAll('button')].find((button) => (button.textContent || '').includes('إضافة قسم'));
  submit.click();
  return true;
})()`);
await sleep(800);
const refused = await evaluate(`(() => ({
  dialogStillOpen: !!window.__h16.dialog(),
  refusalShown: /اكتب كود القسم/.test(document.body.innerText),
}))()`);
console.log(`  empty submit refused  : ${JSON.stringify(refused)}`);

// fill it and submit for real
await evaluate(`(() => {
  const node = window.__h16.dialog();
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inputs = [...node.querySelectorAll('input')];
  setValue(inputs[0], 'QA1');
  setValue(inputs[1], 'الجودة');
  setValue(inputs[2], 'Quality');
  const submit = [...node.querySelectorAll('button')].find((button) => (button.textContent || '').includes('إضافة قسم'));
  submit.click();
  return true;
})()`);
const closed = await until(`!window.__h16.dialog()`, 12000);
const after = await evaluate(`(() => ({
  dialogClosed: !window.__h16.dialog(),
  departmentCards: document.querySelectorAll('.work-surface').length,
  successBanner: /تم/.test(document.body.innerText),
  bodyTail: document.body.innerText.slice(-260).replace(/\\n+/g, ' | '),
}))()`);
console.log(`  after real create     : ${JSON.stringify(after)}`);

// the panel must be gone from the organisation settings page
await send('Page.navigate', { url: `${base}/admin/settings` });
await until(`!!document.querySelector('.page, .page-header')`);
await sleep(1200);
await evaluate(HELPERS);
const moved = await evaluate(`(() => ({
  settingsHasOrgPanel: document.body.innerText.includes('الأقسام والموظفون'),
  settingsHasAddDepartment: !!(window.__h16 && window.__h16.byText('إضافة قسم', 'button')),
}))()`);
console.log(`  moved off settings    : ${JSON.stringify(moved)}`);

const structureOk =
  moved.settingsHasOrgPanel === false &&
  moved.settingsHasAddDepartment === false &&
  before.fields > 0 &&
  before.exportLabels === 0 &&
  before.hasDialog === false &&
  before.addButton === true &&
  opened.dialogFound === true &&
  opened.codeField === true &&
  opened.arabicField === true &&
  opened.englishField === true &&
  opened.inputsInDialog === 3 &&
  opened.actionsInDialog === 2 &&
  refused.dialogStillOpen === true &&
  refused.refusalShown === true;
console.log(
  structureOk
    ? '  ✓ the fields live in the button-triggered dialog'
    : '  ✗ the dialog behaviour is not as specified',
);
console.log(`  create closed dialog  : ${closed ? 'yes' : 'no'}`);

const pngPath = process.argv[3] && process.argv[3].endsWith('.png') ? process.argv[3] : '';
if (pngPath) {
  try {
    await send('Page.navigate', { url: `${base}/admin/people` });
    await until(`!!document.querySelector('.page, .page-header')`);
    await sleep(1300);
    await evaluate(HELPERS);
    // cancel whatever is open, then open the dialog fresh: the shot should show
    // exactly the state the user asked about, not the leftover error message
    await evaluate(`(() => {
      const node = window.__h16.dialog();
      const cancel = node && [...node.querySelectorAll('button')].find((button) => (button.textContent || '').includes('إلغاء'));
      if (cancel) cancel.click();
      return true;
    })()`);
    await sleep(500);
    await evaluate(`(() => {
      const button = window.__h16.byText('إضافة قسم', 'button');
      if (button) button.click();
      return true;
    })()`);
    await sleep(900);
    const png = await send('Page.captureScreenshot', { format: 'png' });
    if (png.result?.data) {
      writeFileSync(pngPath, Buffer.from(png.result.data, 'base64'));
      console.log(`  → ${pngPath}`);
    } else {
      console.log('  shot failed           : no image data came back');
    }
  } catch (failure) {
    console.log(`  shot skipped          : ${String(failure).slice(0, 140)}`);
  }
}
ws.close();
chrome.kill();
process.exit(structureOk ? 0 : 1);
