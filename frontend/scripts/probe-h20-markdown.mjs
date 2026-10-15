#!/usr/bin/env node
/**
 * H20 — the renderer probe: the assistant's reply must render as ELEMENTS.
 *
 *   node scripts/probe-h20-markdown.mjs [baseUrl] [shotsDir]
 *
 * Pattern proven in H18: fresh HR signup on the served app's own origin →
 * link a local stub OpenAI-compatible provider through the real profile
 * widget → open the panel → send a message whose stub reply carries
 * `**bold**`, `` `code` ``, a `-` bullet list and a `1.` numbered list →
 * assert the DOM: <strong>/<code>/<ul>/<ol> present, literal `**` ABSENT.
 * Screenshots land in <shotsDir> (default /home/menisy/.hermes/cache/scratch/h20-shots).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '/home/menisy/.hermes/cache/scratch/h20-shots';
mkdirSync(shotsDir, { recursive: true });
const password = 'StrongPass!2026';
const code = 'Menisy2002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── stub OpenAI-compatible provider ─────────────────────────────────────────
// A reply that uses everything the brief demands: bold, inline code, a bullet
// list, a numbered list. NOT triggered by a [WRITE] — every message gets it.
const MARKDOWN_REPLY = [
  '**ملخص رصيدك**:',
  '- **الطلبات المعلقة**: ٢',
  '- `read_my_leave_balance` عاد بـ بيانات حقيقية',
  '',
  'وخطوتك الجاية:',
  '1. **افتح** صفحة الطلبات',
  '2. اضغط «طلب جديد»',
].join('\n');
const STUB_PORT = 19500 + Math.floor(Math.random() * 300);
const STUB_URL = `http://127.0.0.1:${STUB_PORT}/v1`;
const FAKE_KEY = 'stub-h20-key-not-a-secret';
let stubHits = 0;
const stub = createServer((request, response) => {
  let body = '';
  request.on('data', (c) => { body += c; });
  request.on('end', () => {
    stubHits += 1;
    response.setHeader('Content-Type', 'application/json');
    if (request.url?.includes('/chat/completions')) {
      response.end(JSON.stringify({
        id: 'stub-h20-1',
        choices: [{ message: { role: 'assistant', content: MARKDOWN_REPLY } }],
      }));
    } else {
      response.end(JSON.stringify({ ok: true, model: 'stub-model' }));
    }
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', resolve));

// ─── headless chrome over CDP (page target — the browser ws 404s) ─────────────
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h20-md-'))}`,
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
if (!wsUrl) { chrome.kill(); stub.close(); console.error('FAIL  no page target'); process.exit(1); }

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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const line = (label, ok, detail = '') => console.log(`  ${label.padEnd(56)}: ${ok ? 'PASS' : 'FAIL'}${detail ? `  (${detail})` : ''}`);
const results = [];

// ─── 1: fresh HR signup over the served app's own origin ─────────────────────
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.origin === ${JSON.stringify(base)}`, 15000);
await sleep(500);
const freshEmail = `probe.h20md.${Date.now()}@example.com`;
const signupStatus = await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const response = await fetch('/api/v1/auth/signup', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({ email: ${JSON.stringify(freshEmail)}, code: ${JSON.stringify(code)}, password: ${JSON.stringify(password)}, password_confirm: ${JSON.stringify(password)}, full_name: 'H20 Markdown Probe' }),
  });
  return response.status;
})()`);
line('fresh HR signup', signupStatus === 200, `HTTP ${signupStatus}`);
results.push(signupStatus === 200);

// The H17 company gate may engage — complete it so the shell exists.
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-shell') || !!document.querySelector('.company-form')`, 20000);
await sleep(600);
if (await evaluate(`!!document.querySelector('.company-form')`)) {
  await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.company-form .input')];
    const set = (node, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const name = (n) => n.name || n.id || '';
    inputs.forEach((n) => {
      const key = name(n).toLowerCase();
      if (key.includes('name')) set(n, 'شركة ه20 للفوضى');
      else if (key.includes('activity')) set(n, 'خدمات تنظيم');
      else if (key.includes('address')) set(n, '١٢ شارع النظام، الجيزة');
      else if (key.includes('phone')) set(n, '+20 100 555 1234');
      else if (key.includes('email')) set(n, 'info@h20.example.com');
    });
    document.querySelector('.company-form button[type="submit"]')?.click();
    return true;
  })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000);
  await sleep(600);
}

// ─── 2: link the stub provider through the real profile widget ───────────────
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-settings')`, 20000);
await sleep(500);
const linked = await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  const inputs = [...section.querySelectorAll('input.input')];
  const [baseUrlInput, modelInput, keyInput] = inputs;
  if (!baseUrlInput || !modelInput) return { error: 'widget inputs missing' };
  const set = (node, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(baseUrlInput, ${JSON.stringify(STUB_URL)});
  set(modelInput, 'stub-model');
  if (keyInput) set(keyInput, ${JSON.stringify(FAKE_KEY)});
  return { inputs: inputs.length };
})()`);
await sleep(300);
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.assistant-settings button')];
  buttons.find((b) => b.textContent.includes('حفظ') || b.textContent.toLowerCase().includes('save'))?.click();
  return true;
})()`);
// Wait for the save round-trip to finish (buttons re-enable).
const saved = await until(`(() => {
  const b = [...document.querySelectorAll('.assistant-settings button')].find((x) => x.textContent.includes('اختبار') || x.textContent.toLowerCase().includes('test'));
  return b && !b.disabled;
})()`, 15000);
line('stub provider linked via the profile widget', Boolean(saved) && !linked.error, JSON.stringify(linked) + ` saved=${saved} stubHits=${stubHits}`);
results.push(Boolean(saved) && !linked.error);
const widgetShot = await shot('h20-widget.png');

// ─── 3: open the panel, send the demand-for-markdown message ─────────────────
await send('Page.navigate', { url: `${base}/` });
await until(`(() => { const b = document.querySelector('.assistant-launcher'); return b && !b.classList.contains('assistant-launcher-muted'); })()`, 20000);
await sleep(500);
await evaluate(`document.querySelector('.assistant-launcher')?.click()`);
const panelOpened = await until(`!!document.querySelector('.assistant-panel')`);
await sleep(500);
line('chat panel opens (launcher enabled)', panelOpened);
results.push(panelOpened);

await evaluate(`(() => {
  const area = document.querySelector('.assistant-composer-input');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, ' invaluable ');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(200);
await evaluate(`(() => {
  document.querySelector('.assistant-composer button[type="submit"]')?.click();
  return true;
})()`);
// Wait for the assistant's own bubbles (stub reply = MARKDOWN_REPLY).
const replyCame = await until(
  `[...document.querySelectorAll('.assistant-message-assistant')].some((m) => m.textContent.includes('ملخص رصيدك'))`,
  30000,
);
await sleep(700);
const dom = await evaluate(`(() => {
  const texts = [...document.querySelectorAll('.assistant-message-assistant .assistant-message-text')];
  const last = texts[texts.length - 1];
  if (!last) return null;
  return {
    strongCount: last.querySelectorAll('strong').length,
    codeCount: last.querySelectorAll('code').length,
    ulCount: last.querySelectorAll('ul').length,
    olCount: last.querySelectorAll('ol').length,
    liCount: last.querySelectorAll('li').length,
    rawStars: last.textContent.includes('**'),
    rawTicks: last.textContent.includes('\x60'),
    boldText: last.querySelector('strong')?.textContent ?? '',
    text: last.textContent,
  };
})()`);
const ok =
  dom &&
  dom.strongCount >= 2 &&
  dom.codeCount >= 1 &&
  dom.ulCount >= 1 &&
  dom.olCount >= 1 &&
  dom.liCount >= 3 &&
  dom.rawStars === false &&
  dom.rawTicks === false &&
  dom.boldText.includes('ملخص رصيدك');
line('reply renders as elements (strong/code/ul/ol)', Boolean(ok), JSON.stringify(dom && { strong: dom.strongCount, code: dom.codeCount, ul: dom.ulCount, ol: dom.olCount, li: dom.liCount, rawStars: dom.rawStars, bold: dom.boldText }));
results.push(Boolean(ok));
const panelShot = replyCame ? await shot('h20-markdown-panel.png') : '';
if (panelShot) console.log(`  → ${panelShot}`);
if (widgetShot) console.log(`  → ${widgetShot}`);

const allOk = results.length > 0 && results.every(Boolean);
console.log('');
console.log(`  stub received ${stubHits} request(s)`);
console.log(`  ${allOk ? '✓ H20 markdown renderer verified' : '✗ H20 checks failed'}`);
ws.close();
chrome.kill();
stub.close();
process.exit(allOk ? 0 : 1);
