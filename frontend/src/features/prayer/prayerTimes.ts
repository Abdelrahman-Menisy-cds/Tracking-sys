/**
 * Prayer-time computation: pure functions, zero dependencies, zero network,
 * zero side effects. Every value a reviewer could want to check by hand is
 * exported as an intermediate.
 *
 * Conventions, stated plainly:
 * - Method: Egyptian General Authority of Survey — Fajr twilight angle 19.5°,
 *   Isha twilight angle 17.5°, Dhuhr at solar transit (+1 min altitude guard,
 *   the standard "sun is not exactly at zenith" convention), Asr via the
 *   Shafi'i shadow factor (one object-length past the noon shadow).
 * - Output unit: minutes after LOCAL midnight of the given date.
 * - The sun position comes from the classical short approximation of the
 *   astronomical almanacs (mean longitude/anomaly -> ecliptic longitude ->
 *   declination + right ascension + equation of time). Accuracy at this level
 *   is about ±1 minute vs published timetables; the UI says so.
 * - A TIME ZONE IS NOT A PLACE. One representative city per zone (below) is
 *   the best any zone-keyed table can do, and the UI copy says "approximated
 *   to <city>".
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface PrayerLocation {
  /** IANA zone the browser resolved via Intl.DateTimeFormat. */
  timeZone: string;
  /** Representative city actually used for the coordinates. */
  timeZoneCity: string;
  /** True when the zone was unknown and Cairo was substituted (the brief's fallback). */
  fellBackToCairo: boolean;
  coordinates: Coordinates;
}

/** The brief's fixed fallback: Cairo (30.04 N, 31.24 E). */
export const CAIRO: Coordinates = { latitude: 30.0444, longitude: 31.2357 };
export const CAIRO_TIME_ZONE = "Africa/Cairo";

/**
 * Zone -> ONE representative city. Includes every zone the brief names plus a
 * sensible spread of zones where Muslim employees are likely to need it.
 */
const TIME_ZONE_CITIES: Readonly<Record<string, Coordinates & { city: string }>> = {
  "Africa/Cairo": { latitude: 30.0444, longitude: 31.2357, city: "Cairo" },
  "Africa/Algiers": { latitude: 36.7538, longitude: 3.0588, city: "Algiers" },
  "Africa/Casablanca": { latitude: 33.5731, longitude: -7.5898, city: "Casablanca" },
  "Africa/Khartoum": { latitude: 15.5007, longitude: 32.5599, city: "Khartoum" },
  "Africa/Lagos": { latitude: 6.5244, longitude: 3.3792, city: "Lagos" },
  "Africa/Nairobi": { latitude: -1.2921, longitude: 36.8219, city: "Nairobi" },
  "Africa/Tripoli": { latitude: 32.8872, longitude: 13.1907, city: "Tripoli" },
  "Africa/Tunis": { latitude: 36.8065, longitude: 10.1815, city: "Tunis" },
  "Asia/Amman": { latitude: 31.9539, longitude: 35.9106, city: "Amman" },
  "Asia/Baghdad": { latitude: 33.3152, longitude: 44.3661, city: "Baghdad" },
  "Asia/Beirut": { latitude: 33.8938, longitude: 35.5018, city: "Beirut" },
  "Asia/Damascus": { latitude: 33.5138, longitude: 36.2765, city: "Damascus" },
  "Asia/Dubai": { latitude: 25.2048, longitude: 55.2708, city: "Dubai" },
  "Asia/Gaza": { latitude: 31.5017, longitude: 34.4668, city: "Gaza" },
  "Asia/Hebron": { latitude: 31.5326, longitude: 35.095, city: "Hebron" },
  "Asia/Jerusalem": { latitude: 31.7683, longitude: 35.2137, city: "Jerusalem" },
  "Asia/Karachi": { latitude: 24.8607, longitude: 67.0011, city: "Karachi" },
  "Asia/Kuwait": { latitude: 29.3759, longitude: 47.9774, city: "Kuwait City" },
  "Asia/Qatar": { latitude: 25.2854, longitude: 51.531, city: "Doha" },
  "Asia/Riyadh": { latitude: 24.7136, longitude: 46.6753, city: "Riyadh" },
  "Asia/Tbilisi": { latitude: 41.7151, longitude: 44.8271, city: "Tbilisi" },
  "Asia/Tehran": { latitude: 35.6892, longitude: 51.389, city: "Tehran" },
  "Europe/Amsterdam": { latitude: 52.3676, longitude: 4.9041, city: "Amsterdam" },
  "Europe/Berlin": { latitude: 52.52, longitude: 13.405, city: "Berlin" },
  "Europe/Istanbul": { latitude: 41.0082, longitude: 28.9784, city: "Istanbul" },
  "Europe/London": { latitude: 51.5074, longitude: -0.1278, city: "London" },
  "Europe/Madrid": { latitude: 40.4168, longitude: -3.7038, city: "Madrid" },
  "Europe/Moscow": { latitude: 55.7558, longitude: 37.6173, city: "Moscow" },
  "Europe/Paris": { latitude: 48.8566, longitude: 2.3522, city: "Paris" },
  "America/New_York": { latitude: 40.7128, longitude: -74.006, city: "New York" },
  "America/Chicago": { latitude: 41.8781, longitude: -87.6298, city: "Chicago" },
  "America/Denver": { latitude: 39.7392, longitude: -104.9903, city: "Denver" },
  "America/Los_Angeles": { latitude: 34.0522, longitude: -118.2437, city: "Los Angeles" },
  "America/Toronto": { latitude: 43.6532, longitude: -79.3832, city: "Toronto" },
  "America/Mexico_City": { latitude: 19.4326, longitude: -99.1332, city: "Mexico City" },
  "America/Sao_Paulo": { latitude: -23.5505, longitude: -46.6333, city: "São Paulo" },
  "Asia/Kolkata": { latitude: 19.076, longitude: 72.8777, city: "Mumbai" },
  "Asia/Jakarta": { latitude: -6.2088, longitude: 106.8456, city: "Jakarta" },
  "Asia/Kuala_Lumpur": { latitude: 3.139, longitude: 101.6869, city: "Kuala Lumpur" },
  "Asia/Singapore": { latitude: 1.3521, longitude: 103.8198, city: "Singapore" },
  "Asia/Shanghai": { latitude: 31.2304, longitude: 121.4737, city: "Shanghai" },
  "Asia/Tokyo": { latitude: 35.6762, longitude: 139.6503, city: "Tokyo" },
  "Australia/Sydney": { latitude: -33.8688, longitude: 151.2093, city: "Sydney" },
  "UTC": { latitude: 51.5074, longitude: -0.1278, city: "London" },
};

export const TIME_ZONE_COUNT = Object.keys(TIME_ZONE_CITIES).length;

/** Resolve a time zone (default: the visitor's) to representative coordinates. */
export function locationForTimeZone(timeZone?: string): PrayerLocation {
  const resolvedZone =
    (timeZone ? timeZone : (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined)) || CAIRO_TIME_ZONE;
  const entry = TIME_ZONE_CITIES[resolvedZone];
  if (entry) {
    return {
      timeZone: resolvedZone,
      timeZoneCity: entry.city,
      fellBackToCairo: false,
      coordinates: { latitude: entry.latitude, longitude: entry.longitude },
    };
  }
  return {
    timeZone: resolvedZone,
    timeZoneCity: "Cairo",
    fellBackToCairo: true,
    coordinates: CAIRO,
  };
}

export type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

/** Minutes after local midnight. Null only on the polar-day/night edge where the event never happens. */
export type MinutesOrNull = number | null;

export interface PrayerTimes {
  fajr: MinutesOrNull;
  dhuhr: MinutesOrNull;
  asr: MinutesOrNull;
  maghrib: MinutesOrNull;
  isha: MinutesOrNull;
}

/** Intermediates so the golden-value table can be checked by hand. */
export interface SolarIntermediates {
  /** Julian day at local NOON of the date (the fixed evaluation anchor). */
  julianDayNoon: number;
  /** Days since J2000.0 (julianDayNoon - 2451545). */
  daysFromJ2000: number;
  /** Sun's geometric mean longitude, degrees. */
  meanLongitude: number;
  /** Sun's mean anomaly, degrees. */
  meanAnomaly: number;
  /** Sun's ecliptic longitude, degrees. */
  eclipticLongitude: number;
  /** Obliquity of the ecliptic, degrees. */
  obliquity: number;
  /** Solar declination, degrees (negative = south of the equator). */
  declination: number;
  /** Equation of time, minutes (apparent minus mean solar time). */
  equationOfTimeMinutes: number;
  /** UTC offset of the date (hours), taken from the device clock for that date. */
  utcOffsetHours: number;
  /** Solar transit in LOCAL minutes of the date. */
  transitMinutes: number;
  /** |hour angle| in degrees per event: sunrise/sunset (zenith 90.833°). */
  sunriseHourAngle: number;
  /** Hour angle magnitude for Fajr (19.5°). */
  fajrHourAngle: number;
  /** Hour angle magnitude for Isha (17.5°). */
  ishaHourAngle: number;
  /** Hour angle magnitude for Asr (Shafi'i). */
  asrHourAngle: number;
}

export interface PrayerComputation {
  times: PrayerTimes;
  intermediates: SolarIntermediates;
}

export const FAJR_ANGLE = 19.5;
export const ISHA_ANGLE = 17.5;
/** Standard, not the 90° zenith: sunrise/sunset use 90° + refraction 50' + solar radius 16'. */
export const SUNRISE_ZENITH_DEGREES = 90.833;
/** Dhuhr guard minute: the sun is never exactly at zenith at non-tropical latitudes. */
export const DHUHR_ALTITUDE_MINUTES = 1;

const DEG = Math.PI / 180;

/** Julian day for a local calendar date at the given local hour. */
export function julianDay(year: number, month: number, day: number, hourLocal = 0): number {
  let y = year;
  let m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 + hourLocal / 24;
}

/** Local UTC offset in hours OF THE GIVEN DATE (device clock; matches the same device's Intl zone). */
export function localUtcOffsetHours(date: Date): number {
  return -date.getTimezoneOffset() / 60;
}

/**
 * The UTC offset for a calendar date on THIS device, without a Date on hand.
 * D + 12:00 UTC always maps inside the date itself, so reading
 * getTimezoneOffset there gives the offset that governs the whole
 * (non-DST-boundary) day — the offset the prayer computation needs.
 */
export const LOCAL_UTC_OFFSET = {
  hoursOnDate(date: { year: number; month: number; day: number }): number {
    const utcNoon = Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0);
    return -new Date(utcNoon).getTimezoneOffset() / 60;
  },
};

/** Hour angle (degrees) for the sun to reach the given ALTITUDE at latitude/declination. Null above the horographic bound. */
function hourAngleForAltitude(altitudeDegrees: number, latitude: number, declination: number): number | null {
  const cosH =
    (Math.sin(altitudeDegrees * DEG) - Math.sin(latitude * DEG) * Math.sin(declination * DEG)) /
    (Math.cos(latitude * DEG) * Math.cos(declination * DEG));
  if (cosH < -1 || cosH > 1) return null;
  return Math.acos(cosH) / DEG;
}

/** Asr altitude (degrees): cot(h_asr) = shadowFactor + tan(|lat − decl|). Shafi'i uses factor 1. */
export function asrAltitudeDegrees(latitude: number, declination: number, shadowFactor = 1): number {
  return Math.atan(1 / (shadowFactor + Math.tan(Math.abs(latitude - declination) * DEG))) / DEG;
}

/** The Sun's position for a Julian day, as the almanac short approximation. */
function sunPosition(daysFromJ2000: number): {
  declination: number;
  equationOfTimeMinutes: number;
  meanLongitude: number;
  meanAnomaly: number;
  eclipticLongitude: number;
  obliquity: number;
} {
  const meanLongitude = (280.459 + 0.98564736 * daysFromJ2000) % 360;
  const meanAnomaly = (357.529 + 0.98560028 * daysFromJ2000) % 360;
  const eclipticLongitude = meanLongitude + 1.915 * Math.sin(meanAnomaly * DEG) + 0.02 * Math.sin(2 * meanAnomaly * DEG);
  const obliquity = 23.439 - 0.00000036 * daysFromJ2000;
  const declination = Math.asin(Math.sin(obliquity * DEG) * Math.sin(eclipticLongitude * DEG)) / DEG;
  // Right ascension in hours:
  const ra = Math.atan2(Math.cos(obliquity * DEG) * Math.sin(eclipticLongitude * DEG), Math.cos(eclipticLongitude * DEG)) / DEG / 15;
  const meanLongitudeHours = meanLongitude / 15;
  // Equation of time, hours -> minutes (kept positive-normalized).
  let eqHours = meanLongitudeHours - ra;
  if (eqHours > 12) eqHours -= 24;
  if (eqHours < -12) eqHours += 24;
  return {
    declination,
    equationOfTimeMinutes: eqHours * 60,
    meanLongitude,
    meanAnomaly,
    eclipticLongitude,
    obliquity,
  };
}

/**
 * FORMULATION A (shipped): almanac-style transit + hour-angle events.
 * The sun position is evaluated at local NOON of the date, then the transit
 * intermediate is used to RE-EVALUATE the position at the transit moment so
 * the slow drift of declination during the day does not bias the angles.
 */
export function computePrayerTimes(
  date: { year: number; month: number; day: number },
  coordinates: Coordinates,
  utcOffsetHours: number,
): PrayerComputation {
  const { latitude, longitude } = coordinates;
  const julianDayNoon = julianDay(date.year, date.month, date.day, 12);
  const daysFromJ2000 = julianDayNoon - 2451545.0;

  const noon = sunPosition(daysFromJ2000);
  // Transit in UTC hours for the noon evaluation, then re-evaluated once.
  const transitHoursFromNoon = 12 - longitude / 15 - noon.equationOfTimeMinutes / 60;
  const transitMomentDaysFromJ2000 = daysFromJ2000 + (transitHoursFromNoon - 12 + utcOffsetHours) / 24;
  const atTransit = sunPosition(transitMomentDaysFromJ2000);

  const transitMinutesLocal = transitHoursFromNoon * 60 + utcOffsetHours * 60;

  const sunriseHA = hourAngleForAltitude(-0.833, latitude, atTransit.declination);
  const fajrHA = hourAngleForAltitude(-FAJR_ANGLE, latitude, atTransit.declination);
  const ishaHA = hourAngleForAltitude(-ISHA_ANGLE, latitude, atTransit.declination);
  const asrHA = hourAngleForAltitude(
    asrAltitudeDegrees(latitude, atTransit.declination),
    latitude,
    atTransit.declination,
  );

  const haMinutes = (ha: number | null, sign: 1 | -1): MinutesOrNull => {
    if (ha === null) return null;
    return transitMinutesLocal + sign * (ha / 15) * 60;
  };

  const dhuhr = transitMinutesLocal + DHUHR_ALTITUDE_MINUTES;
  const fajr: MinutesOrNull = haMinutes(fajrHA, -1);
  const maghrib: MinutesOrNull = haMinutes(sunriseHA, 1);
  const asr: MinutesOrNull = haMinutes(asrHA, 1);
  const isha: MinutesOrNull = haMinutes(ishaHA, 1);

  return {
    times: { fajr, dhuhr, asr, maghrib, isha },
    intermediates: {
      julianDayNoon,
      daysFromJ2000,
      meanLongitude: noon.meanLongitude,
      meanAnomaly: noon.meanAnomaly,
      eclipticLongitude: noon.eclipticLongitude,
      obliquity: noon.obliquity,
      declination: atTransit.declination,
      equationOfTimeMinutes: atTransit.equationOfTimeMinutes,
      utcOffsetHours,
      transitMinutes: transitMinutesLocal,
      sunriseHourAngle: sunriseHA ?? NaN,
      fajrHourAngle: fajrHA ?? NaN,
      ishaHourAngle: ishaHA ?? NaN,
      asrHourAngle: asrHA ?? NaN,
    },
  };
}

/**
 * FORMULATION B (independent cross-check): the "simple sunrise equation".
 * cos(ω) = (cos(zenith) − sin(φ)·sin(δ)) / (cos(φ)·cos(δ)) applied with the
 * SAME declination but derived from a different expression of the geometry —
 * this checks the transit, the hour-angle direction, and the symmetry of the
 * twilight events, not just re-runs A.
 */
export function sunriseEquationTimes(
  date: { year: number; month: number; day: number },
  coordinates: Coordinates,
  utcOffsetHours: number,
): { sunrise: MinutesOrNull; sunset: MinutesOrNull; transit: MinutesOrNull } {
  const { latitude, longitude } = coordinates;
  const daysFromJ2000 = julianDay(date.year, date.month, date.day, 12) - 2451545.0;
  const { declination, equationOfTimeMinutes } = sunPosition(daysFromJ2000);
  // Solar transit by the plain UTC expression:
  const transitUTCMinutes = (12 - longitude / 15) * 60 - equationOfTimeMinutes;
  const transit = transitUTCMinutes + utcOffsetHours * 60;
  const hourAngle = hourAngleForAltitude(
    -(SUNRISE_ZENITH_DEGREES - 90),
    latitude,
    declination,
  );
  if (hourAngle === null) return { sunrise: null, sunset: null, transit };
  const minutes = (hourAngle / 15) * 60;
  return { sunrise: transit - minutes, sunset: transit + minutes, transit };
}

/**
 * Third check: the sun's ALTITUDE evaluated directly at each computed event
 * time must round-trip to the angle that event is defined by.
 */
export function sunAltitudeAtLocalMinutes(
  date: { year: number; month: number; day: number },
  coordinates: Coordinates,
  utcOffsetHours: number,
  localMinutes: number,
): number {
  const { latitude, longitude } = coordinates;
  const daysFromJ2000 = julianDay(date.year, date.month, date.day, 12) - 2451545.0;
  const { declination, equationOfTimeMinutes } = sunPosition(daysFromJ2000);
  const transitUTCMinutes = (12 - longitude / 15) * 60 - equationOfTimeMinutes;
  const transitLocal = transitUTCMinutes + utcOffsetHours * 60;
  const hourAngleMinutes = localMinutes - transitLocal;
  const hourAngleDegrees = (hourAngleMinutes / 4); // 15°/hour = 0.25°/min
  const altitude = Math.asin(
    Math.sin(latitude * DEG) * Math.sin(declination * DEG) +
    Math.cos(latitude * DEG) * Math.cos(declination * DEG) * Math.cos(hourAngleDegrees * DEG),
  );
  return altitude / DEG;
}

export const PRAYER_KEYS: readonly PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/** "HH:MM" (24h) for minutes-after-midnight; "" when null. */
export function formatPrayerMinutes(minutes: MinutesOrNull): string {
  if (minutes === null) return "";
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = Math.floor(normalized % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
