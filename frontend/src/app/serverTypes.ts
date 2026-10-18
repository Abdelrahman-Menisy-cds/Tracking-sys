/**
 * Brief H33 - the shared SERVER-FACING record types.
 *
 * The mock module's type declarations used to be the de-facto contract
 * (`src/mock/data.ts`). The server is the contract now: these are the shapes
 * the Django serializers actually emit (reqs/serializers.py, review/serializers.py,
 * timesheets/serializers.py). Every API-backed screen types its rows from here.
 */

/** EmployeeRequest.Status - reqs/models.py. */
export type RequestStatusType =
  | "DRAFT"
  | "PENDING_MANAGER"
  | "PENDING_HR"
  | "APPROVED"
  | "REJECTED"
  | "RETURNED"
  | "CANCELLED";

/** Timesheet.Status - timesheets/models.py. */
export type TimesheetStatusType = "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" | "REJECTED";

/** Decision actions accepted by the decision endpoints (lowercase on the wire). */
export type DecisionAction = "approve" | "reject" | "return";

/** RequestTypeSerializer - `name` is a plain string in the caller's language. */
export interface ServerRequestType {
  id: number;
  name: string;
  requires_hr_approval: boolean;
}

/** RequestEventSerializer / TimesheetEventSerializer. The server does NOT expose an actor name. */
export interface ServerRecordEvent {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  comment: string;
  created_at: string;
}

/** RequestAttachment.ScanStatus - reqs/models.py. UPPERCASE on the wire, exactly. */
export type ScanStatus = "PENDING" | "CLEAN" | "FAILED" | "REJECTED";

/** Attachment metadata as the endpoints emit it (both the employee and review paths). */
export interface ServerAttachmentSummary {
  id: string;
  original_filename: string;
  declared_content_type: string;
  size_bytes: number;
  scan_status: ScanStatus;
  created_at: string;
}

/** EmployeeRequestSerializer - the requester's own rows. No requester_name, no events. */
export interface ServerMyRequest {
  id: string;
  request_type: ServerRequestType;
  title: string;
  details: string;
  status: RequestStatusType;
  version: number;
  created_at: string;
  updated_at: string;
}

/** ReviewRequestSummarySerializer - a queue row of the review scope. */
export interface ServerReviewRequestRow {
  id: string;
  requester_id: string;
  requester_name: string;
  request_type: ServerRequestType;
  title: string;
  status: RequestStatusType;
  version: number;
  submitted_at: string | null;
  permissions: { can_decide: boolean };
  created_at: string;
}

/** ReviewRequestSerializer - the review detail: attachments + events + permissions. */
export interface ServerReviewRequest extends Omit<ServerReviewRequestRow, "requester_name"> {
  requester_name: string;
  details: string;
  attachments: ServerAttachmentSummary[];
  events: ServerRecordEvent[];
  updated_at: string;
}

/** TimeEntrySerializer (server rows; `id` is a real entry id). */
export interface ServerTimeEntry {
  id: string;
  work_date: string;
  duration_minutes: number;
  unpaid_break_minutes: number;
  description: string;
  created_at: string;
  updated_at: string;
}

/** TimesheetSerializer - the owner's own sheet (has totals, no employee_name). */
export interface ServerMyTimesheet {
  id: string;
  employee_id: string;
  week_start: string;
  week_end: string;
  status: TimesheetStatusType;
  version: number;
  entries: ServerTimeEntry[];
  total_worked_minutes: number;
  total_worked_hours: number;
  total_worked_hours_minutes_display: string;
  total_unpaid_break_minutes: number;
  events: ServerRecordEvent[];
  created_at: string;
  updated_at: string;
}

/** ReviewTimesheetSummarySerializer - a review-queue row (no entries). */
export interface ServerReviewTimesheetRow {
  id: string;
  employee_id: string;
  employee_name: string;
  week_start: string;
  status: TimesheetStatusType;
  version: number;
  permissions: { can_decide: boolean };
  created_at: string;
}

/** ReviewTimesheetSerializer - the review detail with entries + events. */
export interface ServerReviewTimesheet extends Omit<ServerReviewTimesheetRow, "employee_name"> {
  employee_name: string;
  entries: Omit<ServerTimeEntry, "created_at" | "updated_at">[];
  total_worked_minutes: number;
  total_unpaid_break_minutes: number;
  events: ServerRecordEvent[];
  updated_at: string;
}

/** «رأي المساعد» — the review-advice verdict vocabulary (review/advice.py). */
export type AdviceVerdict = "RECOMMEND_APPROVE" | "RECOMMEND_REJECT" | "NEEDS_ATTENTION" | "NO_OPINION";
/** Whether one rule argues for approving, rejecting, merely warns, or is just a fact. */
export type AdviceSupport = "approve" | "reject" | "warn" | "info";

/** One cited rule fact (the numbers it was derived from + its own reason). */
export interface ServerAdviceFact {
  rule: "balance" | "overlap" | "coverage" | "hr_approval";
  supports: AdviceSupport;
  fact: Record<string, unknown>;
  reason_ar: string;
  reason_en: string;
}

/** The assistant's half: present only when one is configured and reachable. */
export interface ServerAdviceExplanation {
  available: boolean;
  text_ar: string | null;
  reason_unavailable: string | null;
  message: string | null;
}

/** GET /review/requests/{id}/advice — the rule verdict + the assistant's prose. */
export interface ServerReviewAdvice {
  request_id: string;
  verdict: AdviceVerdict;
  verdict_label: { ar: string; en: string };
  period: { start: string; end: string; days: number; source: string } | null;
  facts: ServerAdviceFact[];
  explanation: ServerAdviceExplanation;
}

/** NotificationSerializer - title/body are server-language STRINGS, not {ar,en}. */
export interface ServerNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  is_read: boolean;
  related_object: { type: string; id: string; available: boolean } | null;
}

/** One holiday register row, as the holidays API's display shape. */
export type PublicHoliday = {
  id: string;
  /** ISO calendar date (Cairo local), e.g. 2026-04-25. */
  date: string;
  name: { ar: string; en: string };
  /** Repeats every year on the same month/day while true. */
  recurring?: boolean;
  /**
   * Provenance, present only on rows that came from the server.
   * `needsConfirmation` marks an LLM *proposal* (Ramadan, Eid Al-Fitr) that HR
   * has not confirmed - it must never render as an official holiday.
   */
  source?: "NAGER" | "LLM" | "MANUAL";
  isManualOverride?: boolean;
  needsConfirmation?: boolean;
};

/** The data+meta envelope every paginated list endpoint returns. */
export interface PagedPayload<T> {
  data: T[];
  meta: { page: number; page_size: number; count: number; total_pages: number };
}
