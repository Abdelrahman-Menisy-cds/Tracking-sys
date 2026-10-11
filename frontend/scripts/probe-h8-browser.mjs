/** Real Chrome CDP smoke for date/time presentation in both locales. */
const pages = await (await fetch("http://127.0.0.1:9224/json/list")).json();
const page = pages.find((item) => item.type === "page" && item.url.startsWith("http://localhost:5199"));
if (!page) throw new Error("H8 Chrome tab unavailable");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  if (message.error) task.reject(new Error(JSON.stringify(message.error)));
  else task.resolve(message.result);
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const next = ++id;
  pending.set(next, { resolve, reject });
  socket.send(JSON.stringify({ id: next, method, params }));
});
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 650));
async function navigate(route) {
  await evaluate(`history.pushState({}, "", ${JSON.stringify(route)}); dispatchEvent(new PopStateEvent("popstate"))`);
  await pause();
}
await cdp("Page.navigate", { url: "http://localhost:5199/" });
await pause();
await evaluate(`document.querySelector('[aria-controls="demo-tools-panel"]')?.click()`);
await evaluate(`(() => { const el = document.querySelector('#demo-tools-panel select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, 'hr'); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await pause();
for (const locale of ["ar", "en"]) {
  await evaluate(`(() => { if (document.documentElement.lang === ${JSON.stringify(locale)}) return; [...document.querySelectorAll('.language-toggle-header')].find(el => el.textContent.trim() === ${JSON.stringify(locale.toUpperCase())})?.click(); })()`);
  await pause();
  for (const route of ["/admin/settings", "/attendance", "/tasks", "/tasks/t-6001", "/notifications", "/requests", "/timesheets", "/reviews", "/profile", "/admin", "/admin/announcements", "/admin/people/e1"]) {
    await navigate(route);
    if (route === "/tasks") {
      await evaluate(`document.querySelector('#tasks-tab-created')?.click()`);
      await pause();
    }
    const result = await evaluate(String.raw`(() => {
      const main = document.querySelector('main, .page');
      const text = main?.innerText ?? '';
      const holiday = [...document.querySelectorAll('.compact-row strong')].find(el => el.textContent.includes('2026') && el.textContent.includes('25'));
      const chars = [];
      if (holiday?.firstChild?.nodeType === Node.TEXT_NODE) {
        const node = holiday.firstChild;
        for (let i = 0; i < node.length; i++) {
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
          const rect = range.getBoundingClientRect();
          chars.push({ char: node.textContent[i], x: Math.round(rect.x) });
        }
      }
      return { path: location.pathname, locale: document.documentElement.lang,
        heading: main?.querySelector('h1')?.textContent ?? null,
        holiday: holiday?.textContent ?? null, holidayChars: chars,
        schedule: document.querySelector('#settings-schedule .decision-facts')?.innerText ?? null,
        visibleIso: text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [],
        displayDates: text.match(/\d{2}\/\d{2}\/\d{4}(?: · \d{2}:\d{2} (?:ص|م|AM|PM))?/g) ?? [],
        sample: text.slice(0, 900) };
    })()`);
    if (!result.heading || result.visibleIso.length) throw new Error(`Date/UI regression on ${route} ${locale}: ${JSON.stringify(result)}`);
    if (["/tasks", "/tasks/t-6001", "/notifications", "/requests", "/timesheets", "/reviews", "/admin/announcements"].includes(route)
      && !result.displayDates.length) throw new Error(`Missing rendered date on ${route} ${locale}`);
    if (route === "/admin/settings") {
      const day = result.holidayChars.find((item) => item.char === "2");
      const month = result.holidayChars.find((item) => item.char === (locale === "ar" ? "ر" : "D"));
      const year = result.holidayChars.findLast((item) => item.char === "2");
      if (!day || !month || !year || !(day.x < month.x && month.x < year.x)
        || !result.schedule.includes("01/01/2024") || !result.schedule.includes(locale === "ar" ? "05:00 م" : "05:00 PM")) {
        throw new Error(`Holiday visual order or schedule shape: ${JSON.stringify(result)}`);
      }
    }
    console.log(JSON.stringify(result));
  }
}
socket.close();
