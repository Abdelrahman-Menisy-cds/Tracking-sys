/**
 * H41 checks - the display functions that must never paint "[object Object]".
 *
 * Runs bundled (vite's own esbuild) because it exercises the .tsx markdown
 * renderer too: `npm run check:assistant` (see package.json).
 *
 * The fake translator maps ONLY the keys the functions above use, so an
 * unmapped key leaks as `?<key>` and would fail the assertions by visibility.
 */
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { formatServerValue, formatArgKey, describeConfirmResult } from "../src/features/assistant/displayValues";
import { renderAssistantMarkdown } from "../src/features/assistant/assistantMarkdown";

const LABELS: Record<string, string> = {
  assistantValueNone: "غير محدد",
  assistantValueYes: "نعم",
  assistantValueNo: "لا",
  assistantValueUnknown: "قيمة مش معروف شكلها",
  assistantArgRequestType: "نوع الطلب",
  assistantArgTitle: "العنوان",
  assistantDoneRequestCreated: "تم إنشاء الطلب.",
  assistantDoneRequestDecided: "تحديد حالة الطلب.",
  assistantDoneTimesheetSubmitted: "تم إرسال الجدول الزمني.",
  assistantDoneId: "الرقم",
  assistantDoneStatus: "الحالة",
  assistantDoneSubmitBlocked: "لم يكتمل الإرسال: %s",
  assistantActionDone: "تم تنفيذ الإجراء.",
  stDraft: "مسودة",
  stPendingManager: "بانتظار مراجعة المدير",
  stPendingHr: "بانتظار مراجعة الموارد البشرية",
  stApproved: "معتمد",
  stRejected: "مرفوض",
  stReturned: "معاد للتعديل",
  stSubmitted: "مُرسل",
  stCancelled: "ملغي",
};
const t = (key: keyof typeof LABELS | string) => LABELS[String(key)] ?? `?${String(key)}`;

const RAW_OBJECT = "[object Object]";

// ── formatServerValue: object, string, null, array, boolean ──
const asObject = formatServerValue({ ok: 2, title: "إجازة" }, t);
assert.ok(!asObject.includes(RAW_OBJECT), `object must not stringify raw: ${asObject}`);
assert.ok(asObject.includes("ok") && asObject.includes("إجازة"));
assert.equal(formatServerValue(null, t), "غير محدد");
assert.equal(formatServerValue(undefined, t), "غير محدد");
assert.equal(formatServerValue("", t), "غير محدد");
assert.equal(formatServerValue("نص عربي", t), "نص عربي");
assert.equal(formatServerValue(42, t), "42");
assert.equal(formatServerValue(true, t), "نعم");
assert.equal(formatServerValue(false, t), "لا");
assert.equal(formatServerValue(["إجازة", "بدل"], t), "إجازة · بدل");
assert.equal(formatArgKey("request_type_id", t), "نوع الطلب");
assert.equal(formatArgKey("future_key", t), "future_key");

// ── describeConfirmResult against the REAL contract shape ──
const created = describeConfirmResult("create_request", { ok: true, request_id: "abc-123", status: "PENDING_MANAGER" }, t);
assert.ok(created.includes("تم إنشاء الطلب."));
assert.ok(created.includes("abc-123"));
assert.ok(!created.includes(RAW_OBJECT));
assert.ok(created.includes("بانتظار مراجعة المدير"), `status label missing: ${created}`);
const blocked = describeConfirmResult("create_request", { ok: true, request_id: "r-1", status: "DRAFT", submit_result: "not submitted (version_conflict)" }, t);
assert.ok(blocked.includes("مسودة"));
assert.ok(blocked.includes("لم يكتمل الإرسال: not submitted (version_conflict)"));
const decided = describeConfirmResult("decide_request", { ok: true, request_id: "r-9", status: "APPROVED" }, t);
assert.ok(decided.includes("معتمد"));
// Unknown tool or shape falls back to the honest generic line.
assert.equal(describeConfirmResult("create_request", null, t), "تم تنفيذ الإجراء.");
assert.equal(describeConfirmResult("rocket_launch", { ok: true, request_id: "x" }, t), "تم تنفيذ الإجراء.");
assert.equal(describeConfirmResult("create_request", { ok: true }, t), "تم تنفيذ الإجراء.");
assert.ok(!describeConfirmResult(undefined, undefined, t).includes(RAW_OBJECT));

// ── the markdown renderer: tables, list fallback, and no regressions ──
const tableHtml = renderToStaticMarkup(
  <>{renderAssistantMarkdown("| النوع | الموافقة |\n|---|---|\n| إجازة اعتيادية | مطلوبة |")}</>,
);
assert.ok(tableHtml.includes("<table"), `table must render as <table>: ${tableHtml}`);
assert.ok(tableHtml.includes("النوع") && tableHtml.includes("مطلوبة"));
assert.ok(!tableHtml.includes("|"), `no raw pipes may survive: ${tableHtml}`);
const fallbackHtml = renderToStaticMarkup(
  <>{renderAssistantMarkdown("| إجازة | مطلوبة |\n| صندوق | ثاني |")}</>,
);
assert.ok(fallbackHtml.includes("<ul"), `no-divider pipe rows fall back to a list: ${fallbackHtml}`);
assert.ok(!fallbackHtml.includes("|"));
// Regression: bullets and paragraphs still work.
const bulletsHtml = renderToStaticMarkup(
  <>{renderAssistantMarkdown("سطر أول\n- عنصر\n- عنصر تاني")}</>,
);
assert.ok(bulletsHtml.includes("<li>عنصر</li>") && bulletsHtml.includes("سطر أول"));

// ── the FULL panel composition: reply + appended confirm receipt (the exact
// way AssistantPanel composes entry.content at confirm time) ──
const panelReply = "حاضر، جهزت لك خطة الطلب قبل التنفيذ:\n\n| البند | القيمة في السيستم |\n|---|---|\n| نوع الطلب | إجازة اعتيادية |\n| الإرسال | فوري بعد التأكيد |\n\nأكدي لي بـ«نعم» وأنا أنفذه على طول.";
const receipt = describeConfirmResult("create_request", { ok: true, request_id: "f0e1d2c3-4a5b", status: "PENDING_MANAGER" }, t);
const composedHtml = renderToStaticMarkup(
  <>{renderAssistantMarkdown(`${panelReply}\n${receipt}`)}</>,
);
assert.ok(
  /<strong[^>]*>تم إنشاء الطلب\.<\/strong>/.test(composedHtml),
  `receipt headline must render bold in the composed reply: ${composedHtml.slice(0, 400)}`,
);
assert.ok(/<code[^>]*>f0e1d2c3-4a5b<\/code>/.test(composedHtml));
assert.ok(!composedHtml.includes(RAW_OBJECT));

console.log("check-assistant-h41: all assertions passed");
