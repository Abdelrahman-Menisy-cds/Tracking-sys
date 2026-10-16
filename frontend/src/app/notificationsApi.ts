/**
 * The notifications API - Brief H33. The recipient's rows (server-scoped by
 * the session) and the single mutation the contract exposes: the read state.
 *
 * There is NO delete/clear endpoint - removing or clearing notifications is
 * a client-side fiction the old fixtures permitted; the server keeps the
 * record, so the screen does not pretend otherwise.
 */
import { apiRequest } from "./api";
import type { PagedPayload, ServerNotification } from "./serverTypes";

/** GET /notifications - one page (page_size fixed by the backend, max 20). */
export function listNotifications(locale: string, page = 1, pageSize = 20): Promise<PagedPayload<ServerNotification>> {
  return apiRequest<PagedPayload<ServerNotification>>(
    `/notifications?page=${page}&page_size=${pageSize}`,
    { acceptLanguage: locale },
  );
}

/** PATCH /notifications/{id}/read-state - {is_read: boolean}. */
export function setNotificationRead(id: number, isRead: boolean, locale: string): Promise<ServerNotification> {
  return apiRequest<{ data: ServerNotification }>(`/notifications/${id}/read-state`, {
    method: "PATCH",
    body: { is_read: isRead },
    acceptLanguage: locale,
  }).then((payload) => payload.data);
}
