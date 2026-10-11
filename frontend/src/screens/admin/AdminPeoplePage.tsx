import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { cairoDayIso } from "../../app/useMockList";
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";
export { default as AdminPeopleDetailPage } from "./AdminPeopleDetailPage";

/**
 * Per-employee roster — spec §2.1. List-first: search + OperationalTable.
 * The exception flag is DERIVED from effective schedule resolution (an
 * EMPLOYEE-scope row in force today that differs from the org default),
 * never from a stored flag column.
 */
import type { LeaveBalance } from "../../mock/attendance";
import type { EmployeeDirectoryEntry } from "../../mock/data";
import { leaveTypeKeys } from "./AdjustLeaveDialog";
import type { Dict } from "../../i18n/dict";

type DictKey = keyof Dict;

/**
 * Per-employee area — spec §2.1 roster. List-first: search + OperationalTable.
 * The exception flag is DERIVED: an employee carries the plan when they have
 * an EMPLOYEE-scope schedule row in force today that differs from the resolved
 * org default — never from a stored flag column (§2.1).
 */

const cairoDateLocal = (date: Date) => cairoDayIso(date);

type RowRecord = EmployeeDirectoryEntry & { exception: boolean; balances: LeaveBalance[] };

export default function AdminPeoplePage() {
  const { t, locale, capabilities, employeeDirectory, schedules, resolveScheduleFor, directoryLeaveBalances } = useApp();
  usePageTitle(t("adminPeopleTitle"));

  const searchAria = t("adminPeopleSearch");
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setPhase("ready"), 350);
    return () => window.clearTimeout(timer);
  }, [phase, attempt]);

  const rows: RowRecord[] = useMemo(() => {
    const today = cairoDateLocal(new Date());
    return employeeDirectory.map((entry) => {
      const ownException = schedules.some(
        (schedule) =>
          schedule.scope === "EMPLOYEE" && schedule.target === entry.id
          && schedule.effective_from <= today && (!schedule.effective_to || today <= schedule.effective_to),
      );
      const orgForToday = resolveScheduleFor(entry.id, today);
      // Derived flag: the schedule actually in force for the employee differs
      // from the ORGANIZATION default that would otherwise apply (§2.1).
      const exception = ownException && orgForToday !== null && (
        JSON.stringify(orgForToday.working_weekdays) !== JSON.stringify(schedules.find((s) => s.scope === "ORGANIZATION")?.working_weekdays ?? [])
        || orgForToday.expected_start !== (schedules.find((s) => s.scope === "ORGANIZATION")?.expected_start ?? "")
      );
      return {
        ...entry,
        exception,
        balances: directoryLeaveBalances.filter((balance) => balance.employee === entry.id),
      };
    });
  }, [employeeDirectory, schedules, resolveScheduleFor, directoryLeaveBalances]);

  const sorted = useMemo(
    () => [...rows].sort((l, r) => Number(r.exception) - Number(l.exception) || l.name[locale].localeCompare(r.name[locale])),
    [rows, locale],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return !needle
      ? sorted
      : sorted.filter((row) =>
          `${row.name[locale]} ${row.employee_number}`.toLowerCase().includes(needle),
        );
  }, [sorted, search, locale]);

  const columns: OperationalColumn<RowRecord>[] = [
    {
      key: "employee",
      label: t("employee"),
      // §2.1: the exception pill is the second visual after the name.
      render: (row) => (
        <span>
          <bdi><Link to={`/admin/people/${row.id}`}>{row.name[locale]}</Link></bdi>{" "}
          <span className="page-meta"><bdi dir="ltr">({row.employee_number})</bdi></span>
          {row.exception ? (
            <>
              {" "}
              <StatusPill tone="warning" label={t("adminPeopleExceptionPill")} />
            </>
          ) : null}
        </span>
      ),
    },
    { key: "department", label: locale === "ar" ? "الإدارة" : "Department", render: (row) => row.department[locale] },
    { key: "job-title", label: locale === "ar" ? "المسمى الوظيفي" : "Job title", render: (row) => row.job_title[locale] },
    {
      key: "employment-type",
      label: t("hrEmploymentType"),
      render: (row) => <StatusPill tone="neutral" label={t(employmentTypeKey(row.employment_type))} />,
    },
    {
      key: "exception",
      label: t("adminPeopleExceptionAria"),
      render: (row) => (row.exception ? <StatusPill tone="warning" label={t("adminPeopleExceptionPill")} /> : <span className="page-meta">—</span>),
    },
    {
      key: "leave-slots",
      label: t("adminPeopleLeaveSlots"),
      render: (row) =>
        row.balances.length ? (
          <span className="row-actions">
            {row.balances.map((balance) => (
              <span key={balance.leave_type} className="page-meta">
                {t(leaveTypeKeys[balance.leave_type])}: {new Intl.NumberFormat(locale).format(balance.entitlement_days - balance.used_days - balance.pending_days)}
              </span>
            ))}
          </span>
        ) : (
          <span className="page-meta">—</span>
        ),
    },
    {
      key: "actions",
      label: t("attendanceActionLabel"),
      render: (row) => (
        <Link className="btn btn-ghost btn-compact" to={`/admin/people/${row.id}`}>
          {t("adminPeopleOpenFile")}
        </Link>
      ),
    },
  ];

  if (!capabilities.canManageDirectory) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <AdminNav />
      <PageHeader title={t("adminPeopleTitle")} subtitle={t("adminPeopleSubtitle")} />
      <Banner tone="info">{t("adminDemoBoundary")}</Banner>

      <section className="work-surface section" aria-labelledby="people-roster">
        <div className="section-heading">
          <h2 id="people-roster">{t("adminPeopleTitle")}</h2>
          <span className="page-meta">{new Intl.NumberFormat(locale).format(filtered.length)}</span>
        </div>

        <div className="filter-toolbar">
          <label className="field">
            <span className="field-label">{t("employee")}</span>
            <input
              className="input"
              type="search"
              aria-label={searchAria}
              placeholder={t("adminPeopleSearch")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {phase === "loading" ? (
          <SkeletonRows rows={8} />
        ) : phase === "error" ? (
          <ErrorState onRetry={() => { setAttempt((current) => current + 1); setPhase("loading"); }} />
        ) : filtered.length === 0 ? (
          search.trim() ? (
            <EmptyState
              message={t("adminPeopleRosterNoMatch")}
              action={<button type="button" className="btn btn-secondary" onClick={() => setSearch("")}>{t("adminPeopleClearSearch")}</button>}
            />
          ) : (
            <EmptyState message={t("adminPeopleRosterEmpty")} />
          )
        ) : (
          <OperationalTable
            caption={`${t("adminPeopleTitle")} — ${new Intl.NumberFormat(locale).format(filtered.length)}`}
            columns={columns}
            records={filtered}
          />
        )}
      </section>
    </div>
  );
}

const employmentTypeKey = (value: EmployeeDirectoryEntry["employment_type"]): DictKey =>
  ({ FULL: "hrEmploymentTypeFull", PART: "hrEmploymentTypePart", HYBRID: "hrEmploymentTypeHybrid", REMOTE: "hrEmploymentTypeRemote" } as const)[value];
