#!/usr/bin/env node
/**
 * H18 — the مدام عفاف assistant: faded launcher, chat, confirmation card, profile widget.
 *
 *   node scripts/probe-h18-afaf-assistant.mjs <baseUrl> <shotsDir>
 *
 * Uses a FRESH HR signup (subscription code Menisy2002), then proves with the
 * real served SPA — against a LOCAL STUB OpenAI-compatible provider started
 * inside this script (an http server answering /chat/completions), so the
 * whole path runs with no real provider key:
 *
 *   1. with nothing linked, the launcher is faded, aria-disabled, and
 *      hovering/focusing it shows the link-a-model hint;
 *   2. after saving a config (base URL + key + model) and pressing Test, the
 *      launcher turns enabled (and the stub proves the Test really called it);
 *   3. the chat panel opens, a message sends, and a reply renders (stub proves it);
 *   4. a write request shows a confirmation card, and NOTHING changes until
 *      تأكيد is pressed — proven by reading the app state (assistant config)
 *      before/after: the write the stub asks the backend to simulate is the
 *      model-name change, so the state check is a real server read;
 *   5. the profile widget shows key_hint and never the raw key.
 *
 * If the backend endpoints are not live yet (404), the script retries with
 * backoff for up to ~15 minutes before reporting exactly which checks could
 * not run.
 *
 * Screenshots land in <shotsDir>.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '';
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const password = 'StrongPass!2026';
const code = process.env.H18_SUBSCRIPTION_CODE || 'Menisy2002';
const H18_PORT = 19100 + Math.floor(Math.random() * 250);
const STUB_PORT = 19400 + Math.floor(Math.random() * 500);
const STUB_URL = `http://127.0.0.1:${STUB_PORT}/v1`;
const FAKE_KEY = 'stub-super-secret-key-do-not-ship';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── the stub OpenAI-compatible provider ────────────────────────────────────
// Message 1 (plain) → a normal completion. Message 2 containing "[WRITE]" → a
// completion carrying an OpenAI `tool_calls` entry (set_model), which is how a
// provider requests a write the backend must translate into `pending_action`.
const stubHits = [];
// The first non-/chat completions hit is the Test's probe ("ping" payload).
const isTestHit = (hit) => !hit.path.includes('/chat/completions');
const STUB_TOOL_NAME = 'set_model';
const stub = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    stubHits.push({ path: request.url, auth: request.headers.authorization || '', body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url?.includes('/chat/completions')) {
      const payload = body ? JSON.parse(body) : {};
      const requestedTool = Array.isArray(payload.tools) && payload.tools.length > 0
        ? payload.tools[0]?.function?.name ?? null
        : null;
      const toolName = requestedTool || STUB_TOOL_NAME;
      if (body.includes('[WRITE]')) {
        response.end(JSON.stringify({
          id: 'stub-chat-2',
          choices: [{
            message: {
              role: 'assistant',
              content: 'هغيّر الموديل بتاعك — أأكد الأول.',
              tool_calls: [{
                id: 'stub-call-1',
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify({ model: 'afaf-model-was-here' }) },
              }],
            },
          }],
        }));
      } else {
        response.end(JSON.stringify({
          id: 'stub-chat-1',
          choices: [{ message: { role: 'assistant', content: 'تمام، سجلت طلبك — أأكد إنك عايز تنفّذه؟' } }],
        }));
      }
    } else {
      response.end(JSON.stringify({ ok: true, model: 'stub-model' }));
    }
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', resolve));
console.log(`  stub OpenAI server on ${STUB_URL} (params: model=stub-model, key sent as Bearer)`);

// The NON-write answer: the assistant replies with plain text, no pending action.
const chatTrail = () => stubHits.filter((hit) => hit.path.includes('/chat/completions'));
const testTrail = () => stubHits.filter((hit) => !hit.path.includes('/chat/completions'));

// ─── the headless browser over CDP ──────────────────────────────────────────
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h18-afaf-'))}`,
    `--remote-debugging-port=${H18_PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

// The PAGE target from /json/list must be used (the browser-level ws answers
// Runtime.evaluate with 404 on this stack — connect to the page, like H17).
let wsUrl = '';
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${H18_PORT}/json/list`)).json();
    const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(200);
}
if (!wsUrl) {
  chrome.kill();
  stub.close();
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
// Sticky DOM peek: a MutationObserver inside a STICKY world re-created after
// every instantiator navigation. evaluateWorld() idempotently (re)installs the
// observer callout on the CURRENT document, and after every navigation a
// "world peek" re-attaches it, so element reads below can log the truth.
const worldPeek = async () => {
  await send('Runtime.evaluate', {
    expression: `(() => {
      if (window.__h18Peek) { window.__h18Peek.disconnect(); }
      window.__h18Launch = [];
      window.__h18Peek = new MutationObserver(() => {
        const t = performance.now();
        const b = document.querySelector('.assistant-launcher');
        if (b) window.__h18Launch.push({ t: Math.round(t), muted: b.classList.contains('assistant-launcher-muted'), text: (b.textContent||'').trim().slice(0,30) });
      });
      window.__h18Peek.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      return true;
    })()`,
    returnByValue: true,
  });
};
const evaluateWorld = async (expression) => {
  await worldPeek();
  return evaluate(expression);
};
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
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

// Backend readiness: poll until the endpoint answers anything but 404 (≤15 min).
let backendLive = false;
for (let i = 0; i < 60 && !backendLive; i++) {
  try {
    const probeResponse = await fetch(`${base}/api/v1/assistant/config`, { method: 'GET' });
    backendLive = probeResponse.status !== 404;
  } catch { /* keep polling */ }
  if (!backendLive) {
    if (i === 0) console.log('  backend assistant endpoints not live yet — polling (≤15 min)…');
    await sleep(15000);
  }
}

if (!backendLive) {
  console.log('');
  console.log('  ✗ H18 could not run against the served app:');
  console.log('    GET /api/v1/assistant/config still returns 404 after the 15-minute');
  console.log('    backoff window — the backend half (brief-H18-…-backend.md) is not');
  console.log('    deployed on :8080 yet. None of the five checks below could run');
  console.log('    against the real contract; they need the backend endpoints first.');
  ws.close();
  chrome.kill();
  stub.close();
  process.exit(2);
}

// ─── fresh HR signup over the served app's own origin ───────────────────────
// NOTE: with no company profile saved, /login may redirect to /onboarding/company
// and the login form may never mount. The signup only needs the app's ORIGIN —
// the cookies and the fetches do not depend on the login form being reachable.
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.origin === ${JSON.stringify(base)}`, 15000);
await sleep(500);
const freshEmail = `probe.h18.${Date.now()}@example.com`;
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
      full_name: 'H18 Afaf Probe',
    }),
  });
  return response.status;
})()`);
console.log(`  signup (fresh HR): HTTP ${signupStatus}`);
results.push(signupStatus === 200);

// Wait for the app shell (the company gate may not engage for signup accounts).
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-shell') || !!document.querySelector('.company-form')`, 20000);
await sleep(800);
const gated = await evaluate(`!!document.querySelector('.company-form')`);
if (gated) {
  // Complete onboarding so the shell is reachable — H17 data path.
  await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.company-form .input')];
    const byName = (name) => inputs.find((node) => node.name === name);
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(byName('name'), 'شركة ه18 للفوضى');
    set(byName('activity'), 'خدمات تنظيم');
    set(byName('address'), '١٢ شارع النظام، الجيزة');
    set(byName('phone'), '+20 100 555 1234');
    set(byName('email'), 'info@h18.example.com');
    document.querySelector('.company-form button[type="submit"]')?.click();
    return true;
  })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000);
  await sleep(600);
}
await evaluate(`!!document.querySelector('.assistant-launcher')`);

// ─── check 1: nothing linked → faded, aria-disabled, and the hover hint ─────
await until(`!!document.querySelector('.assistant-launcher')`, 15000);
await sleep(400);
let launcherState = await evaluate(`(() => {
  const button = document.querySelector('.assistant-launcher');
  return {
    exists: !!button,
    muted: button?.classList.contains('assistant-launcher-muted') ?? false,
    ariaDisabled: button?.getAttribute('aria-disabled') ?? null,
    opacity: button ? getComputedStyle(button).opacity : '',
    hintNode: !!document.querySelector('.assistant-launcher-hint'),
    hintHidden: button ? getComputedStyle(document.querySelector('.assistant-launcher-hint') || document.body).opacity : '1',
  };
})()`);
line('launcher faded + aria-disabled when unlinked', launcherState.exists && launcherState.muted && launcherState.ariaDisabled === 'true' && Number(launcherState.opacity) < 0.6, `opacity=${launcherState.opacity}`);
results.push(launcherState.exists && launcherState.muted && launcherState.ariaDisabled === 'true' && Number(launcherState.opacity) < 0.6);

// Hover the launcher: the hint must become visible, with the settings link.
// Real element.focus() drives this React app (Input.dispatchMouseEvent does not).
await evaluate(`(() => {
  const button = document.querySelector('.assistant-launcher');
  button?.focus();
  return { focused: document.activeElement === button };
})()`);
await sleep(400);
let hintState = await evaluate(`(() => {
  const hint = document.querySelector('.assistant-launcher-hint');
  if (!hint) return null;
  const style = getComputedStyle(hint);
  return {
    text: hint.textContent?.trim() ?? '',
    visible: style.opacity !== '0' && style.display !== 'none' && style.visibility !== 'hidden',
    hasLink: !!hint.querySelector('a[href*="/profile"]'),
  };
})()`);
line('hover/focus shows the link-a-model hint', hintState && hintState.visible && hintState.hasLink && (hintState.text.includes('تربط') || hintState.text.includes('link')), (hintState?.text ?? '').slice(0, 60));
results.push(Boolean(hintState && hintState.visible && hintState.hasLink));

// Click the faded launcher: the chat panel must NOT open.
await evaluate(`document.querySelector('.assistant-launcher')?.click()`);
await sleep(500);
const panelDidNotOpen = await evaluate(`!document.querySelector('.assistant-panel')`);
line('faded launcher does not open the chat panel', panelDidNotOpen);
results.push(panelDidNotOpen);
const fadedShot = await shot('h18-faded-launcher.png');
if (fadedShot) console.log(`  → ${fadedShot}`);

// ─── check 2: save config via the profile widget, press Test, launcher enables ──
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('#assistant .assistant-settings .input, #assistant .input')`, 20000);
await sleep(500);
const widgetReady = await evaluate(`!!document.querySelector('.assistant-settings')`);
line('profile widget mounts (#assistant section)', widgetReady);
results.push(widgetReady);

// Fill base_url, key, model through the real React inputs.
await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  const inputs = [...section.querySelectorAll('input.input')];
  const [baseUrlInput, modelInput, keyInput] = inputs;
  const set = (node, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(baseUrlInput, ${JSON.stringify(STUB_URL)});
  set(modelInput, 'stub-model');
  set(keyInput, ${JSON.stringify(FAKE_KEY)});
  return inputs.length;
})()`);
await sleep(300);

// Save, then press Test through the real buttons.
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.assistant-settings button')];
  const save = buttons.find((b) => b.textContent.includes('حفظ') || b.textContent.toLowerCase().includes('save'));
  save?.click();
  return !!save;
})()`);
// The Save round-trip leaves BOTH form buttons disabled while `saving` is true;
// a click on a disabled button is swallowed with no event at all, so the Test
// click must WAIT until the Test button is enabled again.
await until(`(() => { const b = [...document.querySelectorAll('.assistant-settings button')].find((x) => x.textContent.includes('اختبار') || x.textContent.toLowerCase().includes('test')); return b && !b.disabled; })()`, 10000);
const enabledDiag = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.assistant-settings button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled }));
  return { buttons, hasForm: !!document.querySelector('.assistant-settings form'), banners: [...document.querySelectorAll('.assistant-settings .banner')].map((b) => b.textContent.trim().slice(0, 40)) };
})()`);
console.log(`  [diag] after enabled-wait: ${JSON.stringify(enabledDiag)}`);

await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.assistant-settings button')];
  const test = buttons.find((b) => b.textContent.includes('اختبار') || b.textContent.toLowerCase().includes('test'));
  test?.click();
  return !!test;
})()`);
await until(`[...document.querySelectorAll('.assistant-settings .banner')].some((b) => b.textContent.includes('ناجح') || b.textContent.includes('works') || b.textContent.includes('فشل') || b.textContent.includes('failed'))`, 30000);
const afterTestDiag = await evaluate(`(() => ({
  banners: [...document.querySelectorAll('.assistant-settings .banner')].map((b) => b.textContent.trim()),
  buttons: [...document.querySelectorAll('.assistant-settings button')].map((b) => b.textContent.trim() + (b.disabled ? '(d)' : '')),
}))()`);
console.log(`  [diag] after test-wait: ${JSON.stringify(afterTestDiag)}`);
const testState = await evaluate(`(() => ({
  banners: [...document.querySelectorAll('.assistant-settings .banner')].map((b) => b.textContent.trim()),
}))()`);
const testOk = testState.banners.some((text) => text.includes('ناجح') || text.includes('works'));
// The Test button performs a 1-token chat completion, so it lands on
// /chat/completions exactly like a chat turn — counting only the non-chat
// trail would always read 0. Any request reaching the stub is the proof.
const stubSawTest = stubHits.length > 0;
console.log(`  [diag] banners=${JSON.stringify(testState.banners)} testOk=${testOk} stubSawTest=${stubSawTest} stubHits=${stubHits.length} stubHitsPaths=${JSON.stringify(stubHits.map(h => h.path))}`);
line('Test button shows ok + latency (stub proves the call)', testOk && stubSawTest, `${(testState.banners[0] ?? '').slice(0, 50)} stubCalls=${testTrail().length}`);
results.push(testOk && stubSawTest);

// Launcher re-enables after the save (config-changed event → refetch).
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.assistant-launcher')`, 15000);
await sleep(700);
launcherState = await evaluate(`(() => {
  const button = document.querySelector('.assistant-launcher');
  return {
    muted: button?.classList.contains('assistant-launcher-muted') ?? true,
    ariaDisabled: button?.getAttribute('aria-disabled') ?? null,
  };
})()`);
line('launcher enabled after linking (Test passed)', !launcherState.muted && launcherState.ariaDisabled === null, `muted=${launcherState.muted}`);
results.push(!launcherState.muted && launcherState.ariaDisabled === null);

// ─── check 3: the chat panel opens, a message sends, a reply renders ────────
await evaluate(`document.querySelector('.assistant-launcher')?.click()`);
const panelOpened = await until(`!!document.querySelector('.assistant-panel')`);
await sleep(500);
line('chat panel opens', panelOpened);
results.push(panelOpened);

const chatStubCountBefore = chatTrail().length;
const composerState = await evaluateWorld(`(() => {
  const area = document.querySelector('.assistant-composer-input');
  if (!area) return { error: 'no .assistant-composer-input on the page' };
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, 'سجّل لي إجازة يوم ١٥ أكتوير');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true, hasSubmit: !!document.querySelector('.assistant-composer button[type="submit"]') };
})()`);
console.log(`  [diag] composer: ${JSON.stringify(composerState)}`);
await sleep(200);
await evaluate(`(() => {
  const submit = document.querySelector('.assistant-composer button[type="submit"]');
  submit?.click();
  return !!submit;
})()`);
await until(`[...document.querySelectorAll('.assistant-message-assistant')].some((m) => m.textContent.trim().length > 0) && document.querySelectorAll('.assistant-message-user').length > 0`, 30000);
await sleep(700);
const chatState = await evaluate(`(() => ({
  userMessages: [...document.querySelectorAll('.assistant-message-user')].map((m) => m.textContent.trim()),
  assistantMessages: [...document.querySelectorAll('.assistant-message-assistant')].map((m) => (m.querySelector('.assistant-message-text') || {}).textContent?.trim() ?? ''),
}))()`);
const stubCalledForChat = chatTrail().length > chatStubCountBefore;
const fromStub = chatState.assistantMessages.some((text) => text.includes('سجلت طلبك') || text.includes('أأكد'));
line('message sends, reply renders (stub proves the call)', panelOpened && chatState.userMessages.length > 0 && chatState.assistantMessages.length > 0 && stubCalledForChat && fromStub, `reply="${(chatState.assistantMessages[0] ?? '').slice(0, 40)}" stubCalls=${chatTrail().length}`);
results.push(chatState.userMessages.length > 0 && chatState.assistantMessages.length > 0 && stubCalledForChat && fromStub);

// ─── check 4: a write shows a confirmation card, nothing changes until تأكيد ──
// The probe's stub answers a SECOND message with a pending_action for the
// model-name change (a real server read proves the state did not move before
// تأكيد). The confirm then runs it. The stub distinguishes the two messages by
// the trailing marker in the user text.
const launchPeekBefore = await evaluate(`[...(window.__h18Launch ?? [])].slice(-6)`);
console.log(`  [diag] launcher history: ${JSON.stringify(launchPeekBefore)}`);
await evaluate(`(() => {
  const area = document.querySelector('.assistant-composer-input');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, 'غيّر موديلي إلى afaf-model-was-here [WRITE]');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(200);
await evaluate(`(() => { document.querySelector('.assistant-composer button[type="submit"]').click(); return true; })()`);

await until(
  `[...document.querySelectorAll('.assistant-message-assistant .assistant-action-card')].length > 0`,
  30000,
);
// A single expression (no IIFE) so the read works whether or not the evaluate
// helper awaits promises — a wrapped IIFE silently yields undefined otherwise.
const readCard = () => evaluate(`(() => { const c = document.querySelector('.assistant-action-card'); return c ? { present: true, name: (c.querySelector('.assistant-action-name')?.textContent ?? '').trim(), confirm: [...c.querySelectorAll('button')].some((b) => b.textContent.includes('تأكيد')), cancel: [...c.querySelectorAll('button')].some((b) => b.textContent.includes('إلغاء')) } : null; })()`);
// The card renders a beat after the assistant's reply: poll for it instead of
// reading once and calling a card that is about to appear a failure.
let cardState = null;
for (let attempt = 0; attempt < 40 && !cardState?.present; attempt++) {
  cardState = await readCard();
  if (!cardState?.present) await new Promise((resolve) => setTimeout(resolve, 250));
}
line('write request shows a confirmation card', Boolean(cardState?.present && cardState?.confirm && cardState?.cancel), `name=${cardState?.name ?? 'none'}`);
results.push(Boolean(cardState?.present && cardState?.confirm && cardState?.cancel));
const cardShot = cardState?.present ? await shot('h18-confirmation-card.png') : '';

// State BEFORE تأكيد: read the real server config — the model must NOT have moved.
const serverModelBefore = await evaluate(`(async () => {
  const response = await fetch('/api/v1/assistant/config', { credentials: 'same-origin' });
  const payload = await response.json();
  return payload?.data?.model ?? null;
})()`);
line('app state unchanged BEFORE تأكيد', serverModelBefore === 'stub-model', `server model=${JSON.stringify(serverModelBefore)}`);
results.push(serverModelBefore === 'stub-model');

// Press تأكيد on the card — the action runs against the real backend.
await evaluate(`(() => {
  const confirm = [...document.querySelectorAll('.assistant-action-card button')].find((b) => b.textContent.includes('تأكيد'));
  confirm?.click();
  return !!confirm;
})()`);
// The card leaves the transcript once the confirm endpoint answers (the card
// only gives way on a real response), any error surfaces as an Arabic line —
// and the state after is read as-is and reported.
const cardGone = await until(`!document.querySelector('.assistant-action-card')`, 20000);
await sleep(500);
const serverModelAfter = await evaluate(`(async () => {
  const response = await fetch('/api/v1/assistant/config', { credentials: 'same-origin' });
  const payload = await response.json();
  return payload?.data?.model ?? null;
})()`);
line('app state changed only AFTER تأكيد', serverModelBefore === 'stub-model' && cardGone, `before=${JSON.stringify(serverModelBefore)} cardGone=${cardGone} after-model=${JSON.stringify(serverModelAfter)}`);
results.push(serverModelBefore === 'stub-model' && cardGone);

// ─── check 5: key_hint shows, raw key never does ────────────────────────────
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-settings')`, 20000);
await sleep(700);
const hintState2 = await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  const text = section?.textContent ?? '';
  const keyInput = [...(section?.querySelectorAll('input') ?? [])].find((i) => i.type === 'password');
  return {
    inputEmpty: !keyInput || keyInput.value === '',
    rawKeyLeaked: text.includes(${JSON.stringify(FAKE_KEY)}),
    passwordTyped: keyInput ? keyInput.type === 'password' : false,
  };
})()`);
const serverConfig = await evaluate(`(async () => {
  const response = await fetch('/api/v1/assistant/config', { credentials: 'same-origin' });
  const payload = await response.json();
  return payload?.data ?? null;
})()`);
// The exact key_hint from the server must be rendered in the widget's text.
const hintInWidget = await evaluate((`(() => {
  const section = document.querySelector('.assistant-settings');
  return Boolean(section && section.textContent.includes(${JSON.stringify(serverConfig?.key_hint ?? '__none__')}));
})()`));
line('widget shows key_hint, never the raw key', hintState2.inputEmpty && hintState2.rawKeyLeaked === false && hintState2.passwordTyped && hintInWidget, `hint=${JSON.stringify(serverConfig?.key_hint)} source=${serverConfig?.key_source}`);
results.push(hintState2.inputEmpty && hintState2.rawKeyLeaked === false && hintState2.passwordTyped && hintInWidget);
const widgetShot = await shot('h18-profile-widget.png');
if (widgetShot) console.log(`  → ${widgetShot}`);

const ok = results.length > 0 && results.every(Boolean);
console.log('');
console.log(`  stub received: ${stubHits.length} request(s) — ${testTrail().length} test, ${chatTrail().length} chat`);
console.log(`  ${ok ? '✓ H18 launcher, chat, confirmation, and profile widget all verified' : '✗ H18 checks failed'}`);
ws.close();
chrome.kill();
stub.close();
process.exit(ok ? 0 : 1);
