import { Link, Navigate, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { useServerData } from "../../app/useServerData";
import { getEmployee, type ServerEmployee } from "../../app/orgApi";
import { Banner, ErrorState, SkeletonRows } from "../../components/ui";
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
  const employee = useServerData(
    () => (parsedId === null ? Promise.reject(new Error("invalid id")) : getEmployee(parsedId, locale)),
    [parsedId, locale],
  );

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
          <ManagerGrantsPanel employeeEmail={employee.data.email} />
          <EmployeeAssistantPanel employeeEmail={employee.data.email} />
        </>
      )}
    </div>
  );
}
