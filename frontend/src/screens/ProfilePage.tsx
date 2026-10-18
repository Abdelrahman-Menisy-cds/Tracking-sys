import { useEffect, useState } from "react";
import { useApp, usePageTitle } from "../app/AppContext";
import { getMyEmployee, type ServerEmployee } from "../app/orgApi";
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
 * never mounts any more - no endpoint expose that field for the caller.
 */
export default function ProfilePage() {
  const { t, locale, serverAccount } = useApp();
  usePageTitle(t("profileTitle"));

  /** The server's own role string, mapped onto the dict's role labels. */
  const roleLabel = serverAccount
    ? serverAccount.role === "HR" ? t("roleHr") : serverAccount.role === "MANAGER" ? t("roleManager") : t("roleEmployee")
    : "-";

  /* The employee file is the caller's OWN row, which /employees/me serves to
     every role; the id route is HR-only and was never the right source here. */
  const [employee, setEmployee] = useState<ServerEmployee | null>(null);
  const [fileFailed, setFileFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getMyEmployee(locale)
      .then((row) => { if (alive) { setEmployee(row); setFileFailed(false); } })
      .catch(() => { if (alive) setFileFailed(true); });
    return () => { alive = false; };
  }, [locale]);
  const fileFields = employee
    ? ([ 
        [t("profileEmail"), employee.email],
        [locale === "ar" ? "المسمى الوظيفي" : "Job title", employee.job_title],
        [locale === "ar" ? "الإدارة" : "Department", [employee.department_name_ar, employee.department_code].filter(Boolean).join(" · ")],
        [locale === "ar" ? "الرقم الوظيفي" : "Employee number", employee.employee_number ?? ""],
        [locale === "ar" ? "المدير" : "Manager", employee.manager_name ?? ""],
      ] as [string, string][]).filter(([, value]) => value !== "" && value !== null && value !== undefined)
    : serverAccount ? [[t("profileEmail"), serverAccount.email]] as [string, string][] : [];

  return (
    <div className="page reading-page profile-page">
      <PageHeader
        title={<><UserIcon /> {t("profileTitle")}</>}
        subtitle={<><bdi>{serverAccount?.full_name ?? "-"}</bdi> · {t("profileSubtitle")}</>}
      />
      {serverAccount ? null : (
        <Banner tone="warning" role="alert">
          {locale === "ar" ? "لم يستقر حساب الخادم بعد، فلا يوجد ملف شخصي مؤكد لعرضه." : "The server account is not settled yet, so there is no confirmed profile to show."}
        </Banner>
      )}
      <section className="work-surface section" aria-labelledby="profile-details-heading">
        <div className="section-heading">
          <h2 id="profile-details-heading"><bdi>{serverAccount?.full_name ?? "-"}</bdi></h2>
          <span className="muted">{roleLabel}</span>
        </div>
        {fileFields.length ? (
          <dl className="profile-details">
            {fileFields.map(([label, value]) => (
              <div className="record-field" key={label}>
                <dt className="record-field-label">{label}</dt>
                <dd><bdi>{value}</bdi></dd>
              </div>
            ))}
          </dl>
        ) : (
          fileFailed ? (
            <Banner tone="error" role="alert">{locale === "ar" ? "تعذّر تحميل ملف الموظف. جرّب تحديث الصفحة." : "Could not load the employee file. Try refreshing."}</Banner>
          ) : (
            <EmptyState message={locale === "ar" ? "جارٍ تحميل ملف الموظف…" : "Loading the employee file…"} />
          )
        )}
      </section>
      {/* H18: the employee links their OWN provider here - no presets, per the owner. */}
      <AssistantSettingsPanel />
    </div>
  );
}
