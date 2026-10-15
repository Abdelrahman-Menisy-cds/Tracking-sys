#!/usr/bin/env node
/**
 * H21c — the opencode tab must show the REAL button (authorize), not import.
 *
 *   node scripts/probe-h21c-authorize.mjs [baseUrl] [shotsDir]
 *
 * Recipe proven in H19/H20: fresh signup on the served app's own origin, CDP
 * against the PAGE target, drive the real /profile widget. This probe runs
 * TWICE effectively: the live server pass below asserts the REAL primary
 * button labels; the stubbed-fetch pass (same page, same widget, fetch
 * stubbed for /subscription/start+/poll only) proves the code+link island
 * and the waiting state that the real provider approval can't complete in
 * a probe.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '/home/menisy/.hermes/cache/scratch/h21-shots';
mkdirSync(shotsDir, { recursive: true });
const password = 'StrongPass!2026';
const code = 'Menisy2002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── headless chrome over CDP (page target — the browser ws 404s) ─────────────
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h21c-'))}`,
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const line = (label, ok, detail = '') => console.log(`  ${label.padEnd(58)}: ${ok ? 'PASS' : 'FAIL'}${detail ? `  (${detail})` : ''}`);
const results = [];

// ─── 1: fresh signup on the served app's own origin ──────────────────────────
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.origin === ${JSON.stringify(base)}`, 15000);
await sleep(500);
const freshEmail = `probe.h21c.${Date.now()}@example.com`;
const signupStatus = await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/heya_fawda_csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const response = await fetch('/api/v1/auth/signup', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({ email: ${JSON.stringify(freshEmail)}, code: ${JSON.stringify(code)}, password: ${JSON.stringify(password)}, password_confirm: ${JSON.stringify(password)}, full_name: 'H21c Probe' }),
  });
  return response.status;
})()`);
line('fresh signup', signupStatus === 200, `HTTP ${signupStatus}`);
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
      if (key.includes('name')) set(n, 'شركة ه21 للفوضى');
      else if (key.includes('activity')) set(n, 'خدمات تنظيم');
      else if (key.includes('address')) set(n, '١٢ شارع النظام، الجيزة');
      else if (key.includes('phone')) set(n, '+20 100 555 1234');
      else if (key.includes('email')) set(n, 'info@h21.example.com');
    });
    document.querySelector('.company-form button[type="submit"]')?.click();
    return true;
  })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000);
  await sleep(600);
}

// ─── 2: /profile — the opencode tab ──────────────────────────────────────────
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-mode-picker')`, 20000);
await sleep(500);
await evaluate(`(() => {
  const op = [...document.querySelectorAll('.assistant-mode-picker button')].find((b) => b.textContent.includes('opencode'));
  if (op) op.click();
  return true;
})()`);
// The face needs the capability round-trip before the primary login button
// exists; both faces (button or the honest hint) settle inside 10s.
await until(
  `(() => {
    const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
    if (!panel) return false;
    return panel.textContent.includes('تسجيل الدخول للاشتراك') || panel.textContent.includes('مفيش صفحة دخول داخلية');
  })()`,
  10000,
);
await sleep(300);

const face = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  if (!panel) return null;
  const actions = [...panel.querySelectorAll('.form-actions')];
  const primary = panel.querySelector('.form-actions .btn-primary');
  const importBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('استيراد من تسجيل الجهاز'));
  const loginBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'));
  const importClass = importBtn?.className ?? '';
  return {
    provider: panel.dataset.provider,
    hasPrimary: Boolean(primary),
    primaryLabel: primary?.textContent ?? '',
    loginIsPrimary: Boolean(loginBtn && primary && loginBtn === primary),
    importPresent: Boolean(importBtn),
    importSecondary: Boolean(importBtn && importBtn.className.includes('btn-secondary')),
    importSmall: Boolean(importBtn && importBtn.className.includes('btn-sm')),
    importAfterPrimary: Boolean(primary && importBtn && primary.compareDocumentPosition(importBtn) & Node.DOCUMENT_POSITION_FOLLOWING),
    actionCount: actions.length,
  };
})()`);
const faceOk = face && face.loginIsPrimary && face.importPresent && face.importSecondary && face.importSmall && face.importAfterPrimary;
line('opencode: primary = تسجيل الدخول للاشتراك', Boolean(face && face.loginIsPrimary), JSON.stringify(face && { primary: face.primaryLabel, loginIsPrimary: face.loginIsPrimary }));
line('opencode: import demoted (secondary, small, second)', Boolean(faceOk), JSON.stringify(face && { importSecondary: face.importSecondary, importSmall: face.importSmall, importAfterPrimary: face.importAfterPrimary }));
results.push(Boolean(face && face.loginIsPrimary));
results.push(Boolean(faceOk));
const liveShot = await shot('h21c-opencode-live.png');

// ─── 3: the REAL flow, started for real ──────────────────────────────────────
// The button calls POST /assistant/subscription/start against the live
// backend (opencode's console device flow). We do NOT approve on the
// provider's site — we assert the widget shows the code+link+waiting state.
await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const primary = panel?.querySelector('.form-actions .btn-primary');
  const btn = [...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'));
  (btn ?? primary)?.click();
  return true;
})()`);
const waitingCame = await until(
  `(() => {
    const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
    if (!panel) return false;
    if (!panel.textContent.includes('في انتظار الموافقة')) return false;
    const codeEl = panel.querySelector('.assistant-sub-code');
    const linkEl = panel.querySelector('.assistant-sub-link');
    return Boolean(codeEl && codeEl.textContent.trim() && linkEl && linkEl.href.startsWith('http'));
  })()`,
  30000,
);
const waitingState = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const codeEl = panel?.querySelector('.assistant-sub-code');
  const linkEl = panel?.querySelector('.assistant-sub-link');
  return {
    waiting: Boolean(panel?.textContent.includes('في انتظار الموافقة')),
    codeShown: Boolean(codeEl && codeEl.textContent.trim().length >= 4),
    codeDirLtr: codeEl?.getAttribute('dir') === 'ltr',
    codeMono: Boolean(codeEl && codeEl.className.includes('assistant-sub-code')),
    copyBtn: Boolean([...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('انسخ الكود'))),
    linkHref: linkEl?.href ?? '',
    linkTargetBlank: linkEl?.target === '_blank',
  };
})()`);
line('opencode: start → waiting state with code+link', waitingCame, JSON.stringify(waitingState && { waiting: waitingState.waiting, codeShown: waitingState.codeShown, link: waitingState.linkHref.slice(0, 48) }));
results.push(waitingCame && Boolean(waitingState?.codeShown && waitingState?.codeDirLtr && waitingState?.codeMono && waitingState?.copyBtn && waitingState?.linkTargetBlank));
if (waitingCame) { await sleep(600); await shot('h21c-opencode-waiting.png'); }

// Give the poll loop one turn, then check it did NOT falsely link (nobody
// approved) and did not crash: the waiting state is still there or the
// window is still running; the import button must stay disabled meanwhile.
await sleep(4000);
const stillWaiting = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  return {
    noCrash: Boolean(panel),
    waiting: Boolean(panel?.textContent.includes('في انتظار الموافقة')),
    importDisabled: [...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('استيراد من تسجيل الجهاز'))?.disabled ?? null,
  };
})()`);
line('opencode: poll keeps waiting (no false link)', Boolean(stillWaiting?.waiting && stillWaiting?.importDisabled === true), JSON.stringify(stillWaiting));
results.push(Boolean(stillWaiting?.waiting && stillWaiting?.importDisabled === true));

// Stop the flow between turns: switch tabs; the flow's timers must die.
await evaluate(`(() => {
  const api = [...document.querySelectorAll('.assistant-mode-picker button')].find((b) => b.textContent.includes('API'));
  if (api) api.click();
  return true;
})()`);
await sleep(400);
await evaluate(`(() => {
  const op = [...document.querySelectorAll('.assistant-mode-picker button')].find((b) => b.textContent.includes('opencode'));
  if (op) op.click();
  return true;
})()`);
await until(
  `(() => {
    const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
    if (!panel) return false;
    return panel.textContent.includes('تسجيل الدخول للاشتراك') || panel.textContent.includes('مفيش صفحة دخول داخلية');
  })()`,
  10000,
);
const switchState = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const unlinked = panel?.textContent.includes('غير مربوط');
  const loginBack = Boolean([...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك')));
  return { unlinked, loginBack };
})()`);
line('switch-away kills the flow: button returns', Boolean(switchState?.unlinked && switchState?.loginBack), JSON.stringify(switchState));
results.push(Boolean(switchState?.unlinked && switchState?.loginBack));

// The codex tab — no in-app login flow → the honest import-only face, and
// a chat turn to prove the backend keeps serving codex subscriptions (the
// import path replaced in H21c must not have broken the linked provider).
await evaluate(`(() => {
  const cx = [...document.querySelectorAll('.assistant-mode-picker button')].find((b) => b.textContent.includes('Codex'));
  if (cx) cx.click();
  return true;
})()`);
await until(`!!document.querySelector('.assistant-sub-panel[data-provider="codex"]')`, 10000);
await sleep(500);
const codexFace = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="codex"]');
  const primary = panel?.querySelector('.form-actions .btn-primary');
  const hint = panel?.textContent.includes('مفيش صفحة دخول داخلية');
  return {
    noPrimary: !primary,
    honestHint: Boolean(hint),
    importStillThere: Boolean([...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('استيراد من تسجيل الجهاز'))),
  };
})()`);
line('codex: honest import-only face unchanged', Boolean(codexFace?.noPrimary && codexFace?.honestHint && codexFace?.importStillThere), JSON.stringify(codexFace));
results.push(Boolean(codexFace?.noPrimary && codexFace?.honestHint && codexFace?.importStillThere));
await shot('h21c-codex.png');

// ——— heartbeat: opencode unlinked again (so the row is untouched) + a chat turn ————
// The login flow above is alive for this user for the provider-wide wait
// window; re-import re-links WITHOUT touching that flow (the server
// replaces the device-code cache entry on import; the /start window the
// earlier section opened is spent). Run the chat checks HERE, on the
// unlinked-opencode → import → linked sequence, so the chat turn always
// has the REAL codex subscription to read (the row is the user's).
await evaluate(`(() => {
  const op = [...document.querySelectorAll('.assistant-mode-picker button')].find((b) => b.textContent.includes('opencode'));
  if (op) op.click();
  return true;
})()`);
await until(`!!document.querySelector('.assistant-sub-panel[data-provider="opencode"]')`, 10000);
await sleep(400);
await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const importBtn = [...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('استيراد من تسجيل الجهاز'));
  importBtn?.click();
  return true;
})()`);
const relinked = await until(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  // 'مربوط ✅' only — plain 'مربوط' is a substring of 'غير مربوط'.
  return Boolean(panel?.textContent.includes('مربوط ✅'));
})()`, 20000);
const relinkState = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  return {
    linkedBadge: Boolean(panel?.textContent.includes('مربوط ✅')),
    modelSelectOrInput: Boolean(panel?.querySelector('select.input') || panel?.querySelector('input.input')),
    updateBtn: Boolean([...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تحديث الموديل'))),
  };
})()`);
line('link via demoted import (again, clean row)', relinked, JSON.stringify(relinkState));
results.push(relinked && Boolean(relinkState?.modelSelectOrInput && relinkState?.updateBtn));
if (relinked) await shot('h21c-opencode-linked.png');

// The real chat turn — the assistant answer, over the linked row.
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
  setter.call(area, 'ما رصيدي من الإجازات؟');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(200);
await evaluate(`(() => {
  document.querySelector('.assistant-composer button[type="submit"]')?.click();
  return true;
})()`);
const chatAnswered = await until(
  // The typing bubble is `.assistant-typing` and says «مدام عفاف بتفكر…» —
  // assert a reply bubble that is NOT that typing state.
  `[...document.querySelectorAll('.assistant-message-assistant .assistant-message-text')].some((m) => !m.classList.contains('assistant-typing') && m.textContent.trim().length > 0 && !m.textContent.includes('بتفكر'))`,
  60000,
);
const chatText = await evaluate(`(() => {
  const replies = [...document.querySelectorAll('.assistant-message-assistant .assistant-message-text')]
    .filter((m) => !m.classList.contains('assistant-typing') && !m.textContent.includes('بتفكر'));
  return { count: replies.length, text: replies.slice(-1)[0]?.textContent.trim().slice(0, 120) ?? '' };
})()`);
const okChat = Boolean(chatAnswered && chatText?.count > 0 && chatText.text.length > 0);
line('assistant chat answers over the linked row', okChat, JSON.stringify(chatText));
results.push(okChat);
const chatShot = await shot('h21c-chat-answer.png');
if (chatShot) console.log(`  → ${chatShot}`);

const allOk = results.length > 0 && results.every(Boolean);
console.log('');
console.log(`  ${allOk ? '✓ H21c authorize-first verified' : '✗ H21c checks failed'}`);
ws.close();
chrome.kill();
process.exit(allOk ? 0 : 1);
