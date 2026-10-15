#!/usr/bin/env node
/**
 * H27 — the honest-failure probe: a 401 must never render as «تعذر الاتصال».
 *
 *   node scripts/probe-h27-401-message.mjs [baseUrl] [shotsDir]
 *
 * Part A (no session): load /profile cold, assert the assistant widget renders
 *   the SIGN-IN state (h27 sign-in copy + a sign-in action), assert the
 *   network sentence NEVER appears, and count GET /assistant/config on the
 *   wire for 15s — must be ≤ 2 total.
 * Part B (valid session): sign in through the real form, load /profile, assert
 *   the widget renders its normal ready state (mode picker visible).
 * Screenshots land in <shotsDir>; the request log tail is printed for the report.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:8081').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '/home/menisy/.hermes/cache/scratch/h27-shots';
const serverLog = process.argv[4] ?? '/home/menisy/.hermes/profiles/frontend_engineer/cache/scratch/h27-server.log';
mkdirSync(shotsDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── headless chrome over CDP (page target) ──────────────────────────────────
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h27-401-'))}`,
  '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let wsUrl = '';
const stderrChunks = [];
chrome.stderr.on('data', (c) => stderrChunks.push(c));
let port = null;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(300);
  const m = Buffer.concat(stderrChunks).toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
  if (m && !port) port = m[1];
  if (!port) continue;
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { chrome.kill(); console.error('FAIL  no page target'); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let messageId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++messageId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text + ' ' + JSON.stringify(reply.result.exceptionDetails));
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
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// Request counting straight off the wire: every /assistant/config GET seen by CDP.
let configRequests = 0;
let lastConfigAt = 0;
const configTimestamps = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Network.requestWillBeSent' && msg.params?.request?.url?.includes('/assistant/config')) {
    configRequests += 1;
    configTimestamps.push(new Date().toISOString());
    lastConfigAt = Date.now();
  }
});

const line = (label, ok, detail = '') => console.log(`  ${label.padEnd(56)}: ${ok ? 'PASS' : 'FAIL'}${detail ? `  (${detail})` : ''}`);
const results = [];

// ─── Part A: no session ──────────────────────────────────────────────────────
console.log('PART A — no session (cold headless profile)');
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-settings')`, 20000);
await sleep(1200); // let any (bad) retry loop show itself
const noSessionProbe = await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  if (!section) return { error: 'assistant section missing' };
  const text = section.textContent || '';
  return {
    networkSentence: text.includes('تعذر الاتصال بالخادم'),
    sessionSentence: text.includes('انتهت الجلسة') || text.includes('سجّل الدخول'),
    signInAction: !!section.querySelector('.assistant-signin-state .btn'),
    signInRegion: !!section.querySelector('.assistant-signin-state'),
    statusDigit: /رجع \\d{3}/.test(text) || /رجّع \\d{3}/.test(text),
    heading: (section.querySelector('h2') || {}).textContent || '',
  };
})()`);
line('widget section renders', !noSessionProbe.error, noSessionProbe.error ?? '');
line('sign-in state shown (سجّل الدخول)', noSessionProbe.sessionSentence === true && noSessionProbe.signInRegion === true && noSessionProbe.signInAction === true);
line('network sentence NOT shown', noSessionProbe.networkSentence === false);
line('no bare server-status digit', noSessionProbe.statusDigit === false);
await shot('part-a-signin-state.png');

// 15-second wire count: a paced/stopped loop must stay ≤ 2 (boot + at most one retry).
const t0 = Date.now();
while (Date.now() - t0 < 15000) await sleep(500);
line('config requests in 15s ≤ 2', configRequests <= 2, `${configRequests} request(s) at ${configTimestamps.join(', ') || 'none'}`);
results.push(noSessionProbe.sessionSentence && noSessionProbe.signInRegion && noSessionProbe.signInAction);
results.push(noSessionProbe.networkSentence === false);
results.push(configRequests <= 2);

// ─── Part B: valid session via the real sign-in form ─────────────────────────
console.log('PART B — valid session (employee@demo.local through the real form)');
await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('form input[name="email"]')`, 20000);
await sleep(400);
const typed = await evaluate(`(() => {
  const set = (node, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const email = document.querySelector('form input[name="email"]');
  const password = document.querySelector('form input[name="password"]');
  if (!email || !password) return false;
  set(email, 'employee@demo.local');
  set(password, 'demo1234');
  document.querySelector('form button.login-submit')?.click();
  return true;
})()`);
line('sign-in form submitted', typed === true);
await until(`!!document.querySelector('.app-shell')`, 20000);
await sleep(600);
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-settings')`, 20000);
const readyOk = await until(`(() => {
  const section = document.querySelector('.assistant-settings');
  if (!section) return false;
  return !!section.querySelector('.assistant-mode-picker') && !section.textContent.includes('تعذر الاتصال بالخادم');
})()`, 20000);
await sleep(800);
const sessionProbe = await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  const text = section.textContent || '';
  return {
    ready: !!section.querySelector('.assistant-mode-picker'),
    networkSentence: text.includes('تعذر الاتصال بالخادم'),
    signInState: !!section.querySelector('.assistant-signin-state'),
    providerFields: !!section.querySelector('input[type="url"]') && !!section.querySelector('input[type="password"]'),
  };
})()`);
line('widget loads normally (mode picker + fields)', sessionProbe.ready === true && sessionProbe.providerFields === true);
line('no error banner at all with a session', sessionProbe.networkSentence === false && sessionProbe.signInState === false);
await shot('part-b-ready-state.png');
results.push(sessionProbe.ready && sessionProbe.providerFields);
results.push(!sessionProbe.networkSentence && !sessionProbe.signInState);

// ─── server-log tail for the report ──────────────────────────────────────────
try {
  const log = readFileSync(serverLog, 'utf8').split('\n');
  const configLines = log.filter((l) => l.includes('/assistant/config'));
  console.log('\nSERVER LOG — /assistant/config lines during the probe:');
  configLines.slice(-12).forEach((l) => console.log('  ' + l));
  console.log(`  total /assistant/config lines in this server log: ${configLines.length}`);
} catch (e) {
  console.log('server log not readable from the probe: ' + e.message);
}

console.log(`\nRESULT: ${results.every(Boolean) ? 'ALL PASS' : 'FAILURES PRESENT'}`);
chrome.kill();
process.exit(results.every(Boolean) ? 0 : 1);
