import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../../app/AppContext";
import { type FloatingNoticeData } from "./FloatingNoticeStack";
import { ADHKAR } from "./adhkar";
import {
  computePrayerTimes,
  locationForTimeZone,
  type PrayerComputation,
} from "./prayerTimes";
import {
  DHIKR_VISIBLE_MS,
  immediateDhikrTrigger,
  nextHourlyDhikrTrigger,
  nextPrayerTrigger,
  startTriggerLoop,
  type TriggerLoopHandle,
  type Trigger,
} from "./triggerLoop";

/*
 * Employee-visible prayer & dhikr settings, for the employee's OWN profile
 * page only (<code>/profile</code>). Shown ONLY when the signed-in
 * employee's directory entry says MUSLIM — the product owner's rule:
 * «لو الموظف مسلم خلي عند الموظف نفسه انه يقدر يشغل 2 اوبشن».
 *
 * Preferences persist in localStorage (device-local, per employee id),
 * following the appearance pattern exactly. NOT a server preference.
 *
 * Notices fire ONLY while this page is open in a visible tab. There is no
 * service worker, no push subscription, and no background delivery: closing
 * the tab stops everything, and that's stated in the UI copy too.
 */

const STORAGE_KEY_PREFIX = "tracking-sys.prayer-preferences.";

export interface PrayerPreferences {
  prayerTimes: boolean;
  preReminder: boolean;
  hourlyDhikr: boolean;
}
/** Read the CURRENT employee's stored preferences (per-employee key). */
export function readPrayerPreferences(employeeId: string): PrayerPreferences {
  if (typeof window === "undefined") return { prayerTimes: false, preReminder: false, hourlyDhikr: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + employeeId);
    if (!raw) return { prayerTimes: false, preReminder: false, hourlyDhikr: false };
    const parsed = JSON.parse(raw) as Partial<PrayerPreferences>;
    return {
      prayerTimes: parsed.prayerTimes === true,
      preReminder: parsed.preReminder === true,
      hourlyDhikr: parsed.hourlyDhikr === true,
    };
  } catch {
    return { prayerTimes: false, preReminder: false, hourlyDhikr: false };
  }
}

function storePrayerPreferences(employeeId: string, prefs: PrayerPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + employeeId, JSON.stringify(prefs));
  } catch {
    // Session-only behavior if storage is unavailable; stated in the UI.
  }
}

// ─────────────────────────── shared state/store ───────────────────────────

/**
 * The shared state: preferences, the notice queue, and the trigger running
 * only when the employee turns a feature on. Everything reaches the DOM via
 * FloatingNoticeStack through a portal out of the AppShell body.
 */
/** The signed-in employee's own prayer/dhikr settings hook, strongly typed. */
export interface PrayerNoticesState {
  prefs: PrayerPreferences;
  setPreference: (key: keyof PrayerPreferences, value: boolean) => void;
  notices: FloatingNoticeData[];
  dismissNotice: (id: string) => void;
  times: PrayerComputation;
  location: ReturnType<typeof locationForTimeZone>;
}

export function usePrayerNotices(employeeId: string): PrayerNoticesState {
  const { locale } = useApp();
  const [prefs, setPrefs] = useState<PrayerPreferences>(() => readPrayerPreferences(employeeId));
  const [notices, setNotices] = useState<FloatingNoticeData[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const location = useMemo(() => locationForTimeZone(), []);
  const loopRef = useRef<TriggerLoopHandle | null>(null);
  // Refs mirror the latest prefs/locale for the trigger callback without
  // re-arming the loop on every re-render; they are written in an effect,
  // never read during render.
  const prefsRef = useRef(prefs);
  const localeRef = useRef(locale);
  const nextIdRef = useRef(0);
  /**
   * Previous value of prefs.hourlyDhikr as seen by the arming effect. Seeded
   * with the MOUNT-time value (what was stored), so a reload with the
   * preference already on is NOT an enable — only a real OFF→ON transition
   * inside this session fires the "show one dhikr after enabling" feedback.
   */
  const prevHourlyDhikrRef = useRef(prefs.hourlyDhikr);

  // The location the browser actually reports:
  const today = useMemo(() => {
    const now = new Date(nowTick);
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }, [nowTick]);

  const times = useMemo<PrayerComputation>(
    () => computePrayerTimes(today, location.coordinates, -new Date().getTimezoneOffset() / 60),
    [today, location.coordinates],
  );

  // Re-arm whenever an enabling changes the trigger surface.
  useEffect(() => {
    if (!prefs.prayerTimes && !prefs.hourlyDhikr && !prefs.preReminder) {
      loopRef.current?.stop();
      loopRef.current = null;
      return;
    }
    const onTrigger = (trigger: Trigger) => {
      const currentPrefs = prefsRef.current;
      if (trigger.kind === "prayer" && !currentPrefs.prayerTimes) return;
      if (trigger.kind === "prayer-remind" && !(currentPrefs.prayerTimes && currentPrefs.preReminder)) return;
      if (trigger.kind === "dhikr" && !currentPrefs.hourlyDhikr) return;
      const id = `notice-${nextIdRef.current++}`;
      if (trigger.kind === "prayer" || trigger.kind === "prayer-remind") {
        const prayerName = localeRef.current === "ar" ? PRAYER_AR[trigger.prayer ?? ""] ?? trigger.prayer : trigger.prayer;
        setNotices((current) => [
          ...current,
          trigger.kind === "prayer"
            ? {
                id,
                title: localeRef.current === "ar" ? "حان وقت الصلاة" : "It is time for prayer",
                body: <>
                  {localeRef.current === "ar" ? `حان وقت صلاة ${prayerName} — على الموظف الخروج لأداء الصلاة.` : `It is time for the ${prayerName} prayer — time to step away and pray.`}
                </>,
                dismissLabel: localeRef.current === "ar" ? `إغلاق إشعار صلاة ${prayerName}` : `Dismiss ${prayerName} prayer notice`,
                visibleMs: 30_000,
                tone: "prayer",
              }
            : {
                id,
                title: localeRef.current === "ar" ? "الصلاة على الأبواب" : "Prayer is near",
                body: localeRef.current === "ar" ? `باقي ٥ دقائق على أذان ${prayerName} — اتوضأ واستعد للصلاة.` : `5 minutes until the ${prayerName} call to prayer — make wudu and get ready.`,
                dismissLabel: localeRef.current === "ar" ? `إغلاق تنبيه اقتراب صلاة ${prayerName}` : `Dismiss ${prayerName} pre-prayer reminder`,
                visibleMs: 30_000,
                tone: "prayer",
              },
        ]);
      } else if (trigger.kind === "dhikr") {
        const dhikr = ADHKAR[trigger.dhikrIndex ?? 0] ?? ADHKAR[0];
        setNotices((current) => [
          ...current,
          {
            id,
            title: localeRef.current === "ar" ? "ذكر الساعة" : "Hourly dhikr",
            body: <bdi style={{ fontSize: "var(--font-size-md)" }}>{localeRef.current === "ar" ? dhikr.ar : `${dhikr.ar}  —  ${dhikr.en}`}</bdi>,
            dismissLabel: localeRef.current === "ar" ? "إغلاق تنبيه الذكر" : "Dismiss dhikr notice",
            visibleMs: DHIKR_VISIBLE_MS, // 14 seconds, then gone — measured by the test below.
            tone: "dhikr",
          },
        ]);
      }
    };
    const loop = startTriggerLoop(
      () => {
        const currentPrefs = prefsRef.current;
        const now = Date.now();
        const candidates: Trigger[] = [];
        if (currentPrefs.prayerTimes) {
          const prayerMinutes = {
            fajr: times.times.fajr,
            dhuhr: times.times.dhuhr,
            asr: times.times.asr,
            maghrib: times.times.maghrib,
            isha: times.times.isha,
          };
          const p = nextPrayerTrigger(prayerMinutes, now, -new Date().getTimezoneOffset() / 60, undefined, {
            preReminder: currentPrefs.preReminder,
          });
          if (p) candidates.push(p);
          // After today's last prayer, the next REAL event is tomorrow's
          // Fajr — computed, never invented. Roll the calendar day forward
          // and ask the same pure function.
          if (!p) {
            const tomorrow = new Date(now + 86_400_000);
            const tDate = { year: tomorrow.getFullYear(), month: tomorrow.getMonth() + 1, day: tomorrow.getDate() };
            const tTimes = computePrayerTimes(tDate, location.coordinates, -tomorrow.getTimezoneOffset() / 60);
            const tOffset = tomorrow.getTimezoneOffset() === new Date(now).getTimezoneOffset()
              ? -tomorrow.getTimezoneOffset() / 60
              : -tomorrow.getTimezoneOffset() / 60;
            const p2 = nextPrayerTrigger({ fajr: tTimes.times.fajr }, tomorrow.getTime(), tOffset, tomorrow, {
              preReminder: false, // the 5-min window belongs to the azan itself; a cross-midnight reminder is noise
            });
            if (p2) candidates.push(p2);
          }
        }
        if (currentPrefs.hourlyDhikr) {
          const d = nextHourlyDhikrTrigger(now, ADHKAR.length);
          if (d) candidates.push(d);
        }
        candidates.sort((a, b) => a.atMs - b.atMs);
        return candidates[0] ?? null;
      },
      { pollMs: 500, onTrigger },
    );
    loopRef.current = loop;
    // Was the preference OFF when this effect last ran, and is it ON now?
    // Only that OFF→ON transition fires the "enable feedback" dhikr. A page
    // that loads with the preference already on (reload/session restore)
    // runs this effect with prev === current, so nothing fires: the earlier
    // defect showed a dhikr card on every reload, which no one had asked
    // for, exactly what the brief's double-mount check is about.
    const transitionedOn = prefs.hourlyDhikr && !prevHourlyDhikrRef.current;
    prevHourlyDhikrRef.current = prefs.hourlyDhikr;
    if (transitionedOn) {
      const immediate = immediateDhikrTrigger(Date.now(), ADHKAR.length);
      if (immediate) {
        onTrigger(immediate);
      }
    }
    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
    };
  }, [prefs.prayerTimes, prefs.preReminder, prefs.hourlyDhikr, times, location.coordinates, employeeId]);

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const setPreference = useCallback(
    (key: keyof PrayerPreferences, value: boolean) => {
      setPrefs((current) => {
        const next = { ...current, [key]: value };
        // #2 is nested under #1: turning #1 off removes the nested one too.
        if (key === "prayerTimes" && !value) next.preReminder = false;
        storePrayerPreferences(employeeId, next);
        return next;
      });
    },
    [employeeId],
  );

  /** Drive ticks through state so the "مواقيت اليوم" table re-renders with fresh times on re-entry. */
  useEffect(() => {
    // A 60-second tick keeps "today" fresh across midnight without spinning fast timers.
    const handle = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(handle);
  }, []);

  return { prefs, setPreference, notices, dismissNotice, times, location };
}

const PRAYER_AR: Record<string, string> = {
  fajr: "الفجر",
  dhuhr: "الظهر",
  asr: "العصر",
  maghrib: "المغرب",
  isha: "العشاء",
};

/** Stage-boundary escapes for tests to force certain paths: */
export const __testHooks = {
  fireImmediateDhikr: (nowMs: number, count: number) => immediateDhikrTrigger(nowMs, count),
  nextDhikrBoundary: (nowMs: number, count: number) => nextHourlyDhikrTrigger(nowMs, count),
  nextPrayer: nextPrayerTrigger,
};

export type { FloatingNoticeData };
