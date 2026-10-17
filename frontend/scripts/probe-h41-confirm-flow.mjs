#!/usr/bin/env node
/**
 * H41 - the [object Object] confirmation bug + the clipped card, measured
 * against the SERVED build.
 *
 *   node scripts/probe-h41-confirm-flow.mjs [baseUrl] [email] [password]
 *
 * Part A (REAL, the brief's front line): ask مدام عفاف to raise a request;
 * when the pending card appears press تأكيد; the panel must then show the
 * formal receipt (تم إنشاء الطلب / الرقم / الحالة) - never "[object Object]" -
 * and the card must fit inside the panel with NO horizontal scroll.
 *
 * Part B (deterministic display layer): the chat + confirm endpoints are
 * driver-mocked with the REAL pinned shapes (pinned by backend pytest and
 * accounts/assistant_chat.py): a reply carrying a markdown pipe TABLE and a
 * pending card whose args hold an unbreakable long token, then the confirm
 * body {tool, result:{ok, request_id, status}}. The renderer must paint a
 * real <table>, wrap the token, and show the object result as text.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args[0] ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const email = args[1] || 'hr@demo.local';
const password = args[2] || 'demo1234';
const PORT = 8700 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h41-flow-'))}`,
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
/** Wait for the turn to settle: typing bubble gone, then either a pending
 *  card OR a plain reply paragraph knows the turn ended. */
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
        card: card ? {
          name: card.querySelector('.assistant-action-name')?.textContent ?? null,
          labels: [...card.querySelectorAll('dt')].map((n) => n.textContent.trim()),
          confirm: !!card.querySelector('button.primary, button'),
        } : null,
        error: error ? error.textContent.slice(0, 120) : null,
        lastReply: ([...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap')).pop() || {}).textContent?.slice(0, 140) ?? null,
        rawObject: panel.innerText.includes('[object Object]'),
      };
    })()`);
    if (state && state.typing === 0 && (state.card || state.error || state.lastReply)) return state;
    await sleep(1000);
  }
  return { timeout: true };
};

/* ============ Part A - the REAL flow: ask → card → تأكيد → receipt ============ */
console.log('── Part A: REAL assistant, REAL confirm ──');
await evaluate(typeIntoComposer('قدّم لي طلب إجازة اعتيادية باسم إجازة شتوية لمدة يومين'));
await evaluate(pressEnter);
const realTurn = await waitSettled(200000);
note('real turn outcome', realTurn);
check('REAL ask produced a pending confirmation card (the promised card exists)', !!realTurn?.card, realTurn?.card?.name ?? realTurn?.lastReply);
if (realTurn?.card) {
  const beforeLayout = await evaluate(`(() => {
    const panel = document.querySelector('.assistant-panel');
    const card = panel.querySelector('.assistant-action-card');
    const transcript = panel.querySelector('.assistant-transcript');
    const panelRect = panel.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      cardInsidePanelX: cardRect.right <= panelRect.right + 1 && cardRect.left >= panelRect.left - 1,
      horizontalScrollAmount: transcript.scrollWidth - transcript.clientWidth,
      labels: [...card.querySelectorAll('dt')].map((n) => n.textContent.trim()),
    };
  })()`);
  note('real card layout', beforeLayout);
  check('REAL card takes its width from the panel (no clipping)', beforeLayout.cardInsidePanelX === true, beforeLayout);
  check('REAL card: no horizontal scroll in the transcript', beforeLayout.horizontalScrollAmount <= 2, beforeLayout.horizontalScrollAmount);
  check('REAL card shows localized labels (نوع الطلب among them)', beforeLayout.labels.some((l) => /نوع الطلب|العنوان/.test(l)), beforeLayout.labels);
  await shot('h41-real-card.png');
  await evaluate(`(() => {
    const card = document.querySelector('.assistant-action-card');
    const confirm = [...card.querySelectorAll('button')].find((node) => node.textContent.trim() === 'تأكيد');
    if (confirm) confirm.click();
    return !!confirm;
  })()`);
  // The confirm is in flight while the card shows «جارٍ الحفظ…»: settle only
  // once the card is consumed (receipt) or the honest error appears.
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
  const receipt = await waitSettled(120000);
  note('real confirm outcome', receipt);
  const receiptState = await evaluate(`(() => {
    const panel = document.querySelector('.assistant-panel');
    const last = [...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap')).pop();
    const transcript = panel.querySelector('.assistant-transcript');
    const panelRect = panel.getBoundingClientRect();
    const card = panel.querySelector('.assistant-action-card');
    const cardRect = card ? card.getBoundingClientRect() : null;
    return {
      text: last ? last.textContent : '',
      inlineId: last ? !!last.querySelector('code') : false,
      cardGoneNormally: card ? cardRect.right <= panelRect.right + 1 : true,
      stillOverflows: transcript.scrollWidth - transcript.clientWidth,
      rawObject: panel.innerText.includes('[object Object]'),
      error: panel.querySelector('.assistant-error')?.textContent.slice(0, 120) ?? null,
    };
  })()`);
  note('real receipt', receiptState);
  check('REAL confirm: card consumed cleanly (no overflow left behind)', receiptState.cardGoneNormally === true && receiptState.stillOverflows <= 2, receiptState);
  check('REAL confirm: receipt shows a rendered RUN of the id (code element), not raw object', receiptState.inlineId || /تم تنفيذ الإجراء|تم إنشاء/.test(receiptState.text), receiptState.text.slice(0, 120));
  check('★ REAL flow: no "[object Object]" anywhere in the panel', receiptState.rawObject === false);
  check('REAL confirm: no error card (honest success)', receiptState.error === null, receiptState.error);
  await shot('h41-real-receipt.png');
} else {
  console.log('WARN  no pending card in the REAL turn — is the provider linked/mood right? Display layer still proven by Part B.');
  await shot('h41-real-no-card.png');
}
check('REAL transcript never painted "[object Object]"', await evaluate(`!document.querySelector('.assistant-panel').innerText.includes('[object Object]')`) === true);

/* ========= Part B - deterministic display layer (driver-mocked, REAL shapes) ========= */
console.log('── Part B: mocked chat/confirm with the REAL pinned response shapes ──');
const MOCK_REPLY = [
  'حاضر، جهزت لك خطة الطلب قبل التنفيذ:',
  '',
  '| البند | القيمة في السيستم |',
  '|---|---|',
  '| نوع الطلب | إجازة اعتيادية |',
  '| الإرسال | فوري بعد التأكيد |',
  '',
  'أكدي لي بـ«نعم» وأنا أنفذه على طول — أول ما توافقي هيظهر لك بطاقة تأكيد رسمية من النظام.',
].join('\n');
const MOCK_CHAT_BODY = JSON.stringify({
  data: {
    reply: MOCK_REPLY,
    pending_action: {
      token: 'probe-mock-token-0123456789abcdef',
      name: 'create_request',
      args: {
        request_type_id: 1,
        title: 'إجازة اعتيادية',
        details: 'دليل دا التفاف unbreakable_long_token_0123456789_abcdefghijklmnopqrstuvwxyz',
        submit: true,
      },
    },
    tool_trace: [],
  },
});
const MOCK_CONFIRM_BODY = JSON.stringify({
  data: {
    tool: 'create_request',
    result: { ok: true, request_id: 'f0e1d2c3-4a5b-6c7d-8e9f-0a1b2c3d4e5f', status: 'PENDING_MANAGER' },
  },
});
const fulfill = async (paused, code, body) => {
  await send('Fetch.fulfillRequest', {
    requestId: paused.requestId,
    responseCode: code,
    body: Buffer.from(body).toString('base64'),
  });
};
await send('Fetch.enable', {
  patterns: [
    { urlPattern: '*api/v1/assistant/chat*', requestStage: 'Request' },
    { urlPattern: '*api/v1/assistant/actions/*confirm*', requestStage: 'Request' },
  ],
});

await evaluate(typeIntoComposer('سؤال المحاكاة: قدّم لي طلب إجازة'));
await evaluate(pressEnter);
let pausedChat = await nextPaused(2500);
if (!pausedChat) pausedChat = await nextPaused(2500);
if (pausedChat) await fulfill(pausedChat, 200, MOCK_CHAT_BODY);
else { console.log('FAIL  the chat request was never captured by the driver mock'); process.exit(1); }

await until(`!!document.querySelector('.assistant-action-card')`, 15000);
const mockCard = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  const card = panel.querySelector('.assistant-action-card');
  const message = card.closest('.assistant-message');
  const transcript = panel.querySelector('.assistant-transcript');
  const panelRect = panel.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const table = panel.querySelector('.assistant-md-table');
  const bubble = [...panel.querySelectorAll('.assistant-message-assistant')].pop();
  return {
    insidePanelX: cardRect.right <= panelRect.right + 1 && cardRect.left >= panelRect.left - 1,
    horizontalScrollAmount: transcript.scrollWidth - transcript.clientWidth,
    labels: [...card.querySelectorAll('dt')].map((n) => n.textContent.trim()),
    submitValue: [...card.querySelectorAll('.assistant-action-arg')].find((row) => row.querySelector('dt')?.textContent === 'إرسال فوري')?.querySelector('dd')?.textContent ?? null,
    detailsFits: (() => {
      const dd = [...card.querySelectorAll('.assistant-action-arg')].find((row) => row.querySelector('dt')?.textContent === 'التفاصيل')?.querySelector('dd');
      if (!dd) return null;
      const ddRect = dd.getBoundingClientRect();
      return ddRect.right <= panelRect.right + 1 && getComputedStyle(dd).overflowWrap;
    })(),
    tableRendered: !!table,
    tableHeaders: table ? [...table.querySelectorAll('th')].map((n) => n.textContent.trim()) : [],
    bubbleRawPipes: bubble ? bubble.innerText.includes('|') : null,
  };
})()`);
note('mock card', mockCard);
check('mock card takes its width from the panel (right/left inside)', mockCard.insidePanelX === true, mockCard);
check('mock card: no horizontal scrollbar under hostile long token', mockCard.horizontalScrollAmount <= 2, mockCard.horizontalScrollAmount);
check('mock card labels are localized (نوع الطلب / العنوان / التفاصيل / إرسال فوري)', ['نوع الطلب', 'العنوان', 'التفاصيل', 'إرسال فوري'].every((l) => mockCard.labels.includes(l)), mockCard.labels);
check('boolean arg renders from dict (نعم), not "true"', mockCard.submitValue === 'نعم', mockCard.submitValue);
check('long token wraps inside the panel (overflow-wrap)', mockCard.detailsFits === 'anywhere', mockCard.detailsFits);
check('H41: markdown table renders as a REAL <table>', mockCard.tableRendered === true, mockCard.tableHeaders);
check('the table headers are the real cells', mockCard.tableHeaders.includes('البند') && mockCard.tableHeaders.includes('القيمة في السيستم'), mockCard.tableHeaders);
check('no raw pipe rows survive in the bubble', mockCard.bubbleRawPipes === false, mockCard.bubbleRawPipes);
await shot('h41-mock-card.png');

await evaluate(`(() => {
  const card = document.querySelector('.assistant-action-card');
  const confirm = [...card.querySelectorAll('button')].find((node) => node.textContent.trim() === 'تأكيد');
  if (confirm) confirm.click();
  return !!confirm;
})()`);
let pausedConfirm = await nextPaused(2500);
if (!pausedConfirm) pausedConfirm = await nextPaused(2500);
if (pausedConfirm) await fulfill(pausedConfirm, 200, MOCK_CONFIRM_BODY);
else { console.log('FAIL  the confirm request was never captured'); process.exit(1); }

await until(`document.querySelector('.assistant-panel').innerText.includes('f0e1d2c3')`, 15000);
await sleep(700);
const mockReceipt = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  const last = [...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap')).pop();
  const transcript = panel.querySelector('.assistant-transcript');
  return {
    text: last ? last.textContent : '',
    boldHeadline: !!last.querySelector('strong') && last.querySelector('strong').textContent.includes('تم إنشاء الطلب'),
    idInCode: last.querySelector('code')?.textContent ?? null,
    statusLabel: last.textContent.includes('بانتظار مراجعة المدير'),
    horizontalScrollAmount: transcript.scrollWidth - transcript.clientWidth,
    rawObject: panel.innerText.includes('[object Object]'),
    error: panel.querySelector('.assistant-error')?.textContent.slice(0, 120) ?? null,
    cardGone: !panel.querySelector('.assistant-action-card'),
  };
})()`);
note('mock receipt', mockReceipt);
check('mock receipt: bold headline «تم إنشاء الطلب.»', mockReceipt.boldHeadline === true);
check('mock receipt: the id renders inline (mono), the whole of it', mockReceipt.idInCode === 'f0e1d2c3-4a5b-6c7d-8e9f-0a1b2c3d4e5f', mockReceipt.idInCode);
check('mock receipt: status localized (بانتظار مراجعة المدير)', mockReceipt.statusLabel === true);
check('mock receipt: no horizontal scrollbar after the confirm too', mockReceipt.horizontalScrollAmount <= 2, mockReceipt.horizontalScrollAmount);
check('mock receipt: the card is consumed', mockReceipt.cardGone === true);
check('mock receipt: no error card', mockReceipt.error === null, mockReceipt.error);
check('★ display layer: "[object Object]" never painted', mockReceipt.rawObject === false);
await shot('h41-mock-receipt.png');

console.log(failed === 0 ? '\nALL H41 CHECKS PASSED' : `\n${failed} H41 CHECK(S) FAILED`);
ws.close();
chrome.kill();
process.exit(failed === 0 ? 0 : 1);
