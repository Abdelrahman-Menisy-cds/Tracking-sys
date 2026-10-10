
import {
  computePrayerTimes,
  formatPrayerMinutes,
  CAIRO,
  LOCAL_UTC_OFFSET,
} from "../src/features/prayer/prayerTimes";
import { nextPrayerTrigger } from "../src/features/prayer/triggerLoop";

const nowMs = Date.now();
const now = new Date(nowMs);
const date = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
const times = computePrayerTimes(date, CAIRO, LOCAL_UTC_OFFSET.hoursOnDate(date));
console.log("Local now:", now.toString());
console.log("Today's five:", JSON.stringify(Object.fromEntries(Object.entries(times.times).map(([k,v])=>[k, formatPrayerMinutes(v)]))));
const t = nextPrayerTrigger(times.times, nowMs, LOCAL_UTC_OFFSET.hoursOnDate(date), now, { preReminder: true });
console.log("Next trigger:", JSON.stringify(t));
if (t) console.log("in", Math.round((t.atMs - nowMs)/60000), "minutes");
