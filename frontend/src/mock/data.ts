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
  /** Present on the review API; optional keeps personal fixtures contract-compatible. */
  created_at?: string;
  updated_at?: string;
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

/** Current demo identities per role; all values are fictional fixture data. */
export interface DemoUserProfile {
  name: { ar: string; en: string };
  email: string;
  jobTitle: { ar: string; en: string };
  department: { ar: string; en: string };
  employeeNumber: string;
  phone: string;
  address: { ar: string; en: string };
  directManager: { ar: string; en: string };
  joinDate: string;
}

export const demoUser: Record<Role, DemoUserProfile> = {
  employee: {
    name: { ar: "كريم مصطفى", en: "Karim Mostafa" },
    email: "karim.mostafa@example.com",
    jobTitle: { ar: "أخصائي عمليات", en: "Operations Specialist" },
    department: { ar: "العمليات", en: "Operations" },
    employeeNumber: "EMP-1042",
    phone: "+20 10 5555 1842",
    address: { ar: "شارع النيل، الدقي، الجيزة", en: "Nile Street, Dokki, Giza" },
    directManager: { ar: "هالة عبد الرحمن", en: "Hala Abdelrahman" },
    joinDate: "2022-04-17",
  },
  manager: {
    name: { ar: "هالة عبد الرحمن", en: "Hala Abdelrahman" },
    email: "hala.abdelrahman@example.com",
    jobTitle: { ar: "مدير عمليات الموظفين", en: "Employee Operations Manager" },
    department: { ar: "العمليات", en: "Operations" },
    employeeNumber: "MGR-2087",
    phone: "+20 11 2740 6381",
    address: { ar: "شارع الثورة، مصر الجديدة، القاهرة", en: "El-Thawra Street, Heliopolis, Cairo" },
    directManager: { ar: "طارق منصور", en: "Tarek Mansour" },
    joinDate: "2019-09-02",
  },
  hr: {
    name: { ar: "منى شريف", en: "Mona Sherif" },
    email: "mona.sherif@example.com",
    jobTitle: { ar: "شريك أعمال الموارد البشرية", en: "HR Business Partner" },
    department: { ar: "الموارد البشرية", en: "Human Resources" },
    employeeNumber: "HR-3016",
    phone: "+20 12 8831 4027",
    address: { ar: "شارع التسعين، التجمع الخامس، القاهرة", en: "90th Street, New Cairo, Cairo" },
    directManager: { ar: "سارة حمدي", en: "Sara Hamdy" },
    joinDate: "2020-01-13",
  },
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
    created_at: iso(1),
    updated_at: iso(1),
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
    created_at: iso(1),
    updated_at: iso(1),
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

export const stateDemoControl: { fixture: "ready" | "loading" | "empty" | "error" | "conflict" | "unknown" } = {
  /** Persistent reviewer fixture. Reset to ready explicitly. */
  fixture: "ready",
};

/** Simulated demo latency. Display-state fixtures are handled by useMockList. */
export function mockFetch<T>(data: T, delayMs = 350): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(data), delayMs);
  });
}

export function pickName(value: { ar: string; en: string }, locale: Locale): string {
  return value[locale];
}

export function roleHomeLabel(role: Role): string {
  return role;
}

/* ======================= HR data foundation (demo fixtures) ======================= */

/** Employment categories; HYBRID employees additionally carry a hybrid policy. */
export type EmploymentType = "FULL" | "PART" | "HYBRID" | "REMOTE";

/**
 * The two hybrid office policies the product allows, discriminated so an
 * invalid combination is unrepresentable: FIXED_DAYS names office weekdays
 * and carries no quota; FLEXIBLE_QUOTA carries a quota per period and no
 * named weekdays. Non-hybrid employees carry no hybrid policy at all.
 */
export type HybridWorkPolicy =
  | { mode: "FIXED_DAYS"; office_weekdays: number[] }
  | { mode: "FLEXIBLE_QUOTA"; period_days: number; min_office_days: number };

/** Contract and evaluation records live in the HR-only file, never in free text. */
export interface EmployeeContractMock {
  id: string;
  type: { ar: string; en: string };
  start_date: string;
  end_date: string | null;
}

export interface EmployeeEvaluationMock {
  id: string;
  period: string;
  rating: number; // 1..5
  note: { ar: string; en: string };
}

/** The religion field the HR-only file records; «آخر» carries a free-text detail. */
export type ReligionCode = "MUSLIM" | "CHRISTIAN" | "OTHER";

/**
 * HR-only field group, explicitly marked on the data: no screen may render
 * these without going through `visibleEmployeeFile` with an HR viewer.
 * Shared fields stay on the entry itself (name, department, job title,
 * direct manager, email, phone, join date, employment type).
 */
export interface EmployeeHrOnlyFile {
  hr_only: true;
  salary: { amount: number; currency: "EGP"; payroll_cycle: "MONTHLY" };
  national_id: string;
  bank_account: { bank_name: { ar: string; en: string }; iban: string };
  contracts: EmployeeContractMock[];
  evaluations: EmployeeEvaluationMock[];
  /** Own-religion data: HR edits it; the employee sees only their own value. */
  religion: ReligionCode;
  /** Non-empty exactly when religion is OTHER (or the OTHER path is invalid). */
  religion_other?: string;
}

/**
 * One full-file write from the HR screens: the shared facts plus the whole
 * HR-only slice (rather than per-field mutations). The context stores these
 * as an overlay keyed by employee id; `mergeEmployeeFilePatch` is the single
 * merge rule — a provided `hr_file` replaces the entry's whole HR slice, so a
 * cleared `religion_other` really disappears instead of surviving the merge.
 */
export interface EmployeeFilePatch
  extends Pick<EmployeeDirectoryEntry, "name" | "department" | "job_title" | "direct_manager" | "email" | "phone" | "join_date"> {
  hr_file?: EmployeeHrOnlyFile;
}

/** The context's overlay rule: replace the fields the patch carries. */
export function mergeEmployeeFilePatch(entry: EmployeeDirectoryEntry, patch: EmployeeFilePatch): EmployeeDirectoryEntry {
  return {
    ...entry,
    ...patch,
    ...(patch.hr_file ? { hr_file: patch.hr_file } : {}),
  };
}

export interface EmployeeDirectoryEntry {
  id: string;
  name: { ar: string; en: string };
  email: string;
  job_title: { ar: string; en: string };
  department: { ar: string; en: string };
  employee_number: string;
  phone: string;
  address: { ar: string; en: string };
  /** Directory id of the manager; null only at the top of the hierarchy. */
  direct_manager: string | null;
  join_date: string;
  employment_type: EmploymentType;
  /** Only HYBRID employees carry a hybrid policy. */
  hybrid_policy?: HybridWorkPolicy;
  /** HR-only field group; remove via visibleEmployeeFile before rendering. */
  hr_file?: EmployeeHrOnlyFile;
}

export type EmployeeFileViewer = { id: string; role: Role };

const hrFile = (
  id: string,
  amount: number,
  nationalId: string,
  bankAr: string,
  bankEn: string,
  iban: string,
  contractType: { ar: string; en: string },
  contractStart: string,
  contractEnd: string | null,
  evaluations: EmployeeEvaluationMock[],
  religion: ReligionCode = "MUSLIM",
  religionOther?: string,
): EmployeeHrOnlyFile => ({
  hr_only: true,
  salary: { amount, currency: "EGP", payroll_cycle: "MONTHLY" },
  national_id: nationalId,
  bank_account: { bank_name: { ar: bankAr, en: bankEn }, iban },
  contracts: [{ id: `contract-${id}`, type: contractType, start_date: contractStart, end_date: contractEnd }],
  evaluations,
  religion,
  ...(religion === "OTHER" && religionOther !== undefined ? { religion_other: religionOther } : {}),
});

/**
 * Demo employee directory (~10 people). The three existing fixture users
 * (e1/m1/hr1, mirrored from demoUser above) keep their exact values so every
 * existing screen keeps working; teammates e2..e4 reuse the `team` names.
 */
export const employeeDirectory: EmployeeDirectoryEntry[] = [
  {
    id: "e1",
    name: demoUser.employee.name,
    email: demoUser.employee.email,
    job_title: demoUser.employee.jobTitle,
    department: demoUser.employee.department,
    employee_number: demoUser.employee.employeeNumber,
    phone: demoUser.employee.phone,
    address: demoUser.employee.address,
    direct_manager: "m1",
    join_date: demoUser.employee.joinDate,
    employment_type: "FULL",
    hr_file: hrFile(
      "e1",
      12500,
      "27904120301285",
      "بنك القاهرة",
      "Cairo Bank",
      "EG61 0190 0050 0000 0001 2340 5",
      { ar: "عقد عمل كامل", en: "Full-time employment contract" },
      "2022-04-17",
      null,
      [{ id: "eval-e1-1", period: "2025-H2", rating: 4, note: { ar: "أداء ثابت مع ملاحظات تطويرية بسيطة.", en: "Consistent performance with minor development notes." } }],
    ),
  },
  {
    id: "m1",
    name: demoUser.manager.name,
    email: demoUser.manager.email,
    job_title: demoUser.manager.jobTitle,
    department: demoUser.manager.department,
    employee_number: demoUser.manager.employeeNumber,
    phone: demoUser.manager.phone,
    address: demoUser.manager.address,
    direct_manager: "emp-2001",
    join_date: demoUser.manager.joinDate,
    employment_type: "FULL",
    hr_file: hrFile(
      "m1",
      24000,
      "28509150102993",
      "بنك مصر",
      "Misr Bank",
      "EG38 0190 0050 0000 0002 6340 2",
      { ar: "عقد عمل كامل", en: "Full-time employment contract" },
      "2019-09-02",
      null,
      [{ id: "eval-m1-1", period: "2025-H2", rating: 5, note: { ar: "قيادة فريق ممتازة خلال التوسع.", en: "Excellent team leadership during the expansion." } }],
    ),
  },
  {
    id: "hr1",
    name: demoUser.hr.name,
    email: demoUser.hr.email,
    job_title: demoUser.hr.jobTitle,
    department: demoUser.hr.department,
    employee_number: demoUser.hr.employeeNumber,
    phone: demoUser.hr.phone,
    address: demoUser.hr.address,
    direct_manager: "emp-2002",
    join_date: demoUser.hr.joinDate,
    employment_type: "FULL",
    hr_file: hrFile(
      "hr1",
      22000,
      "29012100104788",
      "بنك القاهرة",
      "Cairo Bank",
      "EG45 0190 0050 0000 0003 0455 1",
      { ar: "عقد عمل كامل", en: "Full-time employment contract" },
      "2020-01-13",
      null,
      [],
    ),
  },
  {
    id: "e2",
    name: team[0].name,
    email: "ahmed.saeed@example.com",
    job_title: { ar: "مهندس دعم فني", en: "Technical Support Engineer" },
    department: { ar: "العمليات", en: "Operations" },
    employee_number: "EMP-1150",
    phone: "+20 10 3312 7495",
    address: { ar: "شارع جامعة الدول العربية، المهندسين، الجيزة", en: "Gameat El-Dowal Street, Mohandessin, Giza" },
    direct_manager: "m1",
    join_date: "2023-03-05",
    employment_type: "HYBRID",
    hybrid_policy: { mode: "FIXED_DAYS", office_weekdays: [0, 2] }, // Sunday + Tuesday, home the rest
    hr_file: hrFile(
      "e2",
      10500,
      "30103050103344",
      "بنك مصر",
      "Misr Bank",
      "EG27 0190 0050 0000 0004 5510 3",
      { ar: "عقد عمل كامل — نظام هجين", en: "Full-time employment contract — hybrid scheme" },
      "2023-03-05",
      null,
      [],
    ),
  },
  {
    id: "e3",
    name: team[1].name,
    email: "nour.eldin@example.com",
    job_title: { ar: "أخصائي ضمان جودة", en: "Quality Assurance Specialist" },
    department: { ar: "العمليات", en: "Operations" },
    employee_number: "EMP-1163",
    phone: "+20 11 6620 1853",
    address: { ar: "شارع مرسطو، ساقية المكي، الجيزة", en: "Marsout Street, Sagia El-Meky, Giza" },
    direct_manager: "m1",
    join_date: "2023-08-27",
    employment_type: "HYBRID",
    hybrid_policy: { mode: "FLEXIBLE_QUOTA", period_days: 7, min_office_days: 2 }, // 2 office days per week, any working days
    hr_file: hrFile(
      "e3",
      9800,
      "30408270105667",
      "بنك مصر",
      "Misr Bank",
      "EG74 0190 0050 0000 0005 1220 8",
      { ar: "عقد عمل كامل — نظام هجين", en: "Full-time employment contract — hybrid scheme" },
      "2023-08-27",
      null,
      [],
    ),
  },
  {
    id: "e4",
    name: team[2].name,
    email: "salma.fouad@example.com",
    job_title: { ar: "محلل بيانات", en: "Data Analyst" },
    department: { ar: "العمليات", en: "Operations" },
    employee_number: "EMP-1201",
    phone: "+20 12 9046 3371",
    address: { ar: "شارع بورسعيد، مدينة نصر، القاهرة", en: "Port Said Street, Nasr City, Cairo" },
    direct_manager: "m1",
    join_date: "2024-02-04",
    employment_type: "FULL",
    hr_file: hrFile(
      "e4",
      13500,
      "30402040102906",
      "بنك القاهرة",
      "Cairo Bank",
      "EG90 0190 0050 0000 0006 7789 2",
      { ar: "عقد عمل كامل", en: "Full-time employment contract" },
      "2024-02-04",
      null,
      [],
    ),
  },
  {
    id: "emp-2001",
    name: { ar: "طارق منصور", en: "Tarek Mansour" },
    email: "tarek.mansour@example.com",
    job_title: { ar: "مدير عام العمليات", en: "Operations Director" },
    department: { ar: "العمليات", en: "Operations" },
    employee_number: "MGR-2090",
    phone: "+20 11 7700 2514",
    address: { ar: "شارع الخمسين، التجمع الخامس، القاهرة", en: "50th Street, New Cairo, Cairo" },
    direct_manager: "emp-2005",
    join_date: "2016-11-06",
    employment_type: "FULL",
    hr_file: hrFile(
      "emp-2001",
      38000,
      "26611060102471",
      "بنك مصر",
      "Misr Bank",
      "EG55 0190 0050 0000 0007 9001 4",
      { ar: "عقد عمل كامل", en: "Full-time employment contract" },
      "2016-11-06",
      null,
      [{ id: "eval-emp2001-1", period: "2025-H1", rating: 4, note: { ar: "شحن قوي للأداء التشغيلي.", en: "Strong operational delivery." } }],
    ),
  },
  {
    id: "emp-2002",
    name: { ar: "سارة حمدي", en: "Sara Hamdy" },
    email: "sara.hamdy@example.com",
    job_title: { ar: "مديرة الموارد البشرية", en: "HR Director" },
    department: { ar: "الموارد البشرية", en: "Human Resources" },
    employee_number: "HR-3018",
    phone: "+20 10 9931 4476",
    address: { ar: "شارع مشرع السوف، بلبيس، الشرقية", en: "Mashrar El-Souf Street, Belbeis, Sharqia" },
    direct_manager: "emp-2005",
    join_date: "2018-02-11",
    employment_type: "FULL",
    hr_file: hrFile(
      "emp-2002",
      35000,
      "29202110102107",
      "بنك القاهرة",
      "Cairo Bank",
      "EG12 0190 0050 0000 0008 3345 0",
      { ar: "عقد عمل كامل", en: "Full-time employment contract" },
      "2018-02-11",
      null,
      [],
    ),
  },
  {
    id: "emp-2003",
    name: { ar: "حسن فاروق", en: "Hassan Farouk" },
    email: "hassan.farouk@example.com",
    job_title: { ar: "مدير الإدارة المالية", en: "Finance Manager" },
    department: { ar: "المالية", en: "Finance" },
    employee_number: "EMP-0227",
    phone: "+20 11 2214 6608",
    address: { ar: "شارع الحجاز، مصر الجديدة، القاهرة", en: "Al-Higaz Street, Heliopolis, Cairo" },
    direct_manager: "emp-2005",
    join_date: "2021-07-04",
    employment_type: "HYBRID",
    hybrid_policy: { mode: "FLEXIBLE_QUOTA", period_days: 14, min_office_days: 3 },
    hr_file: hrFile(
      "emp-2003",
      30000,
      "29707040109763",
      "بنك مصر",
      "Misr Bank",
      "EG68 0190 0050 0000 0009 9087 6",
      { ar: "عقد عمل كامل — نظام هجين", en: "Full-time employment contract — hybrid scheme" },
      "2021-07-04",
      null,
      [{ id: "eval-emp2003-1", period: "2025-H2", rating: 4, note: { ar: "إقفال مالي دقيق وموثوق.", en: "Accurate and reliable financial close." } }],
      "CHRISTIAN",
    ),
  },
  {
    id: "emp-2004",
    name: { ar: "دينا زكريا", en: "Dina Zakaria" },
    email: "dina.zakaria@example.com",
    job_title: { ar: "أخصائية مالية", en: "Finance Specialist" },
    department: { ar: "المالية", en: "Finance" },
    employee_number: "EMP-1402",
    phone: "+20 15 5099 2730",
    address: { ar: "شارع طه حسين، الزمالك، القاهرة", en: "Taha Hussein Street, Zamalek, Cairo" },
    direct_manager: "emp-2003",
    join_date: "2025-06-01",
    employment_type: "PART", // Part-time: no hybrid policy; smaller leave entitlements by default.
    hr_file: hrFile(
      "emp-2004",
      8000,
      "30606010108429",
      "بنك القاهرة",
      "Cairo Bank",
      "EG83 0190 0050 0000 0001 0012 9",
      { ar: "عقد دوام جزئي", en: "Part-time employment contract" },
      "2025-06-01",
      "2026-12-31",
      [],
      "OTHER",
      "معتنقة للمسيحية إثر زواجها", // AR tail reaches the OTHER path in fixtures
    ),
  },
  {
    id: "emp-2005",
    name: { ar: "ماجد كامل", en: "Magued Kamel" },
    email: "magued.kamel@example.com",
    job_title: { ar: "الرئيس التنفيذي", en: "Chief Executive Officer" },
    department: { ar: "الإدارة العليا", en: "Executive Office" },
    employee_number: "EMP-0772",
    phone: "+20 10 1147 8826",
    address: { ar: "حديقة الأزهر، وسط البلد، القاهرة", en: "Azhar Park, Downtown, Cairo" },
    direct_manager: null,
    join_date: "2015-03-08",
    employment_type: "REMOTE",
    hr_file: hrFile(
      "emp-2005",
      60000,
      "28903080101207",
      "بنك مصر",
      "Misr Bank",
      "EG49 0190 0050 0000 0002 2276 0",
      { ar: "عقد عمل كامل", en: "Full-time employment contract" },
      "2015-03-08",
      null,
      [{ id: "eval-emp2005-1", period: "2025-H2", rating: 5, note: { ar: "قيادة استراتيجية مستقرة.", en: "Steady strategic leadership." } }],
    ),
  },
];

/**
 * Filter the employee file for a viewer: HR keeps the whole record, everyone
 * else gets a copy with the entire `hr_only` group removed, so an HR-only
 * field is unreachable from the render path rather than merely hidden.
 */
export function visibleEmployeeFile(entry: EmployeeDirectoryEntry, viewer: EmployeeFileViewer): EmployeeDirectoryEntry {
  if (viewer.role === "hr") return entry;
  const { hr_file: _hrOnly, ...visible } = entry;
  return visible;
}

/** Stable id lookup for directory references (direct_manager, recipients, …). */
export function findDirectoryEntry(id: string): EmployeeDirectoryEntry | undefined {
  return employeeDirectory.find((entry) => entry.id === id);
}

/* ============================ Announcements (demo) ============================ */

export type AnnouncementChannel = "EMAIL" | "NOTIFICATION" | "BOTH";
export type AnnouncementAudience = "ALL" | "SELECTED";
/** Honest demo lifecycle: a send starts PENDING and only settles later. */
export type AnnouncementStatus = "PENDING" | "CONFIRMED" | "UNKNOWN" | "CONFLICT";

export interface AnnouncementMock {
  id: string;
  subject: string;
  body: string;
  attachments: AttachmentMock[];
  channel: AnnouncementChannel;
  audience: AnnouncementAudience;
  /** Recipient directory ids; empty for the ALL audience. */
  recipient_ids: string[];
  created_by: string;
  created_at: string;
  status: AnnouncementStatus;
}

/**
 * Build the initial send record for an announcement. Always starts PENDING —
 * this stands in for a real dispatch, so it never reports success
 * synchronously and never touches a real mail or notification API; the
 * caller settles the record afterwards via the context mutation.
 */
export function createAnnouncementFixture(
  input: { subject: string; body: string; channel: AnnouncementChannel; audience: AnnouncementAudience; recipient_ids: string[]; created_by: string },
): AnnouncementMock {
  return {
    id: `ann-demo-${Date.now()}`,
    subject: input.subject,
    body: input.body,
    attachments: [],
    channel: input.channel,
    audience: input.audience,
    recipient_ids: input.audience === "ALL" ? [] : input.recipient_ids,
    created_by: input.created_by,
    created_at: new Date().toISOString(),
    status: "PENDING",
  };
}

/** Previously-sent history; new sends enter as PENDING via the context. */
export const announcements: AnnouncementMock[] = [
  {
    id: "ann-5001",
    subject: "تعديل سياسة الدوام الهجين",
    body: "بدءًا من الأسبوع القادم، يستطيع موظفو الهجين اختيار أيام الحضور من أيام العمل بشرط حصتين أسبوعيًا.",
    attachments: [att("a-4", "hybrid-policy-update.pdf", "application/pdf", 210, "clean", 12)],
    channel: "EMAIL",
    audience: "ALL",
    recipient_ids: [],
    created_by: "hr1",
    created_at: iso(12),
    status: "CONFIRMED",
  },
];
