#!/usr/bin/env node
/**
 * Log in as HR, then shoot the HR surfaces over CDP, and MEASURE the layout.
 *
 *   node scripts/probe-h16-hr-shots.mjs <baseUrl> <outDir> [email] [password]
 *
 * Headless Chrome with a throwaway profile (so the developer's running Chrome
 * holding the real profile is irrelevant), Node 22+ global WebSocket, no
 * packages. Prints measurements next to each shot so a broken layout is provable
 * without eyeballing: horizontal overflow, how many cards/fields rendered, and
 * whether the two H16 panels are actually on the page.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const outDir = process.argv[3] ?? '.';
const email = process.argv[4] ?? 'p0.hr.31182@example.com';
const password = process.argv[5] ?? 'StrongPass!2026';
const PORT = 9500 + Math.floor(Math.random() * 300);

mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h16-shot-'))}`,
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// ── log in as HR (the panel only exists for HR) ──
await send('Page.navigate', { url: `${base}/login` });
if (!(await until(`!!document.querySelector('input[type="email"]')`))) {
  console.log('FAIL  the login form never rendered');
  ws.close();
  chrome.kill();
  process.exit(1);
}
await evaluate(`(() => {
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setValue(document.querySelector('input[type="email"]'), ${JSON.stringify(email)});
  setValue(document.querySelector('input[type="password"]'), ${JSON.stringify(password)});
  return true;
})()`);
await evaluate(`(() => {
  const button = document.querySelector('.login-submit')
    || [...document.querySelectorAll('button')].find((node) => /دخول|Sign in|Log in/i.test(node.textContent || ''));
  if (!button) return false;
  button.click();
  return true;
})()`);
const signedIn = await until(`location.pathname !== '/login'`, 30000);
console.log(`  login          : ${signedIn ? 'ok' : 'FAILED'}  (now at ${await evaluate('location.pathname')})`);
if (!signedIn) {
  ws.close();
  chrome.kill();
  process.exit(1);
}

const shot = async (route, label) => {
  await send('Page.navigate', { url: `${base}${route}` });
  await until(`!!document.querySelector('.page, .page-header')`);
  await sleep(1500); // let the panel's real API calls land
  const report = await evaluate(`(() => {
    const root = document.documentElement;
    const boxes = [...document.querySelectorAll('.work-surface')];
    const wide = boxes.filter((node) => node.getBoundingClientRect().width > innerWidth);
    const overflowing = [...document.querySelectorAll('main *')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
    });
    const culprits = overflowing.slice(0, 6).map((node) => node.tagName.toLowerCase() + "." + String(node.className || "").split(" ")[0]);
    return {
      path: location.pathname,
      text: root.innerText.slice(0, 260).replace(/\\n+/g, ' | '),
      surfaces: boxes.length,
      fields: document.querySelectorAll('.field').length,
      selectsStyled: [...document.querySelectorAll('select')].filter((s) => s.classList.contains('select')).length,
      selectsTotal: document.querySelectorAll('select').length,
      tables: document.querySelectorAll('table').length,
      wideBoxes: wide.length,
      overflowing: overflowing.length,
      culprits,
      scrollWidth: root.scrollWidth,
      innerWidth,
      hasOrgPanel: root.innerText.includes('الأقسام والموظفون'),
      hasGrantsPanel: root.innerText.includes('صلاحيات إضافية'),
    };
  })()`);
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = join(outDir, `${label}.png`);
  if (png.result?.data) writeFileSync(file, Buffer.from(png.result.data, 'base64'));
  console.log(`  ${label}: ${JSON.stringify(report)}`);
  console.log(`    → ${file}`);
  return report;
};

const settings = await shot('/admin/settings', 'hr-settings');

// the roster links each row to a file, which carries the grants panel
await shot('/admin/people', 'hr-people');
const firstLink = await evaluate(`(() => {
  const link = document.querySelector('a[href^="/admin/people/"]');
  return link ? link.getAttribute('href') : null;
})()`);
if (firstLink) await shot(firstLink, 'hr-employee-file');

const overflowFree = settings && settings.overflowing === 0 && settings.wideBoxes === 0;
console.log(
  overflowFree
    ? '  ✓ layout: no horizontal overflow, no oversized cards'
    : '  ✗ layout: something overflows horizontally',
);

ws.close();
chrome.kill();
process.exit(overflowFree && settings.hasOrgPanel ? 0 : 1);
