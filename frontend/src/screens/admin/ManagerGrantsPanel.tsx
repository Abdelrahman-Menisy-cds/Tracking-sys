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
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";

/**
 * HR-managed extra access for ONE employee — Story H16.
 *
 * The rule this panel exists for: a manager never sees someone outside their own
 * department unless HR says so, in writing, for that one person. The backend
 * enforces it; this is the only screen that can widen it.
 *
 * The employee file on this screen is still fed by the demo directory, whose
 * emails do not exist on the server — so when the email does not resolve we say
 * so and let HR pick the real account instead of pretending to know.
 */

const SCOPES = ["requests", "timesheets", "attendance", "reports"] as const;

const scopeKey = {
  requests: "adminGrantsScopeRequests",
  timesheets: "adminGrantsScopeTimesheets",
  attendance: "adminGrantsScopeAttendance",
  reports: "adminGrantsScopeReports",
} as const;

export default function ManagerGrantsPanel({ employeeEmail }: { employeeEmail?: string | null }) {
  const { t, locale } = useApp();
  const [employees, setEmployees] = useState<ServerEmployee[] | null>(null);
  const [grants, setGrants] = useState<ServerGrant[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [pickedId, setPickedId] = useState<string>("");
  const [draft, setDraft] = useState({ manager: "", scope: "requests" as (typeof SCOPES)[number], reason: "" });
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

  const managers = useMemo(() => (employees ?? []).filter((person) => person.role === "MANAGER"), [employees]);

  const mine = useMemo(
    () => grants.filter((grant) => grant.employee_id === person?.id),
    [grants, person],
  );
  const live = mine.filter((grant) => grant.is_active);
  const revoked = mine.filter((grant) => !grant.is_active);

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
      setDraft({ manager: "", scope: "requests", reason: "" });
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
    <section className="panel" aria-label={t("adminGrantsTitle")}>
      <header className="panel-head">
        <div>
          <h2 className="panel-title">{t("adminGrantsTitle")}</h2>
          <p className="panel-subtitle">{t("adminGrantsSubtitle")}</p>
        </div>
      </header>

      {notice && <Banner tone="success">{notice}</Banner>}
      {problem && <Banner tone="error">{problem}</Banner>}
      {phase === "loading" && <SkeletonRows rows={2} />}
      {phase === "error" && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {phase === "ready" && !resolved && (
        <>
          <Banner tone="info">{t("adminGrantsNoRealAccount")}</Banner>
          <label className="field">
            <span className="field-label">{t("adminOrgAddEmployee")}</span>
            <select className="input" value={pickedId} onChange={(event) => setPickedId(event.target.value)}>
              <option value="">—</option>
              {(employees ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name || person.email}
                  {person.department_name_ar ? ` — ${person.department_name_ar}` : ""}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {phase === "ready" && person && (
        <>
          <label className="field">
            <span className="field-label">{t("adminGrantsManager")}</span>
            <select
              className="input"
              value={draft.manager}
              onChange={(event) => setDraft({ ...draft, manager: event.target.value })}
            >
              <option value="">—</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.full_name || manager.email}
                  {manager.department_name_ar ? ` — ${manager.department_name_ar}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t("adminGrantsScope")}</span>
            <select
              className="input"
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
          <label className="field">
            <span className="field-label">{t("adminGrantsReason")}</span>
            <input
              className="input"
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
            />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving || !draft.manager}
            onClick={addGrant}
          >
            {saving ? t("adminOrgPending") : t("adminGrantsAdd")}
          </button>

          {live.length === 0 && revoked.length === 0 ? (
            <EmptyState message={t("adminGrantsNone")} />
          ) : (
            <ul className="request-list">
              {[...live, ...revoked].map((grant) => (
                <li key={grant.id} className="request-row">
                  <span>{grant.manager_name}</span>
                  <StatusPill tone={grant.is_active ? "success" : "neutral"} label={grant.is_active ? t("adminGrantsActive") : t("adminGrantsInactive")} />
                  <span className="text-muted">{t(scopeKey[grant.scope as (typeof SCOPES)[number]] ?? "adminGrantsScopeRequests")}</span>
                  {grant.is_active && (
                    <button className="btn btn-secondary" type="button" onClick={() => dropGrant(grant)}>
                      {t("adminGrantsRevoke")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
