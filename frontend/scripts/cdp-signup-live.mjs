/**
 * The owner's signup rule, measured on the SERVED build (H14b follow-up).
 *
 * The owner asked for: email + code + password + CONFIRM password, with the
 * subscription code as the gate — "if the code is right we store the email and
 * the password". This probe drives the real form over CDP and asserts each part
 * of that rule, plus the two things an independent review flagged as unchecked:
 * that a rejected signup never reaches the API, and that a raised banner clears
 * as soon as the operator edits a field.
 *
 *   node scripts/cdp-signup-live.mjs [baseUrl] [port]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://192.168.1.19:8080';
const PORT = Number(process.argv[3] ?? 9347);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (label, ok, value = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  — ${typeof value === 'string' ? value : JSON.stringify(value)}`);
};

const profile = mkdtempSync(join(tmpdir(), 'cdp-signup-live-'));
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
const signupPosts = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
  if (message.method === 'Network.requestWillBeSent') {
    const url = (message.params && message.params.request && message.params.request.url) || '';
    if (url.includes('/auth/signup')) signupPosts.push(message.params.request.method + ' ' + url.replace(BASE, ''));
  }
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
/* React owns these inputs: the native value setter must be paired with a reset
   of React's _valueTracker, or the descriptor set alone is swallowed. */
const setField = (name, value) => evaluate(`(() => {
  const el = document.querySelector('input[name="${name}"]');
  if (!el) return null;
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue('');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`);
const banner = () => evaluate('(document.querySelector(".banner-error") || {}).textContent || null');
const email = `signup.probe.${Date.now()}@example.local`;
const PASSWORD = 'Str0ng-Pass-2026';

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  /* ---- 1. The sign-in screen carries the entry point the owner asked for. ---- */
  await send('Page.navigate', { url: `${BASE}/login` });
  await until('!!document.querySelector("form")');
  const landing = await evaluate(`(() => ({
    picker: !!document.querySelector('.login-role-picker'),
    entryText: document.body.innerText.includes('أول مرة؟'),
    entryButton: !!document.querySelector('.login-signup-toggle'),
  }))()`);
  check('the role picker stays out of the normal sign-in page', landing.picker === false, landing.picker);
  check('the «أول مرة؟» line sits under the sign-in button with an إنشاء حساب button', landing.entryText === true && landing.entryButton === true, [landing.entryText, landing.entryButton]);

  /* ---- 2. The signup form collects the owner's four fields, in order. ---- */
  await evaluate('document.querySelector(".login-signup-toggle").click()');
  const fourFields = await until('document.querySelectorAll("form input").length === 4');
  const form = await evaluate(`(() => ({
    labels: [...document.querySelectorAll('.field-label')].map((el) => el.textContent.trim()),
    names: [...document.querySelectorAll('form input')].map((el) => el.name),
    contact: document.body.innerText.includes('مفيش كود؟ اتواصل معانا للاشتراك واستلام الكود الخاص بك'),
    phone: (document.querySelector('.login-signup-phone bdi') || {}).textContent,
  }))()`);
  check('the signup form has FOUR fields', fourFields === true, form.names);
  check('the fields are email, code, password, confirm — in that order',
    JSON.stringify(form.labels) === JSON.stringify(['البريد الإلكتروني', 'كود الاشتراك', 'كلمة المرور', 'تأكيد كلمة المرور']), form.labels);
  check('the confirm field is a real password input named confirm-password',
    JSON.stringify(form.names) === JSON.stringify(['email', 'code', 'new-password', 'confirm-password']), form.names);
  check('the no-code contact line and the owner\'s number sit under the code field', form.contact === true && form.phone === '01200704564', [form.contact, form.phone]);

  /* ---- 2b. H15b: a refusal must NAME the field, in the operator's language, and attach to it.
        The served server localises its own validator messages (H15a), so a weak password must
        come back as Arabic text under «كلمة المرور» — never as the generic «Validation failed.»
        the owner photographed. ---- */
  await setField('email', email);
  await setField('code', 'Menisy2002');
  await setField('new-password', '123');
  await setField('confirm-password', '123');
  await evaluate('document.querySelector(".login-submit").click()');
  const named = await until('(() => { const b = document.querySelector(".banner.banner-error"); return !!b && b.textContent.includes("كلمة المرور"); })()', 60);
  const weak = await evaluate(`(() => {
    const banner = document.querySelector('.banner.banner-error');
    const field = document.querySelector('input[name="new-password"]');
    const described = field ? field.getAttribute('aria-describedby') : null;
    const hint = field && field.closest('label') ? field.closest('label').querySelector('.field-hint') : null;
    return {
      banner: banner ? banner.textContent.trim() : null,
      invalid: field ? field.getAttribute('aria-invalid') : null,
      described,
      describedExists: described ? !!document.getElementById(described) : null,
      hint: hint ? hint.textContent.trim() : null,
      generic: document.body.innerText.includes('Validation failed'),
      latinSentence: /[A-Za-z]{4,}\\s+[A-Za-z]{4,}/.test(banner ? banner.textContent : ''),
    };
  })()`);
  check('a weak password is refused BY NAME, in Arabic, attached to the password field', named === true && weak.invalid === 'true' && weak.describedExists === true, weak);
  check('neither «Validation failed.» nor an English sentence is left on the screen', weak.generic === false && weak.latinSentence === false, [weak.generic, weak.latinSentence]);
  check('the password rules are stated under the field before any submit', typeof weak.hint === 'string' && weak.hint.includes('٨'), weak.hint);

  /* ---- 3. A mismatched confirmation is refused LOCALLY — nothing reaches the API. ---- */
  await setField('email', email);
  await setField('code', 'Menisy2002');
  await setField('new-password', PASSWORD);
  await setField('confirm-password', 'different-pass');
  signupPosts.length = 0;
  await evaluate('document.querySelector(".login-submit").click()');
  await sleep(600);
  const mismatch = await evaluate('({ path: location.pathname, banner: (document.querySelector(".banner-error") || {}).textContent || null })');
  check('a mismatched confirmation is refused before any request is sent',
    mismatch.banner === 'كلمتا المرور مش متطابقتين — جرّب تاني.' && signupPosts.length === 0 && mismatch.path === '/login', [mismatch.banner, signupPosts.length]);

  /* ---- 4. The banner clears the moment the operator edits a field. ---- */
  await setField('confirm-password', PASSWORD);
  await sleep(250);
  check('editing a field clears the raised banner', (await banner()) === null, await banner());

  /* ---- 5. A wrong code is refused, and does not sign anyone in. ---- */
  await setField('code', 'not-the-code');
  signupPosts.length = 0;
  await evaluate('document.querySelector(".login-submit").click()');
  const refused = await until('!!(document.querySelector(".banner-error") || {}).textContent', 60);
  const wrong = await evaluate('({ path: location.pathname, banner: (document.querySelector(".banner-error") || {}).textContent || null })');
  check('a wrong subscription code is refused by the server', refused === true && typeof wrong.banner === 'string' && wrong.banner.includes('الكود غير صحيح') && wrong.path === '/login', wrong);
  check('the wrong-code attempt did reach the API (the check is not vacuous)', signupPosts.length >= 1, signupPosts);

  /* ---- 6. The owner's rule: a right code stores the email and the password. ---- */
  await setField('code', 'Menisy2002');
  await sleep(150);
  signupPosts.length = 0;
  await evaluate('document.querySelector(".login-submit").click()');
  const signedIn = await until('location.pathname !== "/login"', 80);
  const session = await evaluate(`fetch('/api/v1/auth/me', { credentials: 'include' }).then((r) => r.json()).then((b) => JSON.stringify(b)).catch((e) => 'error: ' + e.message)`);
  check('the right code signs the new account straight in', signedIn === true, await evaluate('location.pathname'));
  check('the session that comes back IS the email that was typed', typeof session === 'string' && session.includes(email), session);
  check('the signup POST was a real POST to /auth/signup', signupPosts.some((line) => line.startsWith('POST')), signupPosts);

  /* ---- 7. No fatal console error on any step. ---- */
  const fatal = pageErrors.filter((line) => !/favicon|Failed to load resource/i.test(line));
  check('no fatal console error on any step', fatal.length === 0, fatal.slice(0, 3));
} finally {
  try { ws.close(); } catch { /* already closed */ }
  chrome.kill();
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
