import { useApp, usePageTitle } from "../../app/AppContext";
import PageHeader from "../../components/layout/PageHeader";
import { Banner, EmptyState } from "../../components/ui";
import AdminNav from "./AdminNav";

/** Placeholder — implemented in a later stage (spec §2). */
export default function AdminPeoplePage() {
  const { t } = useApp();
  usePageTitle(t("adminNavPeople"));
  return (
    <div className="page">
      <AdminNav />
      <PageHeader title={t("adminNavPeople")} />
      <EmptyState message={t("adminPlaceholderNote")} />
      <Banner tone="info">{t("adminDemoBoundary")}</Banner>
    </div>
  );
}
