import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";

/**
 * /tasks/:taskId — Brief H33 honest state. The backend exposes NO tasks
 * endpoints, so a task record cannot exist on the server and no detail view
 * can be rendered truthfully. The route shell stays so the link resolves.
 */

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { t, locale } = useApp();
  usePageTitle(t("taskDetailTitle"));
  const unavailable = locale === "ar"
    ? `المهمة غير متاحة: لا توجد نقطة نهاية للمهام على الخادم حتى الآن${taskId ? ` (المعرف: ${taskId})` : ""}، فلا يوجد سجل حقيقي لعرضه ولا مسار لاحق يعتمد عليه. تعود إلى المهام أو تبدأ من الرئيسية.`
    : `The task is not available: the server exposes no tasks endpoint yet${taskId ? ` (id: ${taskId})` : ""}, so there is no real record to render and no trail to rely on. Go back to tasks or start from home.`;
  return (
    <div className="page">
      <PageHeader title={t("taskDetailTitle")} breadcrumb={<Link to="/tasks">{t("tasksTitle")}</Link>} />
      <Banner tone="warning" role="alert">{locale === "ar" ? "المهام قادمة من الخادم لاحقًا؛ لا يوجد مسار مهام على الخادم بعد." : "Tasks arrive from the server later; there is no tasks route on the server yet."}</Banner>
      <EmptyState
        message={unavailable}
        action={<Link className="btn btn-secondary" to="/tasks">{t("tasksTitle")}</Link>}
      />
    </div>
  );
}
