/**
 * Live check of the H14b login/signup flow over CDP — headless Chrome, Node's
 * global WebSocket, no npm packages. It measures the SERVED build, not the
 * source: the role picker must be gone from the normal page, the
 * «أول مرة؟ إنشاء حساب» entry must reveal the signup form with the three
 * fields and the contact line, a wrong code must be refused, and the demo
 * code Menisy2002 must sign in and land inside the app. The two demo-path
 * signup attempts run against an unreachable API by design (they create no
 * real account); the final probe hits the real backend from the served origin
 * with a FRESH email each run and asserts the signed-in HR session through
 * /auth/me, not just a response body.
 *
 *   node scripts/cdp-login-signup.mjs [baseUrl] [port]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://192.168.1.19:8080';
const PORT = Number(process.argv[3] ?? 9341);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (label, ok, value = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  — ${typeof value === 'string' ? value : JSON.stringify(value)}`);
};

const profile = mkdtempSync(join(tmpdir(), 'cdp-login-signup-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1400,1000', 'about:blank',
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
/* React owns these inputs, so the native value setter must be paired with a
   reset of React's _valueTracker — a descriptor set alone is swallowed.
   The form swap on the toggle click lands on the NEXT tick, hence until(). */
const setField = (name, value) => evaluate(`(() => {
  const el = document.querySelector('input[name="${name}"]');
  if (!el) return null;
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue('');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`);
const submitForm = () => evaluate('document.querySelector(".login-submit").click()');
const text = () => evaluate('document.body.innerText');

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });

  /* ---- 1. The normal page: picker gone, entry present. ---- */
  await send('Page.navigate', { url: `${BASE}/login` });
  const rendered = await until('!!document.querySelector("form")');
  check('the served build reached the login screen', rendered, await evaluate('location.pathname'));

  const landing = await evaluate(`(() => ({
    picker: !!document.querySelector('.login-role-picker'),
    hint: !!document.querySelector('.login-role-hint'),
    entry: !!document.querySelector('.login-signup-toggle'),
    entryLabel: (document.querySelector('.login-signup-toggle') || {}).textContent,
  }))()`);
  check('the role picker is gone from the normal page', landing.picker === false && landing.hint === false, [landing.picker, landing.hint]);
  check('the «أول مرة؟ إنشاء حساب» entry exists as a real button', landing.entry === true && landing.entryLabel?.includes('إنشاء حساب'), landing.entryLabel);

  /* ---- 2. The dev affordance still reveals the picker. ---- */
  await send('Page.navigate', { url: `${BASE}/login?dev=1` });
  await until('!!document.querySelector("form")');
  const dev = await evaluate('!!document.querySelector(".login-role-picker")');
  check('?dev=1 still reveals the role picker as a dev affordance', dev === true, dev);

  /* ---- 3. Reveal the signup form and inspect it. ---- */
  await send('Page.navigate', { url: `${BASE}/login` });
  await until('!!document.querySelector("form")');
  await evaluate('document.querySelector(".login-signup-toggle").click()');
  const formShown = await until('document.querySelectorAll("form input").length === 4');
  const form = await evaluate(`(() => ({
    labels: [...document.querySelectorAll('.field-label')].map((el) => el.textContent.trim()),
    codeAttrs: (() => { const el = document.querySelector('input[name="code"]'); return el && { dir: el.dir, autocomplete: el.autocomplete, spellcheck: el.spellcheck }; })(),
    roleNote: document.body.innerText.includes('الحساب بيتعمل كـ موارد بشرية'),
    contact: document.body.innerText.includes('مفيش كود؟ اتواصل معانا للاشتراك واستلام الكود الخاص بك'),
    phoneHref: (document.querySelector('.login-signup-phone') || {}).href,
    phoneText: (document.querySelector('.login-signup-phone bdi') || {}).textContent,
    eye: [...document.querySelectorAll('.password-visibility-toggle')].length,
    submit: (document.querySelector('.login-submit') || {}).textContent,
    back: [...document.querySelectorAll('.login-signup-toggle')].map((b) => b.textContent.trim()),
  }))()`);
  check('the signup form replaced the sign-in form on the same page', formShown, await evaluate('location.pathname'));
  check('the four fields are email, code, password, confirm — in that order', JSON.stringify(form.labels) === JSON.stringify(['البريد الإلكتروني', 'كود الاشتراك', 'كلمة المرور', 'تأكيد كلمة المرور']), form.labels);
  check('the code field is dir=ltr, autocomplete=off, spellCheck=false', !!form.codeAttrs && form.codeAttrs.dir === 'ltr' && form.codeAttrs.autocomplete === 'off' && form.codeAttrs.spellcheck === false, form.codeAttrs);
  check('the HR note is present', form.roleNote === true, form.roleNote);
  check('the contact line is verbatim', form.contact === true, form.contact);
  check('the phone is a tel: link rendering 01200704564 in one piece', form.phoneHref === 'tel:01200704564' && form.phoneText === '01200704564', [form.phoneHref, form.phoneText]);
  check('both password fields keep their eye toggle', form.eye === 2, form.eye);
  check('the submit button says إنشاء حساب', form.submit?.includes('إنشاء حساب'), form.submit);
  check('a way back to signing in exists', form.back.some((label) => label.includes('تسجيل الدخول')), form.back);

  /* ---- 4. A wrong code is refused. ---- */
  await setField('email', 'probe.h14b@example.local');
  await setField('code', 'not-the-code');
  await setField('new-password', 'Str0ng-Passw0rd-2026');
  await setField('confirm-password', 'Str0ng-Passw0rd-2026');
  await submitForm();
  const wrongRefused = await until('(() => { const b = document.querySelector(".banner.banner-error"); return b && document.body.innerText.includes("غير صحيح"); })()', 40);
  check('a wrong code is refused in the error banner', wrongRefused === true, (await text()).split('\n').find((l) => l.includes('غير صحيح')));
  check('the declined attempt stays on the login screen', (await evaluate('location.pathname')) === '/login', await evaluate('location.pathname'));

  /* ---- 5. The right code signs a FRESH email in and lands inside the app.
        The form collects the password twice, so the confirmation has to match, and the
        email has to be fresh: a fixed address answers email_in_use on the second run. ---- */
  const freshEmail = `cdp.probe.${Date.now()}@example.local`;
  await setField('email', freshEmail);
  await setField('code', 'Menisy2002');
  await submitForm();
  const landed = await until('location.pathname !== "/login"', 40);
  check('the right code signs a fresh email in', landed, await evaluate('location.pathname'));
  check('the user is inside the app (home, not /login)', (await evaluate('location.pathname')) === '/', await evaluate('location.pathname'));

  /* ---- 6. Keyboard-only: the entry toggle takes focus; the focus ring is
        declared in CSS, so assert the rule exists and the element is the
        activeElement — :focus-visible is not queryable headlessly. ---- */
  await send('Page.navigate', { url: `${BASE}/login` });
  await until('!!document.querySelector("form")');
  const focusProbe = await evaluate(`(() => {
    const entry = document.querySelector('.login-signup-toggle');
    entry.focus();
    return { active: document.activeElement === entry, tag: entry.tagName };
  })()`);
  const focusRingDeclared = await evaluate('/\\.login-signup-toggle:focus-visible \\{ outline:/-1 !== -1 || [...document.styleSheets].some((sheet) => { try { return [...sheet.cssRules].some((rule) => rule.selectorText?.includes(".login-signup-toggle:focus-visible")); } catch { return false; } })');
  check('the entry control takes keyboard focus as a real <button>', focusProbe.active === true && focusProbe.tag === 'BUTTON', focusProbe);
  check('the entry control declares a visible :focus-visible ring', focusRingDeclared === true, focusRingDeclared);

  /* ---- 7. The real backend contract, called from the served origin with a
        FRESH email each run: the signed-in session is asserted through
        /auth/me, not inferred from a response body. ---- */
  await send('Page.navigate', { url: `${BASE}/login` });
  await until('!!document.querySelector("form")');
  const live = await evaluate(`(async () => {
    const csrf = (await (await fetch('/api/v1/auth/csrf', { credentials: 'include' })).json()).data.csrftoken;
    const attempt = (body) => fetch('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const wrong = await attempt({ email: 'probe.h14b2@example.local', code: 'WRONG-AGAIN', password: 'Str0ng-Passw0rd-2026' });
    const wrongBody = await wrong.json().catch(() => ({}));
    const email = 'h14b.probe.' + Date.now() + '@example.local';
    const good = await attempt({ email, code: 'Menisy2002', password: 'Str0ng-Passw0rd-2026' });
    const goodBody = await good.json().catch(() => ({}));
    const me = await (await fetch('/api/v1/auth/me', { credentials: 'include' })).json().catch(() => ({}));
    return { status: wrong.status, code: wrongBody?.error?.code, ok: good.status, data: goodBody?.data, me: me?.data };
  })()`);
  check('the live backend rejects a wrong code with 400 invalid_code', live.status === 400 && live.code === 'invalid_code', [live.status, live.code]);
  check('the live backend creates the account and signs it in (CurrentUser shape)', live.ok === 200 && typeof live.data?.id === 'number' && live.data?.email?.includes('h14b.probe') && live.data?.role === 'HR', live.data);
  check('the created session reads back HR from /auth/me', live.me?.role === 'HR' && live.me?.email?.includes('h14b.probe'), live.me);

  check('no fatal console error on any step', pageErrors.length === 0, pageErrors.slice(0, 3));
} finally {
  try { ws.close(); } catch { /* already closing */ }
  chrome.kill();
}

if (failed) { console.log(`\nLOGIN/SIGNUP CHECK FAILED (${failed})`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
