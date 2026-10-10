import { useApp, usePageTitle } from "../app/AppContext";
import { demoUser } from "../mock/data";
import PageHeader from "../components/layout/PageHeader";
import { Banner } from "../components/ui";
import { UserIcon } from "../components/icons";
import PrayerDhikrSettings from "../features/prayer/PrayerDhikrSettings";
import { identityEmployeeId } from "../mock/attendance";

/**
 * The employee's own profile page. The prayer/dhikr settings block renders
 * only when THIS employee's directory religion is MUSLIM — the block reads
 * the religion from the signed-in identity's own directory file (e1/m1/hr1
 * the demo identities), which HR edits on the admin People file (the same
 * overlay the context merges). Christian and OTHER employees get nothing:
 * the block is not merely hidden, it never mounts.
 */
export default function ProfilePage() {
  const { t, locale, role, employeeDirectory } = useApp();
  const profile = demoUser[role];
  usePageTitle(t("profileTitle"));

  /** The signed-in identity's own directory entry (contains hr_file.religion). */
  const ownEntry = employeeDirectory.find((entry) => entry.id === identityEmployeeId(role));
  const ownReligion = ownEntry?.hr_file?.religion ?? null;
  const isMuslim = ownReligion === "MUSLIM";

  const fields = [
    [t("profileJobTitle"), profile.jobTitle[locale]],
    [t("profileDepartment"), profile.department[locale]],
    [t("profileEmployeeNumber"), profile.employeeNumber],
    [t("profileEmail"), profile.email],
    [t("profilePhone"), profile.phone],
    [t("profileAddress"), profile.address[locale]],
    [t("profileDirectManager"), profile.directManager[locale]],
    [t("profileJoinDate"), new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(`${profile.joinDate}T00:00:00`))],
  ];

  return (
    <div className="page reading-page profile-page">
      <PageHeader
        title={<><UserIcon /> {t("profileTitle")}</>}
        subtitle={<><bdi>{profile.name[locale]}</bdi> · {t("profileSubtitle")}</>}
      />
      <Banner tone="info">{t("profileFixtureNote")}</Banner>
      <section className="work-surface section" aria-labelledby="profile-details-heading">
        <div className="section-heading">
          <h2 id="profile-details-heading"><bdi>{profile.name[locale]}</bdi></h2>
          <span className="muted"><bdi>{role.toUpperCase()}</bdi></span>
        </div>
        <dl className="profile-details">
          {fields.map(([label, value]) => (
            <div className="record-field" key={label}>
              <dt className="record-field-label">{label}</dt>
              <dd><bdi>{value}</bdi></dd>
            </div>
          ))}
        </dl>
      </section>
      {isMuslim ? <PrayerDhikrSettings employeeId={identityEmployeeId(role)} isMuslim={isMuslim} /> : null}
    </div>
  );
}
