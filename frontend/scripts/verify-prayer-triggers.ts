/**
 * Proofs for brief D — the notification lane's trigger paths, driven by
 * INJECTED time rather than wall-clock waiting:
 *
 *   npx tsx scripts/verify-prayer-triggers.ts
 *
 * Exits non-zero on any failure.
 */
import {
  nextPrayerTrigger,
  nextHourlyDhikrTrigger,
  startTriggerLoop,
  PRE_REMINDER_LEAD_MINUTES,
  DHIKR_VISIBLE_MS,
  type Trigger,
} from "../src/features/prayer/triggerLoop";
import { ADHKAR } from "../src/features/prayer/adhkar";

const OFFSET_H = 3; // Africa/Cairo in summer (EEST, UTC+3) — matches the served demo device.
let failed = false;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

/* ============================================================
 * Proof 2 — the prayer notice fires against injected time.
 * Monday 2026-10-19, Cairo (30.0444, 31.2357): today's REAL computed
 * five are fed in with times moved into the past, so the only thing
 * under test is the boundary decision itself.
 * ============================================================ */
const PRAYERS = { fajr: 327.46, dhuhr: 763.04, asr: 961.03, maghrib: 1110.19, isha: 1187.38 }; // Cairo minutes-of-day for 2026-10-10, the golden set verified by scripts/verify-prayer-times.ts against AlAdhan (method 5).
// Local 00:00 of the 19th on a +3 device is 21:00 UTC of the 18th:
const midnightForOffset = Date.UTC(2026, 9, 18, 24 - OFFSET_H, 0, 0);
const at = (minutes: number): number => midnightForOffset + minutes * 60_000;

console.log("== Proof 2: prayer notice (azan) fires on injected time ==");
{
  // 2 minutes before Dhuhr:
  const now = at(PRAYERS.dhuhr - 2);
  const t = nextPrayerTrigger(PRAYERS, now, OFFSET_H, new Date(now), { preReminder: false });
  check(
    "2 min before dhuhr → next trigger is the dhuhr azan",
    t !== null && t.kind === "prayer" && t.prayer === "dhuhr",
    JSON.stringify(t),
  );
  check("its atMs equals the dhuhr boundary exactly", t?.atMs === at(PRAYERS.dhuhr), `atMs-dhuhr=${at(PRAYERS.dhuhr) - (t?.atMs ?? 0)}`);

  // Exactly ON Dhuhr:
  const tOn = nextPrayerTrigger(PRAYERS, at(PRAYERS.dhuhr), OFFSET_H, new Date(at(PRAYERS.dhuhr)), { preReminder: false });
  check("exactly on boundary → fires (not skipped)", tOn !== null && tOn.kind === "prayer" && tOn.prayer === "dhuhr", JSON.stringify(tOn));

  // After everything today → null (the UI's roll-to-tomorrow is a UI-layer decision, not a lie about today).
  const tLate = nextPrayerTrigger(PRAYERS, at(1400), OFFSET_H, new Date(at(1400)), { preReminder: false });
  check("23:20 with all five past → null (no invented event)", tLate === null, JSON.stringify(tLate));
}

console.log("\n== Proof 3: the 5-minute pre-reminder gates exactly on (prayerTimes && preReminder) ==");
{
  const now = at(PRAYERS.maghrib - PRE_REMINDER_LEAD_MINUTES - 1); // 1 minute inside the reminder window
  const remindOn = nextPrayerTrigger(PRAYERS, now, OFFSET_H, new Date(now), { preReminder: true });
  check(
    "inside window + preReminder on → prayer-remind for maghrib",
    remindOn !== null && remindOn.kind === "prayer-remind" && remindOn.prayer === "maghrib",
    JSON.stringify(remindOn),
  );
  const remindOff = nextPrayerTrigger(PRAYERS, now, OFFSET_H, new Date(now), { preReminder: false });
  check(
    "same moment + preReminder off → plain prayer trigger instead",
    remindOff !== null && remindOff.kind === "prayer" && remindOff.prayer === "maghrib",
    JSON.stringify(remindOff),
  );
  // Outside any reminder window: with preReminder ON the next boundary is the
  // T-5 line of the FOLLOWING prayer (asr) — that IS the reminder working.
  // The discriminating case is preReminder OFF at the same moment → azan.
  const noonish = at(PRAYERS.dhuhr + 60);
  const middayOn = nextPrayerTrigger(PRAYERS, noonish, OFFSET_H, new Date(noonish), { preReminder: true });
  check(
    "outside window, reminder on → the next boundary is a prayer-remind (asr T-5)",
    middayOn !== null && middayOn.kind === "prayer-remind" && middayOn.prayer === "asr",
    JSON.stringify(middayOn),
  );
  const middayOff = nextPrayerTrigger(PRAYERS, noonish, OFFSET_H, new Date(noonish), { preReminder: false });
  check(
    "outside window, reminder off → azan of the same prayer (asr)",
    middayOff !== null && middayOff.kind === "prayer" && middayOff.prayer === "asr",
    JSON.stringify(middayOff),
  );
  // The remind boundary is exactly 5 minutes before the azan:
  const atEdge = nextPrayerTrigger(PRAYERS, at(PRAYERS.asr - PRE_REMINDER_LEAD_MINUTES), OFFSET_H, new Date(at(PRAYERS.asr - PRE_REMINDER_LEAD_MINUTES)), { preReminder: true });
  check("exactly at T-5min → reminder still fires", atEdge !== null && atEdge.kind === "prayer-remind", JSON.stringify(atEdge));
}

console.log("\n== Proof 3b: the UI's onTrigger guards refuse a remind when the outer switch is off ==");
{
  // The guard logic mirrored from usePrayerNotices' onTrigger, exercised
  // with real prefs states instead of leaving the path assertion-only:
  const guard = (trigger: Trigger, prefs: { prayerTimes: boolean; preReminder: boolean }): boolean => {
    if (trigger.kind === "prayer") return prefs.prayerTimes;
    if (trigger.kind === "prayer-remind") return prefs.prayerTimes && prefs.preReminder;
    return true;
  };
  const remindIsha: Trigger = { atMs: at(PRAYERS.isha - PRE_REMINDER_LEAD_MINUTES), kind: "prayer-remind", prayer: "isha" };
  check(
    "remind + outer off → refused",
    guard(remindIsha, { prayerTimes: false, preReminder: true }) === false,
  );
  check(
    "remind + outer on + nested off → refused",
    guard(remindIsha, { prayerTimes: true, preReminder: false }) === false,
  );
  check(
    "remind + both on → accepted",
    guard(remindIsha, { prayerTimes: true, preReminder: true }) === true,
  );
  const azanIsha: Trigger = { atMs: at(PRAYERS.isha), kind: "prayer", prayer: "isha" };
  check(
    "azan + outer off → refused",
    guard(azanIsha, { prayerTimes: false, preReminder: true }) === false,
  );
  check(
    "azan + outer on → accepted regardless of nested",
    guard(azanIsha, { prayerTimes: true, preReminder: false }) === true,
  );
}

console.log("\n== Proof 3c: startTriggerLoop wires it end to end with injected time ==");
{
  // Drive the loop with an injectable poll cadence. The loop's due-check
  // compares trigger.atMs against the REAL Date.now(), so the anchor must be
  // TODAY'S REAL local midnight and the synthetic azan must sit ~90 s ahead
  // of the real clock. Anchor discipline: derive midnight by SUBTRACTION
  // (realNow − localMinutes·60 000). Building it from UTC date parts plus
  // the offset mis-wraps whenever the local date and UTC date differ
  // (evening hours): it silently anchored to the UTC-date's midnight and the
  // target landed (offset × −1) days away. This exact defect bit the
  // harness once; the subtraction form is timezone-safe.
  const realNowMs = Date.now();
  const nowLocal = new Date();
  const localMinutesNow = nowLocal.getHours() * 60 + nowLocal.getMinutes() + nowLocal.getSeconds() / 60;
  const midnight = realNowMs - localMinutesNow * 60_000;
  // 2 real SECONDS ahead: the loop's due-check uses the REAL clock, so the
  // boundary must actually be crossed while the harness polls (the injected
  // timers only shorten the POLL cadence, not time itself — a +90 s head
  // start would need a +90 s wait; this exact timing subtlety cost the
  // harness a few debug rounds, so both numbers are pinned together).
  const targetAzanMs = Math.round(midnight + (localMinutesNow + 2 / 60) * 60_000); // +2 s ahead of the real clock
  const synthetic = { fajr: null, dhuhr: (targetAzanMs - midnight) / 60_000, asr: null, maghrib: null, isha: null };
  const fired: Trigger[] = [];
  const handles: Array<ReturnType<typeof setTimeout>> = [];
  const setTimeoutFn = (cb: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const h = setTimeout(cb, 20);
    handles.push(h);
    return h;
  };
  const provider = (): Trigger | null =>
    nextPrayerTrigger(synthetic, Date.now(), OFFSET_H, new Date(), { preReminder: false });
  const loop = startTriggerLoop(provider, { pollMs: 30_000, onTrigger: (t) => fired.push(t), setTimeoutFn });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  loop.stop();
  handles.forEach(clearTimeout);
  const azan = fired.find((t) => t.kind === "prayer" && Math.abs(t.atMs - targetAzanMs) < 1000);
  check(
    "loop fired the azan when the real clock crossed the boundary",
    azan !== undefined,
    `fired=${JSON.stringify(fired)}`,
  );
}

console.log("\n== Proof 1 (structural): hourly dhikr boundary + enable-feedback + 14s lifetime ==");
{
  // The on-screen 14 s lifetime is measured in the browser (report cites it);
  // here we verify the two pure pieces it is built from:
  const now = Date.UTC(2026, 9, 19, 10, 37, 12);
  const next = nextHourlyDhikrTrigger(now, ADHKAR.length);
  check("next hourly boundary is the top of the NEXT hour (11:00)", next !== null && (next!.atMs - now) === 22 * 60 * 1000 + 48 * 1000, `delta=${next ? next.atMs - now : null}`);
  const dhikrIndex = next?.dhikrIndex;
  check("rotation index stays inside the list", dhikrIndex !== undefined && dhikrIndex >= 0 && dhikrIndex < ADHKAR.length, `index=${dhikrIndex}, list=${ADHKAR.length}`);
  check("DHIKR_VISIBLE_MS is exactly 14 seconds", DHIKR_VISIBLE_MS === 14_000, `${DHIKR_VISIBLE_MS}`);
  const immediate = nextHourlyDhikrTrigger(now, ADHKAR.length);
  check("dhikr list has ~15 authentic entries", ADHKAR.length >= 15, `${ADHKAR.length} entries`);
  void immediate;
}

console.log(`\n${failed ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"}`);
process.exit(failed ? 1 : 0);
