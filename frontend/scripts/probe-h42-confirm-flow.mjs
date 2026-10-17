#!/usr/bin/env node
/**
 * H42 - the confirmation card + receipt speak the user's language, measured
 * against the SERVED build.
 *
 *   node scripts/probe-h42-confirm-flow.mjs [baseUrl] [email] [password]
 *
 * Part A (REAL): ask مدام عفاف to raise a request; the pending card must
 * name the tool «إنشاء طلب» - never `create_request` - carry dict labels
 * with a readable «نوع الطلب: #N» value, never a `submit` line, and its
 * note must be the honest draft/submit sentence. تأكيد then produces a
 * receipt with the promised title, a SHORT «مرجع» (no whole UUID), and a
 * dict-translated status.
 *
 * Part B (deterministic, driver-mocked REAL shapes): twice over the real
 * pending-action contract - submit:true (changing-system note, PENDING
 * receipt under «مرجع») and submit:false + a refused step (`submitted:
 * false` + a real reason sentence → the truth line). Light AND dark themes
 * get the card and their screenshots.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args[0] ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const email = args[1] || 'hr@demo.local';
const password = args[2] || 'demo1234';
const PORT = 8800 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NOTE_DRAFT = 'مفيش حاجة هتتغير — هيتحفظ كمسودة بس ومش هيتقدّم قبل ما تراجعه.';
const NOTE_CHANGING = 'هيتغيّر في النظام — مش هيحصل حاجة قبل تأكيدك.';
const TOOL_NAMES = ['إنشاء طلب', 'تحديد حالة طلب', 'تحديد حالة جدول زمني', 'إرسال جدول زمني', 'إنشاء مهمة', 'تسجيل حضور'];
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const REFUSED_REASON = 'الطلب بيتفاوت على فترة معلقة فعليًا، فالإرسال ما كمّل وحُفظ كمسودة.';

let failed = 0;
const check = (label, ok, value = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${value === '' ? '' : ` — ${JSON.stringify(value)}`}`);
};
const note = (label, value) => console.log(`      ${label}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h42-flow-'))}`,
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,1000',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
process.on('exit', () => chrome.kill());

let wsUrl = '';
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch { /* chrome still starting */ }
  await sleep(200);
}
if (!wsUrl) { console.error('FAIL  chrome never exposed a page target'); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let messageId = 0;
const pending = new Map();
const pausedQueue = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Fetch.requestPaused') { pausedQueue.push(message.params); return; }
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); waiter(message); }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++messageId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const nextPaused = async (graceMs = 250) => {
  const immediate = pausedQueue.shift();
  if (immediate) return immediate;
  await sleep(graceMs);
  return pausedQueue.shift() ?? null;
};
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
    await sleep(300);
  }
  return false;
};
const shot = async (file) => {
  try {
    const dir = join(process.cwd(), 'docs/screenshots');
    mkdirSync(dir, { recursive: true });
    const data = await send('Page.captureScreenshot', { format: 'png' });
    if (!data.result?.data) return 'no image data';
    writeFileSync(join(dir, file), Buffer.from(data.result.data, 'base64'));
    return `docs/screenshots/${file}`;
  } catch (failure) { return String(failure).slice(0, 120); }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

/* ------------------------------- login ------------------------------- */
await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('input[type="email"]')`);
const setValue = (selector, value) => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(element, ${JSON.stringify(value)});
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
let signedIn = false;
for (let attempt = 0; attempt < 4 && !signedIn; attempt++) {
  await evaluate(setValue('input[type="email"]', email));
  await evaluate(setValue('input[type="password"]', password));
  await evaluate(`(() => {
    const submit = document.querySelector('.login-submit')
      || [...document.querySelectorAll('button')].find((node) => /دخول|Sign in|Log in/i.test(node.textContent || ''));
    if (!submit) return false;
    submit.click();
    return true;
  })()`);
  signedIn = await until(`location.pathname !== '/login'`, 9000);
  if (!signedIn) await sleep(1200);
}
check('login as HR demo identity', signedIn);
if (!signedIn) process.exit(1);

/* --------------------------- tour + launcher --------------------------- */
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.assistant-launcher')`);
await sleep(1000);
// The onboarding tour intercepts presses: skip it FIRST, then interact.
await evaluate(`(() => {
  const skip = [...document.querySelectorAll('button')].find((node) => /تخطي الجولة|Skip the tour/i.test(node.textContent || ''));
  if (skip) skip.click();
  return !!skip;
})()`);
await sleep(600);
await evaluate(`(() => {
  const skip = [...document.querySelectorAll('button')].find((node) => /تخطي الجولة|Skip the tour/i.test(node.textContent || ''));
  if (skip) skip.click();
  return true;
})()`);
await sleep(400);
await evaluate(`document.querySelector('.assistant-launcher').click()`);
await until(`!!document.querySelector('.assistant-panel')`);
const muted = await evaluate(`document.querySelector('.assistant-launcher').classList.contains('assistant-launcher-muted')`);
check('assistant launcher enabled (model linked)', muted === false);

const typeIntoComposer = (text) => `(() => {
  const input = document.querySelector('.assistant-composer-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
const pressEnter = `(() => {
  document.querySelector('.assistant-composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return true;
})()`;
const waitSettled = async (ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => {
      const panel = document.querySelector('.assistant-panel');
      if (!panel) return null;
      const typing = panel.querySelectorAll('.assistant-typing-row').length;
      const card = panel.querySelector('.assistant-action-card');
      const error = panel.querySelector('.assistant-error-card');
      return {
        typing,
        card: !!card,
        error: error ? error.textContent.slice(0, 120) : null,
        lastReply: ([...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap')).pop() || {}).textContent?.slice(0, 140) ?? null,
      };
    })()`);
    if (state && state.typing === 0 && (state.card || state.error || state.lastReply)) return state;
    await sleep(1000);
  }
  return { timeout: true };
};
/** Everything H42 demands of the DISPLAYED card, read off the live DOM. */
const readCard = () => evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  const card = panel.querySelector('.assistant-action-card');
  if (!card) return null;
  const panelRect = panel.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const transcript = panel.querySelector('.assistant-transcript');
  const typRow = (label) => [...card.querySelectorAll('.assistant-action-arg')].find((row) => row.querySelector('dt')?.textContent.trim() === label);
  return {
    toolName: card.querySelector('.assistant-action-name')?.textContent.trim() ?? null,
    text: card.innerText,
    labels: [...card.querySelectorAll('dt')].map((n) => n.textContent.trim()),
    typeValue: typRow('نوع الطلب')?.querySelector('dd')?.textContent.trim() ?? null,
    note: card.querySelector('p.page-meta')?.textContent.trim() ?? null,
    insidePanel: cardRect.right <= panelRect.right + 1 && cardRect.left >= panelRect.left - 1,
    horizontalScrollAmount: transcript.scrollWidth - transcript.clientWidth,
    rawTool: card.innerText.includes('create_request') || card.innerText.includes('request_type_id'),
    hasSubmitWord: /submit|إرسال فوري/.test(card.innerText)
      || [...card.querySelectorAll('dt')].some((n) => /submit|^لا$/.test(n.textContent.trim())),
    hasFalse: /\bfalse\b/.test(card.innerText),
  };
})()`);

/* ============ Part A - the REAL flow: ask → card → تأكيد → receipt ============ */
console.log('── Part A: REAL assistant, REAL confirm ──');
await evaluate(typeIntoComposer('قدّم لي طلب إجازة اعتيادية باسم إجازة شتوية لمدة يومين'));
await evaluate(pressEnter);
// The provider is not deterministic: a turn may come back as PROSE asking
// for confirmation instead of a pending card. Follow up once or twice -
// the card appearing IS the brief's front line - before declaring missing.
let realTurn = null;
for (let attempt = 0; attempt < 3; attempt++) {
  realTurn = await waitSettled(200000);
  if (realTurn?.card || realTurn?.error) break;
  note(`REAL turn came back as prose (attempt ${attempt + 1}) — following up`, realTurn?.lastReply);
  await evaluate(typeIntoComposer('أكدي: أنفّذها كمسودة بس'));
  await evaluate(pressEnter);
}
check('REAL ask produced a pending confirmation card', !!realTurn?.card, realTurn?.lastReply);
if (realTurn?.card) {
  const card = await readCard();
  note('real card', { toolName: card.toolName, labels: card.labels, typeValue: card.typeValue, note: card.note });
  check('★ REAL card names the tool in Arabic (no create_request)', TOOL_NAMES.includes(card.toolName), card.toolName);
  check('★ REAL card: no raw technical keys anywhere on it', card.rawTool === false, card.text.slice(0, 200));
  check('★ REAL card: no submit word, no false', card.hasSubmitWord === false && card.hasFalse === false, card.text.slice(0, 200));
  check('REAL card: labels are dict labels (نوع الطلب / العنوان)', card.labels.includes('نوع الطلب') && card.labels.includes('العنوان'), card.labels);
  check('★ REAL card: the type value reads #N (honest, no invented name)', card.typeValue === null || /^#\d+$/.test(card.typeValue), card.typeValue);
  check('★ REAL card: the note is the honest draft/submit sentence', card.note === NOTE_DRAFT || card.note === NOTE_CHANGING, card.note);
  check('REAL card still fits the panel (no H41 regression)', card.insidePanel === true && card.horizontalScrollAmount <= 2, card);
  await shot('h42-real-card.png');
  await evaluate(`(() => {
    const card = document.querySelector('.assistant-action-card');
    const confirm = [...card.querySelectorAll('button')].find((node) => node.textContent.trim() === 'تأكيد');
    if (confirm) confirm.click();
    return !!confirm;
  })()`);
  const receiptArrived = await until(
    `(() => {
      const panel = document.querySelector('.assistant-panel');
      if (!panel) return true;
      return !panel.querySelector('.assistant-action-card') || !!panel.querySelector('.assistant-error');
    })()`,
    90000,
  );
  if (!receiptArrived) { check('REAL confirm: receipt arrived within 90s', false); }
  await sleep(900);
  await waitSettled(120000);
  const receiptState = await evaluate(`(() => {
    const panel = document.querySelector('.assistant-panel');
    const last = [...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap')).pop();
    return {
      text: last ? last.textContent : '',
      codeText: last ? [...last.querySelectorAll('code')].map((n) => n.textContent.trim()) : [],
      boldHeadline: last ? [...last.querySelectorAll('strong')].some((node) => node.textContent.includes('تم إنشاء الطلب')) : false,
      uuidShown: /\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b/i.test(panel.innerText),
      refShown: last ? last.textContent.includes('المرجع: ') : false,
      statusWords: last ? last.textContent.includes('الحالة: مسودة') || last.textContent.includes('بانتظار') || last.textContent.includes('معتمد') : false,
      rawObject: panel.innerText.includes('[object Object]'),
      error: panel.querySelector('.assistant-error')?.textContent.slice(0, 120) ?? null,
    };
  })()`);
  note('real receipt', receiptState);
  check('REAL receipt: bold headline «تم إنشاء الطلب.»', receiptState.boldHeadline, receiptState.text.slice(0, 120));
  check('★ REAL receipt: the reference is a SHORT tail (…xxxxxx), never the whole UUID', !receiptState.uuidShown && receiptState.refShown, { uuidShown: receiptState.uuidShown, refs: receiptState.codeText });
  check('★ REAL receipt: status is a dict word (مسودة/بانتظار/معتمد), not DRAFT', receiptState.statusWords, receiptState.text.slice(0, 200));
  check('★ REAL flow: no "[object Object]" and no error', receiptState.rawObject === false && receiptState.error === null, receiptState.error);
  await shot('h42-real-receipt.png');
} else {
  console.log('WARN  no pending card in the REAL turn — Part B carries the deterministic proof.');
  await shot('h42-real-no-card.png');
}

/* ========= Part B - deterministic display layer (driver-mocked, REAL shapes) ========= */
console.log('── Part B: mocked chat/confirm with the REAL pinned response shapes ──');
const MOCK_REPLY = [
  'حاضر، سأجهز لك الآن مسودة الطلب — وبعدها نراجعها قبل الإرسال.',
  '',
  '| البند | القيمة |',
  '|---|---|',
  '| نوع الطلب | إجازة اعتيادية |',
  '',
].join('\n');
const fulfill = async (paused, code, body) => {
  await send('Fetch.fulfillRequest', {
    requestId: paused.requestId,
    responseCode: code,
    body: Buffer.from(body).toString('base64'),
  });
};
const MOCK_CHAT_BODY = (submit) => JSON.stringify({
  data: {
    reply: MOCK_REPLY,
    pending_action: {
      token: `probe-mock-token-${submit ? 'submit' : 'draft'}-0123456789abcdef`,
      name: 'create_request',
      args: {
        request_type_id: 1,
        title: 'إجازة اعتيادية - يوم 25',
        details: 'طلب إجازة اعتيادية للديمو',
        submit,
      },
    },
    tool_trace: [],
  },
});
const UUID_A = 'f0e1d2c3-4a5b-4c7d-8e9f-0a1b2c396379';
const MOCK_CONFIRM_BODY = {
  tool: 'create_request',
  result: { ok: true, request_id: UUID_A, status: 'PENDING_MANAGER' },
};
const MOCK_CONFIRM_REFUSED = {
  tool: 'create_request',
  result: {
    ok: true,
    request_id: UUID_A,
    status: 'DRAFT',
    submitted: false,
    message: REFUSED_REASON,
  },
};

/* ── B1: submit:true — the changing-system note + the short ref receipt ── */
await send('Fetch.enable', {
  patterns: [
    { urlPattern: '*api/v1/assistant/chat*', requestStage: 'Request' },
    { urlPattern: '*api/v1/assistant/actions/*confirm*', requestStage: 'Request' },
  ],
});
await evaluate(typeIntoComposer('سؤال المحاكاة الأول: قدّم لي طلب إجازة فوري'));
await evaluate(pressEnter);
let pausedChat = await nextPaused(2500);
if (!pausedChat) pausedChat = await nextPaused(2500);
if (pausedChat) await fulfill(pausedChat, 200, MOCK_CHAT_BODY(true));
else { console.log('FAIL  the chat request was never captured by the driver mock'); process.exit(1); }

await until(`!!document.querySelector('.assistant-action-card')`, 15000);
const b1Card = await readCard();
note('B1 card', { toolName: b1Card.toolName, labels: b1Card.labels, typeValue: b1Card.typeValue, note: b1Card.note });
check('★ B1: the tool reads «إنشاء طلب»', b1Card.toolName === 'إنشاء طلب', b1Card.toolName);
check('★ B1: create_request / request_type_id appear NOWHERE on the card', b1Card.rawTool === false, b1Card.text.slice(0, 200));
check('★ B1: no submit row, no false, no إرسال فوري', b1Card.hasSubmitWord === false && b1Card.hasFalse === false && !b1Card.labels.includes('إرسال فوري'), b1Card.labels);
check('★ B1: request type reads «نوع الطلب: #1» — a value, not the raw 1', b1Card.typeValue === '#1', b1Card.typeValue);
check('★ B1: note matches the immediate action', b1Card.note === NOTE_CHANGING, b1Card.note);
check('B1: card fits the panel', b1Card.insidePanel === true && b1Card.horizontalScrollAmount <= 2, b1Card);
await shot('h42-b1-card-light.png');
await evaluate(`document.documentElement.dataset.theme = 'dark'`);
await sleep(400);
check('B1: dark theme applied', (await evaluate(`document.documentElement.dataset.theme`)) === 'dark');
await shot('h42-b1-card-dark.png');
await evaluate(`document.documentElement.dataset.theme = 'light'`);
await sleep(200);

await evaluate(`(() => {
  const card = document.querySelector('.assistant-action-card');
  const confirm = [...card.querySelectorAll('button')].find((node) => node.textContent.trim() === 'تأكيد');
  if (confirm) confirm.click();
  return !!confirm;
})()`);
let pausedConfirm = await nextPaused(2500);
if (!pausedConfirm) pausedConfirm = await nextPaused(2500);
if (pausedConfirm) await fulfill(pausedConfirm, 200, JSON.stringify({ data: MOCK_CONFIRM_BODY }));
else { console.log('FAIL  the confirm request was never captured'); process.exit(1); }

await until(`document.querySelector('.assistant-panel') && !document.querySelector('.assistant-action-card')`, 15000);
await sleep(700);
let b1Receipt = null;
for (let round = 0; round < 20; round++) {
  b1Receipt = await evaluate(`(() => {
    const panel = document.querySelector('.assistant-panel');
    const last = [...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap')).pop();
    return last ? { text: last.textContent, code: [...last.querySelectorAll('code')].map((n) => n.textContent.trim()) } : null;
  })()`);
  if (b1Receipt && b1Receipt.text.includes('المرجع')) break;
  await sleep(600);
}
note('B1 receipt', b1Receipt);
check('★ B1 receipt: «المرجع: …396379» — the UUID never displays whole', b1Receipt && !UUID_RE.test(b1Receipt.text) && JSON.stringify(b1Receipt.code).includes('…396379'), b1Receipt?.code);
check('★ B1 receipt: the promised العنوان is on it', b1Receipt && b1Receipt.text.includes('العنوان: إجازة اعتيادية - يوم 25'), b1Receipt?.text.slice(0, 200));
check('★ B1 receipt: الحالة is a dict word (بانتظار مراجعة المدير)', b1Receipt && b1Receipt.text.includes('الحالة: بانتظار مراجعة المدير'), b1Receipt?.text.slice(0, 200));
check('B1 receipt: no [object Object]', b1Receipt && !b1Receipt.text.includes('[object Object]'));

/* ── B2: submit:false + a refused step — the truth note + the truth receipt ── */
await evaluate(typeIntoComposer('سؤال المحاكاة الثاني: احفظ إجازة تانية كمسودة بس'));
await evaluate(pressEnter);
pausedChat = await nextPaused(2500);
if (!pausedChat) pausedChat = await nextPaused(2500);
if (pausedChat) await fulfill(pausedChat, 200, MOCK_CHAT_BODY(false));
else { console.log('FAIL  the second chat request was never captured'); process.exit(1); }

await until(`!!document.querySelector('.assistant-action-card')`, 15000);
const b2Card = await readCard();
note('B2 card', { note: b2Card.note, labels: b2Card.labels });
check('★ B2: the draft note is the «nothing changes» sentence', b2Card.note === NOTE_DRAFT, b2Card.note);
check('★ B2: still no submit row / raw keys', b2Card.rawTool === false && b2Card.hasSubmitWord === false && b2Card.hasFalse === false, b2Card.text.slice(0, 200));

await evaluate(`(() => {
  const card = document.querySelector('.assistant-action-card');
  const confirm = [...card.querySelectorAll('button')].find((node) => node.textContent.trim() === 'تأكيد');
  if (confirm) confirm.click();
  return !!confirm;
})()`);
pausedConfirm = await nextPaused(2500);
if (!pausedConfirm) pausedConfirm = await nextPaused(2500);
if (pausedConfirm) await fulfill(pausedConfirm, 200, JSON.stringify({ data: MOCK_CONFIRM_REFUSED }));
else { console.log('FAIL  the second confirm request was never captured'); process.exit(1); }

await until(`document.querySelector('.assistant-panel') && !document.querySelector('.assistant-action-card')`, 15000);
await sleep(700);
let b2Receipt = null;
for (let round = 0; round < 20; round++) {
  b2Receipt = await evaluate(`(() => {
    const panel = document.querySelector('.assistant-panel');
    const last = [...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap')).pop();
    return last ? { text: last.textContent, code: [...last.querySelectorAll('code')].map((n) => n.textContent.trim()) } : null;
  })()`);
  if (b2Receipt && b2Receipt.text.includes('ما كمّلش')) break;
  await sleep(600);
}
note('B2 receipt', b2Receipt);
check('★ B2 receipt: the refusal speaks the truth', b2Receipt && b2Receipt.text.includes('اتعمل مسودة بس الإرسال ما كمّلش — السبب:') && b2Receipt.text.includes(REFUSED_REASON), b2Receipt?.text.slice(0, 300));
check('★ B2 receipt: the draft honestly remains (الحالة: مسودة)', b2Receipt && b2Receipt.text.includes('الحالة: مسودة'), b2Receipt?.text.slice(0, 300));
check('★ B2 receipt: no machine tokens (validation_error/false)', b2Receipt && !/validation_error|\bfalse\b/.test(b2Receipt.text), b2Receipt?.text.slice(0, 200));
check('★ B2 receipt: short ref, not the UUID', b2Receipt && !UUID_RE.test(b2Receipt.text) && JSON.stringify(b2Receipt.code).includes('…396379'), b2Receipt?.code);
check('★ whole panel never painted [object Object]', (await evaluate(`!document.querySelector('.assistant-panel').innerText.includes('[object Object]')`)) === true);

console.log(failed === 0 ? '\nALL H42 CHECKS PASSED' : `\n${failed} H42 CHECK(S) FAILED`);
ws.close();
chrome.kill();
process.exit(failed === 0 ? 0 : 1);
