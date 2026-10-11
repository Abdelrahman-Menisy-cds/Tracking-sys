import { useCallback, useEffect, useState } from "react";
import { stateDemoControl } from "../mock/data";

export type ListState<T> =
  | { phase: "loading" }
  | { phase: "error"; retry: () => void }
  | { phase: "empty"; forced: boolean }
  | { phase: "ready"; data: T };

export function useMockList<T>(load: () => Promise<T>, deps: unknown[] = []): ListState<T> {
  const [state, setState] = useState<ListState<T>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    stateDemoControl.fixture = "ready";
    setAttempt((currentAttempt) => currentAttempt + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setState({ phase: "loading" });
      if (stateDemoControl.fixture === "loading") return;
      if (stateDemoControl.fixture === "error") {
        setState({ phase: "error", retry });
        return;
      }
      if (stateDemoControl.fixture === "empty") {
        setState({ phase: "empty", forced: true });
        return;
      }
      // Mutation-only fixtures are deliberately ignored by read queries. They
      // are consumed exactly once by the decision boundary and never replayed.
      try {
        const loadedData = await load();
        if (!cancelled) setState({ phase: "ready", data: loadedData });
      } catch {
        if (!cancelled) setState({ phase: "error", retry });
      }
    };

    const handleFixtureChange = () => setAttempt((currentAttempt) => currentAttempt + 1);
    window.addEventListener("demo-fixture-change", handleFixtureChange);
    void run();
    return () => {
      cancelled = true;
      window.removeEventListener("demo-fixture-change", handleFixtureChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, retry]);

  return state;
}

/**
 * Brief H3 — ONE shared date/time path for every screen (the user saw
 * scrambled values in the RTL UI on every page: «ظبط طريقه عرض الوقت
 * والتاريخ لانه مش مظبوط ف كل الصفحات»). All rules:
 *  - LATIN digits always, via `localeTag` (`ar-EG-u-nu-latn` for `ar`).
 *  - A stable shape in BOTH locales, zero-padded:
 *      date       → DD/MM/YYYY            (14/10/2026)
 *      date+time  → DD/MM/YYYY · h:mm ص   (11/10/2026 · 09:18 ص)
 *      time only  → h:mm ص / h:mm AM
 *  - NO per-row time zone name («غرينتش+3» reorders inside RTL text and
 *    reads as «3+») — the zone is stated once on the page, not per row.
 *  - Every returned value is wrapped in Unicode isolates (LRI … PDI) so it
 *    renders in the same correct order in a text node, inside <bdi>, or in
 *    an RTL paragraph. Per-number RTL marks (U+200F) are NOT used — that
 *    pattern is what was broken.
 */
const CAIRO_TIME_ZONE = "Africa/Cairo";

const LRI = "\u2066";
const PDI = "\u2069";

/** Wrap a formatted value in bidi isolates — brief H3 rule 4. */
function isolated(value: string): string {
  return `${LRI}${value}${PDI}`;
}

function localeTag(locale: "ar" | "en") {
  return locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
}

/** The org-local calendar day of an instant, yyyy-mm-dd (shared primitive
 *  for the screens that keyed their rows on a Cairo work date). */
export function cairoDayIso(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** DD/MM/YYYY in the given locale, zero-padded, bidi-isolated. */
export function formatDate(isoDate: string, locale: "ar" | "en"): string {
  const parts = new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: CAIRO_TIME_ZONE,
  }).formatToParts(new Date(isoDate)).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return isolated(`${parts.day}/${parts.month}/${parts.year}`);
}

/** Zero-padded h:mm in 12-hour shape with the locale's day-period marker. */
function paddedTimeParts(date: Date, locale: "ar" | "en"): { hour: string; minute: string; period: string } {
  const parts = new Intl.DateTimeFormat(localeTag(locale), {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: CAIRO_TIME_ZONE,
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  const paddedHour = String(Number(parts.hour)).padStart(2, "0");
  // en-GB spells the day period lowercase ("am"); the brief's shape is "AM".
  const period = (parts.dayPeriod ?? "").toUpperCase();
  return { hour: paddedHour, minute: parts.minute, period };
}

/** DD/MM/YYYY · h:mm period — zero-padded, bidi-isolated, no zone token. */
export function formatDateTime(isoDate: string, locale: "ar" | "en"): string {
  const date = new Date(isoDate);
  const time = paddedTimeParts(date, locale);
  const day = formatDate(isoDate, locale).slice(1, -1); // unwrap the isolates for composition
  return isolated(`${day} · ${time.hour}:${time.minute} ${time.period}`.trim());
}

/** h:mm period only — zero-padded, bidi-isolated, no zone token. */
export function formatTime(isoDate: string, locale: "ar" | "en"): string {
  const time = paddedTimeParts(new Date(isoDate), locale);
  return isolated(`${time.hour}:${time.minute} ${time.period}`.trim());
}

/** The weekday NAME of a fixed calendar date (0 = Sunday … 6 = Saturday)
 *  or of an ISO instant, locale-aware, digits not involved. */
export function formatWeekdayIndex(weekdayIndex: number, locale: "ar" | "en"): string {
  // 2023-01-01 was a Sunday; indexing from there gives the nth weekday.
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2023, 0, 1 + weekdayIndex)));
}

export function formatWeekdayOf(isoDate: string, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: "long", timeZone: CAIRO_TIME_ZONE })
    .format(new Date(isoDate));
}

/** The long/full date shapes (profile join date, admin validity lines),
 *  still Latin digits and bidi-isolated. */
export function formatDateLong(isoDate: string, locale: "ar" | "en"): string {
  return isolated(new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric", month: "long", day: "numeric", timeZone: CAIRO_TIME_ZONE,
  }).format(new Date(isoDate)));
}

export function weekInterval(weekStart: string, locale: "ar" | "en"): string {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat(localeTag(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

export function formatMinutes(minutes: number, locale: "ar" | "en"): string {
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return locale === "ar" ? `${hours} ساعة و${remainderMinutes} دقيقة` : `${hours} h ${remainderMinutes} min`;
}
