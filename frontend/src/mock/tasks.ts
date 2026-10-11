/**
 * Demo fixtures for the tasks cycle (brief C) — create → assign / route-to-manager.
 * Mirrors the same shape conventions as the other mock modules: id strings from
 * the employee directory (`e1`, `m1`, `hr1`, `e2`…), bilingual names resolved at
 * render time via the directory, append-only event trails — never an in-place
 * history rewrite.
 */
import type { DemoUserProfile } from "./data";

/** Statuses kept as briefed; no additions — nothing in the UI needs more. */
export type TaskStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";

export type TaskPriority = "HIGH" | "MEDIUM" | "LOW";

/**
 * Trail actions. The trail is append-only: an "ASSIGN" that happens when the
 * task already had an assignee is recorded as "REASSIGN" (carrying `replaces`)
 * instead of overwriting anything. STATUS_CHANGE (brief H1) carries from/to
 * statuses the same way — the from values live on to keep history honest.
 */
export type TaskEventAction = "CREATE" | "ROUTE_TO_MANAGER" | "ASSIGN" | "REASSIGN" | "STATUS_CHANGE";

export interface TaskEventMock {
  id: string;
  action: TaskEventAction;
  /** Directory id of the actor — resolved to a localized name at render time. */
  actor: string;
  /** The assignee an ASSIGN / REASSIGN event put on the task. */
  assigned?: string;
  /** The previous assignee a REASSIGN event replaced. */
  replaces?: string;
  /** The manager a ROUTE_TO_MANAGER event targeted. */
  routed_to?: string;
  /** The status a STATUS_CHANGE event moved FROM (brief H1). */
  from_status?: TaskStatus;
  /** The status a STATUS_CHANGE event moved TO (brief H1). */
  to_status?: TaskStatus;
  comment: string;
  created_at: string;
}

/** Mirrors the briefed task shape; the trail rides on the record itself. */
export interface TaskMock {
  id: string;
  title: string;
  description: string;
  /** Directory id of the creator — always recorded, never overwritten. */
  created_by: string;
  assignee: string | null;
  /** The manager the task was routed to when the creator cannot assign. */
  routed_to_manager: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string;
  created_at: string;
  events: TaskEventMock[];
}

/** Honest demo mutation surface, shaped like attendance's AttendanceMutationResult. */
export type TaskMutationCode = "CAPABILITY_DENIED" | "MISSING_RECORD" | "INVALID_INPUT";
export type TaskMutationResult<T = void> =
  | { ok: true; value?: T }
  | { ok: false; code: TaskMutationCode };

/** The two per-employee flags the brief asks for; manager and HR hold both. */
export interface TaskCapability {
  can_create_tasks: boolean;
  can_assign_tasks: boolean;
}

/** Sensible default for a directory entry not listed: no task capability. */
export const DEFAULT_TASK_CAPABILITY: TaskCapability = { can_create_tasks: false, can_assign_tasks: false };

/**
 * Seed per employee, exercising every path the brief demands:
 *  - e1 creates AND assigns (the direct-assign creator);
 *  - e2 creates but CANNOT assign (their creations route to a manager);
 *  - e3 and e4 cannot create at all;
 *  - m1 / hr1 / the directory managers hold both.
 */
export const taskCapabilitiesById: Record<string, TaskCapability> = {
  e1: { can_create_tasks: true, can_assign_tasks: true },
  e2: { can_create_tasks: true, can_assign_tasks: false },
  e3: { can_create_tasks: false, can_assign_tasks: false },
  e4: { can_create_tasks: false, can_assign_tasks: false },
  m1: { can_create_tasks: true, can_assign_tasks: true },
  hr1: { can_create_tasks: true, can_assign_tasks: true },
  "emp-2001": { can_create_tasks: true, can_assign_tasks: true },
  "emp-2002": { can_create_tasks: true, can_assign_tasks: true },
  "emp-2003": { can_create_tasks: true, can_assign_tasks: true },
};

const iso = (daysAgo: number, hour = 10): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const isoDate = (inDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + inDays);
  return d.toISOString().slice(0, 10);
};

const tee = (
  id: string,
  action: TaskEventAction,
  actor: string,
  comment: string,
  daysAgo: number,
  extra: Partial<Pick<TaskEventMock, "assigned" | "replaces" | "routed_to">> = {},
): TaskEventMock => ({ id, action, actor, comment, created_at: iso(daysAgo), ...extra });

/**
 * Seed covering: a directly-assigned task for e1, an in-progress one, and the
 * routed-but-unassigned task that lands in m1's needs-assignment queue (created
 * by e2, who cannot assign). Actor fields are directory ids, not names.
 */
export const demoTasks: TaskMock[] = [
  {
    id: "t-6001",
    title: "تجهيز تقرير الحضور الشهري",
    description: "تجميع أرقام الحضور لشهر أكتوبر ومراجعة الاستثناءات قبل الإرسال.",
    created_by: "m1",
    assignee: "e1",
    routed_to_manager: null,
    status: "OPEN",
    priority: "HIGH",
    due_date: isoDate(3),
    created_at: iso(2, 9),
    events: [
      tee("t-6001-ev-1", "CREATE", "m1", "", 2),
      tee("t-6001-ev-2", "ASSIGN", "m1", "", 2, { assigned: "e1" }),
    ],
  },
  {
    id: "t-6002",
    title: "مراجعة سياسة الهجين مع الفريق",
    description: "جمع ملاحظات الفريق حول حصة أيام المكتب قبل تعديل السياسة.",
    created_by: "m1",
    assignee: "e3",
    routed_to_manager: null,
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    created_at: iso(5, 11),
    events: [
      tee("t-6002-ev-1", "CREATE", "m1", "", 5),
      tee("t-6002-ev-2", "ASSIGN", "m1", "", 5, { assigned: "e3" }),
    ],
  },
  {
    id: "t-6003",
    title: "تحديث إرشادات الدعم الفني",
    description: "لهذا الموظف صلاحية إنشاء بلا صلاحية تكليف — تُحوّل لمديره ليكلف بها أحدًا.",
    created_by: "e2",
    assignee: null,
    routed_to_manager: "m1",
    status: "OPEN",
    priority: "LOW",
    due_date: isoDate(7),
    created_at: iso(1, 12),
    events: [
      tee("t-6003-ev-1", "CREATE", "e2", "", 1),
      tee("t-6003-ev-2", "ROUTE_TO_MANAGER", "e2", "لا أملك صلاحية التكليف — التكليف ضمن عمل المدير.", 1, { routed_to: "m1" }),
    ],
  },
  {
    id: "t-6004",
    title: "أرشفة ملفات العقد لعام 2025",
    description: "نموذج لمهمة منتهية تظهر في السجل دون إجراء متاح.",
    created_by: "hr1",
    assignee: "e4",
    routed_to_manager: null,
    status: "DONE",
    priority: "MEDIUM",
    created_at: iso(9, 9),
    events: [
      tee("t-6004-ev-1", "CREATE", "hr1", "", 9),
      tee("t-6004-ev-2", "ASSIGN", "hr1", "", 9, { assigned: "e4" }),
    ],
  },
];

/**
 * Open work for the team members who appear in the manager's review queue. A manager
 * deciding on leave needs to know what deadlines the request collides with and whether
 * the rest of the department can absorb them, so the demo carries real tasks for those
 * three people instead of leaving the queue's requesters with an empty workload. These
 * are ordinary fixtures — /tasks lists them, nothing is special-cased for the suggestion.
 */
function reviewTeamTask(
  id: string,
  title: string,
  description: string,
  assignee: string,
  status: TaskStatus,
  priority: TaskPriority,
  dueInDays: number | null,
  createdDaysAgo: number,
): TaskMock {
  const events: TaskEventMock[] = [tee(`${id}-ev-1`, "CREATE", "m1", "", createdDaysAgo)];
  events.push(tee(`${id}-ev-2`, "ASSIGN", "m1", "", createdDaysAgo, { assigned: assignee }));
  return {
    id,
    title,
    description,
    created_by: "m1",
    assignee,
    routed_to_manager: null,
    status,
    priority,
    ...(dueInDays === null ? {} : { due_date: isoDate(dueInDays) }),
    created_at: iso(createdDaysAgo, 9),
    events,
  };
}

export const reviewTeamTasks: TaskMock[] = [
  // e2 asked for a week of annual leave: two deadlines land inside that week.
  reviewTeamTask("t-6101", "تسليم تقرير تشغيل الفرع", "تجميع أرقام الفرع لشهر أكتوبر وتسليمها للإدارة الإقليمية.", "e2", "OPEN", "HIGH", 4, 6),
  reviewTeamTask("t-6102", "مطابقة فواتير الموردين", "مطابقة فواتير سبتمبر مع أوامر الشراء وإغلاق الفروقات.", "e2", "IN_PROGRESS", "MEDIUM", 2, 8),
  reviewTeamTask("t-6103", "تحديث دليل الإجراءات", "إضافة التعديلات الأخيرة على إجراءات الاستلام والتسليم.", "e2", "OPEN", "LOW", 12, 4),
  // e3 asked for a 30-minute exit: the nearest deadline is well beyond it.
  reviewTeamTask("t-6111", "مراجعة طلبات الاشتراك", "مراجعة طلبات الاشتراك الجديدة والرد على الاستفسارات المعلّقة.", "e3", "OPEN", "MEDIUM", 9, 5),
  reviewTeamTask("t-6112", "تدقيق بيانات العملاء", "تدقيق بيانات العملاء المكرّرة قبل تحديث قاعدة البيانات.", "e3", "IN_PROGRESS", "LOW", 15, 7),
  // e4 asked for two sick days: one deadline falls inside them.
  reviewTeamTask("t-6121", "تجهيز عرض العميل الجديد", "تجهيز العرض الفني والمالي لاجتماع العميل الأسبوع القادم.", "e4", "OPEN", "MEDIUM", 1, 3),
  reviewTeamTask("t-6122", "أرشفة مراسلات الربع الثالث", "أرشفة المراسلات الرسمية وربطها بملفات العقود.", "e4", "DONE", "LOW", -3, 10),
];

/** Every task the demo ships: the brief-C seed plus the review queue's own open work. */
export const allDemoTasks: TaskMock[] = [...demoTasks, ...reviewTeamTasks];

/** The demo user's utility — re-used so the creator/assignee rows localize. */
export type { DemoUserProfile };
