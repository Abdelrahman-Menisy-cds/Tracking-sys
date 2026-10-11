import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { ApiError } from "../../app/api";
import {
  createDepartment,
  createEmployee,
  listDepartments,
  listEmployees,
  updateDepartment,
  type ServerDepartment,
  type ServerEmployee,
} from "../../app/orgApi";
import { Banner, Dialog, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";

/**
 * Departments and the people inside them — Story H16, the HR surface.
 *
 * This panel is the one place HR asked for: add a department, name the manager
 * who owns it, and add an employee or a manager INSIDE a department. It talks to
 * the real `/departments` and `/employees` endpoints, so what HR types here is
 * what the rest of the system enforces — unlike the roster tables on the other
 * admin screens, which still render demo fixtures.
 *
 * The owner's rule is enforced twice on purpose: the backend refuses a manager
 * from another department, and the "reports to" picker here only ever offers
 * members of the department that is selected, so the mistake is hard to make and
 * impossible to keep.
 */

type FieldIssue = { field: string; message: string } | null;

/** The server's own per-field refusal, already localised by the backend. */
function firstFieldIssue(failure: unknown): FieldIssue {
  if (!(failure instanceof ApiError) || !failure.fields) return null;
  for (const [field, messages] of Object.entries(failure.fields)) {
    const list = (messages ?? []).filter(Boolean);
    if (list.length > 0) return { field, message: list.join(" · ") };
  }
  return null;
}

function describeFailure(failure: unknown, fallback: string): string {
  if (failure instanceof ApiError) {
    const issue = firstFieldIssue(failure);
    if (issue) return `${issue.field}: ${issue.message}`;
    if (failure.message) return failure.message;
  }
  return fallback;
}

export default function OrgDepartmentsPanel() {
  const { t, locale } = useApp();
  const [departments, setDepartments] = useState<ServerDepartment[] | null>(null);
  const [employees, setEmployees] = useState<ServerEmployee[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [departmentDraft, setDepartmentDraft] = useState({ code: "", name_ar: "", name_en: "" });
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [employeeDraft, setEmployeeDraft] = useState({
    full_name: "",
    email: "",
    role: "EMPLOYEE" as "EMPLOYEE" | "MANAGER",
    department: "" as string,
    manager: "" as string,
    job_title: "",
    employee_number: "",
  });
  const [employeeIssue, setEmployeeIssue] = useState<FieldIssue>(null);

  const reload = useCallback(async () => {
    const [nextDepartments, nextEmployees] = await Promise.all([
      listDepartments(locale),
      listEmployees(locale),
    ]);
    setDepartments(nextDepartments);
    setEmployees(nextEmployees);
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

  const managers = useMemo(() => employees.filter((person) => person.role === "MANAGER"), [employees]);
  const membersOf = useCallback(
    (departmentId: number) => employees.filter((person) => person.department_id === departmentId),
    [employees],
  );
  /** The owner's rule, offered up front: only the chosen department's people. */
  const managerChoices = useMemo(() => {
    const departmentId = Number(employeeDraft.department);
    if (!Number.isFinite(departmentId) || departmentId <= 0) return [];
    return membersOf(departmentId).filter((person) => person.id !== Number(employeeDraft.manager));
  }, [employeeDraft.department, employeeDraft.manager, membersOf]);

  const addDepartment = async () => {
    if (!departmentDraft.code.trim() || !departmentDraft.name_ar.trim()) return;
    setSaving(true);
    setNotice(null);
    setProblem(null);
    try {
      await createDepartment(
        {
          code: departmentDraft.code.trim(),
          name_ar: departmentDraft.name_ar.trim(),
          name_en: departmentDraft.name_en.trim(),
        },
        locale,
      );
      setDepartmentDraft({ code: "", name_ar: "", name_en: "" });
      await reload();
      setNotice(t("adminOrgCreated"));
    } catch (failure) {
      setProblem(describeFailure(failure, t("errorNetwork")));
    } finally {
      setSaving(false);
    }
  };

  const assignManager = async (department: ServerDepartment, managerId: string) => {
    setNotice(null);
    setProblem(null);
    try {
      await updateDepartment(
        department.id,
        { manager: managerId ? Number(managerId) : null },
        locale,
      );
      await reload();
    } catch (failure) {
      setProblem(describeFailure(failure, t("errorNetwork")));
    }
  };

  const addEmployee = async () => {
    setEmployeeIssue(null);
    setProblem(null);
    setSaving(true);
    try {
      await createEmployee(
        {
          email: employeeDraft.email.trim(),
          full_name: employeeDraft.full_name.trim(),
          role: employeeDraft.role,
          department: employeeDraft.department ? Number(employeeDraft.department) : null,
          manager: employeeDraft.manager ? Number(employeeDraft.manager) : null,
          job_title: employeeDraft.job_title.trim(),
          employee_number: employeeDraft.employee_number.trim() || undefined,
        },
        locale,
      );
      setEmployeeOpen(false);
      setEmployeeDraft({
        full_name: "",
        email: "",
        role: "EMPLOYEE",
        department: "",
        manager: "",
        job_title: "",
        employee_number: "",
      });
      await reload();
      setNotice(t("adminOrgCreated"));
    } catch (failure) {
      const issue = firstFieldIssue(failure);
      if (issue) setEmployeeIssue(issue);
      else setProblem(describeFailure(failure, t("errorNetwork")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel" aria-label={t("adminOrgTitle")}>
      <header className="panel-head">
        <div>
          <h2 className="panel-title">{t("adminOrgTitle")}</h2>
          <p className="panel-subtitle">{t("adminOrgSubtitle")}</p>
        </div>
        <div className="panel-actions">
          <button className="btn btn-secondary" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t("retry")}
          </button>
          <button className="btn btn-primary" type="button" onClick={() => setEmployeeOpen(true)}>
            {t("adminOrgAddEmployee")}
          </button>
        </div>
      </header>

      {notice && <Banner tone="success">{notice}</Banner>}
      {problem && <Banner tone="error">{problem}</Banner>}

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t("adminOrgCode")}</span>
          <input
            className="input"
            dir="ltr"
            value={departmentDraft.code}
            onChange={(event) => setDepartmentDraft({ ...departmentDraft, code: event.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("adminOrgNameAr")}</span>
          <input
            className="input"
            value={departmentDraft.name_ar}
            onChange={(event) => setDepartmentDraft({ ...departmentDraft, name_ar: event.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("adminOrgNameEn")}</span>
          <input
            className="input"
            dir="ltr"
            value={departmentDraft.name_en}
            onChange={(event) => setDepartmentDraft({ ...departmentDraft, name_en: event.target.value })}
          />
        </label>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={saving || !departmentDraft.code.trim() || !departmentDraft.name_ar.trim()}
          onClick={addDepartment}
        >
          {saving ? t("adminOrgPending") : t("adminOrgAddDepartment")}
        </button>
      </div>

      {phase === "loading" && <SkeletonRows rows={3} />}
      {phase === "error" && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
      {phase === "ready" && departments && departments.length === 0 && (
        <EmptyState message={t("adminOrgNoDepartments")} />
      )}

      {phase === "ready" &&
        departments?.map((department) => (
          <article className="panel" key={department.id}>
            <header className="panel-head">
              <h3 className="panel-title">
                {locale === "ar" ? department.name_ar : department.name_en || department.name_ar}
                <span dir="ltr"> ({department.code})</span>
              </h3>
              <StatusPill
                tone={department.is_active ? "success" : "neutral"}
                label={`${t("adminOrgMemberCount")}: ${department.member_count}`}
              />
            </header>

            <label className="field">
              <span className="field-label">{t("adminOrgManager")}</span>
              <select
                className="input"
                value={department.manager_id ?? ""}
                onChange={(event) => assignManager(department, event.target.value)}
              >
                <option value="">{t("adminOrgNoManager")}</option>
                {managers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name || person.email}
                  </option>
                ))}
              </select>
            </label>

            <ul className="request-list">
              {membersOf(department.id).map((person) => (
                <li key={person.id} className="request-row">
                  <span>{person.full_name || person.email}</span>
                  <StatusPill
                    tone="info"
                    label={person.role === "MANAGER" ? t("adminOrgRoleManager") : t("adminOrgRoleEmployee")}
                  />
                  <span className="text-muted">
                    {person.manager_name ?? t("adminOrgNoManagerOfEmployee")}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}

      {employeeOpen && (
        <Dialog
          title={t("adminOrgAddEmployee")}
          description={t("adminOrgSubtitle")}
          busy={saving}
          onClose={() => setEmployeeOpen(false)}
        >
          {employeeIssue && <Banner tone="error">{`${employeeIssue.field}: ${employeeIssue.message}`}</Banner>}
          <label className="field">
            <span className="field-label">{t("adminOrgFullName")}</span>
            <input
              className="input"
              value={employeeDraft.full_name}
              aria-invalid={employeeIssue?.field === "full_name" ? "true" : undefined}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, full_name: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t("signupEmailLabel")}</span>
            <input
              className="input"
              dir="ltr"
              type="email"
              value={employeeDraft.email}
              aria-invalid={employeeIssue?.field === "email" ? "true" : undefined}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, email: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t("adminOrgRole")}</span>
            <select
              className="input"
              value={employeeDraft.role}
              onChange={(event) =>
                setEmployeeDraft({ ...employeeDraft, role: event.target.value as "EMPLOYEE" | "MANAGER" })
              }
            >
              <option value="EMPLOYEE">{t("adminOrgRoleEmployee")}</option>
              <option value="MANAGER">{t("adminOrgRoleManager")}</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t("adminOrgDepartment")}</span>
            <select
              className="input"
              value={employeeDraft.department}
              aria-invalid={employeeIssue?.field === "department" ? "true" : undefined}
              onChange={(event) =>
                setEmployeeDraft({ ...employeeDraft, department: event.target.value, manager: "" })
              }
            >
              <option value="">{t("adminOrgNoManager")}</option>
              {departments?.map((department) => (
                <option key={department.id} value={department.id}>
                  {locale === "ar" ? department.name_ar : department.name_en || department.name_ar}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t("adminOrgManagerOfEmployee")}</span>
            <select
              className="input"
              value={employeeDraft.manager}
              aria-invalid={employeeIssue?.field === "manager" ? "true" : undefined}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, manager: event.target.value })}
            >
              <option value="">{t("adminOrgNoManagerOfEmployee")}</option>
              {managerChoices.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name || person.email}
                </option>
              ))}
            </select>
            {!employeeDraft.department && <span className="field-hint">{t("adminOrgSubtitle")}</span>}
          </label>
          <label className="field">
            <span className="field-label">{t("adminOrgJobTitle")}</span>
            <input
              className="input"
              value={employeeDraft.job_title}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, job_title: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t("adminOrgEmployeeNumber")}</span>
            <input
              className="input"
              dir="ltr"
              value={employeeDraft.employee_number}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, employee_number: event.target.value })}
            />
          </label>

          <div className="dialog-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setEmployeeOpen(false)}>
              {t("adminOrgCancel")}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={saving || !employeeDraft.email.trim()}
              onClick={addEmployee}
            >
              {saving ? t("adminOrgPending") : t("adminOrgSave")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
