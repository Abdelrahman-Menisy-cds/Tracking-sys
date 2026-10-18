/**
 * The leave-balance API - the «استحقاقات الإجازات - لكل موظف» panel's server half.
 *
 *   GET  /leave-balances?year=<int>   read balances (HR: everyone; else: own)
 *   POST /leave-balances/adjust       HR-only, versioned, idempotent adjust
 *
 * Two truths, one derived: `entitled_days` and `carried_over_days` are
 * HR-configured and stored, so an unconfigured row carries them as `null` -
 * which is NOT zero and must never render as one. `used_days` is DERIVED from
 * the approved requests and is a real count even when the entitlement is unset,
 * so the two can be told apart (`is_configured` is false while `used_days` may
 * be a real number). `remaining_days` is null exactly when the balance is
 * unset, because there is nothing to subtract from.
 *
 * The adjust endpoint carries the same discipline as the rest of the API: a
 * required Idempotency-Key header (one per attempt, never reused across a
 * retry), the `version` the caller last saw (a stale write is refused 409, never
 * silently applied), and a mandatory reason. HR sends the new ABSOLUTE
 * entitlement - `used_days` is deliberately not accepted.
 */
import { apiRequest } from "./api";
import { newIdempotencyKey } from "./requestsApi";

/** One adjustment in a row's bounded history (newest first). */
export interface LeaveBalanceHistoryEntry {
  id: string;
  actor_name: string;
  reason: string;
  entitled_delta: number;
  carried_delta: number;
  created_at: string;
}

/** One read row exactly as the server serialises it. */
export interface LeaveBalanceRow {
  employee_id: string;
  employee_name: string;
  employee_email: string;
  employee_number: string | null;
  request_type_id: number;
  request_type_name: string;
  year: number;
  /** null when the balance is unset - NOT zero. */
  entitled_days: number | null;
  /** null when the balance is unset - NOT zero. */
  carried_over_days: number | null;
  /** Derived from approved requests; a real count even when unconfigured. */
  used_days: number;
  /** null exactly when the balance is unset. */
  remaining_days: number | null;
  /** 0 when no balance row exists yet; the value the next adjust must carry. */
  version: number;
  balance_id: string | null;
  is_configured: boolean;
  history: LeaveBalanceHistoryEntry[];
}

export interface LeaveTypeOption {
  id: number;
  name: string;
}

/** The whole GET body: the year, the leave types, and a row per employee. */
export interface LeaveBalancePayload {
  year: number;
  leave_types: LeaveTypeOption[];
  rows: LeaveBalanceRow[];
  /** false when the company defines no leave types - then rows is empty. */
  tracked: boolean;
  note: string | null;
  used_days_note?: string;
}

/** The adjust request body (HR sends absolute entitlements, never used_days). */
export interface LeaveBalanceAdjustInput {
  employeeId: string;
  requestTypeId: number;
  year: number;
  entitledDays: number;
  carriedOverDays: number;
  version: number;
  reason: string;
}

/** GET /leave-balances - scoped read; HR reads everyone, others their own row. */
export function fetchLeaveBalances(year: number, locale: string): Promise<LeaveBalancePayload> {
  return apiRequest<{ data: LeaveBalancePayload }>(`/leave-balances?year=${year}`, {
    acceptLanguage: locale,
    timeoutMs: 20000,
  }).then((payload) => payload.data);
}

/**
 * POST /leave-balances/adjust - set one (employee, leave type, year) entitlement.
 *
 * Returns the server's rebuilt row so the caller renders what was written
 * instead of assuming it. Refusals keep the error envelope's `fields` (422) and
 * its `code` (409 version_conflict / idempotency_conflict) for the form.
 */
export function adjustLeaveBalance(
  input: LeaveBalanceAdjustInput,
  locale: string,
): Promise<LeaveBalanceRow> {
  return apiRequest<{ data: LeaveBalanceRow }>("/leave-balances/adjust", {
    method: "POST",
    body: {
      employee_id: input.employeeId,
      request_type_id: input.requestTypeId,
      year: input.year,
      entitled_days: input.entitledDays,
      carried_over_days: input.carriedOverDays,
      version: input.version,
      reason: input.reason,
    },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
    timeoutMs: 20000,
  }).then((payload) => payload.data);
}
