#!/usr/bin/env node
/**
 * Live check of the new-request form over CDP (headless Chrome, Node's global WebSocket, no
 * npm packages). It measures the SERVED build, not the source: the form must take its period
 * from the calendar, keep the details as a reason, drop the typed title, and submit on ONE
 * press — then the request must appear in the list and read back with its period.
 *
 *   node scripts/cdp-new-request.mjs [baseUrl] [port]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://192.168.1.19:8080';
const PORT = Number(process.argv[3] ?? 9339);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (label, ok, value = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${value === '' ? '' : ` — ${JSON.stringify(value)}`}`);
};

const profile = mkdtempSync(join(tmpdir(), 'cdp-new-request-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' });

let targets = null;
for (let i = 0; i < 60; i += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    if (response.ok) {
      const list = await response.json();
      if (list.some((target) => target.type === 'page')) { targets = list; break; }
    }
  } catch { /* chrome still starting */ }
  await sleep(250);
}
if (!targets) { chrome.kill(); throw new Error('chrome did not expose CDP'); }

const page = targets.find((target) => target.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let id = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params && message.params.exceptionDetails;
    pageErrors.push((details && details.exception && details.exception.description) || (details && details.text) || 'exception');
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params && message.params.type)) {
    pageErrors.push((message.params.args || []).map((arg) => arg.value || arg.description).join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const callId = ++id;
  pending.set(callId, resolve);
  ws.send(JSON.stringify({ id: callId, method, params }));
});
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result && reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
  return reply.result && reply.result.result ? reply.result.result.value : undefined;
};
const until = async (expression, tries = 60) => {
  for (let i = 0; i < tries; i += 1) { if (await evaluate(expression)) return true; await sleep(250); }
  return false;
};
const setField = (selector, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`);
const text = () => evaluate('document.body.innerText');

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `${BASE}/requests/new` });
  const rendered = await until('!!document.querySelector("#request-period") || !!document.querySelector("form")');
  check('the served build reached the new-request form', rendered, await evaluate('location.pathname'));

  /* ---- 1. The form itself: calendar in, title out, details as the reason. ---- */
  const form = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input')];
    const labels = [...document.querySelectorAll('.field-label, legend')].map((el) => el.textContent.trim());
    return {
      dates: inputs.filter((i) => i.type === 'date').map((i) => i.id),
      discrete: inputs.filter((i) => i.type !== 'date' && i.type !== 'time' && i.type !== 'file').map((i) => i.id || i.name),
      hasTitle: !!document.querySelector('#request-title'),
      reasonName: (document.querySelector('textarea') || {}).name || null,
      labels,
      buttons: [...document.querySelectorAll('.form-actions button')].map((b) => b.textContent.trim()),
      strip: !!document.querySelector('.attention-strip'),
    };
  })()`);
  check('the period is picked from a calendar field', form.dates.includes('request-period'), form.dates);
  check('there is no typed title field left', form.hasTitle === false, form.hasTitle);
  check('no free-text title input remains at all', form.discrete.length === 0, form.discrete);
  check('the details field IS the reason', form.reasonName === 'details' && form.labels.includes('السبب'), form.labels);
  check('submit is a single button, no confirm step', form.buttons.length === 3 && form.strip === false, form.buttons);

  /* ---- 2. The picker drives the request: pick Sun→Wed and the form says four working days. ---- */
  const now = new Date();
  const isoDay = (offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const toSunday = (7 - now.getUTCDay()) % 7;
  const sunday = isoDay(toSunday);
  const wednesday = isoDay(toSunday + 3);
  await setField('#request-period', sunday);
  await setField('#request-period-end', wednesday);
  const hint = await until('document.querySelector(".field-hint") && /4 يوم عمل|4 working days/.test(document.body.innerText)');
  check('the form reports the picked period downstream', hint, (await text()).split('\n').find((line) => /يوم عمل|working days/.test(line)));

  await setField('textarea[name="details"]', 'زيارة عائلية — فحص آلي');
  const reasonTaken = await evaluate('document.querySelector("textarea[name=\\"details\\"]").value');
  check('the reason field keeps what was typed', reasonTaken === 'زيارة عائلية — فحص آلي', reasonTaken);

  /* ---- 3. ONE press sends it: no confirmation strip, and the request exists. ---- */
  await evaluate('document.querySelector(".form-actions .btn-primary").click()');
  await sleep(400);
  const stripAfterClick = await evaluate('!!document.querySelector(".attention-strip")');
  check('one press sends without a confirmation step', stripAfterClick === false, stripAfterClick);
  const submitted = await until('/أرسلت|submitted/.test(document.body.innerText)');
  check('the demo layer confirmed the submission', submitted, (await text()).split('\n').find((line) => /أرسلت|submitted/.test(line)));

  /* ---- 4. The request reaches the list, titled from the picked period. ---- */
  await evaluate('document.querySelector(\'a[href="/requests"]\').click()');
  const listed = await until('/إجازة اعتيادية — 4 يوم عمل/.test(document.body.innerText)', 40);
  check('the list shows the request, titled from the period', listed, (await text()).split('\n').filter((line) => /إجازة اعتيادية/.test(line)).slice(0, 2));

  /* ---- 5. Its own screen reads the period back. ---- */
  const opened = await evaluate(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => /إجازة اعتيادية — 4 يوم عمل/.test(tr.innerText));
    if (!row) return false;
    (row.querySelector('a') || row).click();
    return true;
  })()`);
  await sleep(600);
  const detail = await until('!!document.querySelector("#request-period")', 40);
  check('the request opens on its own screen', opened === true && detail === true, await evaluate('location.pathname'));
  const period = await evaluate('(document.querySelector("#request-period") || {}).closest ? document.querySelector("#request-period").parentElement.innerText : null');
  check('the period reads back as the picked dates', typeof period === 'string' && period.includes('/'), period);
  const reasonShown = await evaluate('(document.querySelector("#request-details") || {parentElement:{}}).parentElement.textContent');
  check('the screen still labels the details as the reason', typeof reasonShown === 'string' && /السبب/.test(reasonShown), (await text()).split('\n').slice(0, 6));

  check('no fatal console error on any step', pageErrors.length === 0, pageErrors.slice(0, 3));
} finally {
  try { ws.close(); } catch { /* already closing */ }
  chrome.kill();
}

if (failed) { console.log(`\nNEW-REQUEST FORM CHECK FAILED (${failed})`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
