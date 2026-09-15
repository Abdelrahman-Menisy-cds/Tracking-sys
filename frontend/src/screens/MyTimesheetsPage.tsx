import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { formatDateTime, formatMinutes, useMockList } from "../app/useMockList";
import { mockFetch, type TimeEntryMock, type TimesheetMock } from "../mock/data";
import { Banner, EmptyState, ErrorState, SkeletonRows, TimesheetStatusPill } from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";

function weekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const date = new Date(`${weekStart}T12:00:00Z`);
  for (let index = 0; index < 7; index += 1) {
    dates.push(date.toISOString().slice(0, 10));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function totalMinutes(sheet: TimesheetMock, field: "duration_minutes" | "unpaid_break_minutes") {
  return sheet.entries.reduce((sum, entry) => sum + entry[field], 0);
}

export function MyTimesheetsPage() {
  const { t, locale, myTimesheetItems } = useApp();
  const list = useMockList(() => mockFetch(myTimesheetItems), [myTimesheetItems]);
  usePageTitle(t("myTimesheetsTitle"));
  const columns: OperationalColumn<TimesheetMock>[] = [
    { key: "week", label: t("week"), render: (sheet) => <Link to={`/timesheets/${sheet.id}`}><bdi dir="ltr">{sheet.week_start}</bdi></Link> },
    { key: "timezone", label: locale === "ar" ? "المنطقة الزمنية" : "Timezone", render: () => locale === "ar" ? "القاهرة" : "Cairo" },
    { key: "status", label: t("status"), render: (sheet) => <TimesheetStatusPill status={sheet.status} /> },
    { key: "total", label: t("totalHours"), render: (sheet) => formatMinutes(totalMinutes(sheet, "duration_minutes"), locale) },
    { key: "updated", label: t("lastUpdate"), render: (sheet) => sheet.events.length ? formatDateTime(sheet.events[sheet.events.length - 1].created_at, locale) : "—" },
    { key: "action", label: locale === "ar" ? "الإجراء" : "Action", render: (sheet) => <Link to={`/timesheets/${sheet.id}`}>{sheet.status === "DRAFT" || sheet.status === "RETURNED" ? (locale === "ar" ? "فتح" : "Open") : (locale === "ar" ? "عرض" : "View")}</Link> },
  ];
  return <div className="page"><PageHeader title={t("myTimesheetsTitle")} subtitle={locale === "ar" ? "الاثنين إلى الأحد · المنطقة الزمنية للمؤسسة: القاهرة" : "Monday to Sunday · organization timezone: Cairo"} />{list.phase === "loading" ? <SkeletonRows rows={3} /> : null}{list.phase === "error" ? <ErrorState onRetry={list.retry} /> : null}{list.phase === "empty" ? <EmptyState message={t("noTimesheets")} /> : null}{list.phase === "ready" ? myTimesheetItems.length ? <OperationalTable caption={locale === "ar" ? `${myTimesheetItems.length} أسابيع في نطاقك الشخصي` : `${myTimesheetItems.length} weeks in your personal scope`} columns={columns} records={myTimesheetItems} /> : <EmptyState message={t("noTimesheets")} /> : null}</div>;
}

export function TimesheetDetailPage() {
  const { id } = useParams();
  const { t, myTimesheetItems } = useApp();
  const state = useMockList(() => mockFetch(myTimesheetItems.find((sheet) => sheet.id === id) ?? null, 250), [id, myTimesheetItems]);
  usePageTitle(t("myTimesheetsTitle"));
  if (state.phase === "loading") return <SkeletonRows rows={3} />;
  if (state.phase === "error") return <ErrorState onRetry={state.retry} />;
  const sheet = state.phase === "ready" ? state.data : null;
  if (!sheet) return <div className="page"><PageHeader title={t("myTimesheetsTitle")} /><Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner><Link to="/timesheets">{t("back")}</Link></div>;
  return <TimesheetEditor sheet={sheet} />;
}

function TimesheetEditor({ sheet }: { sheet: TimesheetMock }) {
  const { t, locale, submitDemoTimesheet } = useApp();
  const [currentSheet, setCurrentSheet] = useState(sheet);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = currentSheet.status !== "DRAFT" && currentSheet.status !== "RETURNED";
  const days = useMemo(() => weekDates(currentSheet.week_start), [currentSheet.week_start]);
  const [entries, setEntries] = useState(() => days.map((date) => {
    const existing = currentSheet.entries.find((entry) => entry.work_date === date);
    return {
      id: existing?.id ?? `demo-entry-${date}`,
      work_date: date,
      duration_minutes: existing?.duration_minutes ?? 0,
      unpaid_break_minutes: existing?.unpaid_break_minutes ?? 0,
      description: existing?.description ?? "",
    };
  }));
  const updateEntry = (date: string, field: "duration_minutes" | "unpaid_break_minutes" | "description", value: string) => {
    setEntries((current) => current.map((entry) => entry.work_date === date ? { ...entry, [field]: field === "description" ? value : Number(value) } : entry));
    setSavedMessage(null);
  };
  const worked = entries.reduce((sum, entry) => sum + entry.duration_minutes, 0);
  const breaks = entries.reduce((sum, entry) => sum + entry.unpaid_break_minutes, 0);
  const submit = async () => {
    setBusy(true);
    try {
      const returned = await submitDemoTimesheet(currentSheet.id, entries as TimeEntryMock[]);
      setCurrentSheet(returned);
      setSavedMessage(locale === "ar" ? "أكدت طبقة العرض التجريبية الإرسال وأصبح السجل للقراءة فقط. التغيير غير دائم وسيختفي بعد إعادة التحميل." : "The demo data layer confirmed submission and the sheet is now read-only. This change is non-persistent and will disappear after reload.");
    } catch {
      setSavedMessage(locale === "ar" ? "لم نتلقَّ تأكيدًا تجريبيًا. احتفظنا بالإدخالات؛ حدّث السجل قبل إعادة المحاولة." : "Demo confirmation was not received. Entries are preserved; refresh the record before retrying.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page reading-page">
      <PageHeader title={<>{t("week")}: <bdi dir="ltr">{currentSheet.week_start}</bdi></>} subtitle={locale === "ar" ? "الاثنين إلى الأحد · المنطقة الزمنية للمؤسسة: القاهرة" : "Monday to Sunday · organization timezone: Cairo"} breadcrumb={<Link to="/timesheets">{t("myTimesheetsTitle")}</Link>} />
      <Banner tone="neutral">{locale === "ar" ? "بيانات عرض تجريبية: أي تعديلات أو إرسال في هذه الصفحة غير دائم ولن يبقى بعد إعادة التحميل." : "Demo data: edits and submission on this page are non-persistent and will not survive a reload."}</Banner>
      <div className="status-action-block"><div className="status-action-row"><TimesheetStatusPill status={currentSheet.status} /><span>{readOnly ? t("readonlyTimesheet") : (locale === "ar" ? "يمكنك تعديل هذا السجل قبل الإرسال." : "This record can be edited before submission.")}</span></div></div>
      <div className="table-wrap section"><table><caption className="table-caption">{locale === "ar" ? "المدة والراحة بالدقائق؛ التحقق النهائي من الخادم عند التكامل." : "Duration and breaks in minutes; final validation will be server-authoritative when integrated."}</caption><thead><tr><th scope="col">{t("workDate")}</th><th scope="col">{t("duration")}</th><th scope="col">{t("breakTime")}</th><th scope="col">{t("description")}</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.work_date}><th scope="row"><bdi dir="ltr">{entry.work_date}</bdi></th><td><input className="input" name={`duration-${entry.work_date}`} type="number" min="0" max="1440" inputMode="numeric" dir="ltr" value={entry.duration_minutes} disabled={readOnly} aria-label={`${t("duration")} ${entry.work_date}`} onChange={(event) => updateEntry(entry.work_date, "duration_minutes", event.target.value)} /></td><td><input className="input" name={`break-${entry.work_date}`} type="number" min="0" max="1440" inputMode="numeric" dir="ltr" value={entry.unpaid_break_minutes} disabled={readOnly} aria-label={`${t("breakTime")} ${entry.work_date}`} onChange={(event) => updateEntry(entry.work_date, "unpaid_break_minutes", event.target.value)} /></td><td><input className="input" name={`description-${entry.work_date}`} value={entry.description} disabled={readOnly} aria-label={`${t("description")} ${entry.work_date}`} onChange={(event) => updateEntry(entry.work_date, "description", event.target.value)} /></td></tr>)}</tbody></table></div>
      <div className="mobile-record-list section">{entries.map((entry) => <section className="record-block" aria-labelledby={`day-${entry.work_date}`} key={entry.work_date}><h2 id={`day-${entry.work_date}`}><bdi dir="ltr">{entry.work_date}</bdi></h2><label className="field"><span className="field-label">{t("duration")}</span><input className="input" name={`mobile-duration-${entry.work_date}`} type="number" inputMode="numeric" dir="ltr" value={entry.duration_minutes} disabled={readOnly} onChange={(event) => updateEntry(entry.work_date, "duration_minutes", event.target.value)} /></label><label className="field"><span className="field-label">{t("breakTime")}</span><input className="input" name={`mobile-break-${entry.work_date}`} type="number" inputMode="numeric" dir="ltr" value={entry.unpaid_break_minutes} disabled={readOnly} onChange={(event) => updateEntry(entry.work_date, "unpaid_break_minutes", event.target.value)} /></label><label className="field"><span className="field-label">{t("description")}</span><input className="input" name={`mobile-description-${entry.work_date}`} value={entry.description} disabled={readOnly} onChange={(event) => updateEntry(entry.work_date, "description", event.target.value)} /></label></section>)}</div>
      <div className="summary-strip section"><div className="summary-item"><span className="summary-label">{t("totalHours")}</span><strong className="summary-value">{formatMinutes(worked, locale)}</strong></div><div className="summary-item"><span className="summary-label">{t("breakTime")}</span><strong className="summary-value">{formatMinutes(breaks, locale)}</strong></div></div>
      {savedMessage ? <Banner tone={currentSheet.status === "SUBMITTED" ? "success" : "warning"}>{savedMessage}</Banner> : null}
      {!readOnly ? <><Banner tone="info">{locale === "ar" ? "الإرسال انتقال تجريبي غير دائم. بعد تأكيد طبقة العرض يصبح السجل للقراءة فقط داخل الجلسة." : "Submission is a non-persistent demo transition. After the demo layer confirms it, the sheet becomes read-only for this session."}</Banner><div className="form-actions"><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? t("saving") : t("submitWeek")}</button></div></> : null}
    </div>
  );
}
