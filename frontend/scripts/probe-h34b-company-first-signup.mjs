#!/usr/bin/env node
/**
 * H34b — the company-first signup wizard probe.
 *
 *   node scripts/probe-h34b-company-first-signup.mjs [baseUrl] [shotsDir]
 *
 * Drives the REAL two-step flow in the served SPA:
 *   /login → إنشاء حساب → step 1 (بيانات الشركة, activation code LAST field)
 *   → متابعة → step 2 (أول حساب) → ONE fused POST /auth/signup.
 * Covers: per-field client validation, back/forward retention, mismatch,
 * wrong code (400 invalid_code → refusal ON the step-1 code field), weak
 * password (422 → ON the step-2 password field), email_in_use → email field,
 * and the successful landing.
 *
 * IMPORTANT (run notes): the backend SERVING :8080 predates the H34 branch
 * (process started 18:41, accounts/*.py modified 19:49+), so the nested
 * `company` object is IGNORED there and the real success answers
 * needs_company_profile:true. The success case is therefore verified two
 * ways: the REAL POST (its actual answer is logged verbatim) and a
 * network-level CDP mock of the contracted fused-200 envelope for a marked
 * address — explicitly a driver-side mock, so the FRONTEND's straight-to-/
 * contract (adopt → no gate) is exercised against the answer shape H34
 * promises. No invented DB state.
 *
 * Left-over test rows are listed at the end. POSTs are spaced for the
 * signup throttle (10/min anonymous).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '/home/menisy/.hermes/profiles/frontend_engineer/cache/scratch/h34b-shots';
mkdirSync(shotsDir, { recursive: true });
const password = 'StrongPass!2026';
const wrongCode = 'WRONG-h34b';
const realCode = 'Menisy2002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── headless chrome over CDP (page target — the browser ws 404s) ─────────────
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h34b-'))}`,
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

// React-controlled inputs: prototype setter + input event (the H18/H20 recipe).
const SETTER = `const __set = (node, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};`;

// ─── 1: entry — /login keeps sign-in and its entry lands on /signup ──────────
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.pathname === '/login'`, 15000);
await until(`!!document.querySelector('.login-signup-toggle')`, 15000);
await sleep(400);
// Instrument the SPA's own fetch so request+response bodies are ON RECORD.
await evaluate(`(() => {
  window.__h34bCalls = [];
  const original = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const record = { url, method: init.method ?? 'GET', body: null, status: null, data: null };
    window.__h34bCalls.push(record);
    if (init.body) { try { record.body = JSON.parse(init.body); } catch { record.body = String(init.body); } }
    const response = await original.call(this, input, init);
    record.status = response.status;
    try {
      const cloned = response.clone();
      const payload = await cloned.json();
      record.data = payload;
    } catch { /* non-JSON */ }
    return response;
  };
})()`);
await evaluate(`document.querySelector('.login-signup-toggle').click()`);
const onSignup = await until(`window.location.pathname === '/signup' && !!document.querySelector('.company-form')`, 15000);
line('A entry /login → /signup (step 1 rendered)', onSignup);
results.push(onSignup);

// ─── 2: step 1 layout — code field is the LAST field inside the shared form ──
const layout = await evaluate(`(() => {
  const form = document.querySelector('.company-form');
  if (!form) return null;
  const inputs = [...form.querySelectorAll('input')];
  const lastInput = inputs[inputs.length - 1];
  const codeInput = form.querySelector('input[name="code"]');
  const submit = form.querySelector('.company-form-actions button[type="submit"]');
  const codeBeforeSubmit = codeInput && submit
    ? !!(codeInput.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING)
    : false;
  return {
    heading: [...document.querySelectorAll('h1')].some((h) => h.textContent.includes('بيانات الشركة')),
    stepnote: document.querySelector('.login-signup-note')?.textContent ?? '',
    lastInputIsCode: lastInput?.name === 'code' && lastInput === codeInput,
    codeInsideForm: !!codeInput,
    codeBeforeSubmit,
    submitLabel: (submit?.textContent ?? '').trim(),
    contactLine: !!document.querySelector('.login-signup-phone'),
  };
})()`);
const stepsOk = layout
  && layout.heading && layout.lastInputIsCode && layout.codeInsideForm && layout.codeBeforeSubmit
  && layout.submitLabel.includes('متابعة') && layout.contactLine;
line('B step-1 DOM order (code LAST, متابعة after)', !!stepsOk, JSON.stringify(layout));
results.push(!!stepsOk);
await shot('01-step1-company.png');

// ─── 3: empty submit → ONLY the shared form's 4 required errors ──────────────
await evaluate(`document.querySelector('.company-form button[type="submit"]').click()`);
await sleep(500);
const emptyState = await evaluate(`(() => {
  const errs = [...document.querySelectorAll('.company-form .request-inline-error')];
  return {
    requiredCount: errs.filter((n) => n.textContent.includes('هذا الحقل مطلوب.')).length,
    noCodeRefusalYet: !document.getElementById('signup-code-error'),
  };
})()`);
const emptyOk = emptyState.requiredCount === 4 && emptyState.noCodeRefusalYet;
line('C1 empty submit → 4 required company errors only', emptyOk, JSON.stringify(emptyState));
results.push(emptyOk);

// ─── 4: company fields filled but NO code → the code refusal, code focused ───
const COMPANY = { name: 'شركة فوضى للفحص H34b', activity: 'خدمات تنظيمية', address: '١٢ شارع البروف', phone: '01200704564' };
await evaluate(`(() => { ${SETTER}
  __set(document.querySelector('.company-form input[name="name"]'), ${JSON.stringify(COMPANY.name)});
  __set(document.querySelector('.company-form input[name="activity"]'), ${JSON.stringify(COMPANY.activity)});
  __set(document.querySelector('.company-form input[name="address"]'), ${JSON.stringify(COMPANY.address)});
  __set(document.querySelector('.company-form input[name="phone"]'), ${JSON.stringify(COMPANY.phone)});
})()`);
await evaluate(`document.querySelector('.company-form button[type="submit"]').click()`);
await sleep(500);
const codeMissing = await evaluate(`(() => {
  const code = document.querySelector('input[name="code"]');
  return {
    there: (document.getElementById('signup-code-error')?.textContent ?? '') === 'أدخل كود الاشتراك.',
    invalid: code?.getAttribute('aria-invalid') === 'true',
    focused: document.activeElement === code,
    stillStep1: !!document.querySelector('.company-form'),
  };
})()`);
line('C2 no code → refusal ON the code field + focus', codeMissing.there && codeMissing.invalid && codeMissing.focused && codeMissing.stillStep1, JSON.stringify(codeMissing));
results.push(!!(codeMissing.there && codeMissing.invalid && codeMissing.focused));
await shot('02-step1-code-required.png');

// ─── 5: add a WRONG code, advance ─────────────────────────────────────────────
await evaluate(`(() => { ${SETTER} __set(document.querySelector('input[name="code"]'), ${JSON.stringify(wrongCode)}); })()`);
await evaluate(`document.querySelector('.company-form button[type="submit"]').click()`);
const onStep2 = await until(`!!document.querySelector('form input[name="confirm-password"]') && !document.querySelector('.company-form')`, 15000);
const step2Meta = await evaluate(`(() => ({
  title: [...document.querySelectorAll('h1')].some((h) => h.textContent.includes('أول حساب')),
  note: document.querySelector('.login-signup-note')?.textContent ?? '',
  submit: document.querySelector('form button.login-submit')?.textContent ?? '',
}))()`);
line('D step 2 (أول حساب) after متابعة', onStep2 && step2Meta.title && step2Meta.submit.includes('إنشاء حساب'), JSON.stringify(step2Meta));
results.push(onStep2 && !!step2Meta.title && step2Meta.submit.includes('إنشاء حساب'));
await shot('03-step2-account.png');

// ─── 6: back to step 1 → collected values retained ───────────────────────────
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('رجوع لبيانات الشركة'))?.click()`);
const backHome = await until(`!!document.querySelector('.company-form')`, 15000);
await sleep(400);
const retained = await evaluate(`(() => ({
  name: document.querySelector('.company-form input[name="name"]').value,
  code: document.querySelector('input[name="code"]').value,
}))()`);
const retainedOk = backHome && retained.name === COMPANY.name && retained.code === wrongCode;
line('E back → step 1 retains company + code', retainedOk, JSON.stringify(retained));
results.push(retainedOk);
// forward again
await evaluate(`document.querySelector('.company-form button[type="submit"]').click()`);
await until(`!!document.querySelector('form input[name="confirm-password"]')`, 15000);
await sleep(300);

// ─── 7: mismatch confirm → inline refusal on the confirm field ───────────────
const step1Email = `probe.h34b.${Date.now()}@example.com`;
await evaluate(`(() => { ${SETTER}
  __set(document.querySelector('form input[name="email"]'), ${JSON.stringify(step1Email)});
  __set(document.querySelector('form input[name="new-password"]'), ${JSON.stringify(password)});
  __set(document.querySelector('form input[name="confirm-password"]'), ${JSON.stringify(password + 'x')});
})()`);
await evaluate(`document.querySelector('form button.login-submit').click()`);
await sleep(400);
const mismatch = await evaluate(`(() => {
  const err = document.getElementById('signup-account-confirm-error');
  return {
    there: !!err,
    text: err?.textContent ?? '',
    url: window.location.pathname,
    invalid: document.querySelector('form input[name="confirm-password"]')?.getAttribute('aria-invalid') === 'true',
  };
})()`);
line('F confirm mismatch → inline on confirm field', mismatch.there && mismatch.invalid && mismatch.url === '/signup', JSON.stringify(mismatch));
results.push(!!mismatch.there && mismatch.invalid);
await shot('04-step2-mismatch.png');

// ─── 8: fix confirm → fused POST with the WRONG code ─────────────────────────
await sleep(10000);
await evaluate(`(() => { ${SETTER}
  __set(document.querySelector('form input[name="confirm-password"]'), ${JSON.stringify(password)});
})()`);
await evaluate(`document.querySelector('form button.login-submit').click()`);
// Backend checks the code FIRST → 400 invalid_code → wizard RETURNS to step 1.
const backOnError = await until(`!!document.querySelector('.company-form') && !!document.getElementById('signup-code-error')`, 20000);
await sleep(400);
const wrongCodeState = await evaluate(`(() => {
  const code = document.querySelector('input[name="code"]');
  return {
    refusal: document.getElementById('signup-code-error')?.textContent ?? '',
    invalid: code?.getAttribute('aria-invalid') === 'true',
    name: document.querySelector('.company-form input[name="name"]').value,
    stillOnWizard: window.location.pathname === '/signup',
    step2Gone: !document.querySelector('form input[name="confirm-password"]'),
  };
})()`);
const wrongOk = backOnError && wrongCodeState.refusal.includes('الكود غير صحيح.')
  && wrongCodeState.invalid && wrongCodeState.name === COMPANY.name && wrongCodeState.stillOnWizard && wrongCodeState.step2Gone;
line('G wrong code → step 1, refusal ON the code field', wrongOk, JSON.stringify(wrongCodeState));
results.push(wrongOk);
await shot('05-step1-invalid-code.png');

// ─── 9: real code + WEAK password → 422 lands on the step-2 password field ───
await sleep(10000);
await evaluate(`(() => { ${SETTER} __set(document.querySelector('input[name="code"]'), ${JSON.stringify(realCode)}); })()`);
await evaluate(`document.querySelector('.company-form button[type="submit"]').click()`);
await until(`!!document.querySelector('form input[name="confirm-password"]')`, 15000);
await sleep(300);
const weakPass = '12345678';
await evaluate(`(() => { ${SETTER}
  __set(document.querySelector('form input[name="new-password"]'), ${JSON.stringify(weakPass)});
  __set(document.querySelector('form input[name="confirm-password"]'), ${JSON.stringify(weakPass)});
})()`);
await evaluate(`document.querySelector('form button.login-submit').click()`);
await until(`!!document.getElementById('signup-account-password-error')`, 20000);
await sleep(300);
const weakState = await evaluate(`(() => ({
  stillWizard: window.location.pathname === '/signup',
  err: document.getElementById('signup-account-password-error')?.textContent ?? '',
  invalid: document.querySelector('form input[name="new-password"]')?.getAttribute('aria-invalid') === 'true',
}))()`);
line('H weak password → inline on step-2 password field', weakState.stillWizard && !!weakState.err && weakState.invalid, JSON.stringify(weakState));
results.push(weakState.stillWizard && !!weakState.err && weakState.invalid);
await shot('06-step2-weak-password.png');

// ─── 10: an EXISTING email → the non-enumerating email_in_use on the field ───
await sleep(12000);
const existingEmail = 'hr@demo.local'; // exists since the crashed first run (id 12)
await evaluate(`(() => { ${SETTER}
  __set(document.querySelector('form input[name="email"]'), ${JSON.stringify(existingEmail)});
  __set(document.querySelector('form input[name="new-password"]'), ${JSON.stringify(password)});
  __set(document.querySelector('form input[name="confirm-password"]'), ${JSON.stringify(password)});
})()`);
await evaluate(`document.querySelector('form button.login-submit').click()`);
await until(`!!document.getElementById('signup-account-email-error')`, 20000);
await sleep(300);
const inUse = await evaluate(`(() => ({
  err: document.getElementById('signup-account-email-error')?.textContent ?? '',
  invalid: document.querySelector('form input[name="email"]')?.getAttribute('aria-invalid') === 'true',
  stillWizard: window.location.pathname === '/signup',
  outcome: window.__h34bCalls.filter((c) => c.url.includes('/auth/signup')).at(-1)?.data?.data?.outcome ?? null,
}))()`);
line('I email_in_use → inline on step-2 email field', !!inUse.err && inUse.invalid && inUse.stillWizard, JSON.stringify(inUse));
results.push(!!inUse.err && inUse.invalid && inUse.stillWizard);
await shot('07-step2-email-in-use.png');

// ─── 11: THE REAL fused POST (fresh email) — logged, honestly interpreted ────
await sleep(12000);
const freshEmail = `probe.h34b.ok.${Date.now()}@example.com`;
await evaluate(`(() => { ${SETTER}
  __set(document.querySelector('form input[name="email"]'), ${JSON.stringify(freshEmail)});
  __set(document.querySelector('form input[name="new-password"]'), ${JSON.stringify(password)});
  __set(document.querySelector('form input[name="confirm-password"]'), ${JSON.stringify(password)});
})()`);
await evaluate(`document.querySelector('form button.login-submit').click()`);
const landedAny = await until(`!!document.querySelector('.app-shell, .company-onboarding-panel')`, 30000);
await sleep(800);
const realState = await evaluate(`(() => {
  const calls = window.__h34bCalls.filter((c) => c.url.includes('/auth/signup'));
  const last = calls.at(-1) ?? {};
  return {
    path: window.location.pathname,
    signedInAs: document.querySelector('.profile-menu-meta')?.textContent ?? '',
    bodyHadCompany: !!last.body?.company,
    needsFlag: last.data?.data?.needs_company_profile ?? null,
    gateDiverted: !!document.querySelector('.company-onboarding-panel'),
  };
})()`);
const realOk = landedAny && realState.path !== '/signup' && realState.bodyHadCompany !== false;
line('J1 REAL fused POST → signed in (actual flag logged)', realOk,
  `path=${realState?.path} needs_company_profile=${realState?.needsFlag} bodyCompany=${realState?.bodyHadCompany} gate=${realState?.gateDiverted}`);
results.push(!!realOk);
await shot('08-real-success.png');
console.log(`   [J1 REAL] identity: ${JSON.stringify(realState?.signedInAs ?? '')} — on THIS served backend the accepted body's flag decides the landing`);

// ─── 12: the legacy /onboarding/company route still renders its own screen ───
await send('Page.navigate', { url: `${base}/onboarding/company` });
const legacy = await until(`!!document.querySelector('.company-onboarding-panel')`, 20000);
line('K legacy /onboarding/company still rendered', legacy);
results.push(legacy);
await shot('09-legacy-onboarding.png');

// ─── 13: the CONTRACTED fused-200 (driver-side CDP mock, marked address) ─────
// Intercepts ONLY the marked POST at the network layer and answers with the
// documented H34 envelope; every other request passes through untouched.
const mockEmail = `mock.h34b.${Date.now()}@example.com`;
await send('Fetch.enable', { patterns: [{ urlPattern: '*://*/*api/v1/auth/signup*', requestStage: 'Request' }] });
await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('.login-signup-toggle')`, 15000);
await sleep(400);
await evaluate(`(() => {
  window.__h34bCalls = [];
  const original = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const record = { url, method: init.method ?? 'GET', body: null, status: null, data: null };
    window.__h34bCalls.push(record);
    if (init.body) { try { record.body = JSON.parse(init.body); } catch { record.body = String(init.body); } }
    const response = await original.call(this, input, init);
    record.status = response.status;
    try { record.data = await response.clone().json(); } catch {}
    return response;
  };
})()`);
await evaluate(`document.querySelector('.login-signup-toggle').click()`);
await until(`!!document.querySelector('.company-form')`, 15000);
// fill step 1 + the marked code-mail pair
await evaluate(`(() => { ${SETTER}
  __set(document.querySelector('.company-form input[name="name"]'), ${JSON.stringify(COMPANY.name)});
  __set(document.querySelector('.company-form input[name="activity"]'), ${JSON.stringify(COMPANY.activity)});
  __set(document.querySelector('.company-form input[name="address"]'), ${JSON.stringify(COMPANY.address)});
  __set(document.querySelector('.company-form input[name="phone"]'), ${JSON.stringify(COMPANY.phone)});
  __set(document.querySelector('input[name="code"]'), ${JSON.stringify(realCode)});
})()`);
await evaluate(`document.querySelector('.company-form button[type="submit"]').click()`);
await until(`!!document.querySelector('form input[name="confirm-password"]')`, 15000);
await sleep(300);
await evaluate(`(() => { ${SETTER}
  __set(document.querySelector('form input[name="email"]'), ${JSON.stringify(mockEmail)});
  __set(document.querySelector('form input[name="new-password"]'), ${JSON.stringify(password)});
  __set(document.querySelector('form input[name="confirm-password"]'), ${JSON.stringify(password)});
})()`);
// arm the mock, then submit
let mockArmed = null;
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method !== 'Fetch.requestPaused') return;
  (async () => {
    const body = msg.params?.request?.postData ?? '';
    if (body.includes(mockEmail)) {
      mockArmed = body;
      await send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Set-Cookie', value: 'sessionid=mock-not-real; Path=/' },
        ],
        body: Buffer.from(JSON.stringify({ data: { id: 9999, email: mockEmail, full_name: 'مؤسس F34b', role: 'HR', needs_company_profile: false }, meta: {} })).toString('base64'),
      });
    } else {
      await send('Fetch.continueRequest', { requestId: msg.params.requestId });
    }
  })();
});
await evaluate(`document.querySelector('form button.login-submit').click()`);
const straightHome = await until(`window.location.pathname === '/' && !!document.querySelector('.app-shell') && !document.querySelector('.company-onboarding-panel')`, 30000);
await sleep(600);
await evaluate(`document.querySelector('.profile-trigger')?.click()`); // open the menu to read the adopted identity
await sleep(400);
const mockState = await evaluate(`(() => {
  const calls = (window.__h34bCalls ?? []).filter((c) => c.url.includes('/auth/signup'));
  const last = calls.at(-1) ?? {};
  return {
    path: window.location.pathname,
    noOnboarding: !document.querySelector('.company-onboarding-panel'),
    headerEmail: (document.querySelector('.profile-menu-meta')?.textContent ?? '').includes(${JSON.stringify(mockEmail)}),
    bodyCompanyFields: last.body?.company ? Object.keys(last.body.company).length : 0,
  };
})()`);
// disengage the interception so nothing else gets caught
await send('Fetch.disable');
const mockOk = straightHome && mockState.noOnboarding && mockState.headerEmail && mockArmed !== null;
line('L mock fused-200 → straight /, no onboarding gate', mockOk, JSON.stringify(mockState));
results.push(!!mockOk);
await shot('10-mock-success-home.png');
console.log(`   [L] fused body carried ${mockState?.bodyCompanyFields} company fields; answer: needs_company_profile:false (DRIVER MOCK — frontend contract only)`);

// ─── verdict ──────────────────────────────────────────────────────────────────
const passed = results.filter(Boolean).length;
console.log(`\nH34b probe: ${passed}/${results.length} checks passed`);
console.log(`test rows left behind: real fused signups ${step1Email} (rejected, no row), ${freshEmail} + the earlier hr@demo.local (id 12); mock NOT persisted`);
chrome.kill();
process.exit(passed === results.length ? 0 : 1);
