import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { ApiError } from "../../app/api";
import {
  createGrant,
  listEmployees,
  listGrants,
  revokeGrant,
  type ServerEmployee,
  type ServerGrant,
} from "../../app/orgApi";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";

/**
 * HR-managed extra access for ONE employee - Story H16.
 *
 * The rule this panel exists for: a manager never sees someone outside their own
 * department unless HR says so, in writing, for that one person. The backend
 * enforces it; this is the only screen that can widen it.
 *
 * The employee file on this screen is still fed by the demo directory, whose
 * emails do not exist on the server - so when the email does not resolve we say
 * so and let HR pick the real account instead of pretending to know.
 *
 * House primitives only: `.section`/`.section-heading`, `.work-surface`,
 * `.form-grid`, `.field`/`.select`, and `OperationalTable` for the history.
 */

const SCOPES = ["requests", "timesheets", "attendance", "reports"] as const;

const scopeKey = {
  requests: "adminGrantsScopeRequests",
  timesheets: "adminGrantsScopeTimesheets",
  attendance: "adminGrantsScopeAttendance",
  reports: "adminGrantsScopeReports",
} as const;

type GrantRow = {
  id: string;
  manager: string;
  scope: string;
  active: boolean;
  grant: ServerGrant;
};

export default function ManagerGrantsPanel({ employeeEmail }: { employeeEmail?: string | null }) {
  const { t, locale } = useApp();
  const [employees, setEmployees] = useState<ServerEmployee[] | null>(null);
  const [grants, setGrants] = useState<ServerGrant[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [pickedId, setPickedId] = useState<string>("");
  const [draft, setDraft] = useState({ manager: "", scope: "requests" as (typeof SCOPES)[number] });
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const [nextEmployees, nextGrants] = await Promise.all([listEmployees(locale), listGrants(locale)]);
    setEmployees(nextEmployees);
    setGrants(nextGrants);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    reload()
      .then(() => {
        if (!cancelled) setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reload, attempt]);

  /** The real account behind the demo file's email, when there is one. */
  const resolved = useMemo(() => {
    if (!employees || !employeeEmail) return null;
    const wanted = employeeEmail.trim().toLowerCase();
    return employees.find((person) => person.email.toLowerCase() === wanted) ?? null;
  }, [employees, employeeEmail]);

  const person = useMemo(() => {
    if (resolved) return resolved;
    const id = Number(pickedId);
    return employees?.find((candidate) => candidate.id === id) ?? null;
  }, [resolved, pickedId, employees]);

  const managers = useMemo(() => (employees ?? []).filter((entry) => entry.role === "MANAGER"), [employees]);

  const mine = useMemo(() => grants.filter((grant) => grant.employee_id === person?.id), [grants, person]);

  const rows: GrantRow[] = mine.map((grant) => ({
    id: String(grant.id),
    manager: grant.manager_name,
    scope: t(scopeKey[grant.scope as (typeof SCOPES)[number]] ?? "adminGrantsScopeRequests"),
    active: grant.is_active,
    grant,
  }));

  const columns: OperationalColumn<GrantRow>[] = [
    { key: "manager", label: t("adminGrantsManager"), render: (row) => <span>{row.manager}</span> },
    { key: "scope", label: t("adminGrantsScope"), render: (row) => <span className="page-meta">{row.scope}</span> },
    {
      key: "state",
      label: t("adminGrantsActive"),
      render: (row) => (
        <StatusPill
          tone={row.active ? "success" : "neutral"}
          label={row.active ? t("adminGrantsActive") : t("adminGrantsInactive")}
          icon={row.active ? "approved" : "cancelled"}
        />
      ),
    },
    {
      key: "action",
      label: t("adminGrantsRevoke"),
      render: (row) =>
        row.active ? (
          <button
            className="btn btn-danger-quiet btn-compact"
            type="button"
            onClick={() => dropGrant(row.grant)}
          >
            {t("adminGrantsRevoke")}
          </button>
        ) : (
          <span className="page-meta">-</span>
        ),
    },
  ];

  const addGrant = async () => {
    if (!person) return;
    if (!draft.manager) {
      setProblem(t("adminGrantsManagerRequired"));
      return;
    }
    setSaving(true);
    setNotice(null);
    setProblem(null);
    try {
      await createGrant({ manager: Number(draft.manager), employee: person.id, scope: draft.scope }, locale);
      setDraft({ manager: "", scope: "requests" });
      await reload();
      setNotice(t("adminGrantsSaved"));
    } catch (failure) {
      setProblem(failure instanceof ApiError && failure.message ? failure.message : t("errorNetwork"));
    } finally {
      setSaving(false);
    }
  };

  const dropGrant = async (grant: ServerGrant) => {
    setNotice(null);
    setProblem(null);
    try {
      await revokeGrant(grant.id, locale);
      await reload();
      setNotice(t("adminGrantsRevoked"));
    } catch (failure) {
      setProblem(failure instanceof ApiError && failure.message ? failure.message : t("errorNetwork"));
    }
  };

  return (
    <section className="section" aria-labelledby="hr-grants-heading">
      <div className="section-heading">
        <h2 id="hr-grants-heading">{t("adminGrantsTitle")}</h2>
      </div>
      <p className="page-meta">{t("adminGrantsSubtitle")}</p>

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {problem ? <Banner tone="error" role="alert">{problem}</Banner> : null}
      {phase === "loading" ? <SkeletonRows rows={2} /> : null}
      {phase === "error" ? <ErrorState onRetry={() => setAttempt((n) => n + 1)} /> : null}

      {phase === "ready" && !resolved ? (
        <div className="work-surface" style={{ marginBlockStart: "var(--sp-4)" }}>
          <Banner tone="info">{t("adminGrantsNoRealAccount")}</Banner>
          <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
            <span className="field-label">{t("adminGrantsPickEmployee")}</span>
            {/* ds-allow-native-select: dynamic-option picker; listbox rewrite is deferred */}
            <select className="select" value={pickedId} onChange={(event) => setPickedId(event.target.value)}>
              <option value="">{t("adminGrantsChoose")}</option>
              {(employees ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.full_name || entry.email}
                  {entry.department_name_ar ? ` - ${entry.department_name_ar}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {phase === "ready" && person ? (
        <>
          <div className="work-surface" style={{ marginBlockStart: "var(--sp-4)" }}>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
                <span className="field-label">{t("adminGrantsManager")}</span>
                {/* ds-allow-native-select: dynamic-option picker; listbox rewrite is deferred */}
                <select
                  className="select"
                  value={draft.manager}
                  onChange={(event) => setDraft({ ...draft, manager: event.target.value })}
                >
                  <option value="">{t("adminGrantsChoose")}</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.full_name || manager.email}
                      {manager.department_name_ar ? ` - ${manager.department_name_ar}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
                <span className="field-label">{t("adminGrantsScope")}</span>
                {/* ds-allow-native-select: dynamic-option picker; listbox rewrite is deferred */}
                <select
                  className="select"
                  value={draft.scope}
                  onChange={(event) =>
                    setDraft({ ...draft, scope: event.target.value as (typeof SCOPES)[number] })
                  }
                >
                  {SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {t(scopeKey[scope])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="button" disabled={saving} onClick={addGrant}>
                {saving ? t("adminOrgPending") : t("adminGrantsAdd")}
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState message={t("adminGrantsNone")} />
          ) : (
            <div style={{ marginBlockStart: "var(--sp-4)" }}>
              <OperationalTable caption={t("adminGrantsTitle")} columns={columns} records={rows} />
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
