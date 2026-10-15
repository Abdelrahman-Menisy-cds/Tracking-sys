#!/usr/bin/env node
// Scratch debug: replicate the H18 signup flow stepwise with logging.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = 'http://192.168.1.19:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h18-dbg-'))}`,
  '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const stderrChunks = [];
chrome.stderr.on('data', (c) => stderrChunks.push(c));
let wsUrl = '';
for (let i = 0; i < 200 && !wsUrl; i++) {
  try {
    const parts = Buffer.concat(stderrChunks).toString().match(/DevTools listening on (ws:\/\/[^ ]+)/);
    if (parts) wsUrl = parts[1];
    else {
      const list = await (await fetch('http://127.0.0.1:0/json/list'.replace(':0', debugPort))).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    }
  } catch {}
  await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); const w = pending.get(m.id); if (w) { pending.delete(m.id); w(m); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression, tag) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.error) console.log(`  [${tag}] CDP ERROR:`, JSON.stringify(reply.error).slice(0, 300));
  else if (reply.result?.exceptionDetails) console.log(`  [${tag}] EXC:`, JSON.stringify(reply.result.exceptionDetails).slice(0, 500));
  else console.log(`  [${tag}] value:`, JSON.stringify(reply.result?.result?.value));
  return reply.result?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');

console.log('-- wsUrl:', wsUrl);
await send('Target.getTargets').then((t) => console.log('TARGETS:', JSON.stringify(t.result).slice(0, 500)));
console.log('-- navigate /login');
await send('Page.navigate', { url: `${base}/login` });
for (let i = 0; i < 100; i++) {
  const v = await evaluate(`!!document.querySelector('input[type="email"]')`, 'email-wait').catch(() => null);
  if (v) break;
  await sleep(200);
}
console.log('-- state before IIFE');
await evaluate(`JSON.stringify({ href: window.location.href, cookies: document.cookie, ready: document.readyState })`, 'state1');
console.log('-- signup IIFE stepwise');
await evaluate(`(async () => {
  const log = [];
  log.push('cookies-before: ' + document.cookie);
  const readCookie = () => {
    const raw = document.cookie.split('; ').find((row) => row.startsWith('csrftoken=') || row.startsWith('heya_fawda_csrftoken='));
    return raw ? raw.split('=')[1] : '';
  };
  log.push('token-before: ' + JSON.stringify(readCookie()));
  let csrfStatus;
  try { csrfStatus = (await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' })).status; }
  catch (e) { log.push('csrf FETCH ERROR: ' + (e && e.message)); }
  log.push('csrf-status: ' + csrfStatus);
  log.push('cookies-after-csrf: ' + document.cookie);
  log.push('token-after: ' + JSON.stringify(readCookie()));
  let status;
  try {
    const response = await fetch('/api/v1/auth/signup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
      body: JSON.stringify({ email: 'probe.h18.dbg.' + Date.now() + '@example.com', code: 'Menisy2002', password: 'StrongPass!2026', password_confirm: 'StrongPass!2026', full_name: 'H18 Debug' }),
    });
    status = response.status;
    if (status !== 200) log.push('signup-body: ' + JSON.stringify(await response.text()).slice(0, 300));
  } catch (e) { log.push('signup FETCH ERROR: ' + (e && e.message) + ' href=' + window.location.href); }
  log.push('signup-status: ' + status);
  return log.join(' || ');
})()`, 'signup-iife');

chrome.kill();
process.exit(0);
