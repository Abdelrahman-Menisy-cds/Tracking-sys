/**
 * The ONE reader of RequestAttachment.scan_status.
 *
 * The server emits the model's UPPERCASE choices (reqs/models.py ScanStatus):
 * PENDING / CLEAN / FAILED / REJECTED. There is no "QUARANTINED" value on the
 * wire — a file is usable only once the scan reports CLEAN, so every other
 * state is "quarantined; file unavailable".
 *
 * The detail and review screens used to compare this field in lowercase
 * ("clean"/"pending"), which can never match the server's uppercase values,
 * so EVERY attachment rendered as quarantined. Comparing against the wrong
 * case is a class of bug, not one line: the fix is this single helper, and
 * the source guard in scripts/check-scan-status.tsx keeps a lowercase
 * comparison from creeping back in. The parameter is typed as the server's
 * union so a bad literal is a compile error, not a silent lie.
 */
import type { Locale } from "../i18n/dict";
import type { ScanStatus } from "./serverTypes";

export function scanStatusLabel(scanStatus: ScanStatus, locale: Locale): string {
  if (scanStatus === "CLEAN") return locale === "ar" ? "فحص سليم" : "Scan clean";
  if (scanStatus === "PENDING") return locale === "ar" ? "بانتظار الفحص" : "Awaiting scan";
  // FAILED and REJECTED (and any future non-CLEAN value) mean the same thing
  // to the operator: the bytes are held and the file is not available.
  return locale === "ar" ? "محجوز؛ الملف غير متاح" : "Quarantined; file unavailable";
}

/** True while the scan has not reported CLEAN — the server blocks submit on these. */
export function isQuarantined(scanStatus: ScanStatus): boolean {
  return scanStatus !== "CLEAN";
}
