import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { formatDateTime } from "../../app/useMockList";
import { Banner } from "../ui";
import type { TaskMock } from "../../mock/tasks";

/**
 * Brief H4 — the work timer as a modern work surface, high on the page:
 * «ونخلي طريقه الوقت الي بيعد دا ومكانه وشكلهم يبقوا حاجه مودرن كدا». The
 * elapsed clock is the hero — large, tabular-numeral, and unmistakably
 * running or not (a pulsing only-when-running indicator). The saved total
 * sits beside it as the secondary figure. One primary action toggles
 * start/stop with the state obvious before the click. Every H1 rule holds:
 * assignee-only, one timer per employee, elapsed derived from the wall
 * clock (reload-safe), intervals sum into the total, and the entries list
 * keeps its timeline styling with the existing testids.
 */
export default function TaskWorkPanel({ task }: { task: TaskMock }) {
  const {
    t, locale, role,
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
  const savedEntries = myEntries.filter((entry) => entry.ended_at);
  const [switchedNote, setSwitchedNote] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  // One primary action that toggles: start when idle, stop-and-save when
  // running — the state is announced by the button itself before the click.
  const toggle = () => {
    setRefusal(null);
    setSwitchedNote(null);
    if (runningOnThisTask) {
      const stopped = stopTaskTimer();
      if (!stopped.ok) setRefusal(stopped.code);
      return;
    }
    const result = startTaskTimer(task.id);
    if (!result.ok) {
      setRefusal(result.code);
      return;
    }
    if (result.value?.closedFirst) setSwitchedNote(t("taskTimerSwitchedNotice"));
  };

  return (
    <section
      className={`work-surface section task-work-timer${runningOnThisTask ? " is-running" : ""}`}
      aria-labelledby="task-work-heading"
    >
      <div className="task-timer-hero">
        <h2 id="task-work-heading" className="task-timer-title">
          <span
            className="task-timer-pulse"
            aria-hidden="true"
            data-testid="task-timer-pulse"
          />
          {t("taskTimerHeading")}
        </h2>
        <div className="task-timer-clock" data-testid="task-timer">
          <span
            className="task-timer-elapsed-value"
            data-testid="task-timer-elapsed"
            aria-live={runningOnThisTask ? "off" : "polite"}
          >
            <bdi dir="ltr">{runningOnThisTask ? taskTimeFormatElapsed(liveSeconds) : t("taskTimerNothingRunning")}</bdi>
          </span>
          <span className="task-timer-label">{runningOnThisTask ? t("taskTimerRunning") : t("taskTimerHint")}</span>
        </div>
        <div className="task-timer-total-box">
          <span className="task-timer-total-value" data-testid="task-timer-total">
            <bdi dir="ltr">{taskTimeFormatElapsed(savedSeconds)}</bdi>
          </span>
          <span className="task-timer-label">{t("taskTimerTotalLabel")}</span>
        </div>
      </div>

      {isAssignee ? (
        <div className="form-actions">
          <button
            type="button"
            className={`btn ${runningOnThisTask ? "btn-secondary" : "btn-primary"}`}
            data-testid={runningOnThisTask ? "task-timer-stop" : "task-timer-start"}
            onClick={toggle}
          >
            {runningOnThisTask ? t("taskTimerStopSave") : t("taskTimerStart")}
          </button>
        </div>
      ) : (
        <p className="page-meta">{t("taskTimerOnlyAssignee")}</p>
      )}
      {runningOnAnother ? (
        <Banner tone="warning" role="status">{t("taskTimerSwitchedNotice")}</Banner>
      ) : null}
      {switchedNote ? <Banner tone="info" role="status">{switchedNote}</Banner> : null}
      {refusal ? <Banner tone="error" role="alert">{refusal}</Banner> : null}

      <h3 className="task-timer-entries-title">{t("taskTimerEntriesHeading")}</h3>
      {savedEntries.length === 0 ? (
        <p className="page-meta">{t("taskTimerNoEntries")}</p>
      ) : (
        <ul className="timeline" aria-label={t("taskTimerEntriesHeading")}>
          {savedEntries.map((entry) => (
            <li className="timeline-event" key={entry.id} data-testid="task-time-entry">
              <span className="timeline-marker" aria-hidden="true" />
              <div>
                <strong><bdi dir="ltr">{taskTimeFormatElapsed(entry.seconds)}</bdi></strong>
                <div className="muted" dir="ltr" translate="no">
                  {formatDateTime(entry.started_at, locale)}
                  {" → "}
                  {formatDateTime(entry.ended_at, locale)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
