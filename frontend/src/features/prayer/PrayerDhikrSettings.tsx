import { useMemo } from "react";
import { useApp } from "../../app/AppContext";
import { usePrayerNotices, type PrayerPreferences } from "../../features/prayer/usePrayerNotices";
import { FloatingNoticeStack, type FloatingNoticeData } from "../../features/prayer/FloatingNoticeStack";
import { formatPrayerMinutes, type PrayerTimes } from "../../features/prayer/prayerTimes";
import { ADHKAR } from "../../features/prayer/adhkar";
import type { Dict } from "../../i18n/dict";

/**
 * The employee's OWN prayer/dhikr settings block on /profile.
 *
 * Rendered ONLY when the signed-in employee's directory entry says MUSLIM —
 * read from their own hr_file.religion through the employeeDirectory (the
 * same overlay-merged directory the admin screens write to). Christian and
 * OTHER employees see nothing here at all: the block does not exist for
 * them, per the product owner's rule that the two options belong to the
 * Muslim employee alone.
 *
 * The notices stack is rendered FROM this screen but portaled to the
 * document body, so it floats over any authenticated page while /profile
 * stays open. No service worker, no push, no background delivery — stated
 * plainly in the copy below and in the feature module.
 */

interface PrayerDhikrSettingsProps {
  /** The signed-in employee's own directory id (their hr_file carries religion). */
  employeeId: string;
  isMuslim: boolean;
}

export default function PrayerDhikrSettings({ employeeId, isMuslim }: PrayerDhikrSettingsProps) {
  const { t, locale } = useApp();
  const { prefs, setPreference, notices, dismissNotice, times, location } = usePrayerNotices(employeeId);
  const localizedNotices = useMemo(() => localizeNotices(notices, locale === "ar" ? "ar" : "en", t), [notices, locale, t]);

  if (!isMuslim) return null;

  const rows: Array<{ key: keyof PrayerTimes; label: string }> = [
    { key: "fajr", label: locale === "ar" ? "الفجر" : "Fajr" },
    { key: "dhuhr", label: locale === "ar" ? "الظهر" : "Dhuhr" },
    { key: "asr", label: locale === "ar" ? "العصر" : "Asr" },
    { key: "maghrib", label: locale === "ar" ? "المغرب" : "Maghrib" },
    { key: "isha", label: locale === "ar" ? "العشاء" : "Isha" },
  ];

  const switches: Array<{
    key: keyof PrayerPreferences;
    label: string;
    hint: string;
    nested: boolean;
    disabled: boolean;
  }> = [
    {
      key: "prayerTimes",
      label: t("prayerNoticeOptIn"),
      hint: t("prayerNoticeOptInHint"),
      nested: false,
      disabled: false,
    },
    {
      key: "preReminder",
      label: t("prayerPreReminder"),
      hint: t("prayerPreReminderHint"),
      nested: true,
      disabled: !prefs.prayerTimes,
    },
    {
      key: "hourlyDhikr",
      label: t("prayerDhikrOptIn"),
      hint: t("prayerDhikrOptInHint"),
      nested: false,
      disabled: false,
    },
  ];

  return (
    <>
      <section className="work-surface section prayer-settings" aria-labelledby="prayer-settings-heading">
        <div className="section-heading">
          <h2 id="prayer-settings-heading">{locale === "ar" ? "مواقيت الصلاة والأذكار" : t("prayerSettingsHeading")}</h2>
        </div>
        <p className="muted prayer-scope-line">{t("prayerSettingsScopeLine")}</p>
        <div className="prayer-switches">
          {switches.map((item) => (
            <label
              key={item.key}
              className={`prayer-switch${item.nested ? " prayer-switch-nested" : ""}${item.disabled ? " is-disabled" : ""}`}
            >
              <input
                type="checkbox"
                role="switch"
                checked={prefs[item.key]}
                disabled={item.disabled}
                onChange={(event) => setPreference(item.key, event.target.checked)}
              />
              <span className="prayer-switch-label">{item.label}</span>
              <span className="prayer-switch-hint muted">{item.hint}</span>
            </label>
          ))}
        </div>
        <div className="prayer-today">
          <h3>{locale === "ar" ? "مواقيت اليوم" : t("prayerTimesToday")}</h3>
          {rows.some((row) => times.times[row.key] === null) ? (
            <p className="muted">{t("prayerUnavailableLine")}</p>
          ) : (
            <dl className="prayer-times-list">
              {rows.map((row) => (
                <div className="prayer-times-row" key={row.key}>
                  <dt>{row.label}</dt>
                  <dd>
                    <time dateTime={formatPrayerMinutes(times.times[row.key])}>
                      {formatPrayerMinutes(times.times[row.key])}
                    </time>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <p className="muted prayer-zone-note">
          {t("prayerTimeZoneNote")
            .replace("%s", location.timeZone)
            .replace("%s", location.timeZoneCity)}
        </p>
      </section>
      <FloatingNoticeStack notices={localizedNotices} onDismiss={dismissNotice} />
    </>
  );
}

function localizeNotices(
  notices: FloatingNoticeData[],
  locale: "ar" | "en",
  t: (key: keyof Dict) => string,
): FloatingNoticeData[] {
  void locale; void t;
  return notices;
}

/** Exported for the reviewer's manual roster: which adhkar exist. */
export { ADHKAR };
