import { useApp, usePageTitle } from "../app/AppContext";
import PageHeader from "../components/layout/PageHeader";
import { Banner, EmptyState } from "../components/ui";
import { UserIcon } from "../components/icons";
import AssistantSettingsPanel from "../features/assistant/AssistantSettingsPanel";

/**
 * The employee's own profile page, now off the SERVER's identity (`auth/me`
 * through the boot probe/Live context): name, email and role come from
 * `serverAccount`, not a demo persona.
 *
 * The rest of the old employee file (job title, department, joins date…) is
 * served only by the HR-only /employees endpoints, and no endpoint returns
 * "my own employee file" to every role, so those fields render the honest
 * unavailable state instead of fixture rows. For the same reason the
 * prayer/dhikr block, which was gated on the directory's religion field,
 * never mounts any more — no endpoint expose that field for the caller.
 */
export default function ProfilePage() {
  const { t, locale, serverAccount } = useApp();
  usePageTitle(t("profileTitle"));

  /** The server's own role string, mapped onto the dict's role labels. */
  const roleLabel = serverAccount
    ? serverAccount.role === "HR" ? t("roleHr") : serverAccount.role === "MANAGER" ? t("roleManager") : t("roleEmployee")
    : "—";

  const unavailable = locale === "ar"
    ? "حقول ملف الموظف (المسمى الوظيفي، الإدارة، الرقم الوظيفي، المدير، تاريخ التعيين) تُقرأ من نقطة نهاية الموظفين على الخادم لاحقًا؛ لا توجد بيانات مؤكدة الآن."
    : "The employee-file fields (job title, department, employee number, manager, join date) will come from the server's employees endpoints; there is no confirmed data yet.";

  const knownFields = serverAccount
    ? [
        [t("profileEmail"), serverAccount.email],
      ] as [string, string][]
    : [];

  return (
    <div className="page reading-page profile-page">
      <PageHeader
        title={<><UserIcon /> {t("profileTitle")}</>}
        subtitle={<><bdi>{serverAccount?.full_name ?? "—"}</bdi> · {t("profileSubtitle")}</>}
      />
      {serverAccount ? null : (
        <Banner tone="warning" role="alert">
          {locale === "ar" ? "لم يستقر حساب الخادم بعد، فلا يوجد ملف شخصي مؤكد لعرضه." : "The server account is not settled yet, so there is no confirmed profile to show."}
        </Banner>
      )}
      <section className="work-surface section" aria-labelledby="profile-details-heading">
        <div className="section-heading">
          <h2 id="profile-details-heading"><bdi>{serverAccount?.full_name ?? "—"}</bdi></h2>
          <span className="muted">{roleLabel}</span>
        </div>
        {knownFields.length ? (
          <dl className="profile-details">
            {knownFields.map(([label, value]) => (
              <div className="record-field" key={label}>
                <dt className="record-field-label">{label}</dt>
                <dd><bdi>{value}</bdi></dd>
              </div>
            ))}
            <div className="record-field" key={unavailable}>
              <dt className="record-field-label">{locale === "ar" ? "ملف الموظف" : "Employee file"}</dt>
              <dd className="muted">{unavailable}</dd>
            </div>
          </dl>
        ) : (
          <EmptyState message={unavailable} />
        )}
      </section>
      {/* H18: the employee links their OWN provider here — no presets, per the owner. */}
      <AssistantSettingsPanel />
    </div>
  );
}
