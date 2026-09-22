import { useApp, usePageTitle } from "../app/AppContext";

export default function AttendancePlaceholderPage() {
  const { t, attendanceDays } = useApp();
  usePageTitle(t("attendanceTitle"));
  return (
    <main className="page-stack" id="main-content">
      <section className="page-heading"><div><p className="eyebrow">{t("navAttendance")}</p><h1>{t("attendanceTitle")}</h1><p className="page-subtitle">{t("attendanceDemoBoundary")}</p></div></section>
      <section className="panel"><h2>{t("attendanceHistoryTitle")}</h2><p>{attendanceDays.length} {t("attendanceEvent")}</p></section>
    </main>
  );
}
