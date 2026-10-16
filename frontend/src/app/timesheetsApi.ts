/**
 * The timesheets API - Brief H33. Personal sheet lifecycle (Story 3.1/3.2) plus
 * the reviewer's queue/detail/decisions (Story 3.3, review scope), all through
 * the shared client in ./api. Mutations require an Idempotency-Key header.
 *
 * Entry corrections are PER-ENTRY PATCHes that each carry the client's known
 * sheet `version`; every accepted edit bumps the sheet version, so a caller
 * editing several entries must chain the versions off each response.
 */
import { apiRequest } from "./api";
import { newIdempotencyKey } from "./requestsApi";
import type {
  DecisionAction,
  PagedPayload,
  ServerMyTimesheet,
  ServerReviewTimesheet,
  ServerReviewTimesheetRow,
} from "./serverTypes";

/** GET /timesheets - the caller's own sheets. */
export function listMyTimesheets(locale: string, page = 1): Promise<PagedPayload<ServerMyTimesheet>> {
  return apiRequest<PagedPayload<ServerMyTimesheet>>(`/timesheets?page=${page}`, { acceptLanguage: locale });
}

/** GET /timesheets/{id} - owner-only detail. */
export function getMyTimesheet(id: string, locale: string): Promise<ServerMyTimesheet> {
  return apiRequest<{ data: ServerMyTimesheet }>(`/timesheets/${id}`, { acceptLanguage: locale }).then((payload) => payload.data);
}

/**
 * PATCH /timesheets/{id}/entries/{entryId} - one permitted-field correction.
 * Sends the sheet's known version; returns the sheet AT ITS NEW VERSION.
 */
export function editTimesheetEntry(
  sheetId: string,
  entryId: string,
  patch: { work_date?: string; duration_minutes?: number; unpaid_break_minutes?: number; description?: string },
  version: number,
  locale: string,
): Promise<ServerMyTimesheet> {
  return apiRequest<{ data: ServerMyTimesheet }>(`/timesheets/${sheetId}/entries/${entryId}`, {
    method: "PATCH",
    body: { ...patch, version },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/** DELETE /timesheets/{id}/entries/{entryId} - owner correction. */
export function deleteTimesheetEntry(
  sheetId: string,
  entryId: string,
  version: number,
  locale: string,
): Promise<ServerMyTimesheet> {
  return apiRequest<{ data: ServerMyTimesheet }>(`/timesheets/${sheetId}/entries/${entryId}`, {
    method: "DELETE",
    body: { version },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/** POST /timesheets/{id}/submit - {confirm:true, version}; DRAFT/RETURNED only. */
export function submitMyTimesheet(id: string, version: number, locale: string): Promise<ServerMyTimesheet> {
  return apiRequest<{ data: ServerMyTimesheet }>(`/timesheets/${id}/submit`, {
    method: "POST",
    body: { confirm: true, version },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/** POST /timesheets/{id}/decision - reviewer-only approve/reject/return. */
export function decideTimesheet(
  id: string,
  action: DecisionAction,
  comment: string,
  version: number,
  locale: string,
): Promise<ServerMyTimesheet> {
  return apiRequest<{ data: ServerMyTimesheet }>(`/timesheets/${id}/decision`, {
    method: "POST",
    body: { action, comment, version },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/** GET /review/timesheets/queue - manager/HR scoped rows (params = ?status=, ?q=). */
export function listReviewTimesheets(
  locale: string,
  options: { status?: string; page?: number } = {},
): Promise<PagedPayload<ServerReviewTimesheetRow>> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  params.set("page", String(options.page ?? 1));
  return apiRequest<PagedPayload<ServerReviewTimesheetRow>>(`/review/timesheets/queue?${params.toString()}`, { acceptLanguage: locale });
}

/** GET /review/timesheets/{id} - scoped detail with entries + events. */
export function getReviewTimesheet(id: string, locale: string): Promise<ServerReviewTimesheet> {
  return apiRequest<{ data: ServerReviewTimesheet }>(`/review/timesheets/${id}`, { acceptLanguage: locale }).then((payload) => payload.data);
}
