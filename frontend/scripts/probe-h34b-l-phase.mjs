#!/usr/bin/env node
/**
 * H34b L-phase re-run: the contracted fused-200 (driver-side CDP mock).
 * No rows are written — the POST never reaches a server, it is fulfilled at
 * the network layer with the documented envelope. Verified: the wizard adopts
 * the identity (menu shows role · email) and lands STRAIGHT on / with no
 * onboarding panel.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:8080';
const password = 'StrongPass!2026';
const realCode = 'Menisy2002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h34bl-'))}`,
  '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let wsUrl = '';
const stderrChunks = [];
chrome.stderr.on('data', (c) => stderrChunks.push(c));
let port = null;
while (!wsUrl) {
  await sleep(300);
  const m = Buffer.concat(stderrChunks).toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
  if (m && !port) port = m[1];
  if (!port) continue;
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch { /* warm-up */ }
}
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let messageId = 0; const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method !== 'Fetch.requestPaused') return;
  const body = msg.params?.request?.postData ?? '';
  if (body.includes('mock.h34b')) {
    void send('Fetch.fulfillRequest', {
      requestId: msg.params.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ data: { id: 9999, email: 'mock.h34b@example.com', full_name: 'مؤسس H34b', role: 'HR', needs_company_profile: false }, meta: {} })).toString('base64'),
    });
  } else {
    void send('Fetch.continueRequest', { requestId: msg.params.requestId });
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
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
    if (await evaluate(expression).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
};
await send('Fetch.enable', { patterns: [{ urlPattern: '*://*/*api/v1/auth/signup*', requestStage: 'Request' }] });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('.login-signup-toggle')`, 15000);
await sleep(400);
await evaluate(`document.querySelector('.login-signup-toggle').click()`);
await until(`!!document.querySelector('.company-form')`, 15000);
await evaluate(`(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const set = (node, value) => { setter.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('.company-form input[name="name"]'), 'شركة فوضى للفحص H34b');
  set(document.querySelector('.company-form input[name="activity"]'), 'خدمات تنظيمية');
  set(document.querySelector('.company-form input[name="address"]'), '١٢ شارع البروف');
  set(document.querySelector('.company-form input[name="phone"]'), '01200704564');
  set(document.querySelector('input[name="code"]'), ${JSON.stringify(realCode)});
})()`);
await evaluate(`document.querySelector('.company-form button[type="submit"]').click()`);
await until(`!!document.querySelector('form input[name="confirm-password"]')`, 15000);
await sleep(300);
await evaluate(`(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const set = (node, value) => { setter.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('form input[name="email"]'), 'mock.h34b@example.com');
  set(document.querySelector('form input[name="new-password"]'), ${JSON.stringify(password)});
  set(document.querySelector('form input[name="confirm-password"]'), ${JSON.stringify(password)});
})()`);
await evaluate(`document.querySelector('form button.login-submit').click()`);
const landed = await until(`window.location.pathname === '/' && !!document.querySelector('.app-shell') && !document.querySelector('.company-onboarding-panel')`, 30000);
await sleep(600);
await evaluate(`document.querySelector('.profile-trigger')?.click()`);
await sleep(400);
const state = await evaluate(`(() => {
  const menu = document.querySelector('.profile-menu');
  return {
    landed: window.location.pathname === '/',
    noOnboarding: !document.querySelector('.company-onboarding-panel'),
    menuText: [...(menu?.querySelectorAll('.profile-menu-meta, .profile-menu-name') ?? [])].map((n) => n.textContent.trim()),
  };
})()`);
const ok = landed && state.noOnboarding && JSON.stringify(state.menuText).includes('mock.h34b@example.com');
console.log(`L re-run (mock fused-200): ${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(state)}`);
chrome.kill();
process.exit(ok ? 0 : 1);
