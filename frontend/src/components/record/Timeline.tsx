import { useApp } from "../../app/AppContext";
import { formatDateTime } from "../../app/useMockList";
import type { RequestEventMock } from "../../mock/data";

const labels: Record<string, { ar: string; en: string }> = { CREATE: { ar: "إنشاء السجل", en: "Record created" }, SUBMIT: { ar: "إرسال للمراجعة", en: "Submitted for review" }, APPROVE: { ar: "اعتماد", en: "Approved" }, RETURN: { ar: "إعادة للتعديل", en: "Returned for correction" }, REJECT: { ar: "رفض", en: "Rejected" } };
export default function Timeline({ events }: { events: RequestEventMock[] }) { const { locale, t } = useApp(); return <ol className="timeline" aria-label={t("history")}>{events.map((event) => <li className="timeline-event" key={event.id}><span className="timeline-marker" aria-hidden="true" /><div><strong>{labels[event.action]?.[locale] ?? event.action}</strong><div className="muted"><bdi>{event.actor}</bdi> · {formatDateTime(event.created_at, locale)}</div>{event.comment && <p><bdi>{event.comment}</bdi></p>}</div></li>)}</ol>; }
