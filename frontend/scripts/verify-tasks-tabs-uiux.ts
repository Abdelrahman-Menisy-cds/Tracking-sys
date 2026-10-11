/** Brief H6: static contracts for the /tasks tab and filter surface. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("screens/TasksPage.tsx");
const sheet = read("components/tasks/TaskTimesheetSection.tsx");
const toolbar = read("components/tasks/TaskFilterToolbar.tsx");
const dict = read("i18n/dict.ts");
const css = read("styles/global.css");
let failed = false;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  failed ||= !ok;
};

check("tablist has controlled tabs and one labelled panel", page.includes('role="tablist"') && page.includes('role="tab"') && page.includes('aria-controls="tasks-tabpanel"') && page.includes('id="tasks-tabpanel" role="tabpanel" aria-labelledby={`tasks-tab-${activeTab}`}'));
check("roving keyboard tabs include RTL arrows, Home/End, Enter/Space", page.includes("tabIndex={activeTab === tab.id ? 0 : -1}") && page.includes('"ArrowLeft"') && page.includes('"ArrowRight"') && page.includes('"Home"') && page.includes('"End"') && page.includes('"Enter"') && page.includes('event.key === " "'));
check("counts have accessible names", page.includes('aria-label={t(tab.id === "timesheet"') && !page.includes('aria-hidden="true"'));
check("one toolbar component serves task and timesheet panes", page.includes("<TaskFilterToolbar") && sheet.includes("<TaskFilterToolbar") && page.includes("<TaskTimesheetSection"));
check("clear all resets every page-level filter", ["setSearch(\"\")", "setStatusFilter(\"ALL\")", "setPeriod(\"all\")", "setEmployeeFilter(\"ALL\")", "setCustomFrom(\"\")", "setCustomTo(\"\")", "setCustomApplied(false)"].every((needle) => page.slice(page.indexOf("const clearAll ="), page.indexOf("const chips:")).includes(needle)));
check("chips remove independently and clear-all disappears with no active filters", toolbar.includes("chips.map((chip)") && toolbar.includes("chip.onRemove") && toolbar.includes("chips.length > 0 ?") && toolbar.includes("onClick={onClear}"));
check("filter-empty differs from genuinely empty and has recovery", page.includes('baseTasks.length > 0 ? t("taskFilterEmpty")') && page.includes("onClick={clearAll}") && sheet.includes('hasAnyLogged') && sheet.includes('taskTimesheetEmptyFiltered') && sheet.includes('taskTimesheetEmptyNothing') && sheet.includes('onClick={clearAll}'));
check("filter copy lives in both locales only", !page.includes("كل الحالات") && !page.includes("All statuses") && !sheet.includes("كل الحالات") && !sheet.includes("All statuses") && dict.includes('taskFilterAllStatuses: "كل الحالات"') && dict.includes('taskFilterAllStatuses: "All statuses"'));
const files = [page, sheet, toolbar, read("components/tasks/TaskStatusBar.tsx"), read("components/tasks/TaskWorkPanel.tsx")].join("\n");
const ids = ["create-task-open", "assign-${task.id}", "task-status-bar", "task-status-control", "task-status-${status.toLowerCase()}", "task-status-readout", "task-timer", "task-timer-elapsed", "task-timer-pulse", "task-timer-total", "task-timer-start", "task-timer-stop", "task-time-entry", "timesheet-section", "timesheet-name-filter", "timesheet-period-filter", "timesheet-employee-filter"];
check("all existing task testids remain", ids.every((id) => files.includes(id)));
check("badge uses the same task predicate and timesheet rows as the list", page.includes('needsAssignment.filter(matchesTask).length') && page.includes('myTasks.filter(matchesTask).length') && page.includes('createdTasks.filter(matchesTask).length') && page.includes('count: filteredTimeRows.length') && page.includes('return base.filter(matchesTask)') && page.includes('rows={filteredTimeRows}') && toolbar.includes('String(shown)') && toolbar.includes('String(total)'));
const h6Start = css.indexOf("Brief H6");
const nextBlock = css.indexOf("/* =====", h6Start + 1);
const block = css.slice(h6Start, nextBlock === -1 ? undefined : nextBlock);
const allowed = ["--surface", "--surface-subtle", "--surface-inset", "--accent", "--on-accent", "--card-border", "--focus-ring", "--text", "--sp-", "--radius-", "--timeline-width", "--control-min-h", "--space-", "--font-size-", "--line-height-"];
const used = [...block.matchAll(/var\((--[^),\s]+)/g)].map((match) => match[1]);
check("new CSS uses only approved token families and no new hex colors", used.length > 0 && used.every((token) => allowed.some((prefix) => token.startsWith(prefix))) && !/#[0-9a-fA-F]{3,8}\b/.test(block));
check("mobile tabs scroll and toolbar stacks", block.includes("overflow-x: auto") && block.includes("max-width: 599px") && block.includes("grid-template-columns: minmax(0, 1fr)"));

if (failed) process.exit(1);
console.log("ALL CHECKS PASSED");
