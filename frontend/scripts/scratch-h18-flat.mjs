import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h18-flat-'))}`,
  '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const stderrChunks = [];
chrome.stderr.on('data', (c) => stderrChunks.push(c));
let wsUrl = '';
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(200);
  const m = Buffer.concat(stderrChunks).toString().match(/DevTools listening on (ws:\/\/[^ ]+)/);
  if (m) wsUrl = m[1];
}
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let id = 0; const pending = new Map();
const waiters = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  const w = pending.get(m.id);
  if (w) { pending.delete(m.id); w(m); return; }
  for (const waiter of waiters.splice(0)) waiter(m);
});
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const i = ++id;
  const payload = { id: i, method, params };
  if (sessionId) payload.sessionId = sessionId;
  pending.set(i, res);
  ws.send(JSON.stringify(payload));
});

// attach to the page target with flatten
const targets = (await send('Target.getTargets')).result.targetInfos;
const page = targets.find((t) => t.type === 'page');
console.log('page:', page.targetId);
const attached = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
console.log('attach:', JSON.stringify(attached.result ?? attached.error));
const sessionId = attached.result?.sessionId;

// events we care about, surfaced
waiters.push((m) => {
  if (m.method === 'Target.attachedToTarget') console.log('EVENT attachedToTarget:', m.params.targetInfo.type, 'sid=', m.params.sessionId);
});

const ev1 = await send('Runtime.evaluate', { expression: '2+2', returnByValue: true }, sessionId);
console.log('evaluate via sessionId:', JSON.stringify(ev1));

// and with sessions won't this also be "unknown"? Check protocol version:
const ver = await send('Browser.getVersion');
console.log('version:', JSON.stringify(ver.result ?? ver.error));

chrome.kill();
process.exit(0);
