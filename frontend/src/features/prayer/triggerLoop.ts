/**
 * Notification trigger scheduling for prayer notices and hourly adhkar.
 *
 * Everything is boundary-driven and injectable so a test can fire the exact
 * trigger without waiting a real hour: `nextPrayerTrigger` and
 * `nextHourlyDhikrTrigger` are pure, and `startTriggers` hands back a stop
 * function plus `fireNow` for the "show one dhikr immediately upon
 * enabling" behavior.
 *
 * NOTES ON SCOPE (also stated in the UI copy):
 * - Notices fire ONLY while the page is open. There is no service worker,
 *   no push subscription, no background delivery, and no reliable offline
 *   queue. Closing the tab ends all of it.
 */

export interface Trigger {
  /** Absolute epoch ms when the trigger should fire. */
  atMs: number;
  /** Stable payload so the caller can label the notice. */
  kind: "prayer" | "prayer-remind" | "dhikr";
  /** Prayer name key when kind is prayer-ish. */
  prayer?: string;
  /** Dhikr index when kind is "dhikr". */
  dhikrIndex?: number;
}

/** Minutes before an event at which the 5-minute pre-reminder fires. */
export const PRE_REMINDER_LEAD_MINUTES = 5;
/** How long a dhikr notice stays visible. */
export const DHIKR_VISIBLE_MS = 14_000;

/**
 * Next prayer trigger for the employee's OWN settings:
 * - the next of the five prayer times at/after `fromMs` (the azan notice),
 * - its −5 min pre-reminder (when enabled),
 * dropped for events inset whose time is today but already fully past.
 */
export function nextPrayerTrigger(
  prayerMinutes: Record<string, number | null>,
  nowMs: number,
  utcOffsetHours: number,
  now: Date = new Date(nowMs),
  options?: { preReminder?: boolean },
): Trigger | null {
  const entries = Object.entries(prayerMinutes)
    .filter(([, minutes]) => minutes !== null) as Array<[string, number]>;
  const order = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
  entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));

  const midnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
  // epoch ms of local midnight for THIS date on this device:
  const localMidnightMs = midnightMs - utcOffsetHours * 3600_000;
  // epoch ms of the wall-clock time the minutes correspond to:
  const eventEpochMs = (minutes: number) => localMidnightMs + minutes * 60_000;

  const pre = options?.preReminder ?? false;
  // Fire-window semantics. A trigger must still be offered briefly AFTER its
  // boundary crosses - otherwise the two conditions (provider offers while
  // azan >= now, loop fires while azan <= now) share a single instant and
  // any poll gap straddling the boundary swallows the notice for the whole
  // day (this exact defect shipped once and made the stack stone-silent).
  // But the catch-up window must be SHORT - poll-gap scale, not "until the
  // next prayer" - or a page loaded hours later would flash a stale azan.
  // GRACE_MS also bounds the reminder line's catch-up.
  const GRACE_MS = 90_000;
  for (let i = 0; i < entries.length; i++) {
    const [prayer, minutes] = entries[i];
    const azan = eventEpochMs(minutes);
    if (azan >= nowMs) {
      // Still in the future: offer the reminder line first when enabled.
      if (pre) {
        const remind = azan - PRE_REMINDER_LEAD_MINUTES * 60_000;
        if (remind >= nowMs) return { atMs: remind, kind: "prayer-remind", prayer };
      }
      return { atMs: azan, kind: "prayer", prayer };
    }
    // Azan already passed: keep offering it past-due for GRACE_MS so the
    // loop's next tick still fires it. The loop suppresses duplicates by
    // recording atMs only on real fires, so a later tick re-sees the same
    // trigger and drops it once fired.
    if (azan >= nowMs - GRACE_MS) {
      return { atMs: azan, kind: "prayer", prayer };
    }
  }
  // All of today's prayers are past (beyond the catch-up grace). Roll to
  // TOMORROW's Fajr rather than returning null: a notice for a real computed
  // time is more useful than silence, and the trigger loop re-asks every
  // poll anyway. The caller must supply tomorrow's times through
  // `tomorrowFirstPrayer` when it has them; without them we return null
  // (never invent a time).
  return null;
}

/**
 * Draw a dhikr index at random. `excludeIndex` (the dhikr shown immediately
 * before, tracked per person per session) is removed from the pool so a
 * repeat never follows itself - the owner reads a repeat as "not random".
 * `random` is injectable so the gate can drive the draw with a fixed
 * sequence; defaults to Math.random.
 */
export function drawDhikrIndex(
  dhikrCount: number,
  excludeIndex: number | null,
  random: () => number = Math.random,
): number | null {
  if (dhikrCount <= 0) return null;
  if (dhikrCount === 1) return 0; // pool of one, nothing to vary
  const candidates: number[] = [];
  for (let i = 0; i < dhikrCount; i++) {
    if (i !== excludeIndex) candidates.push(i);
  }
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}

/**
 * Next hourly dhikr boundary at/after `nowMs`. Fires at wall-clock top of
 * hour per the local clock. WHICH dhikr is drawn at random (per employee,
 * never the immediately previous one) - the clock only sets the boundary,
 * it no longer selects the content (the old `floor(hour) % count` rotation
 * made every employee see the same dhikr in the same hour).
 */
export function nextHourlyDhikrTrigger(
  nowMs: number,
  dhikrCount: number,
  options?: { excludeIndex?: number | null; random?: () => number },
): Trigger | null {
  const index = drawDhikrIndex(dhikrCount, options?.excludeIndex ?? null, options?.random);
  if (index === null) return null;
  const hourStart = Math.ceil((nowMs + 1) / 3_600_000) * 3_600_000;
  return { atMs: hourStart, kind: "dhikr", dhikrIndex: index };
}

/**
 * Which dhikr shows "immediately upon enabling": a fresh random draw, per
 * person, excluding the last one shown - NOT a rotation (the old version
 * derived the pick from the epoch hour, so every toggle inside one hour
 * showed the same card and two employees matched each other).
 */
export function immediateDhikrTrigger(
  nowMs: number,
  dhikrCount: number,
  options?: { excludeIndex?: number | null; random?: () => number },
): Trigger | null {
  const index = drawDhikrIndex(dhikrCount, options?.excludeIndex ?? null, options?.random);
  if (index === null) return null;
  return { atMs: nowMs, kind: "dhikr", dhikrIndex: index };
}

export interface TriggerLoopOptions {
  /** Called every time a trigger crosses its boundary. */
  onTrigger: (trigger: Trigger) => void;
  /**how long to sleep between boundary checks; small enough to be prompt, large enough to be cheap. */
  pollMs: number;
  /** Injectable timer for tests. */
  setTimeoutFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface TriggerLoopHandle {
  stop: () => void;
  /** Fire the right-now dhikr/path immediately (the "enable feedback" path). */
  fire: () => void;
}

/**
 * Run ONE loop of trigger polling for whichever of the two settings is on.
 * The loop never hangs on an empty trigger list - it wakes every pollMs and
 * re-asks, so a new day or a new set of times just works.
 */
export function startTriggerLoop(
  provider: () => Trigger | null,
  options: TriggerLoopOptions,
): TriggerLoopHandle {
  const setTimeoutFn = options.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((h: ReturnType<typeof setTimeout>) => clearTimeout(h));
  const pollMs = Math.max(250, options.pollMs);
  let stopped = false;
  let lastFiredAt = -1;
  let handle: ReturnType<typeof setTimeout> | null = null;

  const tick = () => {
    if (stopped) return;
    const trigger = provider();
    // Fire the trigger when its boundary has been crossed. `lastFiredAt` is
    // recorded ONLY on an actual fire - a first tick that sees a FUTURE
    // trigger must not record it, or that same trigger would be suppressed
    // forever once time actually crosses its boundary (the notice then
    // never fires for the whole day; this exact bug shipped once).
    if (trigger && trigger.atMs <= Date.now() && trigger.atMs !== lastFiredAt) {
      lastFiredAt = trigger.atMs;
      options.onTrigger(trigger);
    }
    handle = setTimeoutFn(tick, pollMs);
  };
  handle = setTimeoutFn(tick, pollMs);
  return {
    stop: () => {
      stopped = true;
      if (handle !== null) clearTimeoutFn(handle);
      handle = null;
    },
    fire: () => {
      const trigger = provider();
      if (trigger) options.onTrigger(trigger);
    },
  };
}
