import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../../app/AppContext";
import type { Dict } from "../../i18n/dict";

/**
 * First-run tour - a coach-mark walkthrough over the real shell.
 *
 * Shown once per identity: the flag is stored under the same localStorage
 * convention the language and appearance preferences already use, keyed by the
 * signed-in email, so a second person on the same device still gets the tour
 * and the same person does not get it twice.
 *
 * Every page renders `<PageHeader>`, so every page has a real title
 * (`.page-header h1`) and, when it has one, a primary action (`.page-actions`).
 * Those two anchors plus the page's main surface explain any screen, which is
 * why the per-page tours are declared as data rather than hand-built per page.
 *
 * The flag is keyed by identity AND page (`…<email>.<page>`), so the first visit
 * to each page is the first visit only once, and a second person on the same
 * device still gets their own tour. A step whose target is not rendered is
 * skipped instead of pointing at nothing, a detail page (`/requests/42`) reuses
 * its list page's detail tour through the pattern match, Escape skips, arrows
 * move, and the card keeps focus so the keyboard path is real.
 */

type DictKey = keyof Dict;
type Step = { selector: string; title: DictKey; body: DictKey };
type PageTour = { key: string; path: string; detail?: boolean; steps: Step[] };
type Box = { top: number; left: number; width: number; height: number };

const SEEN_PREFIX = "hermes.tour.seen.";
/** Fired by the profile menu to replay the tour on demand. */
export const TOUR_START_EVENT = "hermes:tour:start";

const SHELL_STEPS: Step[] = [
  { selector: "#app-rail-nav", title: "tourNavTitle", body: "tourNavBody" },
  { selector: ".app-header", title: "tourHeaderTitle", body: "tourHeaderBody" },
  { selector: ".profile-trigger", title: "tourProfileTitle", body: "tourProfileBody" },
  { selector: "#main-content", title: "tourMainTitle", body: "tourMainBody" },
  { selector: 'a[href="/admin"]', title: "tourAdminTitle", body: "tourAdminBody" },
  { selector: ".assistant-launcher", title: "tourAssistantTitle", body: "tourAssistantBody" },
];

/** Title → primary action → main surface: the shape every page shares. */
const pageSteps = (heading: DictKey, action: DictKey, surface: DictKey): Step[] => [
  { selector: ".page-header h1", title: "tourStepHeader", body: heading },
  { selector: ".page-actions", title: "tourStepAction", body: action },
  { selector: ".work-surface, table, .interval-list, .compact-list", title: "tourStepSurface", body: surface },
];

/** Detail screens show one record: its header, its decisions, its history. */
const detailSteps: Step[] = [
  { selector: ".page-header", title: "tourStepHeader", body: "tourPDetailH" },
  { selector: ".page-actions, .decision-actions", title: "tourStepAction", body: "tourPDetailA" },
  { selector: ".timeline, .work-surface, table", title: "tourStepSurface", body: "tourPDetailS" },
];

const PAGE_TOURS: PageTour[] = [
  { key: "shell", path: "/", steps: SHELL_STEPS },
  // H17: the onboarding screen explains itself like every other page. While the
  // gate holds, the shell renders the onboarding screen directly, so this entry
  // never fights the shell tour; after completion the route redirects home.
  { key: "onboarding-company", path: "/onboarding/company", steps: pageSteps("tourCompanyH", "tourCompanyA", "tourCompanyS") },
  { key: "requests", path: "/requests", steps: pageSteps("tourPRequestsH", "tourPRequestsA", "tourPRequestsS") },
  { key: "request-new", path: "/requests/new", steps: pageSteps("tourPRequestNewH", "tourPRequestNewA", "tourPRequestNewS") },
  { key: "timesheets", path: "/timesheets", steps: pageSteps("tourPTimesheetsH", "tourPTimesheetsA", "tourPTimesheetsS") },
  { key: "reviews", path: "/reviews", steps: pageSteps("tourPReviewsH", "tourPReviewsA", "tourPReviewsS") },
  { key: "notifications", path: "/notifications", steps: pageSteps("tourPNotificationsH", "tourPNotificationsA", "tourPNotificationsS") },
  { key: "profile", path: "/profile", steps: pageSteps("tourPProfileH", "tourPProfileA", "tourPProfileS") },
  { key: "attendance", path: "/attendance", steps: pageSteps("tourPAttendanceH", "tourPAttendanceA", "tourPAttendanceS") },
  { key: "attendance-history", path: "/attendance/history", steps: pageSteps("tourPAttHistoryH", "tourPAttHistoryA", "tourPAttHistoryS") },
  { key: "attendance-corrections", path: "/attendance/corrections", steps: pageSteps("tourPAttCorrectionsH", "tourPAttCorrectionsA", "tourPAttCorrectionsS") },
  { key: "tasks", path: "/tasks", steps: pageSteps("tourPTasksH", "tourPTasksA", "tourPTasksS") },
  { key: "admin", path: "/admin", steps: pageSteps("tourPAdminH", "tourPAdminA", "tourPAdminS") },
  { key: "admin-people", path: "/admin/people", steps: pageSteps("tourPAdminPeopleH", "tourPAdminPeopleA", "tourPAdminPeopleS") },
  { key: "admin-settings", path: "/admin/settings", steps: pageSteps("tourPAdminSettingsH", "tourPAdminSettingsA", "tourPAdminSettingsS") },
  { key: "admin-announcements", path: "/admin/announcements", steps: pageSteps("tourPAdminAnnouncementsH", "tourPAdminAnnouncementsA", "tourPAdminAnnouncementsS") },
  // detail patterns last: an exact path above always wins over these
  { key: "request-detail", path: "/requests", detail: true, steps: detailSteps },
  { key: "timesheet-detail", path: "/timesheets", detail: true, steps: detailSteps },
  { key: "review-detail", path: "/reviews", detail: true, steps: detailSteps },
  { key: "task-detail", path: "/tasks", detail: true, steps: detailSteps },
  { key: "employee-detail", path: "/admin/people", detail: true, steps: detailSteps },
];

/** The tour for a path: exact page first, then its detail pattern, then the shell. */
export function tourForPath(pathname: string): PageTour {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const exact = PAGE_TOURS.find((tour) => !tour.detail && tour.path === clean);
  if (exact) return exact;
  const detail = PAGE_TOURS.find((tour) => tour.detail && clean.startsWith(`${tour.path}/`));
  return detail ?? PAGE_TOURS[0];
}

export function tourStorageKey(email: string, tourKey: string): string {
  return `${SEEN_PREFIX}${email.trim().toLowerCase()}.${tourKey}`;
}

export default function TourGuide() {
  const { t, locale, serverAccount } = useApp();
  const { pathname } = useLocation();
  const email = serverAccount?.email ?? "unknown";
  const tour = useMemo(() => tourForPath(pathname), [pathname]);
  // One flag per account, not per page. The tour is the first-run orientation,
  // and a per-page flag meant every screen it had not been shown on yet started
  // its own, so it followed the user around the app and came back on every
  // sign-in.
  const storageKey = tourStorageKey(email, "account");

  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  /** Steps whose target is actually on screen - the list is role-agnostic. */
  const steps = useMemo(() => {
    if (index === null) return [];
    return tour.steps.map((step, position) => ({ ...step, position })).filter((step) => {
      const node = document.querySelector<HTMLElement>(step.selector);
      return Boolean(node && node.getBoundingClientRect().height > 0);
    });
  }, [index, locale, tour]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Storage unavailable: the tour simply offers itself again next session.
    }
    setIndex(null);
    setBox(null);
    targetRef.current = null;
  }, [storageKey]);

  // Auto-start on the first visit for this identity.
  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(storageKey) !== null;
    } catch {
      seen = false;
    }
    if (seen) return;
    // Marked as seen the moment it opens, not when it is finished. A tour the
    // user walks away from is still a tour they were shown; leaving it unmarked
    // is what made it reappear on the next page - and on every sign-in after
    // that, since a navigation drops the tour before finish() ever runs.
    try {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Storage unavailable: the tour simply offers itself again next session.
    }
    const timer = window.setTimeout(() => setIndex(0), 700);
    return () => window.clearTimeout(timer);
  }, [storageKey, pathname]);

  // Leaving a page mid-tour drops it without marking it as seen.
  useEffect(() => {
    setIndex(null);
    setBox(null);
  }, [pathname]);

  // The profile menu can replay it at any time.
  useEffect(() => {
    const start = () => setIndex(0);
    window.addEventListener(TOUR_START_EVENT, start);
    return () => window.removeEventListener(TOUR_START_EVENT, start);
  }, []);

  const active = index === null ? null : steps[Math.min(index, Math.max(steps.length - 1, 0))] ?? null;

  const place = useCallback(() => {
    const node = active ? document.querySelector<HTMLElement>(active.selector) : null;
    targetRef.current = node;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const pad = 8;
    setBox({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    });
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return;
    place();
    const card = cardRef.current;
    card?.focus();
  }, [active, place]);

  useEffect(() => {
    if (!active) return;
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [active, place]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const forward = event.key === "ArrowLeft" ? locale === "ar" : locale === "en";
        setIndex((current) => {
          const next = (current ?? 0) + (forward ? 1 : -1);
          if (next < 0) return 0;
          if (next > steps.length - 1) {
            finish();
            return current;
          }
          return next;
        });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, finish, locale, steps.length]);

  if (!active || !box) return null;

  const stepNumber = Math.min(index ?? 0, steps.length - 1) + 1;
  const cardHeight = cardRef.current?.offsetHeight ?? 190;
  const cardWidth = Math.min(360, window.innerWidth - 32);
  const spaceBelow = window.innerHeight - (box.top + box.height);
  const below = spaceBelow > cardHeight + 24;
  // A target that fills most of the viewport (the rail, the main area) has no
  // room above or below, so the card parks beside it instead of covering it.
  const tallTarget = box.height > window.innerHeight * 0.6;
  const cardTop = tallTarget
    ? 24
    : below
      ? box.top + box.height + 12
      : Math.max(12, box.top - cardHeight - 12);
  // Pick the side with room: the rail sits on the right in Arabic and on the
  // left in English, so the free side is measured rather than assumed.
  const spaceLeft = box.left;
  const cardLeft = tallTarget
    ? (spaceLeft >= cardWidth + 24
      ? box.left - cardWidth - 16
      : Math.min(Math.max(12, box.left + box.width + 16), Math.max(12, window.innerWidth - cardWidth - 12)))
    : Math.min(Math.max(12, box.left), Math.max(12, window.innerWidth - cardWidth - 12));

  return (
    <div className="tour-layer">
      <div
        className="tour-spotlight"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="false"
        aria-label={t("tourAria")}
        tabIndex={-1}
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        <span className="tour-step">{t("tourStepOf").replace("%s", String(stepNumber)).replace("%s", String(steps.length))}</span>
        <strong className="tour-title">{t(active.title)}</strong>
        <p className="tour-body">{t(active.body)}</p>

        <div className="tour-dots" aria-hidden="true">
          {steps.map((step) => (
            <span key={step.selector} className={`tour-dot${step.position === index ? " active" : ""}`} />
          ))}
        </div>

        <div className="tour-actions">
          <button type="button" className="btn btn-ghost btn-compact" onClick={finish}>
            {t("tourSkip")}
          </button>
          <span className="tour-actions-spacer" />
          {stepNumber > 1 ? (
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => setIndex((current) => Math.max((current ?? 1) - 1, 0))}>
              {t("tourPrev")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-compact"
            onClick={() => {
              if (stepNumber >= steps.length) finish();
              else setIndex((current) => (current ?? 0) + 1);
            }}
          >
            {stepNumber >= steps.length ? t("tourDone") : t("tourNext")}
          </button>
        </div>
      </div>
    </div>
  );
}
