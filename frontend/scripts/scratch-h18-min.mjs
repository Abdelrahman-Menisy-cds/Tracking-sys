import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'h18-min-'))}`,
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
console.log('ws:', wsUrl);
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); const w = pending.get(m.id); if (w) { pending.delete(m.id); w(m); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const reply = await send('Target.getTargets');
console.log('targets:', JSON.stringify(reply.result?.targetInfos?.map(t => t.type)));
chrome.kill();
process.exit(0);
