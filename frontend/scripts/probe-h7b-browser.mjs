/** Built-demo geometry smoke for the eight H7b pages and their detail routes. */
const pages = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const target = pages.find((page) => page.type === "page" && page.url.startsWith("http://localhost:4173"));
if (!target) throw new Error("Demo preview tab not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const pending = new Map();
let id = 0;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
};
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", { expression, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
const pause = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));
async function navigate(route) {
  await evaluate(`history.pushState({}, "", ${JSON.stringify(route)}); window.dispatchEvent(new PopStateEvent("popstate"));`);
  await pause();
}
async function setLocale(locale) {
  if (await evaluate("document.documentElement.lang") === locale) return;
  const changed = await evaluate(`(() => { const button = [...document.querySelectorAll('.language-toggle-header')].find((el) => el.textContent.trim() === ${JSON.stringify(locale.toUpperCase())}); button?.click(); return !!button; })()`);
  if (!changed) throw new Error(`Cannot select locale ${locale}`);
  await pause();
}
async function setRole(role) {
  await navigate("/");
  await evaluate(`if (!document.querySelector('#demo-tools-panel select')) document.querySelector('[aria-controls="demo-tools-panel"]')?.click()`);
  const changed = await evaluate(`(() => { const control = document.querySelector('#demo-tools-panel select'); if (!control) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(control, ${JSON.stringify(role)}); control.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  if (!changed) throw new Error("Demo role switcher unavailable");
  await pause();
}

const routes = [
  ["hr", "/timesheets"], ["hr", "/timesheets/t-3001"],
  ["hr", "/notifications"], ["hr", "/profile"],
  ["hr", "/requests/r-1001"], ["hr", "/reviews"],
  ["hr", "/reviews/requests/r-2001"], ["hr", "/reviews/timesheets/t-4001"],
  ["hr", "/admin"], ["hr", "/admin/people/e1"], ["hr", "/admin/announcements"],
];
const failures = [];
await cdp("Page.navigate", { url: "http://localhost:4173/" });
await pause(1000);
for (const width of [1280, 390]) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
  for (const locale of ["ar", "en"]) {
    await setLocale(locale);
    await setRole("hr");
    for (const [, route] of routes) {
      await navigate(route);
      const state = await evaluate(`(() => {
        const page = document.querySelector('.page');
        const header = page?.querySelector('.page-header');
        const surface = [...(page?.querySelectorAll(':scope > .work-surface, :scope > .table-wrap, :scope > .dashboard-grid, :scope > .review-queue') ?? [])].find((el) => getComputedStyle(el).display !== 'none');
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
        return { route: location.pathname, lang: document.documentElement.lang, dir: document.documentElement.dir,
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, heading: page?.querySelector('h1')?.textContent?.trim(),
          header: box(header), surface: box(surface), loading: !!page?.querySelector('.skeleton'),
          errors: [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent?.slice(0, 50)),
          overflow: [...document.querySelectorAll('.page *')].filter((el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && (r.right > 391 || r.left < -1) && r.width > 0; }).slice(0, 12).map((el) => ({ tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', text: el.textContent?.slice(0, 30), box: box(el) })) };
      })()`);
      console.log(JSON.stringify({ ...state, overflow: state.documentWidth > width + 1 ? state.overflow : undefined }));
      if (state.route !== route || !state.heading || state.lang !== locale) failures.push(`${route} ${locale} ${width}: route, heading or locale`);
      if (state.documentWidth > width + 1) failures.push(`${route} ${locale} ${width}: horizontal overflow ${state.documentWidth}`);
      if (state.header && state.surface && (Math.abs(state.header.left - state.surface.left) > 1 || Math.abs(state.header.right - state.surface.right) > 1)) failures.push(`${route} ${locale} ${width}: surface edge mismatch`);
    }
  }
}
socket.close();
if (failures.length) throw new Error(failures.join("\n"));
console.log("H7b browser geometry smoke passed");
