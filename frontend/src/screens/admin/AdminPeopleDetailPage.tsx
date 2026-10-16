import { Link, Navigate, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { useServerData } from "../../app/useServerData";
import { getEmployee } from "../../app/orgApi";
import { Banner, EmptyState, ErrorState, SkeletonRows } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";
import ManagerGrantsPanel from "./ManagerGrantsPanel";
import EmployeeAssistantPanel from "../../features/assistant/EmployeeAssistantPanel";

/**
 * Employee employment settings — spec §2.2/§2.3/§2.4 at /admin/people/:employeeId.
 *
 * HONEST STATE (Brief H33): identity comes from the SERVER (`GET /employees/{id}`).
 * The employment-type/hybrid policy, schedule exceptions, leave allocation,
 * task-capability flags and the two-tier file (salary, national id, bank,
 * contracts, religion) have NO server endpoints — src/mock carried them, and
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

  const unavailable = locale === "ar"
    ? "إعدادات التوظيف (نوع التعاقد، سياسة الهجين، استثناء الجدول، مخصص الإجازات، أعلام قدرات المهام) وملف الموظف من المستوى الحصري للموارد البشرية (الراتب، الرقم القومي، البنك، العقود) حاضرة كان لديها بيانات من طبقة العرض التجريبية المحذوفة؛ لا توجد نقطة نهاية على الخادم تقدمها الآن، فلا يوجد مسار كتابة حقيقي. أعمال منح الصلاحيات وإعدادات المساعد تعمل من نقاطهما الحقيقية."
    : "The employment settings (contract type, hybrid policy, schedule exception, leave allocation, task capability flags) and the HR-only file tier (salary, national id, bank, contracts) came from the deleted demo/mock layer; no server endpoint serves them now, so there is no real write path. Manager grants and the assistant panel keep working from their real endpoints.";

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
            subtitle={<span>{t("adminPeopleEmploymentSubtitle")} · <bdi dir="ltr">{employee.data.employee_number ?? "—"}</bdi> · {locale === "ar" ? (employee.data.department_name_ar ?? "—") : (employee.data.department_name_en ?? "—")}</span>}
            breadcrumb={<a href="/admin/people">{t("adminPeopleBack")}</a>}
          />
          {!employee.data.is_active ? (
            <Banner tone="warning" role="status">{locale === "ar" ? "هذا الموظف غير نشط على الخادم." : "This employee is inactive on the server."}</Banner>
          ) : null}
          <Banner tone="warning" role="alert">{unavailable}</Banner>
          <EmptyState
            message={locale === "ar" ? "لا توجد إعدادات توظيف أو ملف موارد بشرية مؤكد من الخادم لهذا الموظف بعد." : "There are no server-confirmed employment settings or HR file for this employee yet."}
          />
          <ManagerGrantsPanel employeeEmail={employee.data.email} />
          <EmployeeAssistantPanel employeeEmail={employee.data.email} />
        </>
      )}
    </div>
  );
}
