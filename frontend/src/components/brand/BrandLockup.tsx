import { useApp } from "../../app/AppContext";

export default function BrandLockup({ showTagline = false }: { showTagline?: boolean }) {
  const { t } = useApp();
  return <div className="brand-lockup"><svg className="brand-mark" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect x="7" y="6" width="26" height="30" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" /><rect x="13" y="3" width="14" height="7" rx="2" fill="currentColor" /><path d="M13 17h14M13 23h14M13 29h8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><rect className="brand-slip" x="26" y="29" width="9" height="7" rx="1.5" transform="rotate(-8 30 32)" /></svg><div><div className="brand-name" translate="no"><bdi>{t("brand")}</bdi></div><div className="brand-descriptor">{t("descriptor")}</div>{showTagline && <div className="brand-descriptor">{t("tagline")}</div>}</div></div>;
}
