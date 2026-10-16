import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useServerData } from "../app/useServerData";
import { formatDate, formatDateTime, formatMinutes, weekInterval } from "../app/format";
import { editTimesheetEntry, getMyTimesheet, listMyTimesheets, submitMyTimesheet } from "../app/timesheetsApi";
import type { ServerMyTimesheet, ServerTimeEntry } from "../app/serverTypes";
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

export function MyTimesheetsPage() {
  const { t, locale } = useApp();
  const list = useServerData(() => listMyTimesheets(locale).then((payload) => payload.data), [locale]);
  usePageTitle(t("myTimesheetsTitle"));
  const columns: OperationalColumn<ServerMyTimesheet>[] = [
    { key: "week", label: t("week"), render: (sheet) => <Link to={`/timesheets/${sheet.id}`}>{weekInterval(sheet.week_start, locale)}</Link> },
    { key: "timezone", label: locale === "ar" ? "المنطقة الزمنية" : "Timezone", render: () => locale === "ar" ? "القاهرة" : "Cairo" },
    { key: "status", label: t("status"), render: (sheet) => <TimesheetStatusPill status={sheet.status} /> },
    { key: "total", label: t("totalHours"), render: (sheet) => formatMinutes(sheet.total_worked_minutes, locale) },
    { key: "updated", label: t("lastUpdate"), render: (sheet) => formatDateTime(sheet.updated_at, locale) },
    { key: "action", label: locale === "ar" ? "الإجراء" : "Action", render: (sheet) => <Link to={`/timesheets/${sheet.id}`}>{sheet.status === "DRAFT" || sheet.status === "RETURNED" ? (locale === "ar" ? "فتح" : "Open") : (locale === "ar" ? "عرض" : "View")}</Link> },
  ];
  const sheets = list.phase === "ready" ? list.data : [];
  return <div className="page"><PageHeader title={t("myTimesheetsTitle")} subtitle={locale === "ar" ? "الاثنين إلى الأحد · المنطقة الزمنية للمؤسسة: القاهرة" : "Monday to Sunday · organization timezone: Cairo"} />{list.phase === "loading" ? <SkeletonRows rows={3} /> : null}{list.phase === "error" ? <ErrorState onRetry={list.retry} /> : null}{list.phase === "ready" && sheets.length === 0 ? <EmptyState message={t("noTimesheets")} action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>} /> : null}{list.phase === "ready" && sheets.length > 0 ? <OperationalTable caption={locale === "ar" ? `${sheets.length} أسابيع في نطاقك الشخصي` : `${sheets.length} weeks in your personal scope`} columns={columns} records={sheets} /> : null}</div>;
}

export function TimesheetDetailPage() {
  const { id } = useParams();
  const { t, locale } = useApp();
  const state = useServerData(async () => {
    try {
      return await getMyTimesheet(id ?? "", locale);
    } catch {
      return null;
    }
  }, [id, locale]);
  usePageTitle(t("myTimesheetsTitle"));
  if (state.phase === "loading") return <div className="page"><PageHeader title={t("myTimesheetsTitle")} /><SkeletonRows rows={3} /></div>;
  if (state.phase === "error") return <div className="page"><PageHeader title={t("myTimesheetsTitle")} /><ErrorState onRetry={state.retry} /></div>;
  const sheet = state.phase === "ready" ? state.data : null;
  if (!sheet) return <div className="page"><PageHeader title={t("myTimesheetsTitle")} /><Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner><Link to="/timesheets">{t("back")}</Link></div>;
  return <TimesheetEditor initialSheet={sheet} />;
}

type EditorEntry = {
  /** A real server entry id, or null for a day the week was created without. */
  entryId: string | null;
  work_date: string;
  duration_minutes: number;
  unpaid_break_minutes: number;
  description: string;
};

/**
 * The week editor. The contract corrects EXISTING entries one PATCH at a
 * time, each carrying the sheet's known version; an accepted edit returns
 * the sheet at its new version and the next edit chains off it. Days the
 * week was created without an entry have NO server row to edit - the
 * backend exposes no add-entry endpoint - so those cells are inert and
 * labelled, never silently writable.
 */
function TimesheetEditor({ initialSheet }: { initialSheet: ServerMyTimesheet }) {
  const { t, locale } = useApp();
  const [currentSheet, setCurrentSheet] = useState(initialSheet);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [savedTone, setSavedTone] = useState<"success" | "warning">("success");
  const [busy, setBusy] = useState(false);
  const [entryBusy, setEntryBusy] = useState<string | null>(null);
  /** Always the version of the LAST server answer the editor holds. */
  const versionRef = useRef(initialSheet.version);
  const readOnly = currentSheet.status !== "DRAFT" && currentSheet.status !== "RETURNED";
  const days = weekDates(currentSheet.week_start);
  const entries: EditorEntry[] = days.map((date) => {
    const existing: ServerTimeEntry | undefined = currentSheet.entries.find((entry) => entry.work_date === date);
    return existing
      ? { entryId: existing.id, work_date: existing.work_date, duration_minutes: existing.duration_minutes, unpaid_break_minutes: existing.unpaid_break_minutes, description: existing.description }
      : { entryId: null, work_date: date, duration_minutes: 0, unpaid_break_minutes: 0, description: "" };
  });

  const patchEntry = async (entry: EditorEntry, field: "duration_minutes" | "unpaid_break_minutes" | "description", value: string) => {
    if (!entry.entryId || readOnly) return;
    setEntryBusy(entry.entryId);
    setSavedMessage(null);
    const patch = field === "description"
      ? { description: value }
      : field === "duration_minutes"
        ? { duration_minutes: Number(value) }
        : { unpaid_break_minutes: Number(value) };
    try {
      const returned = await editTimesheetEntry(currentSheet.id, entry.entryId, patch, versionRef.current, locale);
      versionRef.current = returned.version;
      setCurrentSheet(returned);
    } catch {
      setSavedTone("warning");
      setSavedMessage(locale === "ar"
        ? "تعذّر حفظ التعديل. أعد تحميل السجل قبل المحاولة مرة أخرى - قد يكون تغيّر إصداره."
        : "The edit was not saved. Reload the record before retrying - its version may have changed.");
    } finally {
      setEntryBusy(null);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const returned = await submitMyTimesheet(currentSheet.id, versionRef.current, locale);
      versionRef.current = returned.version;
      setCurrentSheet(returned);
      setSavedTone("success");
      setSavedMessage(locale === "ar" ? "تم إرسال الأسبوع للمراجعة على الخادم وأصبح للقراءة فقط." : "The week was submitted to the server and is now read-only.");
    } catch {
      setSavedTone("warning");
      setSavedMessage(locale === "ar" ? "لم يُقبل الإرسال من الخادم. غالبًا الراحة غير مطابقة أو إصدار السجل تغيّر؛ أعد تحميل الصفحة وحاول مرة أخرى." : "The server did not accept the submission. Usually the version changed; reload the page and try again.");
    } finally {
      setBusy(false);
    }
  };

  const worked = entries.reduce((sum, entry) => sum + entry.duration_minutes, 0);
  const breaks = entries.reduce((sum, entry) => sum + entry.unpaid_break_minutes, 0);

  const cell = (entry: EditorEntry, field: "duration_minutes" | "unpaid_break_minutes" | "description", name: string, ariaLabel: string, dir?: string, minMax?: boolean) => (
    <input
      className="input"
      name={name}
      {...(field === "description" ? {} : { type: "number", ...(minMax ? { min: "0", max: "1440", inputMode: "numeric" } : {}) })}
      dir={dir}
      value={entry[field]}
      disabled={readOnly || entry.entryId === null}
      title={entry.entryId === null ? (locale === "ar" ? "لا يوجد إدخال مسجل لهذا اليوم على الخادم" : "No server entry exists for this day") : undefined}
      aria-label={ariaLabel}
      onChange={(event) => void patchEntry(entry, field, event.target.value)}
    />
  );

  return (
    <div className="page reading-page">
      <PageHeader title={<>{t("week")}: {weekInterval(currentSheet.week_start, locale)}</>} subtitle={locale === "ar" ? "الاثنين إلى الأحد · المنطقة الزمنية للمؤسسة: القاهرة" : "Monday to Sunday · organization timezone: Cairo"} breadcrumb={<Link to="/timesheets">{t("myTimesheetsTitle")}</Link>} />
      <div className="work-surface status-action-block"><div className="status-action-row"><TimesheetStatusPill status={currentSheet.status} /><span>{readOnly ? t("readonlyTimesheet") : (locale === "ar" ? "يمكنك تعديل هذا السجل قبل الإرسال." : "This record can be edited before submission.")}{entryBusy ? ` · ${locale === "ar" ? "جارٍ الحفظ" : "saving"}` : "" }</span></div></div>
      <div className="table-wrap section"><table><caption className="table-caption">{locale === "ar" ? "المدة والراحة بالدقائق؛ كل تعديل يُرسل إلى الخادم فورًا مع إصدار السجل." : "Duration and breaks in minutes; every edit is sent to the server immediately with the record's version."}</caption><thead><tr><th scope="col">{t("workDate")}</th><th scope="col">{t("duration")}</th><th scope="col">{t("breakTime")}</th><th scope="col">{t("description")}</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.work_date}><th scope="row">{formatDate(`${entry.work_date}T12:00:00Z`, locale)}</th><td>{cell(entry, "duration_minutes", `duration-${entry.work_date}`, `${t("duration")} ${formatDate(`${entry.work_date}T12:00:00Z`, locale)}`, "ltr", true)}</td><td>{cell(entry, "unpaid_break_minutes", `break-${entry.work_date}`, `${t("breakTime")} ${formatDate(`${entry.work_date}T12:00:00Z`, locale)}`, "ltr", true)}</td><td>{cell(entry, "description", `description-${entry.work_date}`, `${t("description")} ${formatDate(`${entry.work_date}T12:00:00Z`, locale)}`)}</td></tr>)}</tbody></table>
        <p className="page-meta">{locale === "ar" ? "ملاحظة: الأيام التي أنشئ الأسبوع بدون إدخال لها تظهر معطّلة - لا تتيح نقطة النهاية إضافة إدخال جديد لأسبوع قائم." : "Note: days the week was created without an entry show disabled - the API offers no add-entry endpoint for an existing week."}</p>
      </div>
      <div className="mobile-record-list section">{entries.map((entry) => <section className="record-block" aria-labelledby={`day-${entry.work_date}`} key={entry.work_date}><h2 id={`day-${entry.work_date}`}>{formatDate(`${entry.work_date}T12:00:00Z`, locale)}</h2><label className="field"><span className="field-label">{t("duration")}</span>{cell(entry, "duration_minutes", `mobile-duration-${entry.work_date}`, `${t("duration")} ${formatDate(`${entry.work_date}T12:00:00Z`, locale)}`, "ltr", true)}</label><label className="field"><span className="field-label">{t("breakTime")}</span>{cell(entry, "unpaid_break_minutes", `mobile-break-${entry.work_date}`, `${t("breakTime")} ${formatDate(`${entry.work_date}T12:00:00Z`, locale)}`, "ltr", true)}</label><label className="field"><span className="field-label">{t("description")}</span>{cell(entry, "description", `mobile-description-${entry.work_date}`, `${t("description")} ${formatDate(`${entry.work_date}T12:00:00Z`, locale)}`)}</label></section>)}</div>
      <div className="summary-strip section"><div className="summary-item"><span className="summary-label">{t("totalHours")}</span><strong className="summary-value">{formatMinutes(worked, locale)}</strong></div><div className="summary-item"><span className="summary-label">{t("breakTime")}</span><strong className="summary-value">{formatMinutes(breaks, locale)}</strong></div></div>
      {savedMessage ? <Banner tone={savedTone} role={savedTone === "warning" ? "alert" : "status"}>{savedMessage}</Banner> : null}
      {!readOnly ? <div className="form-actions"><button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? t("saving") : t("submitWeek")}</button></div> : null}
    </div>
  );
}
