import { dict } from "../i18n/dict";
import type { RequestTypeMock } from "../mock/data";
import { formatDate } from "./useMockList";
import { minutesBetween, workingDaysBetween, type RequestedSpan } from "./reviewSuggestion";

/**
 * The four request types the demo ships carry no structured "period" field — the type shape
 * mirrors the API — so the period a type asks for is read from its Arabic name, the same
 * source of truth the review suggestion uses to tell annual leave from the rest.
 */
export type PeriodKind = "FULL_DAYS" | "PART_DAY" | "SINGLE_DATE";

export function periodKindOf(requestType: RequestTypeMock): PeriodKind {
  if (/تصحيح/.test(requestType.name.ar)) return "SINGLE_DATE";
  if (/خروج/.test(requestType.name.ar)) return "PART_DAY";
  return "FULL_DAYS";
}

export interface RequestDraft {
  requestType: RequestTypeMock;
  /** The period, as picked from the calendar. */
  startDate: string;
  endDate: string;
  /** The clock window, for the types that cover part of a day. */
  startTime: string;
  endTime: string;
  /** Why the request is being made. */
  reason: string;
}

export type DraftField = "period" | "clock" | "reason";

export interface DraftIssue {
  field: DraftField;
  message: string;
}

const fill = (template: string, value: string | number) => template.replace("%s", String(value));

/** The span the picked dates describe; null when the type asks for no absence at all. */
export function draftSpan(draft: RequestDraft): RequestedSpan | null {
  const kind = periodKindOf(draft.requestType);
  if (kind === "SINGLE_DATE") return null;
  if (!draft.startDate) return null;
  if (kind === "PART_DAY") {
    const minutes = minutesBetween(draft.startTime, draft.endTime);
    return { kind: "PART_DAY", minutes };
  }
  const days = workingDaysBetween(draft.startDate, draft.endDate || draft.startDate);
  return { kind: "FULL_DAYS", days };
}

/**
 * The period in words, for the live receipt under the picker.
 *
 * Returns ONE of three visible states, so the page can show what the picked span means at
 * pick time — not only after a submit attempt:
 *  - a counted span («4 يوم عمل» / «120 دقيقة») when normal;
 *  - the single-day state for a FULL_DAYS span whose end was never picked — the silent
 *    `endDate = startDate` default read aloud before any submit (critique 4.1);
 *  - the zero-working-day state (a weekend, or a reversed range) as its own string with
 *    its own token, styled --danger live at the pick surface (critique 4.4/4.6);
 *  - the missing-clock state for a PART_DAY window whose endpoints are missing or
 *    unordered — the empty-not-prefilled times speak before validation (spec §3).
 */
export type DurationState = "COUNTED" | "SINGLE_DAY" | "NO_WORKING_DAY" | "REVERSED" | "REVERSED_CLOCK" | "EMPTY_CLOCK";

export function durationState(draft: RequestDraft): DurationState | null {
  const kind = periodKindOf(draft.requestType);
  if (kind === "SINGLE_DATE") return null;
  if (!draft.startDate) return null;
  if (kind === "PART_DAY") {
    if (minutesBetween(draft.startTime, draft.endTime) > 0) return "COUNTED";
    /* The clock endpoints speak for themselves: both empty (the strip boots here),
       one empty, or both picked but unordered. The first two are the "not picked
       yet" state, the last one carries the reversed sentence at the pick surface. */
    if (draft.startTime && draft.endTime) return "REVERSED_CLOCK";
    return "EMPTY_CLOCK";
  }
  if (!draft.endDate) return "SINGLE_DAY";
  if (draft.endDate < draft.startDate) return "REVERSED";
  const days = workingDaysBetween(draft.startDate, draft.endDate);
  if (days > 0) return "COUNTED";
  return "NO_WORKING_DAY";
}

/** The receipt's first line: the span in words, exactly as the title will read it. */
export function durationText(draft: RequestDraft, locale: "ar" | "en"): string | null {
  const span = draftSpan(draft);
  if (!span) return null;
  if (span.kind === "FULL_DAYS" && span.days > 0) return fill(dict[locale].requestPeriodDays, span.days);
  if (span.kind === "PART_DAY" && span.minutes > 0) return fill(dict[locale].requestPeriodMinutes, span.minutes);
  return null;
}

/** The live warning beside the counted duration; null when nothing is being warned about. */
export function durationWarningText(draft: RequestDraft, locale: "ar" | "en"): string | null {
  const state = durationState(draft);
  if (state === "SINGLE_DAY") return dict[locale].requestPeriodSingleDay;
  if (state === "NO_WORKING_DAY") return dict[locale].requestPeriodNoWorkingDay;
  if (state === "REVERSED") return dict[locale].requestPeriodReversed;
  if (state === "REVERSED_CLOCK") return dict[locale].requestPeriodTimesReversed;
  if (state === "EMPTY_CLOCK") return dict[locale].requestPeriodEmptyClock;
  return null;
}

/**
 * The title the request list and the review screen show. The period is carried in its own
 * fields, so the title only has to read well — the same shape as the demo's seed titles.
 */
export function buildRequestTitle(draft: RequestDraft, locale: "ar" | "en"): string {
  const name = draft.requestType.name[locale];
  const kind = periodKindOf(draft.requestType);
  if (kind === "SINGLE_DATE") {
    return draft.startDate ? `${name} — ${formatDate(draft.startDate, locale)}` : name;
  }
  const duration = durationText(draft, locale);
  return duration ? `${name} — ${duration}` : name;
}

/** What is missing or contradictory, with the field to put the reader back on. */
export function validateDraft(draft: RequestDraft, locale: "ar" | "en"): DraftIssue | null {
  const kind = periodKindOf(draft.requestType);
  if (!draft.startDate) return { field: "period", message: dict[locale].requestPeriodMissing };
  if (kind === "FULL_DAYS") {
    const end = draft.endDate || draft.startDate;
    if (end < draft.startDate) return { field: "period", message: dict[locale].requestPeriodReversed };
    if (workingDaysBetween(draft.startDate, end) === 0) return { field: "period", message: dict[locale].requestPeriodNoWorkingDay };
  }
  if (kind === "PART_DAY" && minutesBetween(draft.startTime, draft.endTime) === 0) {
    return { field: "clock", message: dict[locale].requestPeriodTimesReversed };
  }
  return null;
}

/** The period as the form sends it: a part-day keeps its clock window, the rest do not. */
export function draftPeriodFields(draft: RequestDraft) {
  const kind = periodKindOf(draft.requestType);
  const startDate = draft.startDate || null;
  const endDate = kind === "FULL_DAYS" && draft.endDate ? draft.endDate : startDate;
  return {
    startDate,
    endDate,
    startTime: kind === "PART_DAY" ? draft.startTime : null,
    endTime: kind === "PART_DAY" ? draft.endTime : null,
  };
}
