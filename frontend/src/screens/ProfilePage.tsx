import { useApp, usePageTitle } from "../app/AppContext";
import { demoUser } from "../mock/data";
import PageHeader from "../components/layout/PageHeader";
import { Banner } from "../components/ui";
import { UserIcon } from "../components/icons";

export default function ProfilePage() {
  const { t, locale, role } = useApp();
  const profile = demoUser[role];
  usePageTitle(t("profileTitle"));

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
    </div>
  );
}
