import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { fetchCompany, saveCompany, type CompanyProfilePatch, type CompanyState } from "../app/companyApi";
import { ApiError, getIdentity, logout } from "../app/api";
import { CompanyForm } from "../components/company/CompanyForm";
import BrandLockup from "../components/brand/BrandLockup";
import { Banner } from "../components/ui";
import { AlertTriangleIcon, LogoutIcon } from "../components/icons";
import type { Dict, Locale } from "../i18n/dict";

type DictKey = keyof Dict;

/**
 * /onboarding/company - the mandatory first stop after signup (Story H17).
 *
 * The gate lives in the app shell: while `needs_company_profile` is true,
 * every other route redirects here. So the only exit besides saving is the
 * sign-out control at the top - deliberately no nav, no links into the app:
 * the owner's rule is that the company's data is the first thing the HR user
 * does, and staying here until it is saved IS the contract, not a glitch.
 *
 * One honest read of GET /company seeds the form (usually null right after
 * signup); the save goes through the one shared helper, per-field server
 * errors render under their field, and success hands the settled state back
 * to the context so the gate releases immediately and navigation continues
 * into the app.
 */
export default function OnboardingCompanyPage({ onCompleted }: { onCompleted?: (state: CompanyState) => void }) {
  const { t, locale, serverAccount, resolvedTheme, adoptSession } = useApp();
  usePageTitle(t("companyOnboardingTitle"));
  const navigate = useNavigate();

  const [profile, setProfile] = useState<CompanyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  /** Refs because the save callback must never read a stale closure. */
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCompany(locale)
      .then((state) => {
        if (cancelled) return;
        setProfile(state);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setLoadFailed(true);
        setLoading(false);
        // 404/unreachable: the backend is not there yet (the gate's own
        // fail-open rule covers the rest of the app; THIS screen still needs
        // a working save, so it says exactly what is wrong instead).
        setBanner(
          failure instanceof ApiError && failure.kind === "server"
            ? t("companyErrorServer")
            : t("companyErrorUnreachable"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [locale, t]);

  const save = async (patch: CompanyProfilePatch): Promise<void> => {
    const settled = await saveCompany(patch, locale);
    if (!mountedRef.current) return;
    setProfile(settled);
    onCompleted?.(settled);
    // The gate reads the identity, not this screen's copy of the state. The
    // boot-time /auth/me snapshot still says "onboarding owed", so re-read the
    // identity (the server's own authoritative flag, now false) and adopt it
    // BEFORE navigating - otherwise the gate would divert the very navigation
    // this save just earned and bounce the user straight back here. The fresh
    // me-answer, not the PATCH envelope, is what the gate consumes.
    try {
      adoptSession(await getIdentity());
    } catch {
      /* an unadoptable refresh must not erase a real save; a reload settles it */
    }
    navigate("/");
  };

  const signOut = async () => {
    try {
      await logout();
    } catch {
      /* the local escape (navigating to /login with the cookie cleared client
         side) is the guaranteed path; a failed server sign-out must not trap
         the user here */
    }
    mountedRef.current = false;
    window.location.href = "/login";
  };

  return (
    <main className="login-page">
      <div className="login-brand-watermark" aria-hidden="true">
        <img src={`/brand/logo-${resolvedTheme}.png`} alt="" />
      </div>
      <section className="work-surface login-panel company-onboarding-panel" aria-labelledby="company-heading">
        <div className="login-header-row">
          <BrandLockup showTagline />
          <button type="button" className="btn btn-ghost company-signout" onClick={signOut}>
            <LogoutIcon />
            {t("companySignOut")}
          </button>
        </div>
        <Banner tone="info" role="status">{t("companyLockedBanner")}</Banner>
        {serverAccount ? (
          <p className="muted company-signed-as">{t("companySignedInAs").replace("%s", serverAccount.email)}</p>
        ) : null}
        <h1 id="company-heading" className="visually-hidden">{t("companyOnboardingTitle")}</h1>
        <p className="page-meta company-onboarding-meta">{t("companyOnboardingSubtitle")}</p>
        {banner ? <Banner tone={loadFailed ? "warning" : "error"} role="alert">{banner}</Banner> : null}
        {loading ? (
          <div className="company-form-loading" aria-busy="true">
            <span className="spinner" aria-hidden="true" />
            <span>{t("loading")}</span>
          </div>
        ) : loadFailed ? (
          <div className="empty-region company-form-error">
            <AlertTriangleIcon className="state-icon" />
            <p>{t("companyErrorUnreachable")}</p>
          </div>
        ) : (
          <CompanyForm
            profile={profile?.profile ?? null}
            t={t as (key: DictKey) => string}
            locale={locale as Locale}
            submitLabel="companySaveContinue"
            savingLabel="companySaving"
            onSave={save}
          />
        )}
      </section>
    </main>
  );
}
