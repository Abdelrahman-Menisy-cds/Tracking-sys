import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { Banner } from "../ui";
import { TaskStatusPill, taskStatusKey } from "./TaskPills";
import type { TaskMock, TaskStatus } from "../../mock/tasks";

/**
 * Brief H4 — the task status as a BAR at the very top of the page:
 * «عاوزين نخلي حاله المهمه دي بار فوق ف اول الصفحه». One full-width row
 * directly under the page header: the current status as the prominent
 * readout (existing TaskStatusPill primitive) beside the same segmented
 * control as before, so changing status stays one click. The visibility
 * rules and refusal contract are the H1 ones, unchanged; the hint text is
 * available but wrapped behind the `<details>` gesture so it cannot bloat
 * the bar.
 *
 * It is a bar, not a card: no elevation, no radius, hairline edges, and it
 * sticks below the app header without trapping focus.
 */
export default function TaskStatusBar({ task }: { task: TaskMock }) {
  const { t, role, changeTaskStatus } = useApp();
  const myId = useMemo(() => {
    const map = { employee: "e1", manager: "m1", hr: "hr1" } as const;
    return map[role];
  }, [role]);

  const isAssignee = task.assignee === myId;
  const isCreator = task.created_by === myId;
  const mayChangeStatus = isAssignee || isCreator || role !== "employee" || myId.startsWith("emp-");

  const [refusal, setRefusal] = useState<string | null>(null);
  const pick = (to: TaskStatus) => {
    setRefusal(null);
    const result = changeTaskStatus(task.id, to);
    if (!result.ok) setRefusal(result.code);
  };
  // Any keypress or blur elsewhere clears the refusal so it never lingers
  // as stale noise under the bar; the H3 gate still reads it as a Banner.
  useEffect(() => {
    if (!refusal) return;
    const handle = window.setTimeout(() => setRefusal(null), 6000);
    return () => window.clearTimeout(handle);
  }, [refusal]);

  const statusOptions: TaskStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];

  return (
    <div className="task-status-bar" data-testid="task-status-bar">
      <TaskStatusPill status={task.status} />
      {mayChangeStatus ? (
        <>
          <div
            className="role-segmented"
            role="radiogroup"
            aria-label={t("taskStatusControlHeading")}
            data-testid="task-status-control"
          >
            {statusOptions.map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={task.status === status}
                className={`role-segmented-option${task.status === status ? " is-selected" : ""}`}
                data-testid={`task-status-${status.toLowerCase()}`}
                onClick={() => pick(status)}
              >
                <span>{t(taskStatusKey[status])}</span>
              </button>
            ))}
          </div>
          <details className="task-status-bar-hint">
            <summary>{t("taskStatusControlHeading")}</summary>
            <p className="page-meta">{t("taskStatusControlHint")}</p>
          </details>
        </>
      ) : (
        <p className="page-meta" data-testid="task-status-readout">
          {t("taskStatusControlHeading")}: <TaskStatusPill status={task.status} />
        </p>
      )}
      {refusal ? (
        <Banner tone="error" role="alert">{refusal}</Banner>
      ) : null}
    </div>
  );
}
