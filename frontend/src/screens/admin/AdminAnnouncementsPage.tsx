import { useApp, usePageTitle } from "../../app/AppContext";
import PageHeader from "../../components/layout/PageHeader";
import { Banner, EmptyState } from "../../components/ui";
import AdminNav from "./AdminNav";

/** Placeholder — implemented in a later stage (spec §4). */
export default function AdminAnnouncementsPage() {
  const { t } = useApp();
  usePageTitle(t("adminNavAnnouncements"));
  return (
    <div className="page">
      <AdminNav />
      <PageHeader title={t("adminNavAnnouncements")} />
      <EmptyState message={t("adminPlaceholderNote")} />
      <Banner tone="info">{t("adminDemoBoundary")}</Banner>
    </div>
  );
}
