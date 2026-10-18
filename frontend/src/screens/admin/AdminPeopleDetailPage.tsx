import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { useServerData } from "../../app/useServerData";
import {
  getEmployee,
  listDepartments,
  listEmployees,
  updateEmployee,
  type ServerDepartment,
  type ServerEmployee,
} from "../../app/orgApi";
import { ApiError } from "../../app/api";
import { Banner, Dialog, ErrorState, SkeletonRows } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";
import ManagerGrantsPanel from "./ManagerGrantsPanel";
import EmployeeAssistantPanel from "../../features/assistant/EmployeeAssistantPanel";

/**
 * Employee employment settings - spec §2.2/§2.3/§2.4 at /admin/people/:employeeId.
 *
 * HONEST STATE (Brief H33): identity comes from the SERVER (`GET /employees/{id}`).
 * The employment-type/hybrid policy, schedule exceptions, leave allocation,
 * task-capability flags and the two-tier file (salary, national id, bank,
 * contracts, religion) have NO server endpoints - src/mock carried them, and
 * the mock is deleted, so those panels render the honest unavailable state
 * instead of fixture rows. Manager grants and the assistant config panel stay
 * on their real endpoints.
 */
export default function AdminPeopleDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { t, locale, capabilities } = useApp();
  usePageTitle(t("adminPeopleTitle"));

  const parsedId = /^\d+$/.test(employeeId ?? "") ? Number(employeeId) : null;
  /* The save bumps this, which re-runs the read above — the page then shows the
     row the server actually stored rather than the values typed into the dialog. */
  const [reloadKey, setReloadKey] = useState(0);
  const employee = useServerData(
    () => (parsedId === null ? Promise.reject(new Error("invalid id")) : getEmployee(parsedId, locale)),
    [parsedId, locale, reloadKey],
  );

  const [editing, setEditing] = useState(false);

  if (!capabilities.canManageDirectory) return <Navigate to="/" replace />;

  /* What the server actually serves for one employee: identity, the roster
     fields, and the reporting line. The exclusive HR tier (salary, national id,
     bank, contracts) and the employment-policy settings have no endpoint and no
     model, so they are named honestly as absent rather than shown as blanks. */
  const employeeFields = (row: ServerEmployee) =>
    ([
      [locale === "ar" ? "البريد الإلكتروني" : "Email", row.email],
      [locale === "ar" ? "المسمى الوظيفي" : "Job title", row.job_title],
      [locale === "ar" ? "الإدارة" : "Department", [locale === "ar" ? row.department_name_ar : row.department_name_en, row.department_code].filter(Boolean).join(" · ")],
      [locale === "ar" ? "الرقم الوظيفي" : "Employee number", row.employee_number ?? ""],
      [locale === "ar" ? "المدير" : "Manager", row.manager_name ?? ""],
      [locale === "ar" ? "الدور" : "Role", row.role],
      [locale === "ar" ? "نشط" : "Active", row.is_active ? (locale === "ar" ? "نعم" : "Yes") : (locale === "ar" ? "لا" : "No")],
    ] as [string, string][]).filter(([, value]) => value !== "" && value !== null && value !== undefined);

  const notOnServer = locale === "ar"
    ? "الملف الحصري للموارد البشرية (الراتب، الرقم القومي، البنك، العقود) وإعدادات التوظيف (نوع التعاقد، سياسة الهجين، استثناء الجدول) مالهاش نقطة على الخادم، فمش معروضة. اللي فوق هو اللي الخادم بيقوله فعلًا."
    : "The exclusive HR file (salary, national id, bank, contracts) and the employment settings (contract type, hybrid policy, schedule exception) have no server endpoint, so they are not shown. Everything above is what the server actually reports.";

  return (
    <div className="page people-detail-page">
      <AdminNav />
      {employee.phase === "loading" ? (
        <div className="work-surface"><SkeletonRows rows={4} /></div>
      ) : employee.phase === "error" ? (
        <>
          <PageHeader title={t("adminPeopleTitle")} breadcrumb={<Link to="/admin/people">{t("adminPeopleBack")}</Link>} />
          <ErrorState onRetry={employee.retry} />
        </>
      ) : (
        <>
          <PageHeader
            title={employee.data.full_name}
            subtitle={<span>{t("adminPeopleEmploymentSubtitle")} · <bdi dir="ltr">{employee.data.employee_number ?? "-"}</bdi> · {locale === "ar" ? (employee.data.department_name_ar ?? "-") : (employee.data.department_name_en ?? "-")}</span>}
            breadcrumb={<a href="/admin/people">{t("adminPeopleBack")}</a>}
          />
          {!employee.data.is_active ? (
            <Banner tone="warning" role="status">{locale === "ar" ? "هذا الموظف غير نشط على الخادم." : "This employee is inactive on the server."}</Banner>
          ) : null}
          <section className="work-surface section">
            <div className="section-heading">
              <h2>{locale === "ar" ? "ملف الموظف" : "Employee file"}</h2>
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                {locale === "ar" ? "تعديل" : "Edit"}
              </button>
            </div>
            <dl className="profile-details">
              {employeeFields(employee.data).map(([label, value]) => (
                <div className="record-field" key={label}>
                  <dt className="record-field-label">{label}</dt>
                  <dd><bdi>{value}</bdi></dd>
                </div>
              ))}
            </dl>
          </section>
          <Banner tone="info" role="status">{notOnServer}</Banner>
          {editing ? (
            <EditEmployeeDialog
              row={employee.data}
              locale={locale}
              onClose={() => setEditing(false)}
              onSaved={() => { setEditing(false); setReloadKey((n) => n + 1); }}
            />
          ) : null}
          <ManagerGrantsPanel employeeEmail={employee.data.email} />
          <EmployeeAssistantPanel employeeEmail={employee.data.email} />
        </>
      )}
    </div>
  );
}

/**
 * HR edits the fields the server actually accepts (PATCH /employees/{id}): the
 * roster fields, the reporting line and the account flags. The exclusive HR tier
 * has no endpoint, so it is not offered here either — a dialog that silently
 * dropped a field would be worse than one that never showed it.
 */
function EditEmployeeDialog({
  row,
  locale,
  onClose,
  onSaved,
}: {
  row: ServerEmployee;
  locale: "ar" | "en";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: row.full_name,
    email: row.email,
    job_title: row.job_title ?? "",
    employee_number: row.employee_number ?? "",
    department: row.department_id === null ? "" : String(row.department_id),
    manager: row.manager_id === null ? "" : String(row.manager_id),
    is_active: row.is_active,
  });
  const [departments, setDepartments] = useState<ServerDepartment[]>([]);
  const [people, setPeople] = useState<ServerEmployee[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listDepartments(locale).then(setDepartments).catch(() => setDepartments([]));
    listEmployees(locale).then(setPeople).catch(() => setPeople([]));
  }, [locale]);

  const submit = async () => {
    setProblem(null);
    if (!form.full_name.trim() || !form.email.trim()) {
      setProblem(locale === "ar" ? "الاسم والإيميل مطلوبين." : "Name and email are required.");
      return;
    }
    setSaving(true);
    try {
      await updateEmployee(
        row.id,
        {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          job_title: form.job_title.trim(),
          employee_number: form.employee_number.trim() || undefined,
          department: form.department === "" ? null : Number(form.department),
          manager: form.manager === "" ? null : Number(form.manager),
          is_active: form.is_active,
        },
        locale,
      );
      onSaved();
    } catch (failure) {
      setProblem(
        failure instanceof ApiError && failure.kind === "forbidden"
          ? (locale === "ar" ? "مش مسموح لك بالتعديل." : "You are not allowed to edit.")
          : (locale === "ar" ? "تعذّر الحفظ. جرّب تاني." : "Could not save. Try again."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={locale === "ar" ? "تعديل ملف الموظف" : "Edit the employee file"}
      description={locale === "ar" ? "الحقول اللي الخادم بيقبلها بس. اللي مش معروض مالهوش نقطة على الخادم." : "Only the fields the server accepts. What is not shown has no server endpoint."}
      onClose={onClose}
      busy={saving}
      dirty={false}
    >
      <div className="form-stack">
        <label className="field"><span>{locale === "ar" ? "الاسم" : "Name"}</span>
          <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
        <label className="field"><span>{locale === "ar" ? "البريد الإلكتروني" : "Email"}</span>
          <input className="input" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="field"><span>{locale === "ar" ? "المسمى الوظيفي" : "Job title"}</span>
          <input className="input" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /></label>
        <label className="field"><span>{locale === "ar" ? "الرقم الوظيفي" : "Employee number"}</span>
          <input className="input" dir="ltr" value={form.employee_number} onChange={(e) => setForm({ ...form, employee_number: e.target.value })} /></label>
        <label className="field"><span>{locale === "ar" ? "الإدارة" : "Department"}</span>
          <select className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
            <option value="">{locale === "ar" ? "بدون إدارة" : "No department"}</option>
            {departments.map((d) => (<option key={d.id} value={String(d.id)}>{d.name_ar || d.code}</option>))}
          </select></label>
        <label className="field"><span>{locale === "ar" ? "المدير" : "Manager"}</span>
          <select className="input" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })}>
            <option value="">{locale === "ar" ? "بدون مدير" : "No manager"}</option>
            {people.filter((p) => p.id !== row.id).map((p) => (<option key={p.id} value={String(p.id)}>{p.full_name}</option>))}
          </select></label>
        <label className="field"><span>{locale === "ar" ? "نشط" : "Active"}</span>
          <select className="input" value={form.is_active ? "1" : "0"} onChange={(e) => setForm({ ...form, is_active: e.target.value === "1" })}>
            <option value="1">{locale === "ar" ? "نعم" : "Yes"}</option>
            <option value="0">{locale === "ar" ? "لا" : "No"}</option>
          </select></label>
      </div>
      {problem ? <Banner tone="error" role="alert">{problem}</Banner> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
          {locale === "ar" ? "إلغاء" : "Cancel"}
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
          {locale === "ar" ? "حفظ" : "Save"}
        </button>
      </div>
    </Dialog>
  );
}
