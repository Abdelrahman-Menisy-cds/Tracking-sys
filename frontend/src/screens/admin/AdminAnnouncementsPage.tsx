import { Link, Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { Banner, EmptyState } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";

/**
 * Announcements - Brief H33 honest state.
 *
 * Spec §4 built a composer + send lifecycle + history on the mock boundary,
 * but the backend exposes NO announcements endpoints (no feeds, no send
 * route, no delivery list). The frontend must not fake a delivery, so the
 * composer, its lifecycle banners, the history table and the directory
 * pickers are removed with src/mock; what remains is the guarded page shell
 * with one honest unavailable state pointing at the working tools.
 */
export default function AdminAnnouncementsPage() {
  const { t, locale, capabilities } = useApp();
  usePageTitle(t("adminNavAnnouncements"));

  if (!capabilities.canSendAnnouncements) {
    return <Navigate to="/" replace />;
  }

  const unavailable = locale === "ar"
    ? "الإعلانات غير متاحة بعد: لا توجد نقطة نهاية للإعلانات على الخادم حتى الآن (لا موجز سجل ولا مسار إرسال ولا قائمة وصول)، فلا يمكن تأليف إعلان حقيقي أو إرساله. المضمون: لا تُحاكى إشعارات إرسال لم تحدث."
    : "Announcements are not available yet: the server exposes no announcements endpoints (no history feed, no send route, no delivery list), so a real announcement cannot be composed or sent. What is guaranteed: no delivery is ever simulated.";

  return (
    <div className="page reading-page">
      <AdminNav />
      <PageHeader title={t("hrAnnouncementsTitle")} subtitle={t("hrAnnouncementsSubtitle")} />
      <Banner tone="warning" role="alert">{unavailable}</Banner>
      <EmptyState
        message={locale === "ar" ? "قائمة سجل الإعلانات تصل من الخادم لاحقًا؛ لا يوجد سجل حقيقي الآن." : "The announcement history feed arrives from the server later; there is no real record yet."}
        action={<Link className="btn btn-secondary" to="/">{locale === "ar" ? "الرئيسية" : "Home"}</Link>}
      />
    </div>
  );
}
