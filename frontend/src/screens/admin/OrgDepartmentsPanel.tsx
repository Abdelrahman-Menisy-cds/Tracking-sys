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
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import { Banner, Dialog, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";

/**
 * Departments and the people inside them — Story H16, the HR surface.
 *
 * Built from the house primitives only, so it reads like the roster screens it
 * sits next to: `.section` + `.section-heading` for the block, `.work-surface`
 * for each card, `.form-grid` + `.field` + `.select` for the forms, and
 * `OperationalTable` for every list of people.
 *
 * Both create flows are dialogs opened from the section heading — the page
 * itself stays a readable list of departments instead of a form that is always
 * open whether or not anyone is adding something.
 *
 * The owner's rule is enforced twice on purpose: the backend refuses a manager
 * from another department, and the "reports to" picker here only ever offers
 * members of the selected department, so the mistake is hard to make and
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

type MemberRow = { id: string; name: string; role: ServerEmployee["role"]; manager: string };

const EMPTY_DEPARTMENT = { code: "", name_ar: "", name_en: "" };
const EMPTY_EMPLOYEE = {
  full_name: "",
  email: "",
  role: "EMPLOYEE" as "EMPLOYEE" | "MANAGER",
  department: "",
  manager: "",
  job_title: "",
  employee_number: "",
};

export default function OrgDepartmentsPanel() {
  const { t, locale } = useApp();
  const [departments, setDepartments] = useState<ServerDepartment[] | null>(null);
  const [employees, setEmployees] = useState<ServerEmployee[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [departmentOpen, setDepartmentOpen] = useState(false);
  const [departmentDraft, setDepartmentDraft] = useState(EMPTY_DEPARTMENT);
  const [departmentError, setDepartmentError] = useState<string | null>(null);

  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [employeeDraft, setEmployeeDraft] = useState(EMPTY_EMPLOYEE);
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

  const memberColumns: OperationalColumn<MemberRow>[] = [
    { key: "employee", label: t("employee"), render: (row) => <span>{row.name}</span> },
    {
      key: "role",
      label: t("adminOrgRole"),
      render: (row) => (
        <StatusPill
          tone={row.role === "MANAGER" ? "info" : "neutral"}
          label={row.role === "MANAGER" ? t("adminOrgRoleManager") : t("adminOrgRoleEmployee")}
          icon={row.role === "MANAGER" ? "approved" : "draft"}
        />
      ),
    },
    {
      key: "manager",
      label: t("adminOrgManagerOfEmployee"),
      render: (row) => <span className="page-meta">{row.manager}</span>,
    },
  ];

  const openDepartmentDialog = () => {
    setDepartmentError(null);
    setDepartmentDraft(EMPTY_DEPARTMENT);
    setNotice(null);
    setProblem(null);
    setDepartmentOpen(true);
  };

  const openEmployeeDialog = () => {
    setEmployeeIssue(null);
    setEmployeeDraft(EMPTY_EMPLOYEE);
    setNotice(null);
    setProblem(null);
    setEmployeeOpen(true);
  };

  const addDepartment = async () => {
    if (!departmentDraft.code.trim() || !departmentDraft.name_ar.trim()) {
      setDepartmentError(t("adminOrgDepartmentRequired"));
      return;
    }
    setSaving(true);
    setNotice(null);
    setProblem(null);
    setDepartmentError(null);
    try {
      await createDepartment(
        {
          code: departmentDraft.code.trim(),
          name_ar: departmentDraft.name_ar.trim(),
          name_en: departmentDraft.name_en.trim(),
        },
        locale,
      );
      setDepartmentDraft(EMPTY_DEPARTMENT);
      setDepartmentOpen(false);
      await reload();
      setNotice(t("adminOrgCreated"));
    } catch (failure) {
      const issue = firstFieldIssue(failure);
      if (issue) setDepartmentError(`${issue.field}: ${issue.message}`);
      else setProblem(describeFailure(failure, t("errorNetwork")));
    } finally {
      setSaving(false);
    }
  };

  const assignManager = async (department: ServerDepartment, managerId: string) => {
    setNotice(null);
    setProblem(null);
    try {
      await updateDepartment(department.id, { manager: managerId ? Number(managerId) : null }, locale);
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
      setEmployeeDraft(EMPTY_EMPLOYEE);
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

  const employeeErrorFor = (field: string) =>
    employeeIssue?.field === field ? employeeIssue.message : null;

  return (
    <section className="section" aria-labelledby="hr-org-heading">
      <div className="section-heading">
        <h2 id="hr-org-heading">{t("adminOrgTitle")}</h2>
        <div className="row-actions">
          <button className="btn btn-secondary" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t("retry")}
          </button>
          <button className="btn btn-secondary" type="button" onClick={openDepartmentDialog}>
            {t("adminOrgAddDepartment")}
          </button>
          <button className="btn btn-primary" type="button" onClick={openEmployeeDialog}>
            {t("adminOrgAddEmployee")}
          </button>
        </div>
      </div>
      <p className="page-meta">{t("adminOrgSubtitle")}</p>

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {problem ? <Banner tone="error" role="alert">{problem}</Banner> : null}

      {phase === "loading" ? <SkeletonRows rows={3} /> : null}
      {phase === "error" ? <ErrorState onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {phase === "ready" && departments && departments.length === 0 ? (
        <EmptyState message={t("adminOrgNoDepartments")} />
      ) : null}

      {phase === "ready"
        ? departments?.map((department) => {
            const members: MemberRow[] = membersOf(department.id).map((person) => ({
              id: String(person.id),
              name: person.full_name || person.email,
              role: person.role,
              manager: person.manager_name ?? t("adminOrgNoManagerOfEmployee"),
            }));
            return (
              <div className="work-surface" key={department.id} style={{ marginBlockStart: "var(--sp-4)" }}>
                <div className="section-heading">
                  <h3>
                    {locale === "ar" ? department.name_ar : department.name_en || department.name_ar}{" "}
                    <span className="page-meta" dir="ltr">
                      ({department.code})
                    </span>
                  </h3>
                  <StatusPill
                    tone={department.is_active ? "success" : "neutral"}
                    label={`${t("adminOrgMemberCount")}: ${department.member_count}`}
                    icon="approved"
                  />
                </div>

                <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
                  <span className="field-label">{t("adminOrgManager")}</span>
                  <select
                    className="select"
                    value={department.manager_id ?? ""}
                    onChange={(event) => assignManager(department, event.target.value)}
                  >
                    <option value="">{t("adminOrgNoManager")}</option>
                    {managers.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name || person.email}
                        {person.department_name_ar ? ` — ${person.department_name_ar}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                {members.length > 0 ? (
                  <OperationalTable caption={t("adminOrgMembers")} columns={memberColumns} records={members} />
                ) : null}
              </div>
            );
          })
        : null}

      {departmentOpen ? (
        <Dialog
          title={t("adminOrgAddDepartment")}
          description={t("adminOrgAddDepartmentHint")}
          busy={saving}
          onClose={() => setDepartmentOpen(false)}
        >
          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("adminOrgCode")}</span>
            <input
              className="input"
              dir="ltr"
              autoFocus
              placeholder="OPS"
              value={departmentDraft.code}
              aria-invalid={departmentError ? "true" : undefined}
              onChange={(event) => setDepartmentDraft({ ...departmentDraft, code: event.target.value })}
            />
          </label>

          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("adminOrgNameAr")}</span>
            <input
              className="input"
              placeholder="العمليات"
              value={departmentDraft.name_ar}
              aria-invalid={departmentError ? "true" : undefined}
              onChange={(event) => setDepartmentDraft({ ...departmentDraft, name_ar: event.target.value })}
            />
          </label>

          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("adminOrgNameEn")}</span>
            <input
              className="input"
              dir="ltr"
              placeholder="Operations"
              value={departmentDraft.name_en}
              onChange={(event) => setDepartmentDraft({ ...departmentDraft, name_en: event.target.value })}
            />
          </label>

          {departmentError ? (
            <span className="field-error" role="alert">{departmentError}</span>
          ) : null}

          <div className="dialog-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setDepartmentOpen(false)}>
              {t("cancel")}
            </button>
            <button className="btn btn-primary" type="button" disabled={saving} onClick={addDepartment}>
              {saving ? t("adminOrgPending") : t("adminOrgAddDepartment")}
            </button>
          </div>
        </Dialog>
      ) : null}

      {employeeOpen ? (
        <Dialog title={t("adminOrgAddEmployee")} busy={saving} onClose={() => setEmployeeOpen(false)}>
          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("adminOrgFullName")}</span>
            <input
              className="input"
              value={employeeDraft.full_name}
              aria-invalid={employeeErrorFor("full_name") ? "true" : undefined}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, full_name: event.target.value })}
            />
            {employeeErrorFor("full_name") ? (
              <span className="field-error" role="alert">{employeeErrorFor("full_name")}</span>
            ) : null}
          </label>

          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("signupEmailLabel")}</span>
            <input
              className="input"
              dir="ltr"
              type="email"
              value={employeeDraft.email}
              aria-invalid={employeeErrorFor("email") ? "true" : undefined}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, email: event.target.value })}
            />
            {employeeErrorFor("email") ? (
              <span className="field-error" role="alert">{employeeErrorFor("email")}</span>
            ) : null}
          </label>

          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("adminOrgRole")}</span>
            <select
              className="select"
              value={employeeDraft.role}
              onChange={(event) =>
                setEmployeeDraft({ ...employeeDraft, role: event.target.value as "EMPLOYEE" | "MANAGER" })
              }
            >
              <option value="EMPLOYEE">{t("adminOrgRoleEmployee")}</option>
              <option value="MANAGER">{t("adminOrgRoleManager")}</option>
            </select>
          </label>

          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("adminOrgDepartment")}</span>
            <select
              className="select"
              value={employeeDraft.department}
              aria-invalid={employeeErrorFor("department") ? "true" : undefined}
              onChange={(event) =>
                setEmployeeDraft({ ...employeeDraft, department: event.target.value, manager: "" })
              }
            >
              <option value="">{t("adminOrgNoDepartment")}</option>
              {departments?.map((department) => (
                <option key={department.id} value={department.id}>
                  {locale === "ar" ? department.name_ar : department.name_en || department.name_ar}
                </option>
              ))}
            </select>
            {employeeErrorFor("department") ? (
              <span className="field-error" role="alert">{employeeErrorFor("department")}</span>
            ) : null}
          </label>

          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("adminOrgManagerOfEmployee")}</span>
            <select
              className="select"
              value={employeeDraft.manager}
              disabled={!employeeDraft.department}
              aria-invalid={employeeErrorFor("manager") ? "true" : undefined}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, manager: event.target.value })}
            >
              <option value="">{t("adminOrgNoManagerOfEmployee")}</option>
              {managerChoices.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name || person.email}
                </option>
              ))}
            </select>
            <span className="field-hint">{t("adminOrgManagerSameDepartmentHint")}</span>
            {employeeErrorFor("manager") ? (
              <span className="field-error" role="alert">{employeeErrorFor("manager")}</span>
            ) : null}
          </label>

          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
            <span className="field-label">{t("adminOrgJobTitle")}</span>
            <input
              className="input"
              value={employeeDraft.job_title}
              onChange={(event) => setEmployeeDraft({ ...employeeDraft, job_title: event.target.value })}
            />
          </label>

          <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
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
              {t("cancel")}
            </button>
            <button className="btn btn-primary" type="button" disabled={saving} onClick={addEmployee}>
              {saving ? t("adminOrgPending") : t("adminOrgSave")}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
