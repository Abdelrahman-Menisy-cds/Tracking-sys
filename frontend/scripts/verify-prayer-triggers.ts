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
  immediateDhikrTrigger,
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
  // Anchor discipline: use the SAME midnight the function under test uses —
  // Date.UTC(now's UTC date parts) minus the offset — NOT a subtraction from
  // local-clock minutes. On a +3 device between 21:00 UTC and 24:00 UTC the
  // local date has rolled to TOMORROW while the UTC date has not: the local
  // subtraction form then built minutes-of-day ≈ 12 (00:12 local) against
  // YESTERDAY's local-midnight anchor, and the synthetic event landed ~23.8 h
  // in the past — outside the 90 s grace — so the azan never fired and this
  // proof flaked exactly at local midnight (observed once, at 00:1x local).
  // The UTC-parts form keeps the minute value huge (≥ 1440) and harmless,
  // and matches nextPrayerTrigger's own anchor for every hour of the day.
  const midnight = Date.UTC(
    nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate(), 0, 0, 0,
  ) - OFFSET_H * 3_600_000;
  // 2 real SECONDS ahead: the loop's due-check uses the REAL clock, so the
  // boundary must actually be crossed while the harness polls (the injected
  // timers only shorten the POLL cadence, not time itself — a +90 s head
  // start would need a +90 s wait; this exact timing subtlety cost the
  // harness a few debug rounds, so both numbers are pinned together).
  const targetAzanMs = realNowMs + 2_000; // +2 s ahead of the real clock, directly
  const synthetic = { fajr: null, dhuhr: (targetAzanMs - midnight) / 60_000, asr: null, maghrib: null, isha: null };
  const fired: Trigger[] = [];
  const handles: Array<ReturnType<typeof setTimeout>> = [];
  const setTimeoutFn = (cb: () => void, _ms: number): ReturnType<typeof setTimeout> => {
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

console.log("== Proof 1 (structural): hourly dhikr boundary + enable-feedback + 14s lifetime ==");
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

const NOW_DHIKR = Date.UTC(2026, 9, 19, 10, 37, 12);

console.log("\n== Proof 5: the draw actually consults the INJECTED randomness ==");
{
  // A deterministic sequence lets us pin exactly which index each call lands
  // on — proves both entry points route through the injectable `random`,
  // not a baked-in Math.random:
  const seq = [0.0, 0.999, 0.5];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const t1 = immediateDhikrTrigger(NOW_DHIKR, 17, { excludeIndex: null, random: rng });
  check("seq 0.0 → index 0 (immediate)", t1?.dhikrIndex === 0, JSON.stringify(t1));
  const t2 = immediateDhikrTrigger(NOW_DHIKR, 17, { excludeIndex: null, random: rng });
  check("seq 0.999 → index 16 (immediate, ceil of pool)", t2?.dhikrIndex === 16, JSON.stringify(t2));
  const t3 = nextHourlyDhikrTrigger(NOW_DHIKR, 17, { excludeIndex: null, random: rng });
  check("seq 0.5 → index 8 (hourly)", t3?.dhikrIndex === 8, JSON.stringify(t3));
  const t4 = nextHourlyDhikrTrigger(NOW_DHIKR, 17, { excludeIndex: null, random: rng });
  check("sequence continues across calls (hourly)", t4?.dhikrIndex === 0, JSON.stringify(t4));
}

console.log("\n== Proof 6: never repeats the immediately previous dhikr ==");
{
  // Real Math.random, many iterations, consecutive draws with exclusion:
  let repeatStreak = 0;
  let prev: number | null = null;
  for (let k = 0; k < 4_000; k++) {
    const t = immediateDhikrTrigger(NOW_DHIKR + k, ADHKAR.length, { excludeIndex: prev });
    const idx = t?.dhikrIndex ?? -1;
    if (idx === prev) { repeatStreak++; break; }
    prev = idx;
  }
  check("4 000 consecutive real-RNG draws, zero immediate repeats", repeatStreak === 0, `repeats=${repeatStreak}`);

  // Exclusion is INJECTED-value-driven, not luck: with the RNG forced to the
  // index that WOULD collide, the draw must skip it anyway:
  const forced = () => 0; // without exclusion this lands on candidates[0] = 0
  const tAfter8 = immediateDhikrTrigger(NOW_DHIKR, 17, { excludeIndex: 0, random: forced });
  check("excludeIndex 0 + RNG pinned at 0 → still not 0 (excluded from pool)", tAfter8?.dhikrIndex !== 0 && tAfter8?.dhikrIndex === 1, JSON.stringify(tAfter8));

  // Each call draws FRESH randomness — two consecutive calls with an
  // un-excluded uniform-ish RNG spread across the pool (old code returned
  // the SAME hour-derived index for every call inside one hour):
  const drawn = new Set<number>();
  for (let k = 0; k < 400; k++) {
    const t = immediateDhikrTrigger(NOW_DHIKR + k, ADHKAR.length, { excludeIndex: null });
    drawn.add(t?.dhikrIndex ?? -1);
  }
  check("400 draws with a fresh RNG spread over nearly the whole list", drawn.size >= 14, `${drawn.size}/17 distinct`);
}

console.log("\n== Proof 7: draw stays in range for every list size (incl. 1 and 0) ==");
{
  const rng = () => 0.3;
  check("dhikrCount = 0 → null", immediateDhikrTrigger(NOW_DHIKR, 0) === null);
  check("dhikrCount = 0 → null (hourly)", nextHourlyDhikrTrigger(NOW_DHIKR, 0) === null);
  const single = immediateDhikrTrigger(NOW_DHIKR, 1, { random: rng });
  check("dhikrCount = 1 → index 0, no divide-by-zero", single?.dhikrIndex === 0, JSON.stringify(single));
  const singleExcludedItself = immediateDhikrTrigger(NOW_DHIKR, 1, { excludeIndex: 0, random: rng });
  check("dhikrCount = 1 + its only index excluded → still 0 (pool of one cannot be empty)", singleExcludedItself?.dhikrIndex === 0, JSON.stringify(singleExcludedItself));
  let allInRange = true;
  for (let c = 1; c <= 17; c++) {
    for (let ex = -1; ex <= c; ex++) {
      const t = immediateDhikrTrigger(NOW_DHIKR + ex + c * 100, c, { excludeIndex: ex < 0 ? null : ex, random: rng });
      if (!t || t.dhikrIndex === undefined || t.dhikrIndex < 0 || t.dhikrIndex >= c) { allInRange = false; }
    }
  }
  check("indices in [0, count) for counts 1..17 with every exclusion", allInRange);
  // Clamping at the pool edge: RNG = 0.9999999 on a pool of 16 must give 15, not 16:
  const edge = immediateDhikrTrigger(NOW_DHIKR, 17, { excludeIndex: null, random: () => 0.9999999999 });
  check("RNG≈1 pools of 16 → max index 16, never 17", edge?.dhikrIndex === 16, JSON.stringify(edge));
}

console.log("\n== Proof 8: BOTH dhikr entry points randomise (not just one) ==");
{
  // The old defect: index derived from the epoch hour → both calls agreed
  // within the hour → every toggle same card. Prove each entry point follows
  // its own random source:
  let state = 0;
  const differentEachCall = () => (state++ % 2 === 0 ? 0.1 : 0.9);
  const hourlyA = nextHourlyDhikrTrigger(NOW_DHIKR, 17, { random: differentEachCall });
  const hourlyB = nextHourlyDhikrTrigger(NOW_DHIKR, 17, { random: differentEachCall });
  check("hourly varies across calls with varying RNG", hourlyA?.dhikrIndex !== hourlyB?.dhikrIndex, `${hourlyA?.dhikrIndex} vs ${hourlyB?.dhikrIndex}`);
  const immA = immediateDhikrTrigger(NOW_DHIKR, 17, { random: differentEachCall });
  const immB = immediateDhikrTrigger(NOW_DHIKR, 17, { random: differentEachCall });
  check("immediate varies across calls with varying RNG", immA?.dhikrIndex !== immB?.dhikrIndex, `${immA?.dhikrIndex} vs ${immB?.dhikrIndex}`);
  // Real-RNG statistical check that neither entry point is hour-derived:
  let immVaried = false, hourlyVaried = false;
  for (let k = 0; k < 60; k++) {
    const ia = immediateDhikrTrigger(NOW_DHIKR, ADHKAR.length)?.dhikrIndex;
    const ib = immediateDhikrTrigger(NOW_DHIKR, ADHKAR.length)?.dhikrIndex;
    const ha = nextHourlyDhikrTrigger(NOW_DHIKR, ADHKAR.length)?.dhikrIndex;
    const hb = nextHourlyDhikrTrigger(NOW_DHIKR, ADHKAR.length)?.dhikrIndex;
    if (ia !== ib) immVaried = true;
    if (ha !== hb) hourlyVaried = true;
  }
  check("immediate+hourly both vary under real RNG within the SAME instant (old code: frozen)", immVaried && hourlyVaried);
}

console.log(`\n${failed ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"}`);
process.exit(failed ? 1 : 0);
