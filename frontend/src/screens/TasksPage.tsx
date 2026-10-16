import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";

/**
 * /tasks — Brief H33 honest state. The backend exposes NO tasks endpoints
 * (no task rows, no events, no per-task timers — the mock cycle was deleted
 * with the fixtures), so the screen keeps its shell and heading and renders
 * the honest unavailable state; nothing is fabricated client-side. The route
 * stays so the link from the rail still resolves once the server ships tasks.
 */
export default function TasksPage() {
  const { t, locale } = useApp();
  usePageTitle(t("tasksTitle"));
  const noTasks = locale === "ar"
    ? "المهام غير متاحة بعد: لا توجد نقطة نهاية للمهام على الخادم حتى الآن، فلا توجد مهام حقيقية ولا أعمال قيد التنفيذ ولا سلاسل زمنية. الشاشة تُستكمل عند توفر النقطة على الخادم."
    : "Tasks are not available yet: the server exposes no tasks endpoint, so there are no real tasks, work in progress, or trails. The screen completes once the endpoint exists on the server.";
  const waiting = locale === "ar" ? "بانتظار نقطة نهاية المهام على الخادم" : "Waiting for the tasks endpoint on the server";
  return (
    <div className="page">
      <PageHeader
        title={t("tasksTitle")}
        subtitle={locale === "ar" ? "تُدار مهامك من الخادم؛ لا يوجد مسار مهام على الخادم بعد." : "Your tasks are managed by the server; there is no tasks route on the server yet."}
        primaryAction={
          <button type="button" className="btn btn-primary" disabled title={waiting}>
            {locale === "ar" ? "مهمة جديدة" : "New task"}
          </button>
        }
      />
      <Banner tone="warning" role="alert">{noTasks}</Banner>
      <EmptyState
        message={noTasks}
        action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>}
      />
    </div>
  );
}
