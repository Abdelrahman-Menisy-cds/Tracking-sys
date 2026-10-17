/**
 * H41 - every value that comes back from the server is INSPECTED before the
 * assistant panel shows it. Never `String()` blindly, never a raw object,
 * never an unformatted JSON dump.
 *
 * H42 - the card and the receipt speak the USER'S language, not the tool's:
 *   • the pending card's title is the tool's ARABIC name («إنشاء طلب»), and
 *     no raw key (`create_request`, `request_type_id`, `submit`) is ever
 *     painted as a label — `submit` is an implementation detail the user
 *     did not decide, so it is not displayed at ALL;
 *   • values are readable: the request type renders as «#1» under a
 *     «نوع الطلب» label (never an invented type name — no typed vocabulary
 *     exists client-side), id arguments render as a short «…xxxxxx» ref;
 *   • the note under the card MATCHES the actual action: a draft promise
 *     says nothing changes, an immediate submit says the system changes —
 *     never a single ambiguous sentence for both;
 *   • the confirm receipt shows the promised title + a SHORT human-readable
 *     reference (a UUID is shortened to its last 6 chars under «مرجع» —
 *     never an invented number) + the status in dict words, and when the
 *     submit step did not complete it tells the truth with the REASON
 *     sentence, never a machine token like `validation_error`.
 *
 * The shape is confirmed against the backend's own code (accounts/
 * assistant_chat.py `confirm_action` and accounts/assistant_tools.py):
 *
 *   POST /assistant/actions/<token>/confirm ->
 *     {"tool": "create_request" | ..., "result": <executor's object>}
 *   where result is an OBJECT, e.g.
 *     {"ok": true, "request_id": "<uuid>", "status": "DRAFT"}
 *     {"ok": true, "request_id": "<uuid>", "status": "PENDING_MANAGER",
 *      "submitted": false, "message": "<real sentence>"}   // submit refused
 *     {"ok": true, "timesheet_id": "<uuid>", "status": "SUBMITTED"}.
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

/** H42 - every pending-card tool gets a NAME, not its API identifier. */
const TOOL_NAME_KEYS: Record<string, keyof Dict> = {
  create_request: "assistantToolCreateRequest",
  decide_request: "assistantToolDecideRequest",
  decide_timesheet: "assistantToolDecideTimesheet",
  submit_timesheet: "assistantToolSubmitTimesheet",
  create_task: "assistantToolCreateTask",
  clock_in: "assistantToolClockIn",
};

/** Pending-action argument keys the cards actually show, localized.
 * `submit` is deliberately ABSENT: the card never displays it (H42). */
const ARG_KEYS: Record<string, keyof Dict> = {
  request_type_id: "assistantArgRequestType",
  request_id: "assistantArgRequestId",
  timesheet_id: "assistantArgTimesheetId",
  title: "assistantArgTitle",
  details: "assistantArgDetails",
  action: "assistantArgAction",
  comment: "assistantArgComment",
  version: "assistantArgVersion",
};

/** A UUID-length hex id is machine-notation: the honest display keeps only
 * the tail, so `e6e85a53-4995-46c2-…` reads as «…396379» under a «مرجع»
 * label. Never fabricated — it is always the id's own last characters. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The short readable form of an id: untouched when short, tail when a UUID. */
export function shortRef(id: string): string {
  return UUID_RE.test(id) ? `…${id.slice(-6)}` : id;
}

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

/** H42 - a pending card's argument VALUE, made readable by its own key:
 * the invite says «نوع الطلب: #1», not `request_type_id: 1`, and uuid id
 * arguments collapse to the short ref. An unknown key/value keeps the
 * honest formatter. */
export function formatArgValue(key: string, value: unknown, t: Translator): string {
  if (key === "request_type_id" && typeof value === "number" && Number.isFinite(value)) {
    return `#${value}`;
  }
  if ((key === "request_id" || key === "timesheet_id") && typeof value === "string") {
    return shortRef(value);
  }
  return formatServerValue(value, t);
}

/** H42 - the card's tool line: «إنشاء طلب», never `create_request`. An
 * unrecognized tool shows its real name untouched - honest, not invented. */
export function toolDisplayName(name: unknown, t: Translator): string {
  if (typeof name !== "string") return formatServerValue(name, t);
  const labelKey = TOOL_NAME_KEYS[name];
  return labelKey ? t(labelKey) : name;
}

/**
 * H42 - the note under the confirmation card MUST match the action it
 * describes. A `create_request` carrying `submit: false` (the draft the
 * assistant promises to review before sending) says "nothing changes"; the
 * immediate-submit call and every other write tool say "the system
 * changes". One truthful sentence per case, both from dict - never the
 * old single ambiguous line.
 */
export function describePendingNote(name: unknown, args: unknown, t: Translator): string {
  const isCreateRequest = name === "create_request";
  const submitValue =
    isCreateRequest && args !== null && typeof args === "object"
      ? (args as Record<string, unknown>).submit
      : undefined;
  const immediate =
    typeof submitValue === "boolean"
      ? submitValue
      : submitValue === null || submitValue === undefined
        ? false
        : Boolean(submitValue);
  return isCreateRequest && !immediate ? t("assistantActionAskDraft") : t("assistantActionAskSubmit");
}

/** Anything a failed submit step gives as the reason; a machine-looking code
 * (e.g. `validation_error`) would be developer vocabulary - callers pass
 * the backend's own sentence (backend H43 now sends human messages). */
function understoodReason(message: string): string {
  return message.trim();
}

/**
 * The confirm result as user-visible markdown: the promised formal
 * confirmation card, as text the existing renderer turns into a bold
 * headline and definition lines -
 *
 *   **تم إنشاء الطلب.**
 *   - العنوان: `إجازة اعتيادية - يوم 25`
 *   - المرجع: `…396379`        (a short id keeps the «الرقم» label)
 *   - الحالة: مسودة | بانتظار مراجعة المدير
 *   [- اتعملت مسودة بس الإرسال ما كمّلش — السبب: <real sentence>]
 *
 * A UUID shown whole was machine-notation (H42 #3): it renders shortened
 * under «مرجع» - the same characters the backend produced, never a number
 * the frontend invented.
 */
export interface ConfirmReceiptContext {
  /** The pending action's `title` argument, when the card carried one. */
  title?: string;
}

export function describeConfirmResult(
  tool: unknown,
  result: unknown,
  t: Translator,
  context?: ConfirmReceiptContext,
): string {
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
  const title = context?.title;
  if (typeof title === "string" && title.trim() !== "") {
    lines.push(`- ${t("assistantArgTitle")}: \`${title.trim()}\``);
  }
  if (idKey) {
    const id = row[idKey];
    if (typeof id === "string") {
      // A UUID gets the honest «مرجع» treatment; a genuinely short id (one
      // day the backend returns one) keeps the plain «الرقم» label.
      if (UUID_RE.test(id)) lines.push(`- ${t("assistantDoneRef")}: \`${shortRef(id)}\``);
      else lines.push(`- ${t("assistantDoneId")}: \`${id}\``);
    }
  }
  if (typeof row.status === "string" && row.status.trim() !== "") {
    lines.push(`- ${t("assistantDoneStatus")}: ${STATUS_KEYS[row.status] ? t(STATUS_KEYS[row.status]) : row.status}`);
  }
  // H43/H42 - the truthful failure line: the submit step did not complete,
  // the draft stands, and the user reads the REASON sentence.
  if (row.submitted === false && typeof row.message === "string" && row.message.trim() !== "") {
    lines.push(`- ${t("assistantDoneSubmitNotDone").replace("%s", understoodReason(row.message))}`);
  } else if (typeof row.submit_result === "string" && row.submit_result.trim() !== "") {
    // The pre-H43 confirmed contract shape, honoured the same honest way.
    lines.push(`- ${t("assistantDoneSubmitBlocked").replace("%s", row.submit_result)}`);
  }
  return lines.join("\n");
}
