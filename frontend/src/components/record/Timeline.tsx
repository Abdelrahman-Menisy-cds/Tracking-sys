import { useApp } from "../../app/AppContext";
import { formatDateTime } from "../../app/format";
import type { ServerRecordEvent } from "../../app/serverTypes";

const actionLabels: Record<string, { ar: string; en: string }> = {
  CREATE: { ar: "إنشاء السجل", en: "Record created" },
  SUBMIT: { ar: "إرسال للمراجعة", en: "Submitted for review" },
  APPROVE: { ar: "اعتماد", en: "Approved" },
  RETURN: { ar: "إعادة للتعديل", en: "Returned for correction" },
  REJECT: { ar: "رفض", en: "Rejected" },
};

const statusLabels: Record<string, { ar: string; en: string }> = {
  DRAFT: { ar: "مسودة", en: "Draft" },
  PENDING_MANAGER: { ar: "بانتظار مراجعة المدير", en: "Awaiting manager review" },
  PENDING_HR: { ar: "بانتظار مراجعة الموارد البشرية", en: "Awaiting HR review" },
  SUBMITTED: { ar: "مُرسل للمراجعة", en: "Submitted for review" },
  APPROVED: { ar: "معتمد", en: "Approved" },
  REJECTED: { ar: "مرفوض", en: "Rejected" },
  RETURNED: { ar: "معاد للتعديل", en: "Returned for correction" },
  CANCELLED: { ar: "ملغى", en: "Cancelled" },
};

/**
 * The review-history rows come off the server (`ServerRecordEvent`), and the
 * server does NOT expose who performed an action — only what changed and when.
 * The actor line is therefore dropped rather than invented.
 */
export default function Timeline({ events }: { events: ServerRecordEvent[] }) {
  const { locale, t } = useApp();
  const orderedEvents = [...events].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  return (
    <ol className="timeline" aria-label={t("history")}>
      {orderedEvents.map((event) => (
        <li className="timeline-event" key={event.id}>
          <span className="timeline-marker" aria-hidden="true" />
          <div>
            <strong>{actionLabels[event.action]?.[locale] ?? (locale === "ar" ? "تحديث السجل" : "Record updated")}</strong>
            <div className="muted">
              {formatDateTime(event.created_at, locale)}
            </div>
            <div className="muted">
              {locale === "ar" ? "الحالة السابقة" : "Previous state"}: {event.from_status ? statusLabels[event.from_status]?.[locale] ?? (locale === "ar" ? "حالة سابقة" : "Previous state") : (locale === "ar" ? "لا توجد" : "None")}
              <br />
              {locale === "ar" ? "الحالة الجديدة" : "New state"}: {statusLabels[event.to_status]?.[locale] ?? (locale === "ar" ? "حالة محدثة" : "Updated state")}
            </div>
            {event.comment ? <p><bdi>{event.comment}</bdi></p> : null}
            <div className="muted" dir="ltr" translate="no">ID: <bdi>{event.id}</bdi></div>
          </div>
        </li>
      ))}
    </ol>
  );
}
