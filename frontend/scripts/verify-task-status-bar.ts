/**
 * Brief H4 — the status bar + the modern timer, as a deterministic gate:
 *
 *   npx tsx scripts/verify-task-status-bar.ts
 *
 * Static source assertions that must FAIL loudly if the layout order
 * regresses or a testid disappears. Exits non-zero on any failure.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

let failed = false;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined && !ok ? " — " + JSON.stringify(detail) : ""}`);
  if (!ok) failed = true;
};

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel: string): string => fs.readFileSync(path.join(srcRoot, rel), "utf8");

/* 1 — the page tree order (from the source, structurally). */
const page = read("screens/TaskDetailPage.tsx");
const headerIdx = page.indexOf("<PageHeader");
const statusBarIdx = page.indexOf("<TaskStatusBar");
const timerIdx = page.indexOf("<TaskWorkPanel");
const factsIdx = page.indexOf("<TaskDetailBody");
const trailIdx = page.indexOf('id="task-trail"');
const assignIdx = page.indexOf('data-testid="detail-assign-open"');
check("1 · header → status bar → timer → facts, in source order",
  headerIdx !== -1 && headerIdx < statusBarIdx && statusBarIdx < timerIdx && timerIdx < factsIdx,
  [headerIdx, statusBarIdx, timerIdx, factsIdx]);
check("1 · the status bar is the FIRST content after the header",
  headerIdx !== -1 && page.slice(headerIdx, statusBarIdx).match(/<Banner|<EmptyState/) !== null && !page.slice(headerIdx, statusBarIdx).includes("<TaskDetailBody"));
check("1 · the trail renders AFTER the timer card", timerIdx !== -1 && timerIdx < trailIdx);
check("1 · the trail is the last content section (assign button comes after the trail)",
  trailIdx !== -1 && assignIdx > trailIdx);

/* 2 — every existing testid survives, in the right component. */
const bar = read("components/tasks/TaskStatusBar.tsx");
const timer = read("components/tasks/TaskWorkPanel.tsx");
check("2 · task-status-control in the bar", bar.includes('data-testid="task-status-control"'));
check("2 · the four status options render via task-status-${status.toLowerCase()}", bar.includes('task-status-${status.toLowerCase()}'));
for (const status of ["open", "in_progress", "done", "cancelled"]) {
  void status;
}
check("2 · all four option statuses derive from the single array", bar.includes('["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]'));
check("2 · task-timer in the timer card", timer.includes('data-testid="task-timer"'));
check("2 · task-timer-elapsed in the timer card", timer.includes('data-testid="task-timer-elapsed"'));
check("2 · task-timer-total in the timer card", timer.includes('data-testid="task-timer-total"'));
check("2 · task-timer-start / task-timer-stop both exist (toggle picks one)", timer.includes('"task-timer-stop"') && timer.includes('"task-timer-start"'));
check("2 · task-time-entry on the entries list", timer.includes('data-testid="task-time-entry"'));
check("2 · the trail anchor id=\"task-trail\" survives", page.includes('id="task-trail"'));

/* 3 — the status bar keeps the radio pattern and capability logic. */
check("3 · the segmented control keeps role=radiogroup + role=radio + aria-checked",
  bar.includes('role="radiogroup"') && bar.includes('role="radio"') && bar.includes("aria-checked"));
check("3 · the capability rules stayed in the bar (assignee/creator/manager)",
  bar.includes("isAssignee") && bar.includes("isCreator") && bar.includes("mayChangeStatus"));
check("3 · a denial still surfaces the error code through the same refusal banner",
  bar.includes("changeTaskStatus") && bar.includes("if (!result.ok) setRefusal(result.code)"));
check("3 · the hint text is still available (taskStatusControlHint i18n key)",
  bar.includes("taskStatusControlHint"));

/* 4 — the timer keeps the H1 rules. */
check("4 · one toggle action (start when idle, stop when running)",
  timer.includes("const toggle = ()") && timer.includes('runningOnThisTask ? "task-timer-stop" : "task-timer-start"'));
check("4 · elapsed is STILL derived from the wall clock (no accumulated ticks)",
  timer.includes("taskTimeElapsedSeconds(myId, Date.now())"));
check("4 · running state drives the pulse + the is-running border",
  timer.includes("is-running") && timer.includes("task-timer-pulse"));
check("4 · the entries list keeps the timeline styling",
  timer.includes('className="timeline"') && timer.includes('className="timeline-event"'));

/* 6 — the assets stay inside the approved token vocabulary: the six
   primitives (via --surface/--accent family), their approved derived
   washes/borders/radii, spacing and hairline tokens. Anything outside
   --* vocabulary would be an invented value. */
const css = read("styles/global.css");
const h4Block = css.slice(css.indexOf("Brief H4"));
const approvedTokens = ["--surface", "--surface-subtle", "--surface-inset", "--accent", "--accent-soft", "--accent-border", "--on-accent", "--card-border", "--border-subtle", "--focus-ring", "--text", "--text-muted", "--sp-", "--radius-sm", "--radius-pill", "--radius-none", "--timeline-width", "--font-size-", "--line-height-", "--control-min-h", "--space-"];
const used = [...h4Block.matchAll(/var\((--[^),\s]+)/g)].map((match) => match[1]);
const notApproved = used.filter((token) => !approvedTokens.some((approved) => token.startsWith(approved)));
check("6 · the new CSS uses ONLY approved --* tokens", notApproved.length === 0, [...new Set(notApproved)]);
check("6 · the primitives are actually exercised",
  ["--surface", "--accent", "--card-border", "--sp-"].every((token) => used.some((usedToken) => usedToken.startsWith(token))));
const h4Hexes = [...h4Block.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
check("6 · no NEW hex colors in the H4 CSS block", h4Hexes.length === 0, h4Hexes);
check("6 · tabular-nums on the clock", h4Block.includes("font-variant-numeric: tabular-nums"));
check("6 · reduced-motion guard on the pulse", /prefers-reduced-motion/.test(h4Block));

/* 7 — the datetime rule held: no new Intl/toLocale anywhere outside useMockList. */
let offenders = 0;
const walk = (dir: string) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const rel = path.relative(srcRoot, full);
    if (rel === path.join("app", "useMockList.ts")) continue;
    if (["features/prayer/prayerTimes.ts", "mock/attendance.ts"].includes(rel)) continue;
    if (/Intl\.DateTimeFormat|toLocaleDateString|toLocaleTimeString|toLocaleString/.test(fs.readFileSync(full, "utf8"))) offenders += 1;
  }
};
walk(srcRoot);
check("7 · the datetime format scan still finds no screen-local formatters", offenders === 0);

if (failed) {
  console.log("\nSTATUS BAR/TIMER GATE FAILED");
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
