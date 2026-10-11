/** Brief H7: static contract for the shared page and filter grammar. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const pageFiles = [
  ...fs.readdirSync(path.join(root, "screens")).filter((name) => name.endsWith("Page.tsx")).map((name) => `screens/${name}`),
  ...fs.readdirSync(path.join(root, "screens/admin")).filter((name) => name.endsWith("Page.tsx")).map((name) => `screens/admin/${name}`),
].sort();
const pages = pageFiles.map((file) => ({ file, source: read(file) }));
const tasks = read("screens/TasksPage.tsx");
const sheet = read("components/tasks/TaskTimesheetSection.tsx");
const toolbar = read("components/tasks/TaskFilterToolbar.tsx");
const dict = read("i18n/dict.ts");
const css = read("styles/global.css");
const taskSources = [tasks, sheet, toolbar, read("components/tasks/TaskStatusBar.tsx"), read("components/tasks/TaskWorkPanel.tsx")].join("\n");
let failed = false;
function check(label: string, ok: boolean, detail?: string[]) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail?.length ? "" : `: ${detail.join(", ")}`}`);
  failed ||= !ok;
}

check("all 16 page files are scanned", pages.length === 16, pageFiles);
const missingHeader = pages.filter(({ source }) => !source.includes("<PageHeader")).map(({ file }) => file);
check("every page renders the shared PageHeader", missingHeader.length === 0, missingHeader);
const missingSurface = pages.filter(({ source }) => !/work-surface|OperationalTable|table-wrap|filter-panel/.test(source)).map(({ file }) => file);
check("every page renders a shared surface or table primitive", missingSurface.length === 0, missingSurface);
const localPageInset = pages.filter(({ source }) => /className="(?:page(?:\s[^"]*)?|login-page)"\s+style=\{\{[^}]*\b(?:padding|margin)/s.test(source)).map(({ file }) => file);
check("page containers carry no inline padding or margin", localPageInset.length === 0, localPageInset);
check("page inner inset is declared once and reused by tabs and filter panels", css.includes(".page { --sp-page-inner: var(--sp-4)") && css.includes(".tasks-tab-strip { overflow-x: auto;") && css.includes("padding: var(--sp-page-inner); }\n.tasks-tab-strip") && css.includes(".tasks-filter-panel { padding: var(--sp-page-inner);") && css.includes(".filter-panel { padding: var(--sp-page-inner, var(--sp-4))"));
check("task and general filter rows adapt to the child count", /\.tasks-filter-controls \{[^}]*repeat\(auto-fit,/.test(css) && /\.filter-panel \.filter-toolbar \{[^}]*repeat\(auto-fit,/.test(css) && !/\.tasks-filter-controls \{[^}]*repeat\(2,/.test(css));
check("390px filter stack is retained", css.includes("@media (max-width: 599px) { .tasks-filter-controls { grid-template-columns: minmax(0, 1fr); }"));
check("task employee control is limited to team viewers", tasks.includes('data-testid="tasks-employee-filter"') && tasks.includes("{isTeamViewer ? <div className=\"field\"") && tasks.includes("employeeDirectory.map((entry) => <option") && tasks.includes('value="ALL">{t("taskFilterAllEmployees")}'));
check("employee predicate drives task badges, list and result count", tasks.includes('task.assignee !== taskEmployeeFilter') && ["needsAssignment.filter(matchesTask).length", "myTasks.filter(matchesTask).length", "createdTasks.filter(matchesTask).length", "return base.filter(matchesTask)"].every((part) => tasks.includes(part)) && tasks.includes("shown={visibleTasks(activeTab).length}") && toolbar.includes("String(shown)"));
check("employee chip and clear-all use the same filter state", tasks.includes('key: "task-employee"') && tasks.includes('onRemove: () => setTaskEmployeeFilter("ALL")') && tasks.slice(tasks.indexOf("const clearAll ="), tasks.indexOf("const chips:")).includes('setTaskEmployeeFilter("ALL")'));
check("both locales supply all touched filter copy", ["taskFilterAllEmployees", "taskTimesheetFilterEmployee", "taskFiltersApplied", "taskFilterRemove", "taskFiltersClearAll", "taskFiltersShowing", "taskFilterAllStatuses"].every((key) => (dict.match(new RegExp(`\\b${key}:`, "g")) ?? []).length === 2));
const requestFilters = read("screens/MyRequestsPage.tsx").split('className="filter-panel page-filter-panel"')[1]?.split("{filtered.length === 0 ?")[0] ?? "";
check("requests toolbar has no hardcoded bilingual filter copy", requestFilters.includes('t("taskFilterAllStatuses")') && requestFilters.includes('t("taskFiltersClearAll")') && !requestFilters.includes('locale === "ar"'));
const ids = ["create-task-open", "assign-${task.id}", "task-status-${status.toLowerCase()}", "task-timer-start", "task-timer-stop", "task-time-entry", "timesheet-section", "timesheet-name-filter", "timesheet-period-filter", "timesheet-employee-filter", "timesheet-total", "timesheet-custom-range", "timesheet-custom-from", "timesheet-custom-to", "timesheet-custom-apply", "tasks-filter-toolbar", "tasks-clear-all", "tasks-status-filter", "tasks-tabpanel", "tasks-tab-${tab.id}"];
const missingIds = ids.filter((id) => !taskSources.includes(id));
check("all load-bearing task testids and ids remain", missingIds.length === 0, missingIds);

// H7b: check the remaining routes by name so a future page cannot silently
// replace a shared state or reintroduce an ad-hoc page-level filter.
const sweptFiles = [
  "screens/MyTimesheetsPage.tsx", "screens/NotificationsPage.tsx", "screens/ProfilePage.tsx",
  "screens/RequestDetailPage.tsx", "screens/TeamReviewsPage.tsx",
  "screens/admin/AdminOverviewPage.tsx", "screens/admin/AdminPeopleDetailPage.tsx",
  "screens/admin/AdminAnnouncementsPage.tsx",
];
const swept = sweptFiles.map((file) => ({ file, source: read(file) }));
check("all eight remaining pages keep the shared header and surface", swept.every(({ source }) => source.includes("<PageHeader") && /work-surface|OperationalTable/.test(source)));
const asyncPages = swept.filter(({ file }) => !/ProfilePage|AdminPeopleDetailPage/.test(file));
const missingStates = asyncPages.filter(({ source }) => !["<SkeletonRows", "<ErrorState", "<EmptyState"].every((part) => source.includes(part))).map(({ file }) => file);
check("async swept pages use shared loading, error and empty states", missingStates.length === 0, missingStates);
const bareStates = swept.filter(({ source }) => /<div\s+className="(?:empty-state|error-state|loading-state|empty|error)"/.test(source)).map(({ file }) => file);
check("swept pages do not render bare state divs", bareStates.length === 0, bareStates);
const unframedDetailState = ["screens/MyTimesheetsPage.tsx", "screens/RequestDetailPage.tsx", "screens/TeamReviewsPage.tsx"]
  .filter((file) => /return <(?:SkeletonRows|ErrorState)/.test(read(file)));
check("detail-route loading and error keep the page header frame", unframedDetailState.length === 0, unframedDetailState);
const adHocFilter = swept.filter(({ source }) => /className="[^"]*(?:filter-toolbar|filter-panel)[^"]*"/.test(source) && !source.includes('className="filter-panel')).map(({ file }) => file);
check("swept page-level filters use the shared panel grammar", adHocFilter.length === 0, adHocFilter);
check("announcement recipient search keeps field, result count and clear action", read("screens/admin/AdminAnnouncementsPage.tsx").includes('className="field announce-picker-search"') && read("screens/admin/AdminAnnouncementsPage.tsx").includes('t("hrAnnouncementAudienceSearchCount")') && read("screens/admin/AdminAnnouncementsPage.tsx").includes('t("hrAnnouncementClearSelection")'));
check("new swept empty-state copy comes from both locales", ["queueEmpty", "reviewEntriesEmpty"].every((key) => (dict.match(new RegExp(`\\b${key}:`, "g")) ?? []).length === 2) && read("screens/TeamReviewsPage.tsx").includes('message={t("reviewEntriesEmpty")}') && read("screens/TeamReviewsPage.tsx").includes('message={t("queueEmpty")}'));
check("admin responsive form tracks and review tabs reuse the page inset", css.includes(".people-facts-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }") && css.includes(".review-queue { padding: var(--sp-page-inner); }") && css.includes(".review-tabs { display: flex;") && css.includes("overflow-x: auto; }\n.review-tab"));
check("employee detail segmented choices wrap within 390px", read("screens/admin/AdminPeopleDetailPage.tsx").includes('className="page people-detail-page"') && css.includes(".dashboard-grid > * { min-inline-size: 0; }") && css.includes(".people-detail-page .role-segmented { flex-wrap: wrap; }") && css.includes(".people-detail-page .role-segmented-option { flex: 1 1 min(100%, 9rem); min-inline-size: 0; }"));

if (failed) process.exit(1);
console.log("ALL CHECKS PASSED");
