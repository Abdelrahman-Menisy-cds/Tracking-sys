#!/usr/bin/env node
/**
 * H24-B — backoff-cadence-only probe (post-fix). Starts a real flow, then
 * injects poll failures and records EXACTLY when each retry lands:
 * the fix targets 5s → 10s → 15s (interval 5), NOT the stacked 10s/15s/20s.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h24b-'))}`,
  '--remote-debugging-port=0', '--window-size=1280,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let port = null; const chunks = [];
chrome.stderr.on('data', (c) => chunks.push(c));
let wsUrl = '';
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(300);
  const m = Buffer.concat(chunks).toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
  if (m && !port) port = m[1];
  if (!port) continue;
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { console.error('no target'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let mid = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 250));
  return r.result?.result?.value;
};
const until = async (expression, ms = 20000) => { const dl = Date.now() + ms; while (Date.now() < dl) { if (await evaluate(expression).catch(() => false)) return true; await sleep(250); } return false; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.origin === ${JSON.stringify(base)}`, 15000);
await sleep(600);
const email = `probe.h24b.${Date.now()}@example.com`;
await evaluate(`(async () => {
  const rc = () => (document.cookie.match(/heya_fawda_csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const r = await fetch('/api/v1/auth/signup', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': rc() },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, code: 'Menisy2002', password: 'StrongPass!2026', password_confirm: 'StrongPass!2026', full_name: 'H24 Backoff Probe' }) });
  return r.status;
})()`);
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-rail') || !!document.querySelector('.company-form')`, 20000);
await sleep(600);
if (await evaluate(`!!document.querySelector('.company-form')`)) {
  await evaluate(`(() => { const set = (n, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); };
    [...document.querySelectorAll('.company-form .input')].forEach((n) => { const k = (n.name || n.id || '').toLowerCase();
      if (k.includes('name')) set(n, 'ش ب'); else if (k.includes('activity')) set(n, 'تنظيم'); else if (k.includes('address')) set(n, 'ش ١');
      else if (k.includes('phone')) set(n, '+20 100 000 0000'); else if (k.includes('email')) set(n, 'x@h24.example.com'); });
    document.querySelector('.company-form button[type="submit"]')?.click(); return 1; })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000); await sleep(600);
}
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-mode-picker')`, 20000);
await sleep(600);
await evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تخطي الجولة'))?.click(); return 1; })()`);
await sleep(300);
await evaluate(`(() => { [...document.querySelectorAll('.assistant-mode-picker button')].find((b) => b.textContent.includes('opencode'))?.click(); return 1; })()`);
await until(`(() => { const p = document.querySelector('.assistant-sub-panel[data-provider="opencode"]'); return !!p && p.textContent.includes('تسجيل الدخول للاشتراك'); })()`, 10000);

// instrument + start + inject failures
const setup = await evaluate(`(async () => {
  window.__log = [];
  const orig = window.fetch.bind(window);
  window.__orig = orig;
  window.fetch = async (...args) => {
    const url = String(args[0]?.url ?? args[0] ?? '');
    if (url.includes('/assistant/subscription/poll')) {
      if (url.includes('/poll') && window.__fail) {
        window.__log.push({ at: Math.round(performance.now() / 100) / 10, kind: 'fail' });
        throw new TypeError('injected');
      }
      const t0 = performance.now();
      const r = await orig(...args);
      window.__log.push({ at: Math.round(performance.now() / 100) / 10, kind: url.includes('/start') ? 'start' : 'poll', status: r.status });
      return r;
    }
    if (url.includes('/assistant/subscription/start')) {
      const r = await orig(...args);
      window.__log.push({ at: Math.round(performance.now() / 100) / 10, kind: 'start', status: r.status });
      return r;
    }
    return orig(...args);
  };
  const p = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  [...(p?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'))?.click();
  return true;
})()`);
const came = await until(`(() => { const p = document.querySelector('.assistant-sub-panel[data-provider="opencode"]'); return !!p && p.textContent.includes('في انتظار الموافقة'); })()`, 30000);
console.log('waiting UI came:', came);
await sleep(11000); // two real polls first (interval 5)
await evaluate(`window.__fail = true`);
console.log('failures ON; recording 60s of retries...');
await sleep(60000);
await evaluate(`window.__fail = false`);
const log = await evaluate(`JSON.stringify(window.__log)`);
const events = JSON.parse(log);
for (const e of events) console.log(` t=${String(e.at).padStart(6)}s  ${e.kind}${e.status ? ' ' + e.status : ''}`);
const fails = events.filter(e => e.kind === 'fail').map(e => e.at);
const gaps = fails.slice(1).map((t, i) => +(t - fails[i]).toFixed(1));
console.log('RETRY GAPS after failures:', JSON.stringify(gaps), '(fix target: 5,10,15 or 5,10,15-close; pre-fix was 10,15,20)');
ws.close(); chrome.kill();
