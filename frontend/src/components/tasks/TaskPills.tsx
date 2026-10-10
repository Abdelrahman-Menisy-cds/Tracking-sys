import { useApp } from "../../app/AppContext";
import { Banner, StatusPill } from "../ui";
import type { TaskPriority, TaskStatus } from "../../mock/tasks";

/** Localized priority copy shared by the list cells and the detail facts. */
export function taskPriorityLabel(priority: TaskPriority, locale: "ar" | "en"): string {
  return locale === "ar"
    ? priority === "HIGH" ? "عالية" : priority === "MEDIUM" ? "متوسطة" : "منخفضة"
    : priority === "HIGH" ? "High" : priority === "MEDIUM" ? "Medium" : "Low";
}

/** Status → pill tone, the same palette the other domains use. */
export const taskStatusTone: Record<TaskStatus, "info" | "warning" | "success" | "neutral"> = {
  OPEN: "info",
  IN_PROGRESS: "warning",
  DONE: "success",
  CANCELLED: "neutral",
};

export const taskStatusKey: Record<TaskStatus, "stOpen" | "stInProgress" | "stDone" | "stCancelled"> = {
  OPEN: "stOpen",
  IN_PROGRESS: "stInProgress",
  DONE: "stDone",
  CANCELLED: "stCancelled",
};

export function TaskStatusPill({ status }: { status: TaskStatus }) {
  const { t } = useApp();
  return <StatusPill tone={taskStatusTone[status]} label={t(taskStatusKey[status])} />;
}

export function TaskPriorityPill({ priority }: { priority: TaskPriority }) {
  const { locale } = useApp();
  return <StatusPill tone={priority === "HIGH" ? "warning" : priority === "MEDIUM" ? "info" : "neutral"} label={taskPriorityLabel(priority, locale)} />;
}

/**
 * The demo-boundary note. Re-used on every tasks surface so the honest copy —
 * these records live in session memory and never touch a server — is exactly
 * the same sentence everywhere.
 */
export function TaskDemoBanner() {
  const { t } = useApp();
  return <Banner tone="info">{t("taskStateDemoNote")}</Banner>;
}
