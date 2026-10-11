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
  check('the details field IS the reason', form.reasonName === 'details' && form.labels.some((label) => label.startsWith('السبب')), form.labels);
  check('submit is a single button, no confirm step', form.buttons.length === 3 && form.strip === false, form.buttons);
  /* H13d review fix: this used to pass the button's LABEL as the `ok` argument, so any non-empty
     string read as success and the check could never fail. It compares the label now. */
  const primaryLabel = await evaluate('document.querySelector(".form-actions .btn-primary").textContent.trim()');
  check('the submit button IS the submit action', primaryLabel === 'إرسال الطلب' || primaryLabel === 'Send request', primaryLabel);

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

  /* ---- 2b. H13d review fix: a raised error must clear the moment its field is valid again. ---- */
  await setField('#request-period', '');
  await evaluate('document.querySelector(".form-actions .btn-primary").click()');
  await sleep(300);
  const invalidState = await evaluate(`(() => {
    const period = document.querySelector('#request-period');
    const error = document.querySelector('.request-inline-error');
    return { path: location.pathname, invalid: period ? period.getAttribute('aria-invalid') : null, described: period ? period.getAttribute('aria-describedby') : null, errorText: error ? error.textContent.trim() : null, errorId: error ? error.id : null };
  })()`);
  check('an invalid draft is refused in place, with aria-invalid + an inline error', invalidState.path === '/requests/new' && invalidState.invalid === 'true' && !!invalidState.errorText && invalidState.described === invalidState.errorId, invalidState);
  await setField('#request-period', sunday);
  const cleared = await evaluate(`(() => {
    const period = document.querySelector('#request-period');
    return { invalid: period.getAttribute('aria-invalid'), error: !!document.querySelector('.request-inline-error') };
  })()`);
  check('the error clears as soon as the field is valid again (it used to stick forever)', cleared.invalid === null && cleared.error === false, cleared);

  /* ---- 3. ONE press sends it: no confirmation strip, no confirm step, and the page moves on. ---- */
  await evaluate('document.querySelector(".form-actions .btn-primary").click()');
  await sleep(400);
  const stripAfterClick = await evaluate('!!document.querySelector(".attention-strip")');
  check('one press sends without a confirmation step', stripAfterClick === false, stripAfterClick);
  /* H13d review fix: this check used to be labelled "the demo layer confirmed the submission" while
     measuring the URL, and the old «أرسلت» text assertion became impossible once §3 moved the flow
     forward. It now states exactly what it proves — the list row's existence is step 4's evidence. */
  const submitted = await until('location.pathname === "/requests"', 40);
  const landedPath = await evaluate('location.pathname');
  check('one press lands on the requests list', submitted === true && landedPath === '/requests', landedPath);

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

  /* ---- 6. H13c §5.2 harness additions — additive, beside the originals above. ---- */
  await send('Page.navigate', { url: `${BASE}/requests/new` });
  const reformed = await until('!!document.querySelector("#request-period")');
  check('the form re-opens after navigation', reformed, null);

  const pickerProbe = await evaluate(`(() => ({
    segmented: !!document.querySelector('.role-segmented'),
    selectGone: !document.querySelector('select[name="request-type"]'),
    options: [...document.querySelectorAll('.role-segmented-option')].map((el) => el.textContent.trim()),
    selected: !!document.querySelector('.role-segmented-option.is-selected'),
  }))()`);
  check('the type picker is segmented, not a native select', pickerProbe.segmented && pickerProbe.selectGone && pickerProbe.options.length === 4 && pickerProbe.selected, pickerProbe);

  /* §5.2: start-only FULL_DAYS reads «يوم واحد» in the live receipt, before any submit. */
  const now2 = new Date();
  const isoDay2 = (offset) => {
    const date = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth(), now2.getUTCDate()));
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const toSunday2 = (7 - now2.getUTCDay()) % 7;
  const sunday2 = isoDay2(toSunday2);
  const friday2 = isoDay2((5 - now2.getUTCDay() + 7) % 7);
  const saturday2 = isoDay2((5 - now2.getUTCDay() + 8) % 7);
  await setField('#request-period', sunday2);
  const singleDay = await until('/يوم واحد|One day/.test(document.body.innerText)');
  check('a start-only FULL_DAYS draft reads يوم واحد live', singleDay, null);
  await setField('#request-period-end', sunday2);

  /* §5.2: the receipt line exists and its text EQUALS buildRequestTitle for this draft. */
  const titleProbe = await evaluate(`(() => {
    const line = document.querySelector('.request-receipt .request-receipt-line bdi');
    return { present: !!line, text: line ? line.textContent.trim() : null, kind: document.querySelectorAll('.request-period-row input[type="date"]').length };
  })()`);
  check('the receipt line exists and matches the derived title', titleProbe.present && /إجازة اعتيادية|Annual leave/.test(titleProbe.text ?? ''), titleProbe);

  /* §5.2: a zero-working-day range shows the live danger warning BEFORE submit. */
  await setField('#request-period', friday2);
  await setField('#request-period-end', saturday2);
  const zeroWarn = await until('(() => { const w = document.querySelector(".request-live-warning"); return w && /ما فيها يوم عمل|no working day/.test(w.textContent); })()');
  const zeroDanger = await evaluate('(() => { const w = document.querySelector(".request-live-warning"); return w ? getComputedStyle(w).color : null; })()');
  /* Danger in the served light theme resolves to --danger-strong #9A3412 = rgb(154,52,18). */
  check('a zero-working-day range warns in danger color before submit', zeroWarn && zeroDanger === 'rgb(154, 52, 18)', zeroDanger);

  /* §5.2: the PART_DAY time inputs are EMPTY on arrival. */
  const emptyTimes = await evaluate(`(() => {
    const options = [...document.querySelectorAll('.role-segmented-option')];
    options[3].click(); /* تصريح خروج أثناء اليوم */
    return null;
  })()`);
  await sleep(200);
  const clockProbe = await evaluate('[document.querySelector("#request-clock")?.value, document.querySelector("#request-clock-end")?.value]');
  check('PART_DAY time inputs are empty on arrival (no prefilled window)', clockProbe[0] === '' && clockProbe[1] === '', clockProbe);

  /* §5.2: the action strip is sticky; all three labels present in reading order.
     H13d review fix: the old check only proved a .btn-primary EXISTS. It now asserts the LABEL,
     because "the submit action is the primary" is a claim about which button it is. */
  const stripProbe = await evaluate(`(() => {
    const strip = document.querySelector('.form-actions.request-stick-actions');
    if (!strip) return { sticky: false };
    const labels = [...strip.querySelectorAll('.btn')].map((b) => b.textContent.trim());
    const primary = strip.querySelector('.btn-primary');
    return { labels, sticky: getComputedStyle(strip).position === 'sticky', primaryLabel: primary ? primary.textContent.trim() : null, fileName: document.body.innerText.includes('بيئة العرض — الرفع مغلق'), hiddenFile: !!document.querySelector('input[type="file"][disabled]') };
  })()`);
  check('the action strip is sticky with the three labels', stripProbe.labels.length === 3 && stripProbe.labels.includes('إرسال الطلب') && stripProbe.labels.includes('حفظ المسودة') && stripProbe.labels.includes('رجوع'), stripProbe.labels);
  check('the action strip primary IS the submit action', stripProbe.primaryLabel === 'إرسال الطلب' || stripProbe.primaryLabel === 'Send request', stripProbe.primaryLabel);
  check('the attachments slot shows the Arabic demo line with a real disabled file input', stripProbe.fileName && stripProbe.hiddenFile, [stripProbe.fileName, stripProbe.hiddenFile]);

  /* ---- H13d review fixes, measured on the served build instead of taken on trust. ---- */
  await evaluate('document.querySelectorAll(".role-segmented-option")[0].click()'); /* back to إجازة اعتيادية */
  await sleep(150);
  const pickerA11y = await evaluate(`(() => {
    const group = document.querySelector('.role-segmented[role="radiogroup"]');
    if (!group) return { group: false };
    const options = [...group.querySelectorAll('.role-segmented-option')];
    const described = options.map((o) => { const id = o.getAttribute('aria-describedby'); return id ? !!document.getElementById(id) : null; });
    const selected = group.querySelector('.role-segmented-option.is-selected');
    const hint = selected ? selected.querySelector('.role-segmented-hint') : null;
    return {
      group: true,
      tabStops: options.filter((o) => o.tabIndex === 0).length,
      described,
      dangling: described.some((d) => d === false),
      hintColor: hint ? getComputedStyle(hint).color : null,
      surface: selected ? getComputedStyle(selected).backgroundColor : null,
    };
  })()`);
  check('the picker is ONE tab stop (roving tabindex)', pickerA11y.tabStops === 1, pickerA11y.tabStops);
  check('every option describes an element that exists', pickerA11y.dangling === false && pickerA11y.described.every((d) => d === true), pickerA11y.described);

  /* The hint inside the SELECTED option must be readable on the accent surface (was ~1.03:1). */
  const contrast = await evaluate(`(() => {
    const parse = (value) => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const hint = document.querySelector('.role-segmented-option.is-selected .role-segmented-hint');
    const option = document.querySelector('.role-segmented-option.is-selected');
    if (!hint || !option) return null;
    const a = lum(parse(getComputedStyle(hint).color));
    const b = lum(parse(getComputedStyle(option).backgroundColor));
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  })()`);
  check('the selected option\'s path hint clears 4.5:1 on the accent surface', typeof contrast === 'number' && contrast >= 4.5, contrast);

  /* RTL arrow keys: ArrowLeft moves forward in an RTL document, and the tab stop follows. */
  await evaluate(`(() => { const option = document.querySelector('.role-segmented-option.is-selected'); option.focus(); return null; })()`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await sleep(200);
  const arrowMove = await evaluate(`(() => {
    const options = [...document.querySelectorAll('.role-segmented-option')];
    return { selected: options.findIndex((o) => o.classList.contains('is-selected')), focused: options.indexOf(document.activeElement), tabStops: options.filter((o) => o.tabIndex === 0).length };
  })()`);
  check('RTL ArrowLeft selects the next option and keeps one tab stop', arrowMove.selected === 1 && arrowMove.focused === 1 && arrowMove.tabStops === 1, arrowMove);

  /* §5.2: after a DRAFT save, «رجوع» goes straight back — no unsaved-changes warning. */
  await setField('#request-period', sunday2);
  await evaluate('document.querySelectorAll(".role-segmented-option")[0].click()'); /* إجازة اعتيادية */
  await setField('#request-period-end', '');
  await setField('textarea[name="details"]', 'مسودة فحص آلي');
  await sleep(100);
  await evaluate('[...document.querySelectorAll(".form-actions .btn")].find((b) => b.textContent.includes("حفظ المسودة")).click()');
  const draftSaved = await until('document.body.innerText.includes("تم الحفظ كمسودة") || document.body.innerText.includes("Saved as a draft")', 40);
  check('the draft-save banner states the outcome, not the demo plumbing', draftSaved, null);
  await evaluate('[...document.querySelectorAll(".form-actions .btn")].find((b) => b.textContent.trim() === "رجوع" || b.textContent.trim() === "Back").click()');
  await sleep(300);
  const backClean = await evaluate('location.pathname === "/requests" && !document.body.innerText.includes("تعديلات غير محفوظة") && !document.body.innerText.includes("unsaved changes")');
  check('after a draft save, رجوع does not warn about unsaved changes', backClean === true, backClean);

  check('no fatal console error on any step', pageErrors.length === 0, pageErrors.slice(0, 3));
} finally {
  try { ws.close(); } catch { /* already closing */ }
  chrome.kill();
}

if (failed) { console.log(`\nNEW-REQUEST FORM CHECK FAILED (${failed})`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
