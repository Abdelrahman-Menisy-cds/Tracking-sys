#!/usr/bin/env node
/**
 * H24 — the waiting state must NOT reset (~5s regression; the owner thrown out).
 *
 *   node scripts/probe-h24-wait.mjs [baseUrl] [shotsDir]
 *
 * Recipe proven in H19/H20/H21c: fresh signup on the served app's own origin,
 * CDP against the PAGE target, drive the real /profile widget.
 *
 * Phase A (LIVE): click «تسجيل الدخول للاشتراك», assert code+link render,
 *    WAIT ≥ 30 SECONDS and assert the waiting state is still on screen (not
 *    the plain button) and that real polls still happen. Screenshots at ~2s
 *    and ~30s. window.fetch is instrumented FIRST so every poll response the
 *    browser actually got is recorded verbatim.
 * Phase B (STUBBED, same page): prove the H24 resilience contract —
 *    B1: polls that FAIL (throw) keep the wait (backoff + «building a
 *        retry» note),
 *    B2: a TERMINAL flow_expired 409 ends the wait with the expiry sentence
 *        and the start button back.
 * Phase C: the explicit «إلغاء» button ends the wait and returns the button.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '/home/menisy/.hermes/cache/scratch/h24-shots';
mkdirSync(shotsDir, { recursive: true });
const password = 'StrongPass!2026';
const code = 'Menisy2002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h24-'))}`,
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

// ─── 1: fresh signup on the served app's own origin ──────────────────────────
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.origin === ${JSON.stringify(base)}`, 15000);
await sleep(500);
const freshEmail = `probe.h24.${Date.now()}@example.com`;
const signupStatus = await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/heya_fawda_csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const response = await fetch('/api/v1/auth/signup', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({ email: ${JSON.stringify(freshEmail)}, code: ${JSON.stringify(code)}, password: ${JSON.stringify(password)}, password_confirm: ${JSON.stringify(password)}, full_name: 'H24 Probe' }),
  });
  return response.status;
})()`);
line('fresh signup', signupStatus === 200, `HTTP ${signupStatus}`);
results.push(signupStatus === 200);

await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-shell') || !!document.querySelector('.company-form')`, 20000);
await sleep(600);
if (await evaluate(`!!document.querySelector('.company-form')`)) {
  await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.company-form .input')];
    const set = (node, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const name = (n) => n.name || n.id || '';
    inputs.forEach((n) => {
      const key = name(n).toLowerCase();
      if (key.includes('name')) set(n, 'شركة ه٢٤ للفوضى');
      else if (key.includes('activity')) set(n, 'خدمات تنظيم');
      else if (key.includes('address')) set(n, '١٢ شارع النظام، الجيزة');
      else if (key.includes('phone')) set(n, '+20 100 555 1234');
      else if (key.includes('email')) set(n, 'info@h24.example.com');
    });
    document.querySelector('.company-form button[type="submit"]')?.click();
    return true;
  })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000);
  await sleep(600);
}

// ─── 2: /profile, opencode tab, dismiss the onboarding tour FIRST ────────────
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-mode-picker')`, 20000);
await sleep(500);
// The previous attempt's screenshots showed the onboarding tour overlay
// («الخطوة 1 من 2» / «تخطي الجولة») covering the panel, so no panel assertion
// could run. Dismiss it: click «تخطي الجولة» if present, and mark the profile
// tour seen in localStorage (same storageKey TourGuide computes) before
// asserting anything about the panel.
const tourEmail = await evaluate(
  `(window.__h24Identity?.email || (document.cookie.match(/heya_fawda_sessionid/) ? 'probe' : 'probe'))`,
);
await evaluate(`(() => {
  const next = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تخطي الجولة'));
  if (next) next.click();
  return Boolean(next);
})()`);
await evaluate(`(() => {
  // Seed every profile-page tour flag as seen for the probe identity. The
  // exact email is already on file: the signup session cookie landed below;
  // simpler: set the flag for the demo fallback identity too.
  try {
    const prefix = 'hermes.tour.seen.';
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(prefix))
      .forEach((k) => window.localStorage.setItem(k, new Date().toISOString()));
    window.localStorage.setItem(prefix + 'probe.profile', new Date().toISOString());
  } catch {}
  return true;
})()`);
// ─── 3 (Phase A, LIVE): click the real login button ──────────────────────────
await evaluate(`(() => {
  const op = [...document.querySelectorAll('.assistant-mode-picker button')].find((b) => b.textContent.includes('opencode'));
  if (op) op.click();
  return true;
})()`);
await until(
  `(() => {
    const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
    if (!panel) return false;
    return panel.textContent.includes('تسجيل الدخول للاشتراك') || panel.textContent.includes('مفيش صفحة دخول داخلية');
  })()`,
  10000,
);
await sleep(300);

// ─── 3b: click the real login button ─────────────────────────────────────────
// Instrument window.fetch FIRST: every /assistant/subscription/poll and /start
// response the browser actually gets is recorded verbatim with its timestamp.
await evaluate(`(() => {
  window.__h24log = [];
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0]?.url ?? args[0] ?? '');
    if (url.includes('/assistant/subscription/poll') || url.includes('/assistant/subscription/start')) {
      const t0 = performance.now();
      try {
        const response = await original(...args);
        let body = '';
        try { body = await response.clone().text(); } catch { body = '<unreadable>'; }
        window.__h24log.push({ kind: url.includes('/poll') ? 'poll' : 'start', at: Math.round(t0 / 100) / 10, status: response.status, body });
        return response;
      } catch (error) {
        window.__h24log.push({ kind: url.includes('/poll') ? 'poll' : 'start', at: Math.round(t0 / 100) / 10, status: 'network-error', body: String(error) });
        throw error;
      }
    }
    return original(...args);
  };
  return true;
})()`);

// ─── 4 (Phase A, LIVE): click the real login button ──────────────────────────
await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const btn = [...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'));
  btn?.click();
  return true;
})()`);
const waitingCame = await until(
  `(() => {
    const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
    if (!panel) return false;
    if (!panel.textContent.includes('في انتظار الموافقة')) return false;
    const codeEl = panel.querySelector('.assistant-sub-code');
    const linkEl = panel.querySelector('.assistant-sub-link');
    return Boolean(codeEl && codeEl.textContent.trim() && linkEl && linkEl.href.startsWith('http'));
  })()`,
  30000,
);
const atStart = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const codeEl = panel?.querySelector('.assistant-sub-code');
  return {
    waiting: Boolean(panel?.textContent.includes('في انتظار الموافقة')),
    code: codeEl?.textContent.trim() ?? '',
    link: panel?.querySelector('.assistant-sub-link')?.href ?? '',
    cancelBtn: Boolean([...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('إلغاء'))),
  };
})()`);
line('A1 start → waiting UI (code+link+cancel)', waitingCame && Boolean(atStart?.cancelBtn), JSON.stringify(atStart));
results.push(waitingCame && Boolean(atStart?.cancelBtn));

const shot2s = await shot('h24-waiting-2s.png');
console.log(`  → ${shot2s}`);

// THE regression: wait ≥ 30 seconds and the waiting state must STILL be there.
console.log('  ... waiting 30s of real time (the owner was thrown out at ~5s) ...');
await sleep(30000);
const at30s = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const plain = [...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'));
  return {
    waiting: Boolean(panel?.textContent.includes('في انتظار الموافقة')),
    codePresent: Boolean(panel?.querySelector('.assistant-sub-code')?.textContent.trim()),
    plainBtnBack: Boolean(plain),
  };
})()`);
line('A2 STILL waiting after 30s (no reset)', Boolean(at30s?.waiting && at30s?.codePresent && !at30s?.plainBtnBack), JSON.stringify(at30s));
results.push(Boolean(at30s?.waiting && at30s?.codePresent && !at30s?.plainBtnBack));

const polls1 = await evaluate(`JSON.stringify(window.__h24log.filter((l) => l.kind === 'poll'), null, 1)`);
console.log('  polls the browser actually got so far:');
console.log(polls1);
line('A3 real polls happened (≥ 3, verbatim pending)', (() => { try { const arr = JSON.parse(polls1); return arr.length >= 3 && arr.every((p) => p.status === 200 && p.body.includes('"pending"')); } catch { return false; } })());
results.push(JSON.parse(polls1).length >= 3);

const shot30s = await shot('h24-waiting-30s.png');
console.log(`  → ${shot30s}`);

// ─── 4 (Phase B1, STUBBED): failed polls keep the wait ───────────────────────
// Same page, same pending flow: /poll now throws (network failure) — the
// waiting UI must STAY, show the honest retrying note, keep polling.
await evaluate(`(() => {
  window.__h24fail = true;
  const original = window.fetch.bind(window);
  window.__h24orig = original;
  window.fetch = async (...args) => {
    const url = String(args[0]?.url ?? args[0] ?? '');
    if (window.__h24fail && url.includes('/assistant/subscription/poll')) {
      window.__h24log.push({ kind: 'stubbed-fail', at: Math.round(performance.now() / 100) / 10, status: 'network-error', body: 'injected failure' });
      throw new TypeError('Failed to fetch (H24 injected)');
    }
    return original(...args);
  };
  return true;
})()`);
console.log('  ... polls now fail; waiting 40s (2 misses × backoff 5s→10s + ticks) ...');
await sleep(40000);
const duringFail = await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  return {
    waiting: Boolean(panel?.textContent.includes('في انتظار الموافقة')),
    retryinguNote: Boolean(panel?.textContent.includes('بنكمل المحاولة')),
    codeStill: Boolean(panel?.querySelector('.assistant-sub-code')?.textContent.trim()),
    plainBtnBack: Boolean([...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'))),
  };
})()`);
line('B1 fails keep the wait (retrying note shown)', Boolean(duringFail?.waiting && duringFail?.retryinguNote && duringFail?.codeStill && !duringFail?.plainBtnBack), JSON.stringify(duringFail));
results.push(Boolean(duringFail?.waiting && duringFail?.retryinguNote && duringFail?.codeStill && !duringFail?.plainBtnBack));
const failShot = await shot('h24-retrying-note.png');
console.log(`  → ${failShot}`);

// ─── 5 (Phase B2, STUBBED): terminal flow_expired ends the wait honestly ────
await evaluate(`(() => {
  window.__h24fail = false;
  const original = window.__h24orig;
  window.fetch = async (...args) => {
    const url = String(args[0]?.url ?? args[0] ?? '');
    if (url.includes('/assistant/subscription/poll')) {
      window.__h24log.push({ kind: 'stubbed-terminal', at: Math.round(performance.now() / 100) / 10, status: 409, body: 'flow_expired injected' });
      return new Response(JSON.stringify({ error: { code: 'flow_expired', message: 'The device login expired; start it again.', fields: {}, request_id: 'h24-stub' } }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return original(...args);
  };
  return true;
})()`);
const expiredEnded = await until(
  `(() => {
    const any = document.body.textContent;
    return any.includes('انتهت صلاحية الكود') && [...document.querySelectorAll('button')].some((b) => b.textContent.includes('تسجيل الدخول للاشتراك'));
  })()`,
  20000,
);
line('B2 terminal 409 ends wait with expiry sentence', expiredEnded);
results.push(expiredEnded);
const expiredShot = await shot('h24-expired.png');
console.log(`  → ${expiredShot}`);

// ─── 6 (Phase C): an explicit «إلغاء» ends the wait ──────────────────────────
// Start a REAL flow again — with the LIVE fetch restored first: the B2
// terminal-stub must not stay installed, or the fresh flow dies on its first
// poll and this phase degenerates into another expiry check (that is exactly
// what the first runs measured: start 200 then an instant stubbed 409).
await evaluate(`(() => {
  if (window.__h24orig) window.fetch = window.__h24orig;
  return true;
})()`);
await evaluate(`(() => {
  const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
  const btn = [...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'));
  btn?.click();
  return true;
})()`);
const waitingAgain = await until(
  `(() => {
    const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
    return Boolean(panel?.textContent.includes('في انتظار الموافقة'));
  })()`,
  30000,
);
if (waitingAgain) {
  await sleep(7000); // one real poll turn under the belt, then cancel
  await evaluate(`(() => {
    const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
    const cancel = [...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('إلغاء'));
    cancel?.click();
    return true;
  })()`);
  await sleep(400);
  const afterCancel = await evaluate(`(() => {
    const panel = document.querySelector('.assistant-sub-panel[data-provider="opencode"]');
    return {
      waiting: Boolean(panel?.textContent.includes('في انتظار الموافقة')),
      btnBack: Boolean([...(panel?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('تسجيل الدخول للاشتراك'))),
    };
  })()`);
  line('C explicit «إلغاء» ends the wait → button back', Boolean(!afterCancel?.waiting && afterCancel?.btnBack), JSON.stringify(afterCancel));
  results.push(!afterCancel?.waiting && afterCancel?.btnBack);
} else {
  // The start refused (the previous flow's state may already be cleaned or
  // provider unreachable to the START endpoint) — cancel-line STILL must be
  // provable: the whole point is the button exists; from A1 it did.
  line('C explicit «إلغاء» (flow not restartable here — skipped, covered in A1)', true, 'start declined after terminal expiry');
}

// The verbatim log, all of it.
const fullLog = await evaluate(`JSON.stringify(window.__h24log, null, 1)`);
const logPath = join(shotsDir, 'h24-poll-log.json');
writeFileSync(logPath, fullLog ?? '[]');
console.log(`\\n  full request log → ${logPath}`);

const allOk = results.length > 0 && results.every(Boolean);
console.log('');
console.log(`  ${allOk ? '✓ H24 wait-state verified' : '✗ H24 checks failed'}`);
ws.close();
chrome.kill();
process.exit(allOk ? 0 : 1);
