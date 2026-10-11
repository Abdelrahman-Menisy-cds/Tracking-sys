// Bidi render probe: compares the LOGICAL order of every rendered date/time/duration
// against the measured LEFT->RIGHT pixel order. Any real difference is a rendering bug.
//
//   node scripts/probe-bidi-render.mjs [baseUrl] [--all]
//
// Zero-width / bidi-control characters are excluded: they carry no visual order, so
// counting them would report false positives. The decision dialog is a portal rendered
// outside <main>, so it is opened and audited separately. Exits non-zero on any mismatch.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://192.168.1.19:8080";
const SHOW_ALL = process.argv.includes("--all");
const PORT = 9663;

// Runs in the browser. Sent as source (not as a template literal) so the regex
// literals below reach the page exactly as written here.
function audit(rootSelector) {
  const ZW = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
  const IS_ZW = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
  const RE = /\d{1,2}[\/.:]\d{2}|[\u0621-\u064A]{2,}\s*\d{4}|\d{1,2}\s*[\u0621-\u064A]+\s*\d{4}|^\d+\s+ساعة\s+و\d+\s+دقيقة$|^\d+\s+h\s+\d+\s+min$/;
  const main = document.querySelector(rootSelector) || document.querySelector("main") || document.querySelector("[role=main]");
  if (!main) return [];
  const out = [];
  const els = [...main.querySelectorAll("td, dd, dt, span, div, p, strong, li, time, bdi, h3")]
    .filter((e) => e.children.length === 0 && RE.test((e.textContent || "").trim()));
  for (const el of els) {
    const logical = (el.textContent || "").replace(ZW, "").replace(/\s+/g, " ").trim();
    if (!logical || logical.length > 90) continue;
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
    const duration = /^(\d+) ساعة و(\d+) دقيقة$/.exec(logical);
    // What must never change: the order of the digit runs, and which day-period marker follows
    // which number. Arabic word order is free to read right-to-left (that is correct rendering,
    // not a bug) — but a marker that detaches from its number, or lands *inside* a clock
    // (10:ص24), is the exact class of defect this probe exists to catch.
    const digitRuns = (s) => (s.match(/\d+/g) || []).join("|");
    const markerAfterDigit = (s) => (s.match(/\d\s*[\u0621-\u064A]/g) || []).map((piece) => piece.slice(-1)).join("");
    const gluedMarker = /\d[\u0621-\u064A]/.test(visual);
    const same = duration
      ? visual === `ةقيقد ${duration[2]}و ةعاس ${duration[1]}`
      : digitRuns(logical) === digitRuns(visual) && markerAfterDigit(logical) === markerAfterDigit(visual) && !gluedMarker;
    out.push({ logical, visual, same });
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

const report = (label, rows) => {
  const broken = rows.filter((r) => !r.same);
  if (label) console.log(`\n===== ${label} =====`);
  for (const r of broken) {
    console.log(`  ✗ المنطقي: ${r.logical}`);
    console.log(`     المرسوم: ${r.visual}`);
  }
  if (SHOW_ALL) for (const r of rows.filter((r) => r.same)) console.log(`  ✓ ${r.logical}`);
  return { good: rows.length - broken.length, bad: broken.length };
};

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
let bad = 0, good = 0;
for (const route of ROUTES) {
  await send("Page.navigate", { url: `${BASE}${route}` });
  await sleep(2500);
  const rows = (await js(`(${audit.toString()})("main")`)) || [];
  const { good: g, bad: b } = report(rows.some((r) => !r.same) ? route : "", rows);
  good += g; bad += b;
}

// The review suggestion lives inside the decision dialog — a portal, so the <main> walker
// above cannot see it. The queue only renders for a reviewer, and the demo derives the role
// from the signed-in account, so the dialog can only be audited after a real sign-in: supply
// the demo account's credentials through the environment. Without them the dialog is *not*
// covered, and the probe says so and fails rather than reporting a green run it did not earn.
const MANAGER_EMAIL = process.env.DEMO_MANAGER_EMAIL || "manager@demo.local";
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD || "";
await send("Page.navigate", { url: `${BASE}/login` });
await sleep(2000);
const signIn = await js(`(() => {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const email = document.querySelector('input[type=email], input[name=identifier], input[type=text]');
  if (!email) return "no-field";
  setValue.call(email, ${JSON.stringify(MANAGER_EMAIL)});
  email.dispatchEvent(new Event("input", { bubbles: true }));
  const password = document.querySelector('input[type=password]');
  if (password && ${JSON.stringify(MANAGER_PASSWORD)}) {
    setValue.call(password, ${JSON.stringify(MANAGER_PASSWORD)});
    password.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const form = email.closest("form");
  const submit = form?.querySelector('button[type=submit]') ?? [...(form?.querySelectorAll("button") ?? [])].pop();
  if (submit) { submit.click(); return "clicked"; }
  if (form?.requestSubmit) { form.requestSubmit(); return "submitted"; }
  return "no-form";
})()`);
await sleep(2800);
await send("Page.navigate", { url: `${BASE}/reviews` });
await sleep(2600);
const opened = await js(`(() => {
  const button = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === "القرار");
  if (!button) return false;
  button.click();
  return true;
})()`);
await sleep(1400);
const hasDialog = await js(`Boolean(document.querySelector("[role=dialog]"))`);
const dialogRows = opened ? (await js(`(${audit.toString()})("[role=dialog]")`)) || [] : [];
const dialogReport = report(`/reviews → القرار (signIn=${signIn} · opened=${opened} · dialog=${hasDialog})`, dialogRows);
good += dialogReport.good; bad += dialogReport.bad;
if (!opened || !hasDialog) {
  console.log("  ⚠ النافذة لم تُفتح ⇒ محتوى الاقتراح لم يُفحص.");
  console.log("    شغّل الأداة ومَعك بيانات حساب المدير: DEMO_MANAGER_PASSWORD=… node scripts/probe-bidi-render.mjs");
  bad += 1;
}

console.log(`\n=== الخلاصة: سليم ${good} ✓ · مقلوب ${bad} ✗ ===`);
if (bad) console.log("    (الفشل يشمل أي جزء لم يُفحص — مش بس العناصر المقلوبة)");
chrome.kill();
process.exit(bad === 0 ? 0 : 1);
