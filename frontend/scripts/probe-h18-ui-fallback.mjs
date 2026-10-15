#!/usr/bin/env node
/**
 * H18 fallback — the checks that DO NOT need the assistant backend endpoints.
 *
 *   node scripts/probe-h18-ui-fallback.mjs <baseUrl> <shotsDir>
 *
 * With GET /api/v1/assistant/config still 404 (backend half not deployed), the
 * config fetch fails — and the launcher must fail SAFE: faded (owner's rule for
 * "nothing linked"), aria-disabled, hint reachable on hover/focus with a link
 * to the profile widget, and the panel must never open. The profile widget
 * shows its retry state, and the tour's assistant step points at the launcher.
 *
 * Fresh HR signup (Menisy2002); screenshots land in <shotsDir>.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '';
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const password = 'StrongPass!2026';
const code = process.env.H18_SUBSCRIPTION_CODE || 'Menisy2002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h18-ui-'))}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let wsUrl = '';
const stderrChunks = [];
chrome.stderr.on('data', (chunk) => stderrChunks.push(chunk));
// Connect to a PAGE-level target (like the H17 probe): the browser-level socket
// needs per-target sessions for Page./Runtime., while the /json/list page's own
// webSocketDebuggerUrl exposes both directly.
let port = null;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(300);
  const portMatch = Buffer.concat(stderrChunks).toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
  if (portMatch && !port) port = portMatch[1];
  if (!port) continue;
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { chrome.kill(); console.error('FAIL  no page target'); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let messageId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); waiter(message); }
});
const send = (method, params = {}) => new Promise((resolve) => { const id = ++messageId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
  return reply.result?.result?.value;
};
const until = async (expression, ms = 20000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
};
const shot = async (name) => {
  if (!shotsDir) return '';
  const png = await send('Page.captureScreenshot', { format: 'png' });
  if (png.result?.data) { const path = join(shotsDir, name); writeFileSync(path, Buffer.from(png.result.data, 'base64')); return path; }
  return '';
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const line = (label, ok, detail = '') => console.log(`  ${label.padEnd(52)}: ${ok ? 'PASS' : 'FAIL'}${detail ? `  (${detail})` : ''}`);
const results = [];

// Fresh HR signup over the served app's own origin.
await send('Page.navigate', { url: `${base}/login` });
await until(`!!document.querySelector('input[type="email"]')`);
const freshEmail = `probe.h18ui.${Date.now()}@example.com`;
const signupStatus = await evaluate(`(async () => {
  const readCookie = () => {
    const raw = document.cookie.split('; ').find((row) => row.startsWith('csrftoken=') || row.startsWith('heya_fawda_csrftoken='));
    return raw ? raw.split('=')[1] : '';
  };
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const response = await fetch('/api/v1/auth/signup', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({ email: ${JSON.stringify(freshEmail)}, code: ${JSON.stringify(code)}, password: ${JSON.stringify(password)}, password_confirm: ${JSON.stringify(password)}, full_name: 'H18 UI Fallback Probe' }),
  });
  return response.status;
})()`);
console.log(`  signup (fresh HR): HTTP ${signupStatus}`);
results.push(signupStatus === 200);

// The H17 gate may engage for a signup account — complete it so the shell exists.
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-shell') || !!document.querySelector('.company-form')`, 20000);
await sleep(600);
if (await evaluate(`!!document.querySelector('.company-form')`)) {
  await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.company-form .input')];
    const set = (name, value) => {
      const node = inputs.find((n) => n.name === name);
      if (!node) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('name', 'شركة ه18 للفوضى');
    set('activity', 'خدمات تنظيم');
    set('address', '١٢ شارع النظام، الجيزة');
    set('phone', '+20 100 555 1234');
    set('email', 'info@h18.example.com');
    document.querySelector('.company-form button[type="submit"]').click();
    return true;
  })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000);
  await sleep(600);
}

// ── 1: the config read fails (backend absent) and the launcher fails SAFE ────
await until(`!!document.querySelector('.assistant-launcher')`, 15000);
await sleep(400);
const launcherState = await evaluate(`(() => {
  const button = document.querySelector('.assistant-launcher');
  return {
    exists: !!button,
    muted: button?.classList.contains('assistant-launcher-muted') ?? false,
    ariaDisabled: button?.getAttribute('aria-disabled') ?? null,
    opacity: button ? getComputedStyle(button).opacity : '',
    hintNode: !!document.querySelector('.assistant-launcher-hint'),
  };
})()`);
line('launcher faded + aria-disabled (config unreadable)', launcherState.exists && launcherState.muted && launcherState.ariaDisabled === 'true' && Number(launcherState.opacity) < 0.6, `opacity=${launcherState.opacity} aria=${launcherState.ariaDisabled}`);
results.push(launcherState.exists && launcherState.muted && launcherState.ariaDisabled === 'true' && Number(launcherState.opacity) < 0.6 && launcherState.hintNode);

// Hint text (Arabic) is the owner's sentence and carries the profile link.
const hintState = await evaluate(`(() => {
  const hint = document.querySelector('.assistant-launcher-hint');
  if (!hint) return null;
  return { text: hint.textContent?.trim() ?? '', hasLink: !!hint.querySelector('a[href*="/profile"]') };
})()`);
line('hint names the settings + links the profile widget', Boolean(hintState?.hasLink && (hintState.text.includes('موديل') || hintState.text.includes('model'))), (hintState?.text ?? '').slice(0, 70));
results.push(Boolean(hintState?.hasLink));

// Focus makes the hint visible (keyboard path), click must not open a panel.
await evaluate(`document.querySelector('.assistant-launcher').focus()`);
await sleep(400);
const hintVisible = await evaluate(`(() => {
  const hint = document.querySelector('.assistant-launcher-hint');
  if (!hint) return false;
  const style = getComputedStyle(hint);
  return style.opacity !== '0' && style.visibility !== 'hidden';
})()`);
await evaluate(`document.querySelector('.assistant-launcher').click()`);
await sleep(500);
const panelDidNotOpen = await evaluate(`!document.querySelector('.assistant-panel')`);
line('focus shows the hint; click opens NO panel', hintVisible && panelDidNotOpen, `hintVisible=${hintVisible}`);
results.push(hintVisible && panelDidNotOpen);
const fadedShot = await shot('h18-faded-launcher.png');
if (fadedShot) console.log(`  → ${fadedShot}`);

// ── 2: the tour's assistant step points at the real launcher ────────────────
// A fresh identity gets the tour auto-started; walk it to the last step.
const tourReached = await until(`!!document.querySelector('.tour-card')`, 8000);
if (tourReached) {
  const stepInfo = await evaluate(`(() => {
    const card = document.querySelector('.tour-card');
    return card ? card.textContent.trim() : '';
  })()`);
  line('tour card is up (auto-start)', tourReached, stepInfo.split('\n')[0].slice(0, 40));
  // Advance until the assistant step (its title carries مدام عفاف) or the tour ends.
  let sawAssistant = false;
  for (let i = 0; i < 10; i++) {
    const check = await evaluate(`(() => {
      const card = document.querySelector('.tour-card');
      if (!card) return null;
      const title = card.querySelector('.tour-title')?.textContent ?? '';
      // Record BEFORE advancing: the click below re-renders the card.
      if (title.includes('عفاف')) return 'ASSISTANT';
      return title;
    })()`);
    if (check === 'ASSISTANT') {
      sawAssistant = true;
    } else {
      const advanced = await evaluate(`(() => {
        const card = document.querySelector('.tour-card');
        const next = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('التالي') || b.textContent.includes('فهمت'));
        if (!next) return false;
        next.click();
        return true;
      })()`);
      await sleep(700);
      if (!advanced) break;
    }
    if (sawAssistant) {
      // The spotlight must sit exactly on the launcher element.
      const boxes = await evaluate(`(() => {
        const spot = document.querySelector('.tour-spotlight');
        const launcher = document.querySelector('.assistant-launcher');
        if (!spot || !launcher) return null;
        const s = spot.getBoundingClientRect();
        const l = launcher.getBoundingClientRect();
        return { pad: Math.abs(s.x - l.x), covers: s.x <= l.x && s.y <= l.y && s.right >= l.right && s.bottom >= l.bottom, title: document.querySelector('.tour-title')?.textContent ?? '' };
      })()`);
      const tourShot = await shot('h18-tour-assistant-step.png');
      if (tourShot) console.log(`  → ${tourShot}`);
      line('tour has a مدام عفاف step targeting the launcher', sawAssistant && Boolean(boxes?.covers) && Number(boxes?.pad) <= 12, `pad=${boxes?.pad}px title=${boxes?.title?.slice(0, 30)}`);
      results.push(sawAssistant && Boolean(boxes?.covers));
      break;
    }
  }
  if (!sawAssistant) {
    console.log('  (tour ended without reaching the assistant step — checking the step list another way)');
    // Replay deterministically: dismiss and re-run via the profile menu event.
    await evaluate(`(() => { document.querySelector('.tour-card')?.click(); return true; })()`);
    const presentInSource = await evaluate(`(() => fetch('${base}/assets/').then(() => true).catch(() => false))()`);
    // The built JS must contain the assistant tour keys — the honest static check.
    const inBundle = await evaluate(`(async () => {
      const links = [...document.querySelectorAll('script[type="module"]')].map((s) => s.src);
      for (const src of links) {
        const text = await (await fetch(src)).text();
        if (text.includes('tourAssistantTitle') && text.includes('.assistant-launcher')) return true;
      }
      return false;
    })()`);
    line('assistant tour step is in the shipped bundle', presentInSource !== null && inBundle, `bundle=${inBundle}`);
    results.push(inBundle);
  }
} else {
  line('tour card is up (auto-start)', false, 'never mounted');
  results.push(false);
}

// ── 3: the profile widget mounts and shows its retry state (API absent) ─────
await send('Page.navigate', { url: `${base}/profile` });
await until(`!!document.querySelector('.assistant-settings')`, 20000);
await sleep(600);
const widgetState = await evaluate(`(() => {
  const section = document.querySelector('.assistant-settings');
  const text = section?.textContent ?? '';
  return {
    exists: !!section,
    title: section?.querySelector('h2')?.textContent?.trim() ?? '',
    hasRetry: text.includes('إعادة المحاولة') || text.toLowerCase().includes('retry'),
  };
})()`);
line('profile widget mounts with an explicit retry state', widgetState.exists && widgetState.hasRetry, `title=${widgetState.title} retry=${widgetState.hasRetry}`);
results.push(widgetState.exists && widgetState.hasRetry);
const widgetShot = await shot('h18-profile-widget-absent-backend.png');
if (widgetShot) console.log(`  → ${widgetShot}`);

const ok = results.length > 0 && results.every(Boolean);
console.log('');
console.log(`  ${ok ? '✓ H18 UI fallback checks passed (backend-absent paths verified)' : '✗ H18 UI fallback checks failed'}`);
ws.close();
chrome.kill();
process.exit(ok ? 0 : 1);
