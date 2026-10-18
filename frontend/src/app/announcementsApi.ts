/**
 * The internal announcements API - the «الإعلانات الداخلية» screen's server half.
 *
 *   GET  /announcements              HR: every company announcement (drafts +
 *                                    published); anyone else: the published ones
 *                                    addressed to them (the in-app feed)
 *   POST /announcements              HR authors a draft   (Idempotency-Key)
 *   POST /announcements/<id>/publish HR publishes one     (version + Idempotency-Key)
 *   GET  /announcements/log          HR reads the send log
 *
 * Thin wrappers over the shared `apiRequest`: same session, CSRF on the unsafe
 * verbs, the same error envelope. The mutating endpoints REQUIRE an
 * Idempotency-Key (one per attempt, never reused across a retry) and publish
 * carries the `version` the author last saw, so a stale client is refused with
 * a 409 rather than publishing twice.
 *
 * Nothing here simulates a delivery: `channel` is always the in-app feed, which
 * is the only transport the product has.
 */
import { apiRequest } from "./api";
import { newIdempotencyKey } from "./requestsApi";

export type AnnouncementAudience = "ALL" | "SELECTED";
export type AnnouncementState = "DRAFT" | "PUBLISHED";

/** One named recipient, as the server returns it to HR (id + display name). */
export interface AnnouncementRecipient {
  id: number;
  name: string;
}

/** One announcement row exactly as the server serialises it. */
export interface ServerAnnouncement {
  id: number;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  state: AnnouncementState;
  published_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  author_id: number;
  author_name: string;
  /** Snapshot once published; the live resolved count while still a draft. */
  recipient_count: number;
  /** Only HR sees this, and only for a SELECTED audience; [] otherwise. */
  recipients: AnnouncementRecipient[];
}

/** One send-log row: what was sent, to which audience, when, by whom. */
export interface ServerDelivery {
  id: number;
  announcement_id: number;
  announcement_title: string;
  audience: AnnouncementAudience;
  recipient_count: number;
  channel: string;
  sent_by_id: number;
  sent_by_name: string;
  sent_at: string;
  request_id: string;
}

export interface AnnouncementDraftInput {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  /** Required (and only meaningful) when audience is SELECTED. */
  recipients?: number[];
}

/** GET /announcements - role-scoped: HR everything, others their feed. */
export function fetchAnnouncements(locale: string): Promise<ServerAnnouncement[]> {
  return apiRequest<{ data: ServerAnnouncement[] }>("/announcements", { acceptLanguage: locale })
    .then((payload) => payload.data ?? []);
}

/** POST /announcements - author a draft. Refusals keep `fields` for the form. */
export function createAnnouncement(
  input: AnnouncementDraftInput,
  locale: string,
): Promise<ServerAnnouncement> {
  return apiRequest<{ data: ServerAnnouncement }>("/announcements", {
    method: "POST",
    body: input,
    headers: { "Idempotency-Key": newIdempotencyKey() },
    acceptLanguage: locale,
    // A write, not the LLM refresh that needs the long budget.
    timeoutMs: 20000,
  }).then((payload) => payload.data);
}

/**
 * POST /announcements/<id>/publish - publish one draft.
 *
 * Returns the updated announcement AND the send-log row the server actually
 * wrote, so the caller renders what happened instead of assuming it.
 */
export function publishAnnouncement(
  id: number,
  version: number,
  locale: string,
): Promise<{ data: ServerAnnouncement; delivery: ServerDelivery }> {
  return apiRequest<{ data: ServerAnnouncement; delivery: ServerDelivery }>(
    `/announcements/${id}/publish`,
    {
      method: "POST",
      body: { version },
      headers: { "Idempotency-Key": newIdempotencyKey() },
      acceptLanguage: locale,
      timeoutMs: 20000,
    },
  );
}

/** GET /announcements/log - the send log (HR only). */
export function fetchAnnouncementLog(locale: string): Promise<ServerDelivery[]> {
  return apiRequest<{ data: ServerDelivery[] }>("/announcements/log", { acceptLanguage: locale })
    .then((payload) => payload.data ?? []);
}
