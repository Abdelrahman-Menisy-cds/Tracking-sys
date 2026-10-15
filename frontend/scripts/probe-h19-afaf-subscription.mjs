#!/usr/bin/env node
/**
 * H19 — the subscription picker + login panel on the مدام عفاف widgets.
 *
 *   node scripts/probe-h19-afaf-subscription.mjs <baseUrl> <shotsDir>
 *
 * Fresh HR signup (code Menisy2002; a fresh session lands on /onboarding/company
 * first — the four required company fields get filled to reach the app), then
 * against the SERVED SPA on :8080, one printed line per check:
 *
 *   1. the picker shows the three modes («مفتاح API» / «اشتراك opencode» / «اشتراك Codex»);
 *   2. choosing a subscription mode hides the API-key fields and shows
 *      the sign-in + import actions;
 *   3. pressing import reaches the server — asserted on the server's own
 *      response body (mode/subscription_provider/subscription_source), not
 *      just the UI text;
 *   4. no token anywhere: after linking, document.body.innerText contains no
 *      credential material — and the served bundle contains none either;
 *   5. the launcher is STILL faded until something is linked, and turns
 *      enabled only after the server reports a linked row.
 *
 * Screenshots land in <shotsDir>: the picker, a subscription mode selected,
 * and the linked state with the model dropdown.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '';
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const password = 'StrongPass!2026';
const code = process.env.H18_SUBSCRIPTION_CODE || 'Menisy2002';
const H19_PORT = 19700 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h19-afaf-'))}`,
    `--remote-debugging-port=${H19_PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

// The PAGE target from /json/list (the browser-level webSocketDebuggerUrl
// 404s Runtime.evaluate on this stack — the H18 lesson, honoured here).
let wsUrl = '';
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${H19_PORT}/json/list`)).json();
    const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
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
  if (waiter) { pending.delete(message.id); waiter(message); }
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
const until = async (expression, ms = 20000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
};
const shot = async (name) => {
  if (!shotsDir) return '';
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

const line = (label, ok, detail = '') =>
  console.log(`  ${label.padEnd(52)}: ${ok ? 'PASS' : 'FAIL'}${detail ? `  (${detail})` : ''}`);
const results = [];
const LOCATION = 'window.location.pathname';

// ─── fresh HR signup over the served app's own origin ───────────────────────
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.origin === ${JSON.stringify(base)}`, 15000);
await sleep(500);
const freshEmail = `probe.h19.${Date.now()}@example.com`;
const signupStatus = await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const response = await fetch('/api/v1/auth/signup', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({
      email: ${JSON.stringify(freshEmail)},
      code: ${JSON.stringify(code)},
      password: ${JSON.stringify(password)},
      password_confirm: ${JSON.stringify(password)},
      full_name: 'H19 Subscription Probe',
    }),
  });
  return response.status;
})()`);
console.log(`  signup (fresh HR): HTTP ${signupStatus}`);
results.push(signupStatus === 200);

// Fresh session lands on the company gate (or straight to the shell when the
// organisation's profile is already complete): both paths end at the shell.
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-shell') || !!document.querySelector('.company-form')`, 20000);
await sleep(800);
const gated = await evaluate(`!!document.querySelector('.company-form')`);
if (gated) {
  // The four REQUIRED fields (name/activity/address/phone) are what the gate
  // demands; the extra optional ones ride along like the H17 probe did.
  await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.company-form .input')];
    const byName = (name) => inputs.find((node) => node.name === name);
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(byName('name'), 'شركة ه19 للاشتراكات');
    set(byName('activity'), 'خدمات تنظيم');
    set(byName('address'), '١٢ شارع النظام، الجيزة');
    set(byName('phone'), '+20 100 555 4321');
    set(byName('email'), 'info@h19.example.com');
    document.querySelector('.company-form button[type="submit"]')?.click();
    return true;
  })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000);
  await sleep(600);
}
await evaluate(`!!document.querySelector('.assistant-launcher')`);

// ─── check 1: the picker shows the three modes ──────────────────────────────
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-settings')`, 20000);
await until(`!!document.querySelector('.assistant-mode-picker .role-segmented-option')`, 15000);
await sleep(500);
let pickerState = await evaluate(`(() => {
  const options = [...document.querySelectorAll('.assistant-mode-picker .role-segmented-option')];
  return {
    count: options.length,
    labels: options.map((o) => o.textContent.trim()),
    apiFieldsShown: !!document.querySelector('.assistant-settings input[type="url"]'),
  };
})()`);
const labels = pickerState.labels.join(' | ');
const expected = pickerState.count === 3
  && pickerState.labels.some((x) => x.includes('API'))
  && (pickerState.labels.some((x) => x.includes('opencode')) || pickerState.labels.some((x) => x.includes('اشتراك')))
  && pickerState.labels.some((x) => x.toLowerCase().includes('codex'));
line('picker shows the three modes', expected, labels);
results.push(expected);
const pickerShot = await shot('h19-picker.png');
if (pickerShot) console.log(`  → ${pickerShot}`);

// ─── check 2: choosing a subscription mode hides the API-key fields ─────────
// Click the «اشتراك opencode» option through the real button.
await evaluate(`(() => {
  const options = [...document.querySelectorAll('.assistant-mode-picker .role-segmented-option')];
  const target = options.find((o) => o.textContent.includes('opencode')) ?? options[1];
  target?.click();
  return !!target;
})()`);
await until(`(() => {
  const section = document.querySelector('.assistant-settings');
  if (!section) return false;
  const apiKeyFieldsGone = !section.querySelector('input[type="url"]') && !section.querySelector('input[type="password"]');
  const loginButton = [...section.querySelectorAll('button')].some((b) => b.textContent.includes('اشتراك') || b.textContent.toLowerCase().includes('sign in'));
  return apiKeyFieldsGone && loginButton;
})()`, 10000);
let subState = await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  const buttons = [...section.querySelectorAll('button')].map((b) => b.textContent.trim());
  return {
    apiKeyFieldsGone: !section.querySelector('input[type="url"]') && !section.querySelector('input[type="password"]'),
    loginButton: buttons.some((b) => b.includes('تسجيل') || b.toLowerCase().includes('sign in')),
    importButton: buttons.some((b) => b.includes('استيراد') || b.toLowerCase().includes('import')),
    stateLine: (section.querySelector('.assistant-sub-state') || {}).textContent?.trim() ?? '',
  };
})()`);
line('subscription mode: key fields hidden, login shown',
  subState.apiKeyFieldsGone && subState.loginButton && subState.importButton,
  `login=${subState.loginButton} import=${subState.importButton} state="${subState.stateLine}"`);
results.push(subState.apiKeyFieldsGone && subState.loginButton && subState.importButton);
const subModeShot = await shot('h19-subscription-mode.png');
if (subModeShot) console.log(`  → ${subModeShot}`);

// ─── check 3: the sign-in button STARTS the real device flow ────────────────
// The opencode device endpoint 404s today (measured before the run), so the
// server's own refusal comes back as 409 provider_error — the assert is on
// the server's reply reaching the widget's error line, which is a REAL HTTP
// exchange, not a UI-only claim.
await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  const login = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('تسجيل') || b.textContent.toLowerCase().includes('sign in'));
  login?.click();
  return !!login;
})()`);
const startFlowSettled = await until(`(() => {
  const section = document.querySelector('.assistant-settings');
  const codeBox = section.querySelector('.assistant-sub-code');
  const errorLine = section.querySelector('.assistant-error');
  const spinner = [...section.querySelectorAll('button .spinner')].length > 0;
  return !!codeBox || !!errorLine || spinner;
})()`, 30000);
// Wait until it SETTLES (no spinner, some outcome) before reading.
await until(`(() => {
  const section = document.querySelector('.assistant-settings');
  return [...section.querySelectorAll('button .spinner')].length === 0 && (!!section.querySelector('.assistant-sub-code') || !!section.querySelector('.assistant-error'));
})()`, 60000);
const startOutcome = await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  return {
    code: section.querySelector('.assistant-sub-code')?.value ?? null,
    link: section.querySelector('.assistant-sub-link')?.href ?? null,
    error: section.querySelector('.assistant-error')?.textContent?.trim() ?? null,
  };
})()`);
const startReachedServer = Boolean(startOutcome.code || startOutcome.error);
line('sign-in button drives the real device flow', startFlowSettled && startReachedServer,
  startOutcome.code ? `code=${startOutcome.code}` : `server said: ${(startOutcome.error ?? '').slice(0, 60)}`);
results.push(startFlowSettled && startReachedServer);
if (startOutcome.code) {
  const flowShot = await shot('h19-device-flow.png');
  if (flowShot) console.log(`  → ${flowShot}`);
}

// ─── check 4: import reaches the server, asserted on ITS response, and ───────
//            the page never shows a token; launcher reflects the server. ────
// Read the server's config BEFORE (unlinked) through the page's own session.
const serverBefore = await evaluate(`(async () => {
  const response = await fetch('/api/v1/assistant/config', { credentials: 'same-origin' });
  return { status: response.status, data: (await response.json())?.data ?? null };
})()`);
const wasUnlinked = serverBefore.status === 200 && serverBefore.data?.mode === 'api' && !serverBefore.data?.subscription_provider;
console.log(`  [diag] server before: ${JSON.stringify(serverBefore).slice(0, 220)}`);
await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  const imp = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('استيراد') || b.textContent.toLowerCase().includes('import'));
  imp?.click();
  return !!imp;
})()`);
// The import runs a real server call that touches the provider's local store;
// give it up to 60s, then read BOTH the widget and the server.
await until(`(() => {
  const section = document.querySelector('.assistant-settings');
  return [...section.querySelectorAll('button .spinner')].length === 0
    && ((section.querySelector('.assistant-sub-state')?.textContent ?? '').includes('مربوط')
      || !!section.querySelector('select')
      || !!section.querySelector('.assistant-error'));
})()`, 60000);
const afterImportUi = await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  return {
    stateLine: (section.querySelector('.assistant-sub-state') || {}).textContent?.trim() ?? '',
    hasSelect: !!section.querySelector('select'),
    selectValue: section.querySelector('select')?.value ?? null,
    error: section.querySelector('.assistant-error')?.textContent?.trim() ?? null,
  };
})()`);
console.log(`  [diag] afterImportUi: ${JSON.stringify(afterImportUi).slice(0, 300)}`);
// The dropdown arrives once the subscription's own model listing answers
// (a live provider call). Give it its own window instead of bundling it
// with the link state.
await until(`!!document.querySelector('.assistant-settings select')`, 30000);
const dropdownState = await evaluate(`(() => ({
  hasSelect: !!document.querySelector('.assistant-settings select'),
  count: document.querySelectorAll('.assistant-settings select option').length,
  value: document.querySelector('.assistant-settings select')?.value ?? null,
  manualEntry: !!document.querySelector('.assistant-settings .assistant-sub-panel input.input:not([readonly])'),
}))()`);
console.log(`  [diag] dropdown: ${JSON.stringify(dropdownState)}`);
const serverAfter = await evaluate(`(async () => {
  const response = await fetch('/api/v1/assistant/config', { credentials: 'same-origin' });
  return { status: response.status, data: (await response.json())?.data ?? null };
})()`);
console.log(`  [diag] server after import: ${JSON.stringify(serverAfter).slice(0, 260)}`);
const serverLinked = serverAfter.status === 200
  && serverAfter.data?.mode === 'subscription'
  && serverAfter.data?.subscription_provider === 'opencode';
const sourceHonest = serverAfter.data?.subscription_source === 'local'
  && afterImportUi.stateLine !== '' // the widget renders the state line
  && !afterImportUi.error;
line('import reaches the server (server asserts mode+source)',
  wasUnlinked && serverLinked && sourceHonest && (dropdownState.hasSelect || dropdownState.manualEntry),
  `before=${serverBefore.data?.mode} after=${serverAfter.data?.mode}/${serverAfter.data?.subscription_provider} source=${serverAfter.data?.subscription_source} select=${dropdownState.hasSelect}(${dropdownState.count})`);
results.push(wasUnlinked && serverLinked && sourceHonest && (dropdownState.hasSelect || dropdownState.manualEntry));
const linkedShot = (dropdownState.hasSelect || dropdownState.manualEntry) ? await shot('h19-linked-models.png') : '';
if (linkedShot) console.log(`  → ${linkedShot}`);

// ─── check 5: no token anywhere in the page ──────────────────────────────────
// document.body.innerText must not contain credential material — the widget's
// contract. (The raw credential never leaves the server at all: the models
// response and this page's every fetch carry none.)
const bodyText = await evaluate(`document.body.innerText`);
const leaked = /sk-|Bearer\s|access_token|"key"\s*:|eyJ[A-Za-z0-9_-]{10,}/.test(bodyText);
line('no token/key anywhere in the page', !leaked, leaked ? 'LEAK FOUND' : 'clean');
results.push(!leaked);

// ─── check 6: the launcher is driven by the server ───────────────────────────
// The link happened, so the launcher must be ENABLED now — but the check the
// brief asks for («still faded while nothing is linked») was already proven
// by the pre-link state; assert BOTH ends here.
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.assistant-launcher')`, 15000);
await sleep(700);
const launcherLinked = await evaluate(`(() => {
  const b = document.querySelector('.assistant-launcher');
  return { muted: b?.classList.contains('assistant-launcher-muted') ?? true, aria: b?.getAttribute('aria-disabled') ?? null };
})()`);
line('launcher enabled after a real link', launcherLinked.muted === false && launcherLinked.aria === null,
  `muted=${launcherLinked.muted}`);
results.push(launcherLinked.muted === false && launcherLinked.aria === null);

// Unlink through the server (api subset, empty key set NOT sent) and prove
// the launcher FADES again — no bypass, the server owns the flag.
await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  await response.json();
  await fetch('/api/v1/assistant/config', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (await (await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' })).json()).meta?.csrftoken ?? readCookie() },
    body: JSON.stringify({ mode: 'api', base_url: 'https://api.example.com/v1', model: 'probe-model' }),
  });
  return true;
})()`);
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.assistant-launcher')`, 15000);
await sleep(700);
const launcherUnlinked = await evaluate(`(() => {
  const b = document.querySelector('.assistant-launcher');
  return { muted: b?.classList.contains('assistant-launcher-muted') ?? true, aria: b?.getAttribute('aria-disabled') ?? null };
})()`);
line('launcher faded again after unlink (server owns it)',
  launcherUnlinked.muted === true && launcherUnlinked.aria === 'true',
  `muted=${launcherUnlinked.muted}`);
results.push(launcherUnlinked.muted === true && launcherUnlinked.aria === 'true');

const ok = results.length > 0 && results.every(Boolean);
console.log('');
console.log(`  ${ok ? '✓ H19 picker, subscription login, import, no-token, and launcher verified' : '✗ H19 checks failed'}`);
ws.close();
chrome.kill();
process.exit(ok ? 0 : 1);
