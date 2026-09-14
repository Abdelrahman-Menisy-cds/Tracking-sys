/** S05 — My timesheets: week list + weekly editor with entries, totals, submit. */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatMinutes } from "../app/useMockList";
import { mockFetch, myTimesheets, type TimesheetMock } from "../mock/data";
import { Banner, EmptyState, ErrorState, SkeletonRows, TimesheetStatusPill } from "../components/ui";

export function MyTimesheetsPage() {
  const { t, locale } = useApp();
  const list = useMockList(() => mockFetch(myTimesheets), []);
  usePageTitle(t("myTimesheetsTitle"));

  return (
    <>
      <h1>{t("myTimesheetsTitle")}</h1>
      {list.phase === "loading" && <SkeletonRows rows={3} />}
      {list.phase === "error" && <ErrorState onRetry={list.retry} />}
      {list.phase === "empty" && <EmptyState message={t("noTimesheets")} />}
      {list.phase === "ready" &&
        (myTimesheets.length === 0 ? (
          <EmptyState message={t("noTimesheets")} />
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {myTimesheets.map((ts) => (
              <li key={ts.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <Link to={`/timesheets/${ts.id}`}>
                    <strong>
                      {t("week")}: {ts.week_start}
                    </strong>
                  </Link>
                  <TimesheetStatusPill status={ts.status} />
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {t("totalHours")}:{" "}
                  {formatMinutes(ts.entries.reduce((s, e) => s + e.duration_minutes, 0), locale)}
                </div>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

function weekDates(weekStart: string): string[] {
  const out: string[] = [];
  const d = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function TimesheetDetailPage() {
  const { id } = useParams();
  const { t } = useApp();
  const state = useMockList(() => mockFetch(myTimesheets.find((ts) => ts.id === id) ?? null, 250), [id]);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  if (state.phase === "loading") return <SkeletonRows rows={3} />;
  if (state.phase === "error") return <ErrorState onRetry={state.retry} />;
  const sheet = state.phase === "ready" ? state.data : null;

  if (!sheet) {
    return (
      <>
        <h1>{t("myTimesheetsTitle")}</h1>
        <Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner>
        <Link to="/timesheets">{t("back")}</Link>
      </>
    );
  }

  return <TimesheetEditor sheet={sheet} savedMsg={savedMsg} setSavedMsg={setSavedMsg} />;
}

function TimesheetEditor({
  sheet,
  savedMsg,
  setSavedMsg,
}: {
  sheet: TimesheetMock;
  savedMsg: string | null;
  setSavedMsg: (v: string | null) => void;
}) {
  const { t, locale } = useApp();
  const readOnly = sheet.status !== "DRAFT" && sheet.status !== "RETURNED";
  const days = useMemo(() => weekDates(sheet.week_start), [sheet.week_start]);

  const [entries, setEntries] = useState(() =>
    days.map((d) => {
      const found = sheet.entries.find((e) => e.work_date === d);
      return {
        work_date: d,
        duration_minutes: found?.duration_minutes ?? 0,
        unpaid_break_minutes: found?.unpaid_break_minutes ?? 0,
        description: found?.description ?? "",
      };
    }),
  );

  const totalWorked = entries.reduce((s, e) => s + Number(e.duration_minutes || 0), 0);
  const totalBreak = entries.reduce((s, e) => s + Number(e.unpaid_break_minutes || 0), 0);

  const update = (date: string, patch: Partial<(typeof entries)[number]>) => {
    setEntries((prev) => prev.map((e) => (e.work_date === date ? { ...e, ...patch } : e)));
    setSavedMsg(null);
  };

  const submitWeek = () => {
    // Demo only: simulates submit acknowledgement; server validation governs in the real system.
    setSavedMsg(t("weekSubmitted"));
  };

  return (
    <>
      <nav aria-label={t("back")}>
        <Link to="/timesheets">← {t("myTimesheetsTitle")}</Link>
      </nav>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
        <h1 style={{ margin: 0 }}>
          {t("week")}: {sheet.week_start}
        </h1>
        <TimesheetStatusPill status={sheet.status} />
      </header>

      {readOnly && (
        <Banner tone="info">
          {t("readonlyTimesheet")} ({locale === "ar" ? "عرض للقراءة فقط" : "read-only view"})
        </Banner>
      )}

      <div className="table-wrap">
        <table>
          <caption style={{ textAlign: "start", padding: "8px 0" }}>
            {locale === "ar"
              ? "المدة بالدقائق؛ الإجماليات تُحدَّث للعرض فقط والتحقق النهائي من الخادم."
              : "Durations in minutes; totals recalculate for feedback only — server validation governs."}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("workDate")}</th>
              <th scope="col">{t("duration")} ({locale === "ar" ? "دقيقة" : "minutes"})</th>
              <th scope="col">{t("breakTime")} ({locale === "ar" ? "دقيقة" : "minutes"})</th>
              <th scope="col">{t("description")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.work_date}>
                <th scope="row" style={{ fontWeight: 400 }}>
                  <bdi dir="ltr">{e.work_date}</bdi>
                </th>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={1440}
                    dir="ltr"
                    value={e.duration_minutes}
                    disabled={readOnly}
                    aria-label={`${t("duration")} ${e.work_date}`}
                    onChange={(ev) => update(e.work_date, { duration_minutes: Number(ev.target.value) })}
                    style={{ width: 110 }}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={1440}
                    dir="ltr"
                    value={e.unpaid_break_minutes}
                    disabled={readOnly}
                    aria-label={`${t("breakTime")} ${e.work_date}`}
                    onChange={(ev) => update(e.work_date, { unpaid_break_minutes: Number(ev.target.value) })}
                    style={{ width: 110 }}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    value={e.description}
                    disabled={readOnly}
                    aria-label={`${t("description")} ${e.work_date}`}
                    onChange={(ev) => update(e.work_date, { description: ev.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t("totalHours")}</th>
              <td colSpan={3}>
                <strong>{formatMinutes(totalWorked, locale)}</strong>
                <span style={{ color: "var(--text-muted)" }}>
                  {" "}
                  · {t("breakTime")}: {formatMinutes(totalBreak, locale)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {savedMsg && <Banner tone="success">{savedMsg}</Banner>}

      {!readOnly && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => setSavedMsg(t("draftSaved"))}>
            {t("save")}
          </button>
          <button className="btn btn-primary" onClick={submitWeek}>
            {t("submitWeek")}
          </button>
        </div>
      )}
    </>
  );
}
