import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, usePageTitle, type Appearance } from "../app/AppContext";
import BrandLockup from "../components/brand/BrandLockup";
import { GlobeIcon, MoonIcon, SunIcon } from "../components/icons";

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="icon" fill="none" focusable="false" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.65} viewBox="0 0 20 20" width="20">
      <path d="M2 10s2.8-4.8 8-4.8S18 10 18 10s-2.8 4.8-8 4.8S2 10 2 10Z" />
      <circle cx="10" cy="10" r="2.4" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" className="icon" fill="none" focusable="false" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.65} viewBox="0 0 20 20" width="20">
      <path d="M2 10s2.8-4.8 8-4.8S18 10 18 10s-2.8 4.8-8 4.8S2 10 2 10Z" />
      <path d="M4 4 16 16" />
    </svg>
  );
}

export default function LoginPage() {
  const {
    t,
    locale,
    setLocale,
    setRole,
    isDemoMode,
    setAppearance,
    resolvedTheme,
  } = useApp();
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  usePageTitle(t("signIn"));

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targetLocale = locale === "ar" ? "en" : "ar";
  const languageLabel = targetLocale === "ar" ? t("switchToArabic") : t("switchToEnglish");

  const targetTheme: Exclude<Appearance, "system"> = resolvedTheme === "light" ? "dark" : "light";
  const ThemeIcon = resolvedTheme === "light" ? SunIcon : MoonIcon;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!identifier.trim()) {
      setError(locale === "ar" ? "أدخل البريد الإلكتروني." : "Enter your email.");
      identifierRef.current?.focus();
      return;
    }
    if (!password) {
      setError(locale === "ar" ? "أدخل كلمة المرور." : "Enter your password.");
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    window.setTimeout(() => {
      setBusy(false);
      setRole("employee");
      navigate("/");
    }, 500);
  };

  return (
    <main className="login-page">
      <div className="login-brand-watermark" aria-hidden="true">
        <img src={`/brand/logo-${resolvedTheme}.png`} alt="" />
      </div>
      <section className="login-panel" aria-labelledby="sign-in-heading">
        <div className="login-header-row">
          <BrandLockup showTagline />
          <div className="login-preferences-header">
            <button
              type="button"
              className="btn btn-secondary icon-only language-toggle-header"
              aria-label={languageLabel}
              onClick={() => setLocale(targetLocale)}
            >
              <GlobeIcon />
            </button>
            <button
              type="button"
              className="btn btn-secondary icon-only theme-toggle-header"
              aria-label={targetTheme === "light" ? t("switchToLight") : t("switchToDark")}
              aria-pressed={resolvedTheme === "dark"}
              onClick={() => setAppearance(targetTheme)}
            >
              <ThemeIcon />
            </button>
          </div>
        </div>
        <h1 id="sign-in-heading">{t("signIn")}</h1>
        <form onSubmit={submit} noValidate>
          {error && (
            <div className="banner banner-error" role="alert">
              {error}
            </div>
          )}
          <label className="field">
            <span className="field-label">{t("identifier")}</span>
            <input
              ref={identifierRef}
              className="input"
              type="email"
              name="email"
              dir="ltr"
              autoComplete="username"
              spellCheck={false}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">{t("password")}</span>
            <div className="password-field">
              <input
                ref={passwordRef}
                className="input"
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="password-visibility-toggle"
                aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
          <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                {t("loading")}
              </>
            ) : (
              t("signIn")
            )}
          </button>
        </form>
        {isDemoMode && <p className="muted login-demo-note">{t("demoDataNote")}</p>}
      </section>
    </main>
  );
}
