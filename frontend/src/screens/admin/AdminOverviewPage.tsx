import { Link, Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { Banner, EmptyState } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";

/**
 * Overview page — Brief H33 honest state.
 *
 * §3 wanted a today-only org attendance snapshot, but the backend exposes NO
 * attendance endpoints (and no leave-balance tool that would power the old
 * per-row adjust action). The frontend must not derive rows from fixtures —
 * the derived-bucket tables, the adjust dialog and the simulated fetch are
 * all gone with src/mock; what remains is the guarded shell, the snapshot
 * heading, the scope banner and one honest unavailable state.
 */
export default function AdminOverviewPage() {
  const { t, locale, capabilities } = useApp();
  usePageTitle(t("adminOverviewTitle"));

  if (!capabilities.canViewOrgAttendance && !capabilities.canSetOrgSchedule && !capabilities.canManageLeaveBalance) {
    return <Navigate to="/" replace />;
  }

  const unavailable = locale === "ar"
    ? "لقطة الحضور اليومية للمؤسسة غير متاحة بعد: لا توجد نقطة نهاية للحضور على الخادم حتى الآن، فلا توجد صفوف مؤكدة لاشتقاق أجزاء اليوم (حاضر/غائب/إجازة/غير مكتمل). تُستكمل اللقطة عند توفر النقطة على الخادم."
    : "The org's daily attendance snapshot is not available yet: the server exposes no attendance endpoint, so there are no confirmed rows to derive the day buckets from (present/absent/leave/incomplete). The snapshot completes once the endpoint exists.";

  return (
    <div className="page">
      <AdminNav />
      <PageHeader
        title={t("adminOverviewTitle")}
        subtitle={<>{t("adminOverviewSnapshotPrefix")}</>}
      />
      <Banner tone="warning" role="alert">{unavailable}</Banner>
      <Banner tone="info" role="status">{t("adminOverviewScopeBanner")}</Banner>
      <EmptyState message={unavailable} />
      <p>
        <Link to="/attendance/history">{t("adminOverviewHistoryLink")}</Link>
      </p>
    </div>
  );
}
