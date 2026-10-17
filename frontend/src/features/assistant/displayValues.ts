/**
 * H41 - every value that comes back from the server is INSPECTED before the
 * assistant panel shows it. Never `String()` blindly, never a raw object,
 * never an unformatted JSON dump.
 *
 * The shape is confirmed against the backend's own code (accounts/
 * assistant_chat.py `confirm_action` and accounts/assistant_tools.py):
 *
 *   POST /assistant/actions/<token>/confirm ->
 *     {"tool": "create_request" | ..., "result": <executor's object>}
 *   where result is an OBJECT, e.g.
 *     {"ok": true, "request_id": "<uuid>", "status": "DRAFT",
 *      "submit_result": "not submitted (...)",   // optional
 *     }
 *   or {"ok": true, "timesheet_id": "<uuid>", "status": "SUBMITTED"}.
 *
 *   and the pending action sent with a chat reply is
 *     {"token": <signed str>, "name": <tool>, "args": <validated scalars>}
 *
 * The old panel did `result.result || t("assistantActionDone")` inside a
 * template string - a truthful object became "[object Object]" on screen.
 */

import type { Dict } from "../../i18n/dict";

export type Translator = (key: keyof Dict) => string;

/** The request/timesheet status vocabulary already lives in dict. */
const STATUS_KEYS: Record<string, keyof Dict> = {
  DRAFT: "stDraft",
  PENDING_MANAGER: "stPendingManager",
  PENDING_HR: "stPendingHr",
  APPROVED: "stApproved",
  REJECTED: "stRejected",
  RETURNED: "stReturned",
  SUBMITTED: "stSubmitted",
  CANCELLED: "stCancelled",
};

const DONE_HEADLINES: Record<string, keyof Dict> = {
  create_request: "assistantDoneRequestCreated",
  decide_request: "assistantDoneRequestDecided",
  decide_timesheet: "assistantDoneTimesheetDecided",
  submit_timesheet: "assistantDoneTimesheetSubmitted",
};

/** Pending-action argument keys the cards actually show, localized. */
const ARG_KEYS: Record<string, keyof Dict> = {
  request_type_id: "assistantArgRequestType",
  request_id: "assistantArgRequestId",
  timesheet_id: "assistantArgTimesheetId",
  title: "assistantArgTitle",
  details: "assistantArgDetails",
  submit: "assistantArgSubmit",
  action: "assistantArgAction",
  comment: "assistantArgComment",
  version: "assistantArgVersion",
};

/**
 * Any server value, formatted for display. Objects render as readable
 * `key: value` runs, arrays as a joined run - and a shape the frontend
 * genuinely does not recognize falls back to the honest unknown-value line,
 * never "[object Object]". U+00B7 (·) is a neutral separator safe in both
 * directions.
 */
export function formatServerValue(value: unknown, t: Translator): string {
  const none = t("assistantValueNone");
  if (value === null || value === undefined) return none;
  if (typeof value === "string") return value.trim() === "" ? none : value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? t("assistantValueYes") : t("assistantValueNo");
  if (Array.isArray(value)) {
    return value.map((item) => formatServerValue(item, t)).join(" · ");
  }
  if (typeof value === "object") {
    const pairs = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${key}: ${formatServerValue(item, t)}`,
    );
    if (pairs.length > 0) return pairs.join(" · ");
  }
  return t("assistantValueUnknown");
}

/** A pending card's argument key, localized when it is one we know. */
export function formatArgKey(key: string, t: Translator): string {
  const labelKey = ARG_KEYS[key];
  return labelKey ? t(labelKey) : key;
}

/**
 * The confirm result as user-visible markdown: the promised formal
 * confirmation card, as text the existing renderer turns into a bold
 * headline and definition lines -
 *
 *   **تم إنشاء الطلب.**
 *   - الرقم: `<uuid>`
 *   - الحالة: بانتظار مراجعة المدير
 *   [- لم يكتمل الإرسال: <reason>]
 *
 * Anything that does not match the real contract above falls back to the
 * honest generic done line from dict - never a raw object, never a JSON dump.
 */
export function describeConfirmResult(tool: unknown, result: unknown, t: Translator): string {
  const headline = typeof tool === "string" ? DONE_HEADLINES[tool] : undefined;
  if (
    !headline ||
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result)
  ) {
    return t("assistantActionDone");
  }
  const row = result as Record<string, unknown>;
  const idKey =
    "request_id" in row && typeof row.request_id === "string" ? "request_id"
    : "timesheet_id" in row && typeof row.timesheet_id === "string" ? "timesheet_id"
    : null;
  if (!idKey && typeof row.status !== "string") return t("assistantActionDone");

  const lines = [`**${t(headline)}**`];
  if (idKey) lines.push(`- ${t("assistantDoneId")}: \`${row[idKey]}\``);
  if (typeof row.status === "string" && row.status.trim() !== "") {
    lines.push(`- ${t("assistantDoneStatus")}: ${STATUS_KEYS[row.status] ? t(STATUS_KEYS[row.status]) : row.status}`);
  }
  if (typeof row.submit_result === "string" && row.submit_result.trim() !== "") {
    lines.push(`- ${t("assistantDoneSubmitBlocked").replace("%s", row.submit_result)}`);
  }
  return lines.join("\n");
}
