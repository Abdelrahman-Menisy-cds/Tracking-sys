import { useApp, usePageTitle } from "../../app/AppContext";
import PageHeader from "../../components/layout/PageHeader";
import { Banner, EmptyState } from "../../components/ui";
import AdminNav from "./AdminNav";

/** Placeholder — implemented in a later stage (spec §1). */
export default function AdminSettingsPage() {
  const { t } = useApp();
  usePageTitle(t("adminNavSettings"));
  return (
    <div className="page">
      <AdminNav />
      <PageHeader title={t("adminNavSettings")} />
      <EmptyState message={t("adminPlaceholderNote")} />
      <Banner tone="info">{t("adminDemoBoundary")}</Banner>
    </div>
  );
}
