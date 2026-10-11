import type { ReactNode } from "react";
import { useApp } from "../../app/AppContext";

export interface TaskFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** One filter grammar for task queues and logged-time rows. */
export default function TaskFilterToolbar({ children, chips, shown, total, onClear }: {
  children: ReactNode;
  chips: TaskFilterChip[];
  shown: number;
  total: number;
  onClear: () => void;
}) {
  const { t } = useApp();
  return (
    <div className="tasks-filter-panel" data-testid="tasks-filter-toolbar">
      <div className="filter-toolbar tasks-filter-controls">{children}</div>
      {chips.length > 0 ? (
        <div className="applied-filters tasks-filter-chips" aria-label={t("taskFiltersApplied")}>
          {chips.map((chip) => (
            <span className="filter-chip" key={chip.key}>
              <span>{chip.label}</span>
              <button type="button" className="tasks-chip-remove" aria-label={t("taskFilterRemove").replace("%s", chip.label)} onClick={chip.onRemove}>×</button>
            </span>
          ))}
          <button type="button" className="btn btn-secondary" data-testid="tasks-clear-all" onClick={onClear}>{t("taskFiltersClearAll")}</button>
        </div>
      ) : null}
      <p className="page-meta tasks-result-count" role="status">{t("taskFiltersShowing").replace("%s", String(shown)).replace("%s", String(total))}</p>
    </div>
  );
}
