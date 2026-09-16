import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const profile = mkdtempSync(`${tmpdir()}/tracking-contrast-`);

async function main() {

const port = 9228;
const url = "http://localhost:4173/";
const chrome = spawn("google-chrome", [
  "--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "inherit"] });

async function getTarget() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
      if (response.ok) return response.json();
    } catch { /* Chrome is still starting. */ }
    await delay(100);
  }
  throw new Error(`Chrome CDP did not start on port ${port}`);
}

const target = await getTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  }
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, returnByValue = true) => (await cdp("Runtime.evaluate", { expression, returnByValue, awaitPromise: true })).result.value;
await cdp("Page.enable");
await cdp("DOM.enable");
await cdp("CSS.enable");
await delay(500);

await evaluate(`(() => {
  const fixture = document.createElement('div');
  fixture.id = 'contrast-fixture';
  fixture.style.cssText = 'position:fixed;inset:0 auto auto 0;z-index:99999;display:flex;gap:8px;padding:8px;background:var(--surface);';
  const style = document.createElement('style'); style.textContent = '#contrast-fixture, #contrast-fixture * { transition: none !important; animation: none !important; }'; document.head.append(style);
  fixture.innerHTML = ['primary','secondary','ghost','danger'].map(v => '<a class="btn btn-'+v+'" href="#">'+v+'</a>').join('');
  document.body.append(fixture);
})()`);
const root = (await cdp("DOM.getDocument")).root.nodeId;
const rows = [];
let failed = false;
const contrastFor = `((selector) => {
  const parse = (value) => { const match = value.match(/rgba?\\(([^)]+)\\)/); if (!match) return null; const parts = match[1].split(',').map(x => Number.parseFloat(x.trim())); return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }; };
  const luminance = ({ r, g, b }) => [r, g, b].map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const ratio = (fg, bg) => { const a = luminance(fg); const b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  const element = document.querySelector(selector); const style = getComputedStyle(element); let bg = parse(style.backgroundColor); let parent = element.parentElement;
  while (bg && bg.a === 0 && parent) { bg = parse(getComputedStyle(parent).backgroundColor); parent = parent.parentElement; }
  return { color: style.color, background: bg ? 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')' : 'transparent', ratio: bg ? ratio(parse(style.color), bg) : 0 };
})`;
for (const theme of ["light", "dark"]) {
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
  await delay(500);
  for (const variant of ["primary", "secondary", "ghost", "danger"]) {
    const selector = `#contrast-fixture .btn-${variant}`;
    const node = await cdp("DOM.querySelector", { nodeId: root, selector });
    for (const state of ["resting", "hover", "active"]) {
      await cdp("CSS.forcePseudoState", { nodeId: node.nodeId, forcedPseudoClasses: state === "resting" ? [] : [state] });
      const value = await evaluate(`${contrastFor}(${JSON.stringify(selector)})`);
      const ratio = Number(value.ratio.toFixed(2));
      rows.push({ theme, variant, state, ratio, color: value.color, background: value.background });
      if (value.ratio < 4.5) { failed = true; console.error(`FAIL ${theme} ${variant} ${state}: ${value.ratio} (${value.color} on ${value.background})`); }
    }
  }
}
console.log(rows.map(row => `${row.theme}\t${row.variant}\t${row.state}\t${row.ratio}:1\t${row.color} on ${row.background}`).join("\n"));
if (failed) { socket.close(); chrome.kill(); process.exit(1); }
console.log(`PASS: ${rows.length} button states meet >= 4.5:1`);
socket.close();
chrome.kill();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
