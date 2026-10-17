/**
 * Brief H3 (the ONE shared date/time path) and H33 (the mock list hook is gone).
 *
 * All rules, unchanged from the original brief:
 *  - LATIN digits always, via `localeTag` (`ar-EG-u-nu-latn` for `ar`).
 *  - A stable shape in BOTH locales, the DATE zero-padded and the clock's HOUR
 *    not («04/10/2026 · 9:24 ص» - one shape everywhere)
 *  - NO per-row time zone name; the zone is stated once on the page
 *  - every returned value wraps in Unicode isolates (LRI … PDI); call sites
 *    must not add <bdi> or dir overrides.
 *
 * This module used to live beside the mock list hook (`useMockList.ts`). The
 * hook was the demo-fixture machinery; the formats are real and stay.
 */

const CAIRO_TIME_ZONE = "Africa/Cairo";

const LRI = "\u2066";
const PDI = "\u2069";

/** Wrap a formatted value in bidi isolates - brief H3 rule 4. */
function isolated(value: string): string {
  return `${LRI}${value}${PDI}`;
}

function unwrapped(value: string): string {
  return value.slice(LRI.length, -PDI.length);
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

/** A Date for a formatter, or null when the input is missing/unparseable.
 *
 *  Reporting rows legitimately carry an empty date (a sheet that was never
 *  submitted has no submitted_at), and Intl throws a RangeError on an Invalid
 *  Date — one empty cell took the whole timesheet report down with
 *  "RangeError: Invalid time value". Every formatter below resolves through
 *  here and renders a dash instead of exploding.
 */
function asDate(isoDate: string | null | undefined): Date | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** DD/MM/YYYY in the given locale, zero-padded, bidi-isolated. */
export function formatDate(isoDate: string, locale: "ar" | "en"): string {
  const date = asDate(isoDate);
  if (!date) return isolated("—");
  const parts = new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: CAIRO_TIME_ZONE,
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return isolated(`${parts.day}/${parts.month}/${parts.year}`);
}

/** h:mm in 12-hour shape with the locale's day-period marker. The HOUR is not
 *  zero-padded ("4:00 م"); the MINUTE keeps its two digits ("9:05 ص"). */
function timeParts(date: Date, locale: "ar" | "en"): { hour: string; minute: string; period: string } {
  const parts = new Intl.DateTimeFormat(localeTag(locale), {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: CAIRO_TIME_ZONE,
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  const hour = String(Number(parts.hour));
  // en-GB spells the day period lowercase ("am"); the shared shape is "AM".
  const period = (parts.dayPeriod ?? "").toUpperCase();
  return { hour, minute: parts.minute, period };
}

/** Keep the day period on the same rendered line as its clock. */
function timeRun(parts: { hour: string; minute: string; period: string }): string {
  return `${parts.hour}:${parts.minute}\u00a0${parts.period}`;
}

/** DD/MM/YYYY · h:mm period - bidi-isolated, no zone token. */
export function formatDateTime(isoDate: string, locale: "ar" | "en"): string {
  const date = asDate(isoDate);
  if (!date) return isolated("—");
  const time = timeParts(date, locale);
  return isolated(`${unwrapped(formatDate(isoDate, locale))}\u00a0·\u00a0${timeRun(time)}`);
}

/** h:mm period only - bidi-isolated, no zone token. */
export function formatTime(isoDate: string, locale: "ar" | "en"): string {
  const date = asDate(isoDate);
  if (!date) return isolated("—");
  const time = timeParts(date, locale);
  return isolated(timeRun(time));
}

/** The weekday NAME of a fixed calendar date (0 = Sunday … 6 = Saturday)
 *  or of an ISO instant, locale-aware, digits not involved. */
export function formatWeekdayIndex(weekdayIndex: number, locale: "ar" | "en"): string {
  // 2023-01-01 was a Sunday; indexing from there gives the nth weekday.
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2023, 0, 1 + weekdayIndex)));
}

export function formatWeekdayOf(isoDate: string, locale: "ar" | "en"): string {
  const date = asDate(isoDate);
  if (!date) return isolated("—");
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: "long", timeZone: CAIRO_TIME_ZONE })
    .format(date);
}

/** Long date for a single-record detail (profile, holiday); lists, tables and
 *  dense validity rows use numeric formatDate instead. */
export function formatDateLong(isoDate: string, locale: "ar" | "en"): string {
  const date = asDate(isoDate);
  if (!date) return isolated("—");
  const parts = new Intl.DateTimeFormat(localeTag(locale), {
    year: "numeric", month: "long", day: "numeric", timeZone: CAIRO_TIME_ZONE,
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  // Each directional run is isolated so the RTL month cannot reorder the year.
  return isolated(`${isolated(parts.day)} ${isolated(parts.month)} ${isolated(parts.year)}`);
}

/** Wall-clock configuration, not an instant: preserve the supplied HH:mm. */
export function formatWallClock(value: string, locale: "ar" | "en"): string {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(Date.UTC(2026, 0, 1, hours, minutes));
  const parts = new Intl.DateTimeFormat(localeTag(locale), {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "UTC",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return isolated(timeRun({ hour: String(Number(parts.hour)), minute: parts.minute, period: (parts.dayPeriod ?? "").toUpperCase() }));
}

/** A single isolated time range; null represents a missing endpoint. */
export function formatTimeRange(fromIso: string | null, toIso: string | null, locale: "ar" | "en"): string {
  return isolated(`${fromIso ? formatTime(fromIso, locale) : "-"} → ${toIso ? formatTime(toIso, locale) : "-"}`);
}

export function formatDateTimeRange(fromIso: string, toIso: string, locale: "ar" | "en"): string {
  return isolated(`${formatDateTime(fromIso, locale)} → ${formatDateTime(toIso, locale)}`);
}

export function formatWallClockRange(from: string, to: string | null, locale: "ar" | "en"): string {
  return isolated(`${formatWallClock(from, locale)} → ${to ? formatWallClock(to, locale) : "-"}`);
}

/** Numeric dates in dense rows and schedule validity ranges. */
export function formatDateRange(fromIso: string, toIso: string | null, locale: "ar" | "en"): string {
  return isolated(`${formatDate(fromIso, locale)} → ${toIso ? formatDate(toIso, locale) : "-"}`);
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
  const part = (date: Date): string => {
    const values = formatter.formatToParts(date).reduce<Record<string, string>>((result, item) => { result[item.type] = item.value; return result; }, {});
    return `${isolated(values.day)} ${isolated(values.month)} ${isolated(values.year)}`;
  };
  return isolated(`${part(start)} - ${part(end)}`);
}

export function formatMinutes(minutes: number, locale: "ar" | "en"): string {
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return locale === "ar" ? `${hours}\u00a0ساعة\u00a0و${remainderMinutes}\u00a0دقيقة` : `${hours}\u00a0h\u00a0${remainderMinutes}\u00a0min`;
}

/**
 * Resolve a display name that may arrive in either shape:
 * the server emits plain strings (full_name, requester_name, employee_name),
 * while a few still-demo surfaces keep {ar, en} labels.
 */
export function displayName(name: string | { ar: string; en: string } | undefined | null, locale: "ar" | "en"): string {
  if (!name) return locale === "ar" ? "غير معروف" : "Unknown";
  if (typeof name === "string") return name;
  return name[locale] ?? name.ar;
}
