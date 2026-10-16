import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { useServerData } from "../../app/useServerData";
import { listEmployees } from "../../app/orgApi";
import type { ServerEmployee } from "../../app/orgApi";
import { EmptyState, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";
import OrgDepartmentsPanel from "./OrgDepartmentsPanel";
export { default as AdminPeopleDetailPage } from "./AdminPeopleDetailPage";

/**
 * Per-employee roster - spec §2.1, list-first: search + OperationalTable.
 * DATA SOURCE: the SERVER roster (`GET /employees`). The backend scopes the
 * read to the caller's company, so the client neither filters by company nor
 * sends any company id. What the old mock layered on top has NO server
 * endpoint (schedule exceptions, per-employee leave slots), so those columns
 * are gone, honestly - not faked with fixture rows.
 */
type RowRecord = Omit<ServerEmployee, "id"> & { id: string };

export default function AdminPeoplePage() {
  const { t, locale, capabilities } = useApp();
  usePageTitle(t("adminPeopleTitle"));

  const [search, setSearch] = useState("");
  const roster = useServerData(() => listEmployees(locale), [locale]);

  /* Server order is authoritative; no client re-sort. */
  const rosterData = roster.phase === "ready" ? roster.data : null;
  const rows = useMemo<RowRecord[]>(
    () => (rosterData ? rosterData.map((entry) => ({ ...entry, id: String(entry.id) })) : []),
    [rosterData],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return !needle
      ? rows
      : rows.filter((row) =>
          `${row.full_name} ${row.employee_number ?? ""} ${row.email}`.toLowerCase().includes(needle),
        );
  }, [rows, search]);

  const columns: OperationalColumn<RowRecord>[] = [
    {
      key: "employee",
      label: t("employee"),
      render: (row) => (
        <span>
          <bdi><Link to={`/admin/people/${row.id}`}>{row.full_name}</Link></bdi>{" "}
          <span className="page-meta"><bdi dir="ltr">({row.employee_number ?? "-"})</bdi></span>
          {!row.is_active ? (
            <StatusPill tone="danger" label={locale === "ar" ? "غير نشط" : "Inactive"} />
          ) : null}
        </span>
      ),
    },
    { key: "department", label: locale === "ar" ? "الإدارة" : "Department", render: (row) => locale === "ar" ? (row.department_name_ar ?? "-") : (row.department_name_en ?? row.department_name_ar ?? "-") },
    { key: "job-title", label: locale === "ar" ? "المسمى الوظيفي" : "Job title", render: (row) => row.job_title || "-" },
    {
      key: "role",
      label: t("role"),
      render: (row) => (
        <StatusPill
          tone="neutral"
          label={row.role === "HR" ? t("roleHr") : row.role === "MANAGER" ? t("roleManager") : t("roleEmployee")}
        />
      ),
    },
    {
      key: "manager",
      label: t("adminPeopleFactManager"),
      render: (row) => row.manager_name ?? <span className="page-meta">-</span>,
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

      {/* Departments and their people live on the employees page, not on the
          organisation settings page: this is where an HR admin comes to manage
          people, so the management surface has to be here. */}
      <OrgDepartmentsPanel />

      <section className="section" aria-labelledby="people-roster">
        <div className="section-heading">
          <h2 id="people-roster">{t("adminPeopleTitle")}</h2>
          <span className="page-meta">{new Intl.NumberFormat(locale).format(filtered.length)}</span>
        </div>

        <div className="filter-panel">
          <div className="filter-toolbar">
            <label className="field">
              <span className="field-label">{t("employee")}</span>
              <input
                className="input"
                type="search"
                aria-label={t("adminPeopleSearch")}
                placeholder={t("adminPeopleSearch")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          {search.trim() ? <div className="applied-filters tasks-filter-chips" aria-label={t("taskFiltersApplied")}><span className="filter-chip">{t("employee")}: {search.trim()}<button type="button" className="tasks-chip-remove" aria-label={t("taskFilterRemove").replace("%s", t("employee"))} onClick={() => setSearch("")}>×</button></span><button type="button" className="btn btn-secondary" onClick={() => setSearch("")}>{t("taskFiltersClearAll")}</button></div> : null}
          <p className="page-meta tasks-result-count" role="status">{t("taskFiltersShowing").replace("%s", String(filtered.length)).replace("%s", String(rows.length))}</p>
        </div>

        {roster.phase === "loading" ? (
          <SkeletonRows rows={8} />
        ) : roster.phase === "error" ? (
          <ErrorState onRetry={roster.retry} />
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
            caption={`${t("adminPeopleTitle")} - ${new Intl.NumberFormat(locale).format(filtered.length)}`}
            columns={columns}
            records={filtered}
          />
        )}
      </section>
    </div>
  );
}
