import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { Banner } from "../ui";
import { taskStatusKey } from "./TaskPills";
import type { TaskMock, TaskStatus } from "../../mock/tasks";

/**
 * Brief H1 — the task's status control and work timer, one panel beside the
 * facts. Both halves mirror context mutations; neither decides on its own:
 *
 *  - The status control renders only for the assignee / creator / manager and
 *    uses the app's segmented-control pattern (`role="radiogroup"` +
 *    `button[role=radio]` + `aria-checked`), the same shape as the login role
 *    picker and the capability flags. Every change appends a STATUS_CHANGE
 *    trail event carrying from → to.
 *  - The timer runs for the assignee only. Elapsed is DERIVED from the
 *    interval's started_at against the wall clock (never accumulated ticks),
 *    so a reload or a throttled tab cannot lose or drift it. Starting a timer
 *    while another one runs closes the first and the UI says so.
 */
export default function TaskWorkPanel({ task }: { task: TaskMock }) {
  const {
    t, locale, role,
    changeTaskStatus,
    startTaskTimer,
    stopTaskTimer,
    taskTimeEntries,
    taskTimeRunningFor,
    taskTimeTotalSeconds,
    taskTimeElapsedSeconds,
    taskTimeFormatElapsed,
  } = useApp();
  const myId = useMemo(() => {
    const map = { employee: "e1", manager: "m1", hr: "hr1" } as const;
    return map[role];
  }, [role]);

  const isAssignee = task.assignee === myId;
  const isCreator = task.created_by === myId;
  const mayChangeStatus = isAssignee || isCreator || role !== "employee" || myId.startsWith("emp-");
  const running = taskTimeRunningFor(myId);
  const runningOnThisTask = running && running.task_id === task.id ? running : null;
  const runningOnAnother = running && running.task_id !== task.id ? running : null;

  // The display ticks once a second; the VALUE still comes from the wall
  // clock through the context, so re-renders are just a fresh derivation.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!runningOnThisTask) return;
    const handle = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(handle);
  }, [runningOnThisTask]);

  const liveSeconds = runningOnThisTask ? taskTimeElapsedSeconds(myId, Date.now()) : 0;
  const savedSeconds = taskTimeTotalSeconds(task.id, myId);
  const myEntries = taskTimeEntries.filter((entry) => entry.task_id === task.id && entry.employee_id === myId);
  const [switchedNote, setSwitchedNote] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const pick = (to: TaskStatus) => {
    setRefusal(null);
    const result = changeTaskStatus(task.id, to);
    if (!result.ok) setRefusal(result.code);
  };

  const start = () => {
    setRefusal(null);
    setSwitchedNote(null);
    const result = startTaskTimer(task.id);
    if (!result.ok) {
      setRefusal(result.code);
      return;
    }
    if (result.value?.closedFirst) setSwitchedNote(t("taskTimerSwitchedNotice"));
  };

  const stop = () => {
    setRefusal(null);
    const result = stopTaskTimer();
    if (!result.ok) setRefusal(result.code);
  };

  const statusOptions: TaskStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];

  return (
    <section className="work-surface section" aria-labelledby="task-work-heading">
      <h2 id="task-work-heading">{t("taskStatusControlHeading")}</h2>

      {mayChangeStatus ? (
        <>
          <div className="role-segmented" role="radiogroup" aria-label={t("taskStatusControlHeading")} data-testid="task-status-control">
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
          <p className="page-meta">{t("taskStatusControlHint")}</p>
        </>
      ) : (
        <p className="page-meta">{t("taskStatusControlHeading")}: <TaskStatusReadout status={task.status} /></p>
      )}

      <h3 style={{ marginBlockStart: "var(--sp-4)" }}>{t("taskTimerHeading")}</h3>
      <p className="page-meta">{t("taskTimerHint")}</p>
      <dl className="decision-facts" data-testid="task-timer">
        <div>
          <dt>{t("taskTimerRunning")}</dt>
          <dd>
            {runningOnThisTask ? (
              <span data-testid="task-timer-elapsed"><bdi dir="ltr">{taskTimeFormatElapsed(liveSeconds)}</bdi></span>
            ) : (
              <span className="page-meta" data-testid="task-timer-elapsed">{t("taskTimerNothingRunning")}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("taskTimerTotalLabel")}</dt>
          <dd><span data-testid="task-timer-total"><bdi dir="ltr">{taskTimeFormatElapsed(savedSeconds)}</bdi></span></dd>
        </div>
      </dl>
      {isAssignee ? (
        <div className="form-actions">
          {runningOnThisTask ? (
            <button type="button" className="btn btn-primary" data-testid="task-timer-stop" onClick={stop}>
              {t("taskTimerStopSave")}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" data-testid="task-timer-start" onClick={start}>
              {t("taskTimerStart")}
            </button>
          )}
        </div>
      ) : (
        <p className="page-meta">{t("taskTimerOnlyAssignee")}</p>
      )}
      {runningOnAnother ? (
        <Banner tone="warning" role="status">{t("taskTimerSwitchedNotice")}</Banner>
      ) : null}
      {switchedNote ? <Banner tone="info" role="status">{switchedNote}</Banner> : null}
      {refusal ? <Banner tone="error" role="alert">{refusal}</Banner> : null}

      <h3 style={{ marginBlockStart: "var(--sp-4)" }}>{t("taskTimerEntriesHeading")}</h3>
      {myEntries.filter((entry) => entry.ended_at).length === 0 ? (
        <p className="page-meta">{t("taskTimerNoEntries")}</p>
      ) : (
        <ul className="timeline" aria-label={t("taskTimerEntriesHeading")}>
          {myEntries.filter((entry) => entry.ended_at).map((entry) => (
            <li className="timeline-event" key={entry.id} data-testid="task-time-entry">
              <span className="timeline-marker" aria-hidden="true" />
              <div>
                <strong><bdi dir="ltr">{taskTimeFormatElapsed(entry.seconds)}</bdi></strong>
                <div className="muted" dir="ltr">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(entry.started_at))}
                  {" → "}
                  {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(entry.ended_at))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskStatusReadout({ status }: { status: TaskStatus }) {
  const { t } = useApp();
  return <span style={{ color: "var(--text)" }}>{t(taskStatusKey[status])}</span>;
}
