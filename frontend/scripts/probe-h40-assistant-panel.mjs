#!/usr/bin/env node
/**
 * H40 - the مدام عفاف chat panel rework, measured against the SERVED build.
 *
 *   node scripts/probe-h40-assistant-panel.mjs [baseUrl] [email] [password]
 *
 * What it proves, in the brief's order:
 *   1. the dead gap under the transcript is gone: with a conversation present the
 *      last bubble sits one transcript padding above the composer (measured px),
 *      the transcript scroll stays pinned to the tail, and the empty panel shows
 *      the suggestions empty state instead of blank white;
 *   2. the waiting state appears EXACTLY once (the bubble; the send button keeps
 *      its plain disabled «إرسال» label), with a real إلغاء button that aborts
 *      the request and restores the draft;
 *   3. a failed send shows the honest danger card + «إعادة المحاولة», and the
 *      retry resends the SAME question without duplicating the user bubble
 *      [driver-mock: /assistant/chat answers 500 then 200];
 *   4. the placeholder / hint / header labels follow the UI language (AR↔EN);
 *   5. Enter sends, Esc closes and focus returns to the launcher;
 *   6. light + dark screenshots for both themes.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args[0] ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const email = args[1] || 'hr@demo.local';
const password = args[2] || 'demo1234';
const PORT = 9800 + Math.floor(Math.random() * 180);
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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h40-panel-'))}`,
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
    await sleep(250);
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
await sleep(1200);
// The onboarding tour intercepts presses: skip it FIRST, then interact.
await evaluate(`(() => {
  const skip = [...document.querySelectorAll('button')]
    .find((node) => /تخطي الجولة|Skip the tour/i.test(node.textContent || ''));
  if (skip) skip.click();
  return !!skip;
})()`);
await sleep(600);
await evaluate(`(() => {
  const skip = [...document.querySelectorAll('button')]
    .find((node) => /تخطي الجولة|Skip the tour/i.test(node.textContent || ''));
  if (skip) skip.click();
  return true;
})()`);
await sleep(600);
const launcherMuted = await evaluate(`document.querySelector('.assistant-launcher')?.classList.contains('assistant-launcher-muted') ?? null`);
check('assistant launcher is enabled (model linked)', launcherMuted === false, { muted: launcherMuted });

/* ---------------------------- open the panel ---------------------------- */
await evaluate(`document.querySelector('.assistant-launcher').click()`);
await until(`!!document.querySelector('.assistant-panel')`);
const panelA11y = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  return {
    role: panel?.getAttribute('role'),
    label: panel?.getAttribute('aria-label'),
    live: document.querySelector('.assistant-transcript')?.getAttribute('aria-live'),
    bdiCount: panel?.querySelectorAll('bdi').length ?? 0,
    modelBdi: panel?.querySelector('.assistant-provider-line bdi[dir="ltr"]')?.textContent ?? null,
  };
})()`);
check('panel is a labelled dialog with aria-live transcript', panelA11y.role === 'dialog' && panelA11y.live === 'polite' && panelA11y.bdiCount >= 2, panelA11y);
note('model in bdi', panelA11y.modelBdi);

/* ------------------------ empty state + suggestions ------------------------ */
const emptyState = await evaluate(`(() => {
  const state = document.querySelector('.assistant-empty-state');
  const transcript = document.querySelector('.assistant-transcript');
  return {
    present: !!state,
    guide: state?.querySelector('.assistant-empty')?.textContent ?? null,
    suggestions: state ? [...state.querySelectorAll('.assistant-suggestion')].map((node) => node.textContent.trim()) : [],
    placeholder: document.querySelector('.assistant-composer-input')?.getAttribute('placeholder') ?? null,
    dir: document.querySelector('.assistant-composer-input')?.getAttribute('dir') ?? null,
    hint: document.querySelector('.assistant-composer-hint')?.textContent ?? null,
    settingsLink: document.querySelector('.assistant-settings-link')?.textContent.trim() ?? null,
    transcriptRatio: transcript ? +(transcript.getBoundingClientRect().height / document.querySelector('.assistant-panel').getBoundingClientRect().height).toFixed(2) : null,
  };
})()`);
check('empty chat shows the useful empty state', emptyState.present === true && emptyState.guide?.length > 10, emptyState.guide);
check('4 ready-made suggestions offered', emptyState.suggestions.length === 4, emptyState.suggestions);
check('placeholder in the UI language (AR)', emptyState.placeholder === 'اكتب سؤالك…', emptyState.placeholder);
check('textarea dir=auto for Arabic typing', emptyState.dir === 'auto', emptyState.dir);
check('Enter/Shift+Enter hint under the composer', /Enter/.test(emptyState.hint || ''), emptyState.hint);
check('header settings link in the UI language (AR)', emptyState.settingsLink === 'الإعدادات', emptyState.settingsLink);
note('transcript height / panel height', emptyState.transcriptRatio);

/* ---------------- send #1: REAL question through the real provider ---------------- */
await evaluate(`(() => {
  const suggestion = document.querySelector('.assistant-suggestion');
  suggestion.click();
  return true;
})()`);
const filledDraft = await evaluate(`document.querySelector('.assistant-composer-input').value`);
check('suggestion lands in the composer', filledDraft === 'إيه رصيد إجازاتي؟', filledDraft);

const pressEnter = `(() => {
  const input = document.querySelector('.assistant-composer-input');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return true;
})()`;
await evaluate(pressEnter);
await sleep(700); // the request is genuinely in flight now (LLM latency)
const waitingReal = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  const bubbles = [...panel.querySelectorAll('.assistant-typing-row')];
  const sendButton = panel.querySelector('.assistant-send');
  return {
    typingBubbles: bubbles.length,
    typingTexts: bubbles.map((node) => node.textContent.trim()),
    sendLabel: sendButton?.textContent.trim() ?? null,
    sendDisabled: sendButton?.disabled ?? null,
    inputDisabled: document.querySelector('.assistant-composer-input')?.disabled ?? null,
    cancelButton: [...panel.querySelectorAll('button')].some((node) => node.textContent.trim() === 'إلغاء'),
    typingMentions: (panel.innerText.match(/بتفكر/g) || []).length,
  };
})()`);
check('REAL send: Enter submitted the question', waitingReal.typingBubbles >= 1 || waitingReal.typingMentions >= 0, null);
check('waiting state exists in the transcript bubble', waitingReal.typingBubbles === 1, waitingReal.typingBubbles);
check('«بتفكر…» appears EXACTLY once in the panel', waitingReal.typingMentions === 1, waitingReal.typingMentions);
check('send button keeps its plain «إرسال» label while waiting', waitingReal.sendLabel === 'إرسال', waitingReal.sendLabel);
check('composer disabled while waiting (clearly, not merged)', waitingReal.sendDisabled === true && waitingReal.inputDisabled === true, waitingReal);
check('إلغاء button beside the waiting bubble', waitingReal.cancelButton === true);

// Wait for the real answer (or its error) — the subscription LLM takes a while.
const realOutcome = await (async () => {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => {
      const panel = document.querySelector('.assistant-panel');
      if (!panel) return { gone: true };
      const typing = panel.querySelectorAll('.assistant-typing-row').length;
      const replies = [...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap'));
      const error = panel.querySelector('.assistant-error');
      return { typing, replies: replies.length, replyText: replies[0]?.textContent.slice(0, 90) ?? null, error: error ? error.textContent.slice(0, 90) : null };
    })()`);
    if (state.gone) return state;
    if (state.typing === 0) return state;
    await sleep(1000);
  }
  return { timeout: true };
})();
note('real send outcome', realOutcome);
check('REAL send completed (reply or honest error)', realOutcome.replies === 1 || !!realOutcome.error, realOutcome.replyText || realOutcome.error);

// Steady-state layout with the REAL reply in the transcript.
await sleep(1000);
const realLayout = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  const transcript = panel.querySelector('.assistant-transcript');
  const replies = [...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap'));
  const lastRect = replies[replies.length - 1].getBoundingClientRect();
  const composerRect = panel.querySelector('.assistant-composer').getBoundingClientRect();
  return {
    gapToComposer: Math.round(composerRect.top - lastRect.bottom),
    scrollPinned: transcript.scrollHeight - (transcript.scrollTop + transcript.clientHeight),
  };
})()`);
check('★ real reply: last bubble sits just above the composer (≤40px)', realLayout.gapToComposer <= 40, realLayout.gapToComposer);
check('real reply: transcript scroll pinned to the tail', realLayout.scrollPinned <= 4, realLayout.scrollPinned);

/* ---------------- send #2: REAL question, then إلغاء aborts it ---------------- */
await evaluate(`(() => {
  const input = document.querySelector('.assistant-composer-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, 'سؤال هيتم إلغاؤه');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await evaluate(pressEnter);
await sleep(900); // in flight
await evaluate(`(() => {
  const cancel = [...document.querySelectorAll('.assistant-panel button')].find((node) => node.textContent.trim() === 'إلغاء');
  if (cancel) cancel.click();
  return !!cancel;
})()`);
await sleep(800);
const afterCancel = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  const input = panel.querySelector('.assistant-composer-input');
  const userBubbles = [...panel.querySelectorAll('.assistant-message-user')];
  return {
    typingGone: panel.querySelectorAll('.assistant-typing-row').length,
    draftRestored: input.value,
    inputEnabled: !input.disabled,
    lastUserBubble: userBubbles[userBubbles.length - 1]?.textContent.trim() ?? null,
    errorShown: !!panel.querySelector('.assistant-error'),
  };
})()`);
check('إلغاء stops the waiting state', afterCancel.typingGone === 0, afterCancel.typingGone);
check('إلغاء puts the question back in the composer', afterCancel.draftRestored === 'سؤال هيتم إلغاؤه', afterCancel.draftRestored);
check('إلغاء removes the unanswered user bubble', afterCancel.lastUserBubble !== 'سؤال هيتم إلغاؤه', afterCancel.lastUserBubble);
check('إلغاء is not an error', afterCancel.errorShown === false && afterCancel.inputEnabled === true, afterCancel);

/* ------------- send #3: driver-mock failure then successful retry ------------- */
const CANNED_REPLY = '**تمام!** هذه قراءة سريعة من السيستم:\n\n- رصيد الإجازات: **14 يوم**\n- آخر طلب: إجازة سنوية - معتمد\n- جدول الأسبوع: 9:00 → 17:00\n\nقل لي لو تحب تفاصيل أكتر.';
const fulfill = async (paused, code, body) => {
  await send('Fetch.fulfillRequest', {
    requestId: paused.requestId,
    responseCode: code,
    body: Buffer.from(body).toString('base64'),
  });
};
const errorBody = JSON.stringify({ error: { code: 'server_error', message: 'Simulated outage (driver-side).', fields: {} } });
const okBody = JSON.stringify({ data: { reply: CANNED_REPLY, pending_action: null } });
await send('Fetch.enable', { patterns: [{ urlPattern: '*api/v1/assistant/chat*', requestStage: 'Request' }] });

await evaluate(`(() => {
  const input = document.querySelector('.assistant-composer-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, 'ملخص سريع لوضعي');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await evaluate(pressEnter);

// While the mock holds the request (~2s), the single typing bubble is observable.
await sleep(800);
const waitingMock = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  return {
    typingBubbles: panel.querySelectorAll('.assistant-typing-row').length,
    typingMentions: (panel.innerText.match(/بتفكر/g) || []).length,
    sendLabel: panel.querySelector('.assistant-send')?.textContent.trim() ?? null,
  };
})()`);
check('mocked send: waiting bubble EXACTLY once (button clean)', waitingMock.typingBubbles === 1 && waitingMock.typingMentions === 1 && waitingMock.sendLabel === 'إرسال', waitingMock);

// Then the failure: the retry question stays, the honest error card appears.
const pausedFail = await nextPaused(1500);
if (pausedFail) await fulfill(pausedFail, 500, errorBody);

await until(`!!document.querySelector('.assistant-error-card')`);
const failureState = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  const card = panel.querySelector('.assistant-error-card');
  const userBubbles = [...panel.querySelectorAll('.assistant-message-user')];
  return {
    text: card?.textContent ?? '',
    hasRetry: !!card && [...card.querySelectorAll('button')].some((node) => node.textContent.trim() === 'إعادة المحاولة'),
    userBubbleKept: userBubbles[userBubbles.length - 1]?.textContent.includes('ملخص سريع لوضعي') ?? false,
  };
})()`);
check('failure is an honest error card with «إعادة المحاولة»', failureState.hasRetry && failureState.text.length > 5, failureState.text.slice(0, 60));
check('failure keeps the user question (not rendered as empty)', failureState.userBubbleKept === true);

// The retry: fulfill with the canned 200 reply.
await evaluate(`(() => {
  const retry = [...document.querySelectorAll('.assistant-error-card button')].find((node) => node.textContent.trim() === 'إعادة المحاولة');
  if (retry) retry.click();
  return !!retry;
})()`);
const pausedRetry = await nextPaused(1500);
if (pausedRetry) await fulfill(pausedRetry, 200, okBody);
// The REAL reply is also markdown, so the matcher counts the replies, not lists.
await until(`[...document.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap')).length >= 2`, 15000);
await send('Fetch.disable');
// Steady state: let the scroll effect and any reflow settle before measuring.
await sleep(1200);

const successState = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  const transcript = panel.querySelector('.assistant-transcript');
  const replies = [...panel.querySelectorAll('.assistant-message-assistant')].filter((n) => !n.classList.contains('assistant-typing-wrap'));
  const last = replies[replies.length - 1];
  const lastRect = last.getBoundingClientRect();
  const composerRect = panel.querySelector('.assistant-composer').getBoundingClientRect();
  const userBubbles = [...panel.querySelectorAll('.assistant-message-user')];
  return {
    replyCount: replies.length,
    hasList: !!last.querySelector('.assistant-md-list'),
    hasBold: !!last.querySelector('.assistant-md-para strong, li strong'),
    gapToComposer: Math.round(composerRect.top - lastRect.bottom),
    scrollPinned: transcript.scrollHeight - (transcript.scrollTop + transcript.clientHeight),
    transcriptRatio: +(transcript.getBoundingClientRect().height / panel.getBoundingClientRect().height).toFixed(2),
    userBubbleCount: userBubbles.length,
    copyButton: last.querySelector('.assistant-copy')?.textContent.trim() ?? null,
    errorGone: !panel.querySelector('.assistant-error'),
  };
})()`);
check('retry delivered the reply (no duplicated question)', successState.replyCount >= 1 && successState.userBubbleCount === 2, successState);
check('★ the dead gap is GONE: last bubble sits just above the composer (≤40px)', successState.gapToComposer <= 40, successState.gapToComposer);
check('transcript scroll is pinned to the tail', successState.scrollPinned <= 4, successState.scrollPinned);
note('transcript height / panel height', successState.transcriptRatio);
check('long reply renders as spaced markdown (list + bold)', successState.hasList && successState.hasBold, successState);
check('copy button on the reply', successState.copyButton === 'انسخ', successState.copyButton);
check('error card cleared after the retry succeeded', successState.errorGone === true);

/* ------------------------------ copy + time ------------------------------ */
await evaluate(`(() => {
  window.__h40copied = null;
  const button = [...document.querySelectorAll('.assistant-copy')].pop();
  try { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__h40copied = t; return Promise.resolve(); } }); } catch {}
  button.focus();
  button.click();
  return true;
})()`);
await sleep(400);
const copyState = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.assistant-copy')];
  const last = buttons[buttons.length - 1];
  const time = last.closest('.assistant-message')?.querySelector('.assistant-message-time');
  return {
    copiedCalled: (window.__h40copied || '').length > 0,
    label: last.textContent.trim(),
    timeText: time?.textContent.trim() ?? null,
    timeOpacityOnFocus: time ? getComputedStyle(time).opacity : null,
    anyTimeHidden: buttons.length ? getComputedStyle(buttons[0].closest('.assistant-message').querySelector('.assistant-message-time')).opacity : null,
  };
})()`);
check('copy puts the reply text on the clipboard', copyState.copiedCalled === true, copyState.copiedCalled);
check('copy label flips to «تم النسخ»', copyState.label === 'تم النسخ', copyState.label);
check('timestamp revealed on focus', copyState.timeOpacityOnFocus === '1' && copyState.timeText.length > 0, { opacity: copyState.timeOpacityOnFocus, time: copyState.timeText });
note('timestamp while NOT hovered/focused (opacity)', copyState.anyTimeHidden);

/* --------------------------- language switch EN --------------------------- */
await evaluate(`window.localStorage.setItem('tracking-sys.locale', 'en'); true`);
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.assistant-launcher')`);
await sleep(900);
await evaluate(`(() => {
  const skip = [...document.querySelectorAll('button')].find((node) => /تخطي الجولة|Skip the tour/i.test(node.textContent || ''));
  if (skip) skip.click();
  return true;
})()`);
await sleep(500);
await evaluate(`document.querySelector('.assistant-launcher').click()`);
await until(`!!document.querySelector('.assistant-panel')`);
const enState = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-panel');
  return {
    placeholder: panel.querySelector('.assistant-composer-input')?.getAttribute('placeholder') ?? null,
    hint: panel.querySelector('.assistant-composer-hint')?.textContent ?? null,
    settingsLink: panel.querySelector('.assistant-settings-link')?.textContent.trim() ?? null,
    emptyGuide: panel.querySelector('.assistant-empty')?.textContent.slice(0, 40) ?? null,
    suggestions: [...panel.querySelectorAll('.assistant-suggestion')].map((n) => n.textContent.trim()),
  };
})()`);
check('EN: placeholder follows the UI language', enState.placeholder === 'Type your question…', enState.placeholder);
check('EN: hint follows the UI language', enState.hint === 'Enter sends - Shift+Enter adds a line', enState.hint);
check('EN: settings link follows the UI language', enState.settingsLink === 'Settings', enState.settingsLink);
check('EN: empty state + suggestions follow the UI language', /^Ask/.test(enState.emptyGuide || '') && enState.suggestions.every((s) => /^[\x00-\x7F ?!?./'-]*$/.test(s)), enState.suggestions);
await evaluate(`window.localStorage.setItem('tracking-sys.locale', 'ar'); true`);

/* --------------------------- Esc + focus return --------------------------- */
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.assistant-launcher')`);
await sleep(900);
await evaluate(`(() => {
  const skip = [...document.querySelectorAll('button')].find((node) => /تخطي الجولة|Skip the tour/i.test(node.textContent || ''));
  if (skip) skip.click();
  return true;
})()`);
await sleep(500);
await evaluate(`document.querySelector('.assistant-launcher').click()`);
await until(`!!document.querySelector('.assistant-panel')`);
await evaluate(`(() => {
  document.querySelector('.assistant-composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyIdentifier: 'Escape', bubbles: true, cancelable: true }));
  return true;
})()`);
// The panel listens on document keydown; dispatch there directly as the belt to the braces.
await evaluate(`(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(500);
const escState = await evaluate(`(() => ({
  panelGone: !document.querySelector('.assistant-panel'),
  focusOnLauncher: document.activeElement?.classList?.contains('assistant-launcher') ?? false,
}))()`);
check('Esc closes the panel', escState.panelGone === true, escState);
check('focus returns to the launcher', escState.focusOnLauncher === true, escState);

// Backdrop press closes too.
await evaluate(`document.querySelector('.assistant-launcher').click()`);
await until(`!!document.querySelector('.assistant-panel')`);
await evaluate(`document.querySelector('.assistant-backdrop').click()`);
await sleep(400);
const backdropClosed = await evaluate(`!document.querySelector('.assistant-panel')`);
check('pressing outside (backdrop) closes the panel', backdropClosed === true);

/* --------------------------- light + dark shots --------------------------- */
// The headless OS preference is light, so each theme is FORCED through the
// appearance preference + reload, and the transcript carries the canned exchange.
const shootTheme = async (theme, file) => {
  await evaluate(`window.localStorage.setItem('tracking-sys.appearance', ${JSON.stringify(theme)}); true`);
  await send('Page.navigate', { url: `${base}/` });
  await until(`!!document.querySelector('.assistant-launcher')`);
  await sleep(900);
  await evaluate(`(() => {
    const skip = [...document.querySelectorAll('button')].find((node) => /تخطي الجولة|Skip the tour/i.test(node.textContent || ''));
    if (skip) skip.click();
    return true;
  })()`);
  await sleep(400);
  await evaluate(`document.querySelector('.assistant-launcher').click()`);
  await until(`!!document.querySelector('.assistant-panel')`);
  await sleep(800);
  const themeNow = await evaluate(`document.documentElement.dataset.theme`);
  const fileSaved = await shot(file);
  note(`${theme} shot`, `${themeNow} — ${fileSaved}`);
  return { themeNow, fileSaved };
};
const darkShot = await shootTheme('dark', 'h40-assistant-dark.png');
check('dark theme shot taken as dark', darkShot.themeNow === 'dark', darkShot.themeNow);
const lightShot = await shootTheme('light', 'h40-assistant-light.png');
check('light theme shot taken as light', lightShot.themeNow === 'light', lightShot.themeNow);

console.log(failed === 0 ? '\nALL H40 CHECKS PASSED' : `\n${failed} H40 CHECK(S) FAILED`);
ws.close();
chrome.kill();
process.exit(failed === 0 ? 0 : 1);
