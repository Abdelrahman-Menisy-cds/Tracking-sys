// Bidi render probe: compares the LOGICAL order of every rendered date/time/duration
// against the measured LEFT->RIGHT pixel order. Any real difference is a rendering bug.
//
//   node scripts/probe-bidi-render.mjs [baseUrl] [--all]
//
// Zero-width / bidi-control characters are excluded: they carry no visual order, so
// counting them would report false positives. Exits non-zero on any real mismatch.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://192.168.1.19:8080";
const SHOW_ALL = process.argv.includes("--all");
const PORT = 9663;

// Runs in the browser. Sent as source (not as a template literal) so the regex
// literals below reach the page exactly as written here.
function audit() {
  const ZW = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
  const IS_ZW = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
  const RE = /\d{1,2}[\/.:]\d{2}|[\u0621-\u064A]{2,}\s*\d{4}|\d{1,2}\s*[\u0621-\u064A]+\s*\d{4}|\d+\s*[سصمد]\b/;
  const main = document.querySelector("main") || document.querySelector("[role=main]");
  if (!main) return [];
  const out = [];
  const els = [...main.querySelectorAll("td, dd, dt, span, div, p, strong, li, time, bdi")]
    .filter((e) => e.children.length === 0 && RE.test((e.textContent || "").trim()));
  for (const el of els) {
    const logical = (el.textContent || "").replace(ZW, "").replace(/\s+/g, " ").trim();
    if (!logical || logical.length > 60) continue;
    const chars = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const s = n.data;
      for (let i = 0; i < s.length; i++) {
        if (IS_ZW.test(s[i])) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        if (b.width > 0 || b.height > 0) chars.push({ ch: s[i], x: Math.round(b.left * 10) / 10 });
      }
    }
    if (chars.length < 3) continue;
    const visual = [...chars].sort((a, b) => a.x - b.x).map((c) => c.ch).join("").replace(/\s+/g, " ").trim();
    out.push({ logical, visual, same: visual === logical });
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(r.logical) ? false : (seen.add(r.logical), true))).slice(0, 40);
}

const ROUTES = ["/", "/notifications", "/profile", "/attendance", "/timesheets", "/tasks", "/requests", "/reviews"];
const chrome = spawn("/usr/bin/google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${mkdtempSync(join(tmpdir(), "bidi-"))}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
let wsUrl;
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(wsUrl);
let seq = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
const send = (m, p = {}) => new Promise((res) => { const i = ++seq; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const js = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
let bad = 0, good = 0;
for (const route of ROUTES) {
  await send("Page.navigate", { url: `${BASE}${route}` });
  await sleep(2500);
  const rows = (await js(`(${audit.toString()})()`)) || [];
  const broken = rows.filter((r) => !r.same);
  if (broken.length) console.log(`\n===== ${route} =====`);
  for (const r of broken) {
    bad++;
    console.log(`  ✗ المنطقي: ${r.logical}`);
    console.log(`     المرسوم: ${r.visual}`);
  }
  good += rows.filter((r) => r.same).length;
  if (SHOW_ALL) for (const r of rows.filter((r) => r.same)) console.log(`  ✓ ${r.logical}`);
}
console.log(`\n=== الخلاصة: سليم ${good} ✓ · مقلوب ${bad} ✗ ===`);
chrome.kill();
process.exit(bad === 0 ? 0 : 1);
