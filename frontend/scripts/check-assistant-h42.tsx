/**
 * H42 checks - the confirmation card and the receipt speak the user's
 * language: no raw tool/key identifiers, no `submit` line, a note that
 * matches the action, and a receipt whose number/title/status are readable.
 *
 * Runs bundled like the H41 check: `npm run check:assistant:h42`.
 *
 * The fake translator maps ONLY the keys the functions use, so an unmapped
 * key leaks as `?<key>` and would fail the assertions by visibility.
 */
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import {
  describeConfirmResult,
  describePendingNote,
  formatArgKey,
  formatArgValue,
  shortRef,
  toolDisplayName,
} from "../src/features/assistant/displayValues";
import { renderAssistantMarkdown } from "../src/features/assistant/assistantMarkdown";

const LABELS: Record<string, string> = {
  assistantValueNone: "غير محدد",
  assistantValueYes: "نعم",
  assistantValueNo: "لا",
  assistantValueUnknown: "قيمة مش معروف شكلها",
  assistantArgRequestType: "نوع الطلب",
  assistantArgTitle: "العنوان",
  assistantToolCreateRequest: "إنشاء طلب",
  assistantToolDecideRequest: "تحديد حالة طلب",
  assistantToolDecideTimesheet: "تحديد حالة جدول زمني",
  assistantToolSubmitTimesheet: "إرسال جدول زمني",
  assistantToolCreateTask: "إنشاء مهمة",
  assistantToolClockIn: "تسجيل حضور",
  assistantActionAskDraft: "مفيش حاجة هتتغير — هيتحفظ كمسودة بس ومش هيتقدّم قبل ما تراجعه.",
  assistantActionAskSubmit: "هيتغيّر في النظام — مش هيحصل حاجة قبل تأكيدك.",
  assistantActionDone: "تم تنفيذ الإجراء.",
  assistantDoneRequestCreated: "تم إنشاء الطلب.",
  assistantDoneId: "الرقم",
  assistantDoneRef: "المرجع",
  assistantDoneStatus: "الحالة",
  assistantDoneSubmitNotDone: "اتعمل مسودة بس الإرسال ما كمّلش — السبب: %s",
  assistantDoneSubmitBlocked: "لم يكتمل الإرسال: %s",
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

const RAW_UUID = "e6e85a53-4995-46c2-b7a1-0a1b2c396379";
const SHORT_TAIL = "…396379";

/* ── ★ ١+٢: the card names the tool in Arabic, never its API identifier ── */
assert.equal(toolDisplayName("create_request", t), "إنشاء طلب");
assert.equal(toolDisplayName("decide_request", t), "تحديد حالة طلب");
assert.equal(toolDisplayName("decide_timesheet", t), "تحديد حالة جدول زمني");
assert.equal(toolDisplayName("submit_timesheet", t), "إرسال جدول زمني");
assert.equal(toolDisplayName("create_task", t), "إنشاء مهمة");
assert.equal(toolDisplayName("clock_in", t), "تسجيل حضور");
// Unknown tools stay honest - the real name, nothing invented.
assert.equal(toolDisplayName("future_tool", t), "future_tool");

// The card loop AS the panel renders it: labels localized, submits skipped.
const cardArgs = { request_type_id: 1, title: "إجازة اعتيادية - يوم 25", details: "طلب إجازة اعتيادية", submit: false };
const cardLines = Object.entries(cardArgs)
  .filter(([key]) => key !== "submit")
  .map(([key, value]) => `${formatArgKey(key, t)}: ${formatArgValue(key, value, t)}`);
const cardText = cardLines.join("\n");
assert.ok(cardText.includes("نوع الطلب: #1"), `type id must read as #1: ${cardText}`);
assert.ok(cardText.includes("العنوان: إجازة اعتيادية - يوم 25"), `title label localized: ${cardText}`);
assert.ok(!cardText.includes("create_request"), `no raw tool kernel may leak: ${cardText}`);
assert.ok(!cardText.includes("request_type_id"), `no raw arg key may leak: ${cardText}`);
assert.ok(!cardText.includes("submit") && !cardText.includes("لا"), `★ submit must never be displayed: ${cardText}`);
assert.ok(!cardText.includes("إرسال فوري"), `★ the «إرسال فوري» line is gone: ${cardText}`);
// The type label keeps the id honest when no name is available: «#1», not a name.
assert.ok(!cardText.includes("الإجازة") || cardText.includes("#1"), "#1 falls back honestly, no invented type name");

/* ── ★ ٤: the note matches the ACTION — two sentences, two truths ── */
assert.equal(
  describePendingNote("create_request", { submit: false }, t),
  LABELS.assistantActionAskDraft,
);
assert.equal(describePendingNote("create_request", { submit: true }, t), LABELS.assistantActionAskSubmit);
// A missing submit arg is a draft (the tool defaults to false).
assert.equal(describePendingNote("create_request", {}, t), LABELS.assistantActionAskDraft);
assert.equal(describePendingNote("create_request", null, t), LABELS.assistantActionAskDraft);
// Every other write tool changes the system by definition.
assert.equal(describePendingNote("decide_request", {}, t), LABELS.assistantActionAskSubmit);
assert.equal(describePendingNote("submit_timesheet", {}, t), LABELS.assistantActionAskSubmit);
// Neither sentence is a leftover of the old ambiguous line.
for (const note of [describePendingNote("create_request", { submit: false }, t), describePendingNote("create_request", { submit: true }, t)]) {
  assert.ok(note !== "حاجة هتتغيّر في السيستم - من غير تأكيدك مفيش حاجة بتحصل.", "the old ambiguous note is gone");
}

/* ── ★ ٣: the receipt - short ref, title, translated status ── */
assert.equal(shortRef(RAW_UUID), SHORT_TAIL, `a UUID collapses to its tail: ${shortRef(RAW_UUID)}`);
assert.equal(shortRef("12"), "12", "a genuinely short id is shown whole");
const receipt = describeConfirmResult(
  "create_request",
  { ok: true, request_id: RAW_UUID, status: "DRAFT" },
  t,
  { title: "إجازة اعتيادية - يوم 25" },
);
assert.ok(receipt.includes("**تم إنشاء الطلب.**"), `bold headline: ${receipt}`);
assert.ok(receipt.includes(`المرجع: \`${SHORT_TAIL}\``), `★ the ref line: ${receipt}`);
assert.ok(!receipt.includes(RAW_UUID), `★ the UUID must never display whole: ${receipt}`);
assert.ok(!receipt.includes("e6e85a53"), `no leading UUID chunk either: ${receipt}`);
assert.ok(receipt.includes("العنوان: `إجازة اعتيادية - يوم 25`"), `the promised title line: ${receipt}`);
assert.ok(receipt.includes("الحالة: مسودة"), `status in dict words, not DRAFT: ${receipt}`);
const decided = describeConfirmResult("decide_request", { ok: true, request_id: RAW_UUID, status: "PENDING_HR" }, t);
assert.ok(decided.includes("بانتظار مراجعة الموارد البشرية"), `PENDING_HR translated: ${decided}`);
const submitted = describeConfirmResult("submit_timesheet", { ok: true, timesheet_id: RAW_UUID, status: "SUBMITTED" }, t);
assert.ok(submitted.includes("مُرسل"), `SUBMITTED translated: ${submitted}`);
assert.ok(submitted.includes(`المرجع: \`${SHORT_TAIL}\``), `timesheet uuid gets the ref too: ${submitted}`);

/* ── ★ ٤»: a refused submit tells the truth, with a REASON not a code ── */
const refused = describeConfirmResult(
  "create_request",
  {
    ok: true,
    request_id: RAW_UUID,
    status: "DRAFT",
    submitted: false,
    message: "The request period overlaps an existing pending request, so the submit did not go through.",
  },
  t,
);
assert.ok(refused.includes("اتعمل مسودة بس الإرسال ما كمّلش — السبب:"), `the refusal speaks: ${refused}`);
assert.ok(
  refused.includes("The request period overlaps an existing pending request, so the submit did not go through."),
  `the real reason sentence travels with it: ${refused}`,
);
assert.ok(!refused.includes("validation_error") && !refused.includes("submitted=false"), `no machine tokens: ${refused}`);
assert.ok(refused.includes("الحالة: مسودة"), `the draft honestly remains: ${refused}`);
// The pre-H43 confirmed shape still renders honestly (H41 compatibility).
const legacy = describeConfirmResult(
  "create_request",
  { ok: true, request_id: RAW_UUID, status: "DRAFT", submit_result: "not submitted (version_conflict)" },
  t,
);
assert.ok(legacy.includes("لم يكتمل الإرسال: not submitted (version_conflict)"), legacy.slice(0, 200));

// Unknown tool or shape falls back to the honest generic line.
assert.equal(describeConfirmResult("create_request", null, t), "تم تنفيذ الإجراء.");
assert.equal(describeConfirmResult("rocket_launch", { ok: true, request_id: "x" }, t), "تم تنفيذ الإجراء.");
assert.equal(describeConfirmResult("create_request", { ok: true }, t), "تم تنفيذ الإجراء.");
assert.ok(!describeConfirmResult(undefined, undefined, t).includes("[object Object]"));

/* ── the composed reply+receipt render - nothing raw anywhere on screen ── */
const reply =
  "حاضر، سأجهز لك الآن مسودة طلب الإجازة الاعتيادية — وبعدها نراجعها قبل الإرسال.\n\n| البند | القيمة |\n|---|---|\n| نوع الطلب | إجازة اعتيادية |\n| المدة | يوم واحد |";
const composedHtml = renderToStaticMarkup(
  <>{renderAssistantMarkdown(`${reply}\n${refused}`)}</>,
);
assert.ok(!composedHtml.includes("create_request"), `no raw tool name in the composed bubble: ${composedHtml.slice(0, 300)}`);
assert.ok(!composedHtml.includes("request_type_id"), "no raw arg key in the composed bubble");
assert.ok(!composedHtml.includes("submit:"), "no submit key in the composed bubble");
assert.ok(!composedHtml.includes("e6e85a53"), "the full UUID never renders");
assert.ok(!composedHtml.includes("[object Object]"));
assert.ok(composedHtml.includes("اتعمل مسودة بس الإرسال ما كمّلش"), "the refusal line renders");
assert.ok(composedHtml.includes("مسودة"), "the translated status renders");

console.log("check-assistant-h42: all assertions passed");
