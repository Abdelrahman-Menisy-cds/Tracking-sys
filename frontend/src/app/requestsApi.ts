/**
 * The requests API - Brief H33. Personal rows, review rows, and the four
 * mutations (draft, submit, decision, cancel - Story 2.1-2.5), all through
 * the shared client in ./api. The server scopes everything; the client adds
 * no filters of its own. Idempotency-Key is REQUIRED by the mutating
 * endpoints, so the callers generate one per attempt.
 */
import { apiRequest } from "./api";
import type {
  DecisionAction,
  PagedPayload,
  ScanStatus,
  ServerMyRequest,
  ServerRequestType,
  ServerReviewAdvice,
  ServerReviewRequest,
  ServerReviewRequestRow,
} from "./serverTypes";

/**
 * The caller's company's ACTIVE request types (GET /request-types) — the
 * source of the «طلب جديد» type picker. Read-only; the server scopes it to the
 * caller's company, so the client adds no filter of its own.
 */
export function listRequestTypes(locale: string): Promise<ServerRequestType[]> {
  return apiRequest<{ data: ServerRequestType[] }>("/request-types", { acceptLanguage: locale })
    .then((payload) => payload.data ?? []);
}

/** The requester's own request list (EmployeeRequestSerializer rows). */
export function listMyRequests(locale: string, page = 1): Promise<PagedPayload<ServerMyRequest>> {
  return apiRequest<PagedPayload<ServerMyRequest>>(`/requests?page=${page}`, { acceptLanguage: locale });
}

/** One of the caller's own requests (detail carries no events server-side). */
export function getMyRequest(id: string, locale: string): Promise<ServerMyRequest> {
  return apiRequest<{ data: ServerMyRequest }>(`/requests/${id}`, { acceptLanguage: locale }).then((payload) => payload.data);
}

/** The caller's own attachments endpoint emits `content_type` + a download initiation URL. */
export interface ServerAttachmentRow {
  id: string;
  request_id: string;
  original_filename: string;
  content_type: string;
  detected_content_type: string;
  size_bytes: number;
  scan_status: ScanStatus;
  created_at: string;
  download_url: string;
}

/** The caller's own attachments for a request (read-only summary shape). */
export function listMyRequestAttachments(id: string, locale: string): Promise<ServerAttachmentRow[]> {
  return apiRequest<{ data: ServerAttachmentRow[] }>(`/requests/${id}/attachments`, { acceptLanguage: locale })
    .then((payload) => payload.data ?? []);
}

/**
 * Create a DRAFT. POST /requests: {request_type_id, title, details} - the
 * period travels inside the composed title (server field allowlist).
 */
export function createRequestDraft(
  input: { requestTypeId: number; title: string; details: string },
  locale: string,
): Promise<ServerMyRequest> {
  return apiRequest<{ data: ServerMyRequest }>("/requests", {
    method: "POST",
    body: { request_type_id: input.requestTypeId, title: input.title, details: input.details },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/** POST /requests/{id}/submit - {version}; server derives the routing. */
export function submitMyRequest(id: string, version: number, locale: string): Promise<ServerMyRequest> {
  return apiRequest<{ data: ServerMyRequest }>(`/requests/${id}/submit`, {
    method: "POST",
    body: { version },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/**
 * PATCH /requests/{id} - the draft's permitted fields only ({title, details}).
 * Used when the form's values changed after the draft was first saved; the
 * server refuses every other field, so nothing else is ever sent.
 */
export function updateMyRequestDraft(
  id: string,
  input: { title: string; details: string },
  locale: string,
): Promise<ServerMyRequest> {
  return apiRequest<{ data: ServerMyRequest }>(`/requests/${id}`, {
    method: "PATCH",
    body: { title: input.title, details: input.details },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/**
 * POST /requests/{id}/attachments - multipart upload (the server reads the
 * `file` part) with the Idempotency-Key the endpoint requires. The bytes go up
 * as FormData; the shared client leaves the multipart boundary to the browser.
 */
export function uploadRequestAttachment(
  id: string,
  file: File,
  locale: string,
): Promise<ServerAttachmentRow> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<{ data: ServerAttachmentRow }>(`/requests/${id}/attachments`, {
    method: "POST",
    body: form,
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/** POST /requests/{id}/cancel - requester-only, before any decision. */
export function cancelMyRequest(id: string, version: number, locale: string): Promise<ServerMyRequest> {
  return apiRequest<{ data: ServerMyRequest }>(`/requests/${id}/cancel`, {
    method: "POST",
    body: { confirm: true, version },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/** POST /requests/{id}/decision - reviewer's approve/reject/return. */
export function decideRequest(
  id: string,
  action: DecisionAction,
  comment: string,
  version: number,
  locale: string,
): Promise<ServerMyRequest> {
  return apiRequest<{ data: ServerMyRequest }>(`/requests/${id}/decision`, {
    method: "POST",
    body: { action, comment, version },
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}

/** GET /review/requests/queue - manager/HR scoped rows (params = ?status=, ?q=). */
export function listReviewRequests(
  locale: string,
  options: { status?: string; page?: number } = {},
): Promise<PagedPayload<ServerReviewRequestRow>> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  params.set("page", String(options.page ?? 1));
  return apiRequest<PagedPayload<ServerReviewRequestRow>>(`/review/requests/queue?${params.toString()}`, { acceptLanguage: locale });
}

/** GET /review/requests/{id} - scoped read-only detail with events + attachments. */
export function getReviewRequest(id: string, locale: string): Promise<ServerReviewRequest> {
  return apiRequest<{ data: ServerReviewRequest }>(`/review/requests/${id}`, { acceptLanguage: locale }).then((payload) => payload.data);
}

/** GET /review/requests/{id}/advice - the rule verdict + the assistant's prose. */
export function getReviewRequestAdvice(id: string, locale: string): Promise<ServerReviewAdvice> {
  return apiRequest<{ data: ServerReviewAdvice }>(`/review/requests/${id}/advice`, { acceptLanguage: locale }).then((payload) => payload.data);
}

/**
 * GET /review/requests/advice?ids=... - the advice for a whole page in ONE call.
 * The table must never fire once per row; the server asks the assistant once
 * for every in-scope id and returns a map keyed by request id.
 */
export function listReviewAdvice(
  ids: string[],
  locale: string,
): Promise<Record<string, ServerReviewAdvice>> {
  const params = new URLSearchParams();
  params.set("ids", ids.join(","));
  return apiRequest<{ data: Record<string, ServerReviewAdvice> }>(
    `/review/requests/advice?${params.toString()}`,
    { acceptLanguage: locale },
  ).then((payload) => payload.data ?? {});
}

/** One attempt, one key: a retry after an unknown outcome must never reuse it. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
