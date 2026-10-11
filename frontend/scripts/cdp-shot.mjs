#!/usr/bin/env node
/**
 * Full-page screenshots of a served route, in BOTH themes, over CDP.
 *   node scripts/cdp-shot.mjs <url> <out-dir> [label] [width]
 * Light and dark come from `Emulation.setEmulatedMedia` (prefers-color-scheme), not from the app's
 * stored preference, so a throwaway profile always reproduces the system default.
 * Node 22+ global WebSocket, no npm packages.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
const outDir = process.argv[3] ?? '.';
const label = process.argv[4] ?? 'page';
const width = Number(process.argv[5] ?? 1280);
const PORT = 9351 + Math.floor(Math.random() * 120);

if (!url) {
  console.error('usage: node scripts/cdp-shot.mjs <url> <out-dir> [label] [width]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-shot-'))}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let wsUrl = '';
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) {
      wsUrl = page.webSocketDebuggerUrl;
      break;
    }
  } catch {}
  await sleep(200);
}
if (!wsUrl) {
  chrome.kill();
  console.error('FAIL  chrome never exposed a page target');
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
await new Promise((resolve) => {
  const done = () => (ws.readyState === WebSocket.OPEN ? resolve() : setTimeout(done, 50));
  done();
});

let messageId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    waiter(message);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++messageId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
  return reply.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });

let failures = 0;
for (const theme of ['light', 'dark']) {
  await send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-color-scheme', value: theme }],
  });
  await send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    // Poll for a real app element: after a navigation the execution context is destroyed and an
    // immediate evaluate silently returns undefined.
    ready = await evaluate('!!document.querySelector("main .work-surface, main form, .page-header")').catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  const applied = await evaluate('document.documentElement.dataset.theme || "(unset)"');
  const measured = await evaluate('document.documentElement.scrollHeight');
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = join(outDir, `${label}-${theme}.png`);
  if (shot.result?.data) {
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log(`  ok    ${theme.padEnd(5)}  theme=${String(applied).padEnd(9)}  height=${measured}px  ${file}`);
  } else {
    failures++;
    console.log(`  FAIL  ${theme}  no screenshot data`);
  }
}

ws.close();
chrome.kill();
process.exit(failures === 0 ? 0 : 1);
