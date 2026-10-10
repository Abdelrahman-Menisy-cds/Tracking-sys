/**
 * The public-holidays register, as the server exposes it.
 *
 * Source of truth is Nager.Date. The LLM only fills Arabic names and *proposes* the
 * holidays Nager is missing (Ramadan, Eid Al-Fitr). A proposal is never a legal fact:
 * the backend stores it with `needs_confirmation`, and this module carries that flag
 * through so the UI can never render one as official.
 */
import { apiRequest } from "./api";
import type { PublicHoliday } from "../mock/attendance";

/** One row as Django serialises it. */
interface ServerHoliday {
  id: string;
  country_code: string;
  date: string;
  name: string;
  name_local: string;
  source: "NAGER" | "LLM" | "MANUAL";
  is_manual_override: boolean;
  needs_confirmation: boolean;
  is_recurring: boolean;
  external_id: string | null;
  year: number;
}

/** What a refresh actually did. Mirrors the backend summary exactly. */
export interface RefreshSummary {
  added: number;
  updated: number;
  unchanged: number;
  manual_preserved: number;
  proposed_missing: number;
  llm_available: boolean;
  warnings: string[];
}

/**
 * Server row -> the register's display shape.
 *
 * `name` is the English name and `name_local` the Arabic one, so the pair maps onto the
 * existing `{ ar, en }` label. When the LLM supplied no Arabic (an older row, or the
 * LLM was down) the English name is shown rather than an empty cell.
 */
export function toPublicHoliday(row: ServerHoliday): PublicHoliday {
  return {
    id: row.id,
    date: row.date,
    name: { ar: row.name_local || row.name, en: row.name || row.name_local },
    recurring: row.is_recurring,
    source: row.source,
    isManualOverride: row.is_manual_override,
    needsConfirmation: row.needs_confirmation,
  };
}

export async function fetchHolidays(year: number, country = "EG"): Promise<PublicHoliday[]> {
  const payload = await apiRequest<{ data: ServerHoliday[] }>(
    `/holidays?year=${year}&country=${encodeURIComponent(country)}`,
  );
  return (payload.data ?? []).map(toPublicHoliday);
}

/**
 * Ask the server to refresh the register from Nager.Date (+ the LLM for Arabic names and
 * the missing Islamic holidays). The call is idempotent server-side; the caller re-reads
 * the register afterwards rather than assuming what changed.
 */
export async function refreshHolidays(year: number, country = "EG"): Promise<RefreshSummary> {
  const payload = await apiRequest<{ data: RefreshSummary }>("/holidays/refresh", {
    method: "POST",
    body: { year, country },
    // No override: this inherits apiRequest's measured 600s budget. The refresh
    // drives Nager and two reasoning-LLM calls, and a 90s cap used to abort a
    // call that was going to succeed and report it as "server unreachable".
  });
  return payload.data;
}

/** Did the server's own summary report anything that makes this a PARTIAL success? */
export function isPartial(summary: RefreshSummary): boolean {
  return !summary.llm_available;
}
