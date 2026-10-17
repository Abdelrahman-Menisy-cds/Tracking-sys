#!/usr/bin/env node
/**
 * H45 — the sidebar opens and closes, with numbers attached.
 *
 *   node scripts/probe-h45-sidebar.mjs [baseUrl] [shotsDir]
 *
 * Desktop 1280x900 (inline rail):
 *   - toggle button visible, `aria-expanded` / `aria-controls` correct
 *   - collapse via click AND via `[` → rail rect width 0, content column grew,
 *     nav inert, focus lands on the toggle button
 *   - open via click/`[` → rail back to full width, focus lands inside the rail
 *   - Esc while focus is in the rail → collapses, focus returns to the button
 *   - reload → the collapsed state is REMEMBERED (localStorage)
 * Mobile 360x800 (overlay drawer):
 *   - backdrop exists, nav is fixed-position, no horizontal scroll
 *   - click-outside closes, Esc closes, focus returns to the toggle
 * Both themes get a screenshot.
 *
 * Pattern proven in H18/H20: headless Chrome over CDP, page target from
 * /json/list, Runtime.evaluate only (dispatchMouseEvent is a no-op here).
 * Screenshots land in <shotsDir> (default ~/.hermes/cache/scratch/h45-shots).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.1.19:8080').replace(/\/$/, '');
const shotsDir = process.argv[3] ?? '/home/menisy/.hermes/cache/scratch/h45-shots';
mkdirSync(shotsDir, { recursive: true });
const EMAIL = 'hr@demo.local';
const PASSWORD = 'demo1234';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── headless chrome over CDP (page target — the browser ws 404s) ─────────────
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h45-rail-'))}`,
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
const setViewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const key = (options) => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', ${options}))`);

await send('Page.enable');
await send('Runtime.enable');

const line = (label, ok, detail = '') => console.log(`  ${label.padEnd(58)}: ${ok ? 'PASS' : 'FAIL'}${detail ? `  (${detail})` : ''}`);
const results = [];
const keep = (ok) => { results.push(Boolean(ok)); };

// ─── 1: sign in with the shared demo HR identity, over the served origin ─────
await setViewport(1280, 900);
await send('Page.navigate', { url: `${base}/login` });
await until(`window.location.origin === ${JSON.stringify(base)}`, 15000);
await sleep(500);
const loginStatus = await evaluate(`(async () => {
  const readCookie = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie() },
    body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} }),
  });
  return response.status;
})()`);
line('hr@demo.local signed in', loginStatus === 200, `HTTP ${loginStatus}`);
keep(loginStatus === 200);

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
    inputs.forEach((n) => {
      const key = (n.name || n.id || '').toLowerCase();
      if (key.includes('name')) set(n, 'شركة H45');
      else if (key.includes('activity')) set(n, 'خدمات تنظيم');
      else if (key.includes('address')) set(n, '١٢ شارع النظام، الجيزة');
      else if (key.includes('phone')) set(n, '+20 100 555 1234');
      else if (key.includes('email')) set(n, 'info@h45.example.com');
    });
    document.querySelector('.company-form button[type="submit"]')?.click();
    return true;
  })()`);
  await until(`!!document.querySelector('.app-rail')`, 20000);
  await sleep(600);
}

// The guided tour intercepts clicks — dismiss it first.
const tourGone = await evaluate(`(() => {
  const skip = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تخطي الجولة'));
  if (skip) { skip.click(); return 'skipped'; }
  return 'absent';
})()`);
await sleep(400);
await evaluate(`(() => {
  const skip = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تخطي'));
  if (skip) skip.click();
  return true;
})()`);
await sleep(300);
line('guided tour dismissed', true, `tour=${tourGone}`);

// ─── 2: DESKTOP — the rail is inline and the toggle really toggles ────────────
const railGeometry = () => evaluate(`(() => {
  const rail = document.querySelector('.app-rail');
  const main = document.querySelector('.app-main');
  const button = document.querySelector('.menu-toggle');
  const rect = rail.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  const style = getComputedStyle(button);
  return {
    railWidth: Math.round(rect.width),
    mainWidth: Math.round(mainRect.width),
    toggleVisible: style.display !== 'none',
    expanded: button.getAttribute('aria-expanded'),
    controls: button.getAttribute('aria-controls'),
    label: button.getAttribute('aria-label'),
    railInert: rail.hasAttribute('inert'),
    activeIsButton: document.activeElement === button,
    activeInRail: rail.contains(document.activeElement),
    stored: window.localStorage.getItem('tracking-sys.rail-collapsed'),
    collapsedClass: document.querySelector('.app-shell').classList.contains('rail-collapsed'),
  };
})()`);

await evaluate(`window.localStorage.removeItem('tracking-sys.rail-collapsed')`);
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-rail')`, 20000);
await until(`!!document.querySelector('.menu-toggle')`, 20000);
await sleep(700);
// dismiss the tour again (fresh page load, tour may re-show per-identity only once)
await evaluate(`(() => { const s = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تخطي')); if (s) s.click(); return true; })()`);
await sleep(300);

let g = await railGeometry();
console.log('');
console.log('  -- DESKTOP (1280x900) initial state --');
line('toggle button visible on desktop, rail open', g.toggleVisible && g.railWidth === 248 && g.expanded === 'true', `rail=${g.railWidth}px expanded=${g.expanded}`);
keep(g.toggleVisible && g.railWidth === 248 && g.expanded === 'true');
line('aria-controls -> app-rail-nav', g.controls === 'app-rail-nav', g.controls);
keep(g.controls === 'app-rail-nav');
line('aria-label names the TARGET action (open -> close label)', g.label && g.label.includes('إغلاق'), g.label);
keep(g.label && g.label.includes('إغلاق'));

// open main width before
const openState = g;

// click the toggle -> collapse
await evaluate(`document.querySelector('.menu-toggle').click()`);
await until(`(() => { const r = document.querySelector('.app-rail').getBoundingClientRect(); return r.width < 2; })()`, 5000);
await sleep(500);
let closed = await railGeometry();
console.log('  -- DESKTOP after CLICK to collapse --');
line('rail collapsed to width 0', closed.railWidth === 0, `rail=${closed.railWidth}px`);
keep(closed.railWidth === 0);
line('content column grew (no empty gap)', closed.mainWidth > openState.mainWidth, `main ${openState.mainWidth}px -> ${closed.mainWidth}px`);
keep(closed.mainWidth > openState.mainWidth);
line('aria-expanded=false + collapsed class', closed.expanded === 'false' && closed.collapsedClass === true, `expanded=${closed.expanded}`);
keep(closed.expanded === 'false' && closed.collapsedClass === true);
line('collapsed rail is inert (no tab stops escape)', closed.railInert === true, `inert=${closed.railInert}`);
keep(closed.railInert === true);
line('preference stored in localStorage', closed.stored === 'true', `stored=${closed.stored}`);
keep(closed.stored === 'true');

// click again -> open, focus into rail
await evaluate(`document.querySelector('.menu-toggle').click()`);
await until(`(() => { const r = document.querySelector('.app-rail').getBoundingClientRect(); return r.width > 200; })()`, 5000);
await sleep(500);
let reopened = await railGeometry();
line('click re-opens rail at full width', reopened.railWidth === 248 && reopened.expanded === 'true', `rail=${reopened.railWidth}px`);
keep(reopened.railWidth === 248 && reopened.expanded === 'true');
line('focus moved into the rail after open', reopened.activeInRail === true, `active=${reopened.activeIsButton ? 'button' : 'rail item'}`);
keep(reopened.activeInRail === true);
const deskOpenShot = await shot('h45-desktop-open-dark.png');

// [ shortcut collapses, and focus returns to the button
await key(`{ key: '[', bubbles: true }`);
await until(`(() => { const r = document.querySelector('.app-rail').getBoundingClientRect(); return r.width < 2; })()`, 5000);
await sleep(500);
let shortcutClosed = await railGeometry();
line('[ key collapses the rail', shortcutClosed.railWidth === 0 && shortcutClosed.expanded === 'false', `rail=${shortcutClosed.railWidth}px`);
keep(shortcutClosed.railWidth === 0 && shortcutClosed.expanded === 'false');
line('focus returned to the toggle button', shortcutClosed.activeIsButton === true, `active-is-button=${shortcutClosed.activeIsButton}`);
keep(shortcutClosed.activeIsButton === true);
const deskClosedShot = await shot('h45-desktop-closed-dark.png');

// reload -> the collapsed state is remembered
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-rail')`, 20000);
await sleep(1000);
await evaluate(`(() => { const s = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تخطي')); if (s) s.click(); return true; })()`);
await sleep(400);
let remembered = await railGeometry();
line('after reload the collapsed state is remembered', remembered.railWidth === 0 && remembered.collapsedClass === true && remembered.stored === 'true', `rail=${remembered.railWidth}px stored=${remembered.stored}`);
keep(remembered.railWidth === 0 && remembered.collapsedClass === true && remembered.stored === 'true');

// Esc with focus inside the (open) rail collapses and restores focus
await evaluate(`document.querySelector('.menu-toggle').click()`);
await until(`(() => { const r = document.querySelector('.app-rail').getBoundingClientRect(); return r.width > 200; })()`, 5000);
await sleep(500);
await evaluate(`(() => { const link = document.querySelector('.app-rail a'); if (link) link.focus(); return document.activeElement.className; })()`);
await key(`{ key: 'Escape', bubbles: true }`);
await until(`(() => { const r = document.querySelector('.app-rail').getBoundingClientRect(); return r.width < 2; })()`, 5000);
await sleep(500);
let escClosed = await railGeometry();
line('Esc (focus in rail) collapses + refocuses button', escClosed.railWidth === 0 && escClosed.activeIsButton === true, `rail=${escClosed.railWidth}px activeIsButton=${escClosed.activeIsButton}`);
keep(escClosed.railWidth === 0 && escClosed.activeIsButton === true);

// ─── 3: LIGHT THEME shots for the same states ────────────────────────────────
await evaluate(`document.querySelector('.menu-toggle').click()`);
await until(`(() => { const r = document.querySelector('.app-rail').getBoundingClientRect(); return r.width > 200; })()`, 5000);
await sleep(400);
await evaluate(`(() => { document.querySelector('.theme-toggle-header').click(); return true; })()`);
await sleep(400);
const lightOpenShot = await shot('h45-desktop-open-light.png');
await evaluate(`document.querySelector('.menu-toggle').click()`);
await until(`(() => { const r = document.querySelector('.app-rail').getBoundingClientRect(); return r.width < 2; })()`, 5000);
await sleep(400);
const lightClosedShot = await shot('h45-desktop-closed-light.png');
console.log('  -- THEME shots --');
line('light theme shots captured', Boolean(lightOpenShot) && Boolean(lightClosedShot), `${lightOpenShot.split('/').pop()}, ${lightClosedShot.split('/').pop()}`);
keep(Boolean(lightOpenShot) && Boolean(lightClosedShot));
// theme back to dark for a clean session
await evaluate(`(() => { document.querySelector('.theme-toggle-header').click(); return true; })()`);
await sleep(300);

// ─── 4: MOBILE 360x800 — the sidebar is an overlay drawer ────────────────────
await evaluate(`window.localStorage.removeItem('tracking-sys.rail-collapsed')`);
await setViewport(360, 800);
await send('Page.navigate', { url: `${base}/` });
await until(`!!document.querySelector('.app-rail') && !!document.querySelector('.menu-toggle')`, 20000);
await sleep(800);
await evaluate(`(() => { const s = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تخطي')); if (s) s.click(); return true; })()`);
await sleep(300);
const mobileOpen = () => evaluate(`(() => {
  const rail = document.querySelector('.app-rail');
  const backdrop = document.querySelector('.drawer-backdrop');
  const button = document.querySelector('.menu-toggle');
  const main = document.querySelector('.app-main');
  return {
    opened: rail.classList.contains('open'),
    railWidth: Math.round(rail.getBoundingClientRect().width),
    drawerOverlays: getComputedStyle(rail).position === 'fixed',
    backdropExists: !!backdrop,
    backdropScrim: backdrop ? getComputedStyle(backdrop).backgroundColor : '',
    expanded: button.getAttribute('expanded') || button.getAttribute('aria-expanded'),
    activeInRail: rail.contains(document.activeElement),
    activeIsButton: document.activeElement === button,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    bodyW: document.body.scrollWidth,
    viewportW: window.innerWidth,
    mainInert: main.hasAttribute('inert'),
    dialogRole: rail.getAttribute('role'),
  };
})()`);
let mClosed = await mobileOpen();
line('mobile starts closed, no backdrop', mClosed.opened === false && mClosed.backdropExists === false && mClosed.mainInert === false, `opened=${mClosed.opened} backdrop=${mClosed.backdropExists} railVisible=` + mClosed.railWidth);
keep(mClosed.opened === false && mClosed.backdropExists === false);
await evaluate(`document.querySelector('.menu-toggle').click()`);
await until(`!!document.querySelector('.drawer-backdrop')`, 5000);
await sleep(500);
let mOpen = await mobileOpen();
console.log('  -- MOBILE (360x800) drawer open --');
line('drawer overlays content (fixed + z-layer)', mOpen.opened === true && mOpen.drawerOverlays === true, `fixed=${mOpen.drawerOverlays}`);
keep(mOpen.opened === true && mOpen.drawerOverlays === true);
line('scrim backdrop present', mOpen.backdropExists === true && mOpen.backdropScrim.includes('rgba'), mOpen.backdropScrim);
keep(mOpen.backdropExists === true && mOpen.backdropScrim.includes('rgba'));
line('no horizontal scroll (scrollWidth == clientWidth)', mOpen.scrollW === mOpen.clientW && mOpen.clientW === mOpen.viewportW, `scroll=${mOpen.scrollW} client=${mOpen.clientW} viewport=${mOpen.viewportW}`);
keep(mOpen.scrollW === mOpen.clientW && mOpen.clientW === mOpen.viewportW);
line('content is inert behind the drawer + dialog role', mOpen.mainInert === true && mOpen.dialogRole === 'dialog', `inert=${mOpen.mainInert} role=${mOpen.dialogRole}`);
keep(mOpen.mainInert === true && mOpen.dialogRole === 'dialog');
line('focus moved into the drawer', mOpen.activeInRail === true, `rail=${mOpen.railWidth}`);
keep(mOpen.activeInRail === true);
const mobileOpenShot = await shot('h45-mobile-open-dark.png');

// click OUTSIDE (the backdrop) closes
await evaluate(`document.querySelector('.drawer-backdrop').click()`);
await until(`(() => document.querySelectorAll('.drawer-backdrop').length === 0 && getComputedStyle(document.querySelector('.app-rail')).visibility === 'hidden')()`, 5000);
await sleep(400);
let mAfterClickOut = await mobileOpen();
line('click outside closes the drawer', mAfterClickOut.opened === false && mAfterClickOut.expanded === 'false', `opened=${mAfterClickOut.opened} expanded=${mAfterClickOut.expanded}`);
keep(mAfterClickOut.opened === false && mAfterClickOut.expanded === 'false');
line('focus returned to the toggle button', mAfterClickOut.activeIsButton === true, `activeIsButton=${mAfterClickOut.activeIsButton}`);
keep(mAfterClickOut.activeIsButton === true);

// open again, Esc closes
await evaluate(`document.querySelector('.menu-toggle').click()`);
await until(`!!document.querySelector('.drawer-backdrop')`, 5000);
await sleep(500);
await key(`{ key: 'Escape', bubbles: true }`);
await until(`(() => document.querySelectorAll('.drawer-backdrop').length === 0)()`, 5000);
await sleep(400);
let mAfterEsc = await mobileOpen();
line('Esc closes the drawer + refocuses the button', mAfterEsc.opened === false && mAfterEsc.activeIsButton === true, `opened=${mAfterEsc.opened} activeIsButton=${mAfterEsc.activeIsButton}`);
keep(mAfterEsc.opened === false && mAfterEsc.activeIsButton === true);

const mobileClosedShot = await shot('h45-mobile-closed-dark.png');
line('mobile shots captured', Boolean(mobileOpenShot) && Boolean(mobileClosedShot), `${mobileOpenShot.split('/').pop()}, ${mobileClosedShot.split('/').pop()}`);
keep(Boolean(mobileOpenShot) && Boolean(mobileClosedShot));

// localStorage untouched by the mobile drawer round (no type changes)
line('mobile round did not scribble the rail preference', await evaluate(`window.localStorage.getItem('tracking-sys.rail-collapsed')`) === null, '');
keep(await evaluate(`window.localStorage.getItem('tracking-sys.rail-collapsed')`) === null);

// ─── summary ─────────────────────────────────────────────────────────────────
const allOk = results.length > 0 && results.every(Boolean);
console.log('');
for (const p of [deskOpenShot, deskClosedShot, lightOpenShot, lightClosedShot, mobileOpenShot, mobileClosedShot]) {
  if (p) console.log(`  -> ${p}`);
}
console.log('');
console.log(`  ${results.filter(Boolean).length}/${results.length} checks passed`);
console.log(`  ${allOk ? '✓ H45 sidebar toggle verified' : '✗ H45 checks failed'}`);
ws.close();
chrome.kill();
process.exit(allOk ? 0 : 1);
