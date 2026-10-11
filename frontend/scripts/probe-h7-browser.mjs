/** Rendered H7 smoke against a running demo preview and headless Chrome CDP. */
const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const target = targets.find((entry) => entry.type === "page" && entry.url.startsWith("http://localhost:4173"));
if (!target) throw new Error("Chrome preview tab not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const wait = pending.get(message.id);
  if (!wait) return;
  pending.delete(message.id);
  if (message.error) wait.reject(new Error(JSON.stringify(message.error)));
  else wait.resolve(message.result);
};
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const pause = (ms = 450) => new Promise((resolve) => setTimeout(resolve, ms));
async function navigate(route) {
  await evaluate(`history.pushState({}, "", ${JSON.stringify(route)}); window.dispatchEvent(new PopStateEvent("popstate"));`);
  await pause();
}
async function selectRole(role) {
  await evaluate(`document.querySelector('[aria-controls="demo-tools-panel"]')?.click()`);
  await pause(100);
  const selected = await evaluate(`(() => { const el = document.querySelector('#demo-tools-panel select'); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(role)}); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  if (!selected) throw new Error("Demo role switcher unavailable");
  await pause();
}
async function localeButton(locale) {
  const result = await evaluate(`(() => { const current = document.documentElement.lang; if (current === ${JSON.stringify(locale)}) return true; const button = [...document.querySelectorAll('.language-toggle-header')].find((item) => item.textContent.trim() === ${JSON.stringify(locale.toUpperCase())}); if (!button) return false; button.click(); return true; })()`);
  if (!result) throw new Error(`Locale switch to ${locale} unavailable`);
  await pause();
}
async function inspect(label) {
  await pause(350);
  const state = await evaluate(`(() => { const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), width: +r.width.toFixed(1) }; }; const first = (selector) => document.querySelector(selector); const toolbar = first('[data-testid="tasks-filter-toolbar"]'); const controls = first('.tasks-filter-controls'); return { path: location.pathname, lang: document.documentElement.lang, dir: document.documentElement.dir, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, heading: first('h1')?.textContent, page: box(first('.page')), header: box(first('.page-header')), surface: box(first('.work-surface, .filter-panel, .tasks-filter-panel, .table-wrap')), tabs: box(first('.tasks-tab-strip')), toolbar: box(toolbar), controls: box(controls), chips: box(first('.tasks-filter-chips')), count: box(first('.tasks-result-count')), table: box(first('.table-wrap')), controlWidths: controls ? [...controls.children].map((el) => +el.getBoundingClientRect().width.toFixed(1)) : [], employeeFilter: !!first('[data-testid="tasks-employee-filter"]'), timesheetEmployeeFilter: !!first('[data-testid="timesheet-employee-filter"]'), overflowElements: document.documentElement.scrollWidth > innerWidth + 1 ? [...document.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).slice(0, 8).map((el) => ({ tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', text: el.textContent?.slice(0, 45), box: box(el) })) : [] }; })()`);
  console.log(JSON.stringify({ label, ...state }));
  if (state.scrollWidth > state.viewport + 1) failures.push(`Horizontal overflow: ${label}`);
  if (!state.heading) throw new Error(`Missing heading: ${label}`);
  return state;
}

const failures = [];

await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: "http://localhost:4173/" });
await pause(1000);
await navigate("/");
await inspect("home employee ar desktop");
await navigate("/tasks/t-6001");
const started = await evaluate(`(() => { const button = document.querySelector('[data-testid="task-timer-start"]'); button?.click(); return !!button; })()`);
if (!started) throw new Error("Employee task timer start unavailable");
await pause(1200);
const stopped = await evaluate(`(() => { const button = document.querySelector('[data-testid="task-timer-stop"]'); button?.click(); return !!button; })()`);
if (!stopped) throw new Error("Employee task timer stop unavailable");
await navigate("/");
await navigate("/tasks");
await evaluate(`document.querySelector('#tasks-tab-timesheet')?.click()`);
await inspect("timesheet employee ar desktop");
await navigate("/");
await selectRole("hr");
await navigate("/tasks");
const taskAr = await inspect("tasks hr ar desktop");
if (!taskAr.employeeFilter) throw new Error("HR task employee filter missing");
await evaluate(`document.querySelector('#tasks-tab-timesheet')?.click()`);
const sheetAr = await inspect("timesheet hr ar desktop");
if (!sheetAr.timesheetEmployeeFilter) throw new Error("Timesheet employee filter missing");
await evaluate(`document.querySelector('#tasks-tab-mine')?.click()`);
await localeButton("en");
await inspect("tasks hr en desktop");
await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await inspect("tasks hr en mobile");
await localeButton("ar");
await inspect("tasks hr ar mobile");
const staticRoutes = ["/", "/requests", "/requests/new", "/timesheets", "/reviews", "/notifications", "/profile", "/attendance", "/attendance/history", "/attendance/corrections", "/admin", "/admin/settings", "/admin/people", "/admin/announcements"];
for (const width of [1280, 390]) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
  for (const locale of ["ar", "en"]) {
    await localeButton(locale);
    for (const route of staticRoutes) { await navigate(route); await inspect(`${route} hr ${locale} ${width}`); }
  }
}
socket.close();
if (failures.length) throw new Error(failures.join("\n"));
