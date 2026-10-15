#!/usr/bin/env node
/**
 * H24 visual-proof fallback — headless chrome CDP against http://localhost:8080.
 * The png the mjs probe captured is byte-identical across runs with different
 * codes => it cannot be showing the changing panel. This script proves the
 * same acceptance facts GEOMETRICALLY: panel visible? code element's rect on
 * screen? cancel button present? retrying note at what y? — plus it dumps the
 * panel's innerText verbatim so a human can read exactly what was rendered.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = 'http://localhost:8080';
const outDir = '/home/menisy/.hermes/cache/scratch/h24-shots';
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h24v-'))}`,
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
if (!wsUrl) { console.error('FAIL no page target'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let mid = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
const until = async (expression, ms = 20000) => {
  const dl = Date.now() + ms;
  while (Date.now() < dl) { if (await evaluate(expression).catch(() => false)) return true; await sleep(250); }
  return false;
};
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  if (png.result?.data) { writeFileSync(join(outDir, name), Buffer.from(png.result.data, 'base64')); return name; }
  return '';
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// fresh signup, same recipe
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.origin === ${JSON.stringify(base)}`, 15000);
await sleep(600);
const email = `probe.h24v.${Date.now()}@example.com`;
const st = await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/heya_fawda_csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const r = await fetch('/api/v1/auth/signup', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, code: 'Menisy2002', password: 'StrongPass!2026', password_confirm: 'StrongPass!2026', full_name: 'H24 Vision Probe' }) });
  return r.status;
})()`);
console.log('signup', st);

await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-rail') || !!document.querySelector('.company-form')`, 20000);
await sleep(600);
if (await evaluate(`!!document.querySelector('.company-form')`)) {
  await evaluate(`(() => {
    const set = (n, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); };
    [...document.querySelectorAll('.company-form .input')].forEach((n) => {
      const k = (n.name || n.id || '').toLowerCase();
      if (k.includes('name')) set(n, 'شركة ه٢٤'); else if (k.includes('activity')) set(n, 'تنظيم');
      else if (k.includes('address')) set(n, 'شارع ١٢'); else if (k.includes('phone')) set(n, '+20 100 000 0000');
      else if (k.includes('email')) set(n, 'x@h24.example.com');
    });
    document.querySelector('.company-form button[type="submit"]')?.click(); return 1;
  })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000);
  await sleep(600);
}

// /profile + opencode tab
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-mode-picker')`, 20000);
await sleep(600);
await evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تخطي الجولة'))?.click(); return 1; })()`);
await sleep(300);
await evaluate(`(() => { [...document.querySelectorAll('.assistant-mode-picker button')].find((b) => b.textContent.includes('opencode'))?.click(); return 1; })()`);
await until(`(() => { const p = document.querySelector('.assistant-sub-panel[data-provider="opencode"]'); return !!p && p.textContent.includes('تسجيل الدخول للاشتراك'); })()`, 10000);

// start the flow
await evaluate(`(() => { const p = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  [...(p?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'))?.click(); return 1; })()`);
const came = await until(`(() => { const p = document.querySelector('.assistant-sub-panel[data-provider="opencode"]'); return !!p && p.textContent.includes('في انتظار الموافقة'); })()`, 30000);

const geom = await evaluate(`(() => {
  const p = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const codeEl = p?.querySelector('.assistant-sub-code');
  const linkEl = p?.querySelector('.assistant-sub-link');
  const cancel = [...(p?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('إلغاء'));
  const viewport = { w: innerWidth, h: innerHeight, scrollY: scrollY };
  const onScreen = (b) => b && b.y >= 0 && b.y + b.h <= viewport.h && b.w > 0;
  return {
    waitingText: p?.textContent.slice(0, 260) ?? null,
    code: codeEl?.textContent.trim() ?? '',
    codeRect: r(codeEl), codeOnScreen: onScreen(r(codeEl)),
    linkRect: r(linkEl), linkOnScreen: onScreen(r(linkEl)),
    cancelRect: r(cancel), cancelOnScreen: onScreen(r(cancel)),
    viewport,
  };
})()`);
console.log('AT-START geometry:', JSON.stringify(geom, null, 1));
console.log('shot 2s-ish:', await shot('h24-v-2s.png'));

// ALSO capture a direct element screenshot (clip to the code row) so the "is the code visibly rendered" question is answerable from pixels we can describe programmatically:
const clip = geom.codeRect ? { ...geom.codeRect, scale: 1 } : undefined;
if (clip) {
  const png = await send('Page.captureScreenshot', { format: 'png', clip });
  if (png.result?.data) writeFileSync(join(outDir, 'h24-v-code-clip.png'), Buffer.from(png.result.data, 'base64'));
  console.log('code-clip saved');
}

// THE 30 second hold
console.log('holding 30s...');
await sleep(30000);
const at30 = await evaluate(`(() => {
  const p = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const plain = [...(p?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'));
  const b = p?.getBoundingClientRect();
  return { waiting: Boolean(p?.textContent.includes('في انتظار الموافقة')), plainBtnBack: Boolean(plain), panelRect: b ? { y: Math.round(b.y), h: Math.round(b.height) } : null, scrollY, viewportH: innerHeight };
})()`);
console.log('AT-30s:', JSON.stringify(at30));
console.log('shot 30s:', await shot('h24-v-30s.png'));
// element shot again at 30s for pixel-level comparison
if (clip) {
  const png = await send('Page.captureScreenshot', { format: 'png', clip });
  if (png.result?.data) writeFileSync(join(outDir, 'h24-v-code-clip-30s.png'), Buffer.from(png.result.data, 'base64'));
}
ws.close(); chrome.kill();
console.log('DONE');
