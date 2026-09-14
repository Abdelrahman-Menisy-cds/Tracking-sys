/**
 * Mock data — clearly-labelled demo data mirroring the real backend contract
 * (backend/reqs, backend/timesheets, backend/review, backend/notifications on main).
 * No backend integration is claimed; nothing here calls the network.
 */
import type { Locale, Role } from "../i18n/dict";

export type RequestStatus =
  | "DRAFT"
  | "PENDING_MANAGER"
  | "PENDING_HR"
  | "APPROVED"
  | "REJECTED"
  | "RETURNED"
  | "CANCELLED";

export type TimesheetStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" | "REJECTED";

export interface RequestTypeMock {
  id: number;
  name: { ar: string; en: string };
  requires_hr_approval: boolean;
}

export interface RequestEventMock {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  comment: string;
  created_at: string;
  actor: string;
}

export interface AttachmentMock {
  id: string;
  original_filename: string;
  declared_content_type: string;
  size_bytes: number;
  scan_status: "clean" | "pending" | "quarantined";
  created_at: string;
}

/** Mirrors ReviewRequestSerializer / EmployeeRequestSerializer shape. */
export interface RequestMock {
  id: string;
  requester_id: string;
  requester_name: { ar: string; en: string };
  request_type: { id: number; name: { ar: string; en: string }; requires_hr_approval: boolean };
  title: string;
  details: string;
  status: RequestStatus;
  version: number;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  attachments: AttachmentMock[];
  events: RequestEventMock[];
  permissions: { can_decide: boolean };
}

export interface TimeEntryMock {
  id: string;
  work_date: string;
  duration_minutes: number;
  unpaid_break_minutes: number;
  description: string;
}

export interface TimesheetMock {
  id: string;
  employee_name: { ar: string; en: string };
  week_start: string;
  status: TimesheetStatus;
  version: number;
  entries: TimeEntryMock[];
  events: RequestEventMock[];
  permissions: { can_decide: boolean };
}

export interface NotificationMock {
  id: string;
  kind: string;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  created_at: string;
  read_at: string | null;
  is_read: boolean;
  related_object: { type: string; id: string; available: boolean } | null;
}

const iso = (daysAgo: number, hour = 10): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 24, 0, 0);
  return d.toISOString();
};

const monday = (weeksAgo: number): string => {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // back to Monday
  d.setDate(d.getDate() - diff - weeksAgo * 7);
  return d.toISOString().slice(0, 10);
};

export const requestTypes: RequestTypeMock[] = [
  { id: 1, name: { ar: "إجازة اعتيادية", en: "Annual leave" }, requires_hr_approval: false },
  { id: 2, name: { ar: "إجازة مرضية", en: "Sick leave" }, requires_hr_approval: true },
  { id: 3, name: { ar: "تصحيح سجل وقت", en: "Timesheet correction" }, requires_hr_approval: true },
  { id: 4, name: { ar: "تصريح خروج أثناء اليوم", en: "Day exit permit" }, requires_hr_approval: false },
];

const ev = (
  id: string,
  actor: string,
  action: string,
  from: string | null,
  to: string,
  comment: string,
  daysAgo: number,
): RequestEventMock => ({
  id,
  actor,
  action,
  from_status: from,
  to_status: to,
  comment,
  created_at: iso(daysAgo),
});

/** Current demo user names per role. */
export const demoUser = {
  employee: { name: { ar: "كريم مصطفى", en: "Karim Mostafa" }, email: "karim.mostafa@example.com" },
  manager: { name: { ar: "هالة عبد الرحمن", en: "Hala Abdelrahman" }, email: "hala.abdelrahman@example.com" },
  hr: { name: { ar: "منى شريف", en: "Mona Sherif" }, email: "mona.sherif@example.com" },
};

/** Team members for manager/HR demo scope. */
export const team = [
  { id: "e2", name: { ar: "أحمد سعيد", en: "Ahmed Saeed" } },
  { id: "e3", name: { ar: "نور الدين", en: "Nour Eldin" } },
  { id: "e4", name: { ar: "سلمى فؤاد", en: "Salma Fouad" } },
];

const att = (id: string, name: string, type: string, kb: number, scan: AttachmentMock["scan_status"], daysAgo: number): AttachmentMock => ({
  id,
  original_filename: name,
  declared_content_type: type,
  size_bytes: kb * 1024,
  scan_status: scan,
  created_at: iso(daysAgo),
});

export const myRequests: RequestMock[] = [
  {
    id: "r-1001",
    requester_id: "e1",
    requester_name: demoUser.employee.name,
    request_type: requestTypes[0],
    title: "إجازة اعتيادية — 3 أيام",
    details: "إجازة اعتيادية من الأحد إلى الثلاثاء لأمر عائلي.",
    status: "PENDING_MANAGER",
    version: 2,
    submitted_at: iso(1),
    created_at: iso(2),
    updated_at: iso(1),
    attachments: [att("a-1", "leave-form.pdf", "application/pdf", 180, "clean", 2)],
    events: [
      ev("ev-1", "كريم مصطفى", "CREATE", null, "DRAFT", "", 3),
      ev("ev-2", "كريم مصطفى", "SUBMIT", "DRAFT", "PENDING_MANAGER", "", 1),
    ],
    permissions: { can_decide: false },
  },
  {
    id: "r-1002",
    requester_id: "e1",
    requester_name: demoUser.employee.name,
    request_type: requestTypes[2],
    title: "تصحيح سجل وقت — الأسبوع 36",
    details: "تصحيح مدة يوم الثلاثاء؛ تم إدخال المدة بخطأ.",
    status: "RETURNED",
    version: 4,
    submitted_at: iso(5),
    created_at: iso(6),
    updated_at: iso(3),
    attachments: [],
    events: [
      ev("ev-3", "كريم مصطفى", "CREATE", null, "DRAFT", "", 6),
      ev("ev-4", "كريم مصطفى", "SUBMIT", "DRAFT", "PENDING_MANAGER", "", 5),
      ev("ev-5", "هالة عبد الرحمن", "RETURN", "PENDING_MANAGER", "RETURNED", "أرفق إيصال الحضور المعدل.", 3),
    ],
    permissions: { can_decide: false },
  },
  {
    id: "r-1003",
    requester_id: "e1",
    requester_name: demoUser.employee.name,
    request_type: requestTypes[3],
    title: "تصريح خروج — موعد بنك",
    details: "تصريح خروج ساعة واحدة ظهرًا.",
    status: "APPROVED",
    version: 3,
    submitted_at: iso(8),
    created_at: iso(9),
    updated_at: iso(7),
    attachments: [],
    events: [
      ev("ev-6", "كريم مصطفى", "SUBMIT", "DRAFT", "PENDING_MANAGER", "", 8),
      ev("ev-7", "هالة عبد الرحمن", "APPROVE", "PENDING_MANAGER", "APPROVED", "", 7),
    ],
    permissions: { can_decide: false },
  },
  {
    id: "r-1004",
    requester_id: "e1",
    requester_name: demoUser.employee.name,
    request_type: requestTypes[1],
    title: "إجازة مرضية — يوم واحد",
    details: "إجازة مرضية مع تقرير طبيب.",
    status: "PENDING_HR",
    version: 2,
    submitted_at: iso(2),
    created_at: iso(2),
    updated_at: iso(2),
    attachments: [att("a-2", "medical-report.jpg", "image/jpeg", 420, "clean", 2)],
    events: [
      ev("ev-8", "كريم مصطفى", "SUBMIT", "DRAFT", "PENDING_MANAGER", "", 2),
      ev("ev-9", "هالة عبد الرحمن", "APPROVE", "PENDING_MANAGER", "PENDING_HR", "", 2),
    ],
    permissions: { can_decide: false },
  },
];

/** Requests in the manager's direct-report review scope. */
export const teamRequests: RequestMock[] = [
  {
    id: "r-2001",
    requester_id: "e2",
    requester_name: team[0].name,
    request_type: requestTypes[0],
    title: "إجازة اعتيادية — أسبوع",
    details: "إجازة اعتيادية لمدة أسبوع في أكتوبر.",
    status: "PENDING_MANAGER",
    version: 1,
    submitted_at: iso(1, 9),
    created_at: iso(1, 9),
    updated_at: iso(1, 9),
    attachments: [],
    events: [ev("ev-10", "أحمد سعيد", "SUBMIT", "DRAFT", "PENDING_MANAGER", "", 1)],
    permissions: { can_decide: true },
  },
  {
    id: "r-2002",
    requester_id: "e3",
    requester_name: team[1].name,
    request_type: requestTypes[3],
    title: "تصريح خروج — ظروري",
    details: "تصريح خروج نصف ساعة نهاية الدوام.",
    status: "PENDING_MANAGER",
    version: 1,
    submitted_at: iso(0, 11),
    created_at: iso(0, 11),
    updated_at: iso(0, 11),
    attachments: [],
    events: [ev("ev-11", "نور الدين", "SUBMIT", "DRAFT", "PENDING_MANAGER", "", 0)],
    permissions: { can_decide: true },
  },
  {
    id: "r-2003",
    requester_id: "e4",
    requester_name: team[2].name,
    request_type: requestTypes[1],
    title: "إجازة مرضية — يومان",
    details: "إجازة مرضية مع تقرير طبيب.",
    status: "PENDING_MANAGER",
    version: 2,
    submitted_at: iso(2),
    created_at: iso(2),
    updated_at: iso(2),
    attachments: [att("a-3", "report-scan.pdf", "application/pdf", 260, "clean", 2)],
    events: [ev("ev-12", "سلمى فؤاد", "SUBMIT", "DRAFT", "PENDING_MANAGER", "", 2)],
    permissions: { can_decide: true },
  },
];

const day = (id: string, date: string, mins: number, brk: number, desc: string): TimeEntryMock => ({
  id,
  work_date: date,
  duration_minutes: mins,
  unpaid_break_minutes: brk,
  description: desc,
});

export const myTimesheets: TimesheetMock[] = [
  {
    id: "t-3001",
    employee_name: demoUser.employee.name,
    week_start: monday(0),
    status: "DRAFT",
    version: 3,
    entries: [
      day("te-1", monday(0), 480, 45, "مهام التطوير الأساسية"),
      day("te-2", monday(0).replace(/.$/, String(Number(monday(0).slice(-1)) + 1 % 10)), 420, 30, "اجتماعات الفريق"),
    ],
    events: [ev("ev-13", "كريم مصطفى", "CREATE", null, "DRAFT", "", 0)],
    permissions: { can_decide: false },
  },
  {
    id: "t-3002",
    employee_name: demoUser.employee.name,
    week_start: monday(1),
    status: "SUBMITTED",
    version: 2,
    entries: [day("te-3", monday(1), 480, 60, "أسبوع كامل")],
    events: [ev("ev-14", "كريم مصطفى", "SUBMIT", "DRAFT", "SUBMITTED", "", 7)],
    permissions: { can_decide: false },
  },
  {
    id: "t-3003",
    employee_name: demoUser.employee.name,
    week_start: monday(2),
    status: "APPROVED",
    version: 4,
    entries: [day("te-4", monday(2), 450, 45, "أسبوع معتمد")],
    events: [ev("ev-15", "هالة عبد الرحمن", "APPROVE", "SUBMITTED", "APPROVED", "", 14)],
    permissions: { can_decide: false },
  },
];

export const teamTimesheets: TimesheetMock[] = [
  {
    id: "t-4001",
    employee_name: team[0].name,
    week_start: monday(0),
    status: "SUBMITTED",
    version: 1,
    entries: [
      day("te-5", monday(0), 480, 30, "دعم العملاء"),
      day("te-6", monday(0).replace(/.$/, String(Number(monday(0).slice(-1)) + 1 % 10)), 510, 30, "دعم العملاء"),
    ],
    events: [ev("ev-16", "أحمد سعيد", "SUBMIT", "DRAFT", "SUBMITTED", "", 1)],
    permissions: { can_decide: true },
  },
  {
    id: "t-4002",
    employee_name: team[2].name,
    week_start: monday(0),
    status: "SUBMITTED",
    version: 1,
    entries: [day("te-7", monday(0), 465, 45, "تحليل بيانات")],
    events: [ev("ev-17", "سلمى فؤاد", "SUBMIT", "DRAFT", "SUBMITTED", "", 1)],
    permissions: { can_decide: true },
  },
];

export const notifications: NotificationMock[] = [
  {
    id: "n-1",
    kind: "request_submitted",
    title: { ar: "طلب جديد بانتظار مراجعتك", en: "New request awaiting your review" },
    body: {
      ar: "أحمد سعيد أرسل طلب إجازة اعتيادية.",
      en: "Ahmed Saeed submitted an annual leave request.",
    },
    created_at: iso(0, 9),
    read_at: null,
    is_read: false,
    related_object: { type: "request", id: "r-2001", available: true },
  },
  {
    id: "n-2",
    kind: "request_returned",
    title: { ar: "تم إعادة طلبك للتعديل", en: "Your request was returned for correction" },
    body: {
      ar: "طلب تصحيح سجل الوقت أُعيد للتعديل مع ملاحظة من المراجع.",
      en: "Your timesheet correction request was returned with a reviewer note.",
    },
    created_at: iso(3),
    read_at: null,
    is_read: false,
    related_object: { type: "request", id: "r-1002", available: true },
  },
  {
    id: "n-3",
    kind: "request_approved",
    title: { ar: "تم اعتماد طلبك", en: "Your request was approved" },
    body: { ar: "تم اعتماد تصريح الخروج.", en: "Your exit permit was approved." },
    created_at: iso(7),
    read_at: iso(6),
    is_read: true,
    related_object: { type: "request", id: "r-1003", available: true },
  },
  {
    id: "n-4",
    kind: "system",
    title: { ar: "سجل غير متاح", en: "Record unavailable" },
    body: {
      ar: "إشعار يشير إلى سجل لم يعد متاحًا لك.",
      en: "A notification referencing a record no longer available to you.",
    },
    created_at: iso(10),
    read_at: null,
    is_read: false,
    related_object: { type: "request", id: "r-9999", available: false },
  },
];

export const stateDemoControl = {
  /** Forces a network-error state for the next list render — demo state control. */
  failNext: false,
  /** Forces a loading (skeleton) state for the next list render. */
  loadingNext: false,
  /** Forces the empty (first-use) state for the next list render. */
  emptyNext: false,
};

/** Simulated latency + state overrides so reviewers can see every UI state. */
export function mockFetch<T>(data: T, delayMs = 350): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (stateDemoControl.failNext) {
        stateDemoControl.failNext = false;
        reject(new Error("network"));
        return;
      }
      stateDemoControl.loadingNext = false;
      resolve(data);
    }, delayMs);
  });
}

export function pickName(value: { ar: string; en: string }, locale: Locale): string {
  return value[locale];
}

export function roleHomeLabel(role: Role): string {
  return role;
}
