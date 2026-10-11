import { Fragment } from "react";
import { useApp } from "../../app/AppContext";
import { formatDateTime } from "../../app/useMockList";
import { findDirectoryEntry } from "../../mock/data";
import { taskStatusKey } from "./TaskPills";
import type { TaskEventMock } from "../../mock/tasks";

const actionLabels: Record<TaskEventMock["action"], { ar: string; en: string }> = {
  CREATE: { ar: "إنشاء المهمة", en: "Task created" },
  ROUTE_TO_MANAGER: { ar: "تحويل إلى مدير", en: "Routed to a manager" },
  ASSIGN: { ar: "تكليف", en: "Assigned" },
  REASSIGN: { ar: "إعادة تكليف", en: "Reassigned" },
  STATUS_CHANGE: { ar: "تغيير الحالة", en: "Status changed" },
};

/**
 * The task's append-only trail, rendered with the same visual timeline the
 * requests and timesheets use. Names resolve from the directory; ids stay as
 * the fallback if a record is missing.
 */
export default function TaskTimeline({ events }: { events: TaskEventMock[] }) {
  const { locale, t } = useApp();
  const orderedEvents = [...events].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  const name = (id: string | undefined): string => (id ? findDirectoryEntry(id)?.name[locale] ?? id : "");
  return (
    <ol className="timeline" aria-label={t("taskTrailHeading")}>
      {orderedEvents.map((event) => (
        <li className="timeline-event" key={event.id}>
          <span className="timeline-marker" aria-hidden="true" />
          <div>
            <strong>{actionLabels[event.action][locale]}</strong>
            <div className="muted">
              <bdi>{name(event.actor)}</bdi> · {formatDateTime(event.created_at, locale)}
            </div>
            {event.action === "ASSIGN" ? (
              <div className="muted">{t("taskAssignee")}: <bdi>{name(event.assigned)}</bdi></div>
            ) : null}
            {event.action === "REASSIGN" ? (
              <div className="muted">
                <Fragment>
                  {t("taskTrailReassign")} <bdi>{name(event.replaces)}</bdi> → <bdi>{name(event.assigned)}</bdi>
                </Fragment>
              </div>
            ) : null}
            {event.action === "STATUS_CHANGE" ? (
              <div className="muted">
                <Fragment>
                  {t("taskTrailStatusFrom")} <bdi>{event.from_status ? t(taskStatusKey[event.from_status]) : t("taskTrailNone")}</bdi>
                  {" → "}
                  <bdi>{event.to_status ? t(taskStatusKey[event.to_status]) : t("taskTrailNone")}</bdi>
                </Fragment>
              </div>
            ) : null}
            {event.action === "ROUTE_TO_MANAGER" ? (
              <div className="muted">{t("taskRoutedManager")}: <bdi>{name(event.routed_to)}</bdi></div>
            ) : null}
            {event.comment ? <p><bdi>{event.comment}</bdi></p> : null}
            <div className="muted" dir="ltr" translate="no">ID: <bdi>{event.id}</bdi></div>
          </div>
        </li>
      ))}
    </ol>
  );
}
