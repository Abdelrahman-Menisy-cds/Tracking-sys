import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, usePageTitle, type Appearance } from "../app/AppContext";
import { ApiError, login } from "../app/api";
import BrandLockup from "../components/brand/BrandLockup";
import { GlobeIcon, MoonIcon, SunIcon } from "../components/icons";
import type { Locale, Role } from "../i18n/dict";

const ROLE_OPTIONS: Role[] = ["employee", "manager", "hr"];

const MANAGER_EMAIL_TOKENS = ["manager", "mgr", "admin"];
const HR_EMAIL_TOKENS = ["hr", "people", "humanresources"];

/**
 * The sign-in form derives the fixture identity from the email local part so
 * the reviewer can reach a manager or HR view without a visible switcher.
 * Token matching is exact per `.`/`_`/`+`/`-` segment, so "chris@…" is NOT hr.
 */
function roleFromEmail(email: string): Role {
  const tokens = email.split("@")[0].toLowerCase().split(/[._+-]+/).filter(Boolean);
  if (tokens.some((token) => MANAGER_EMAIL_TOKENS.includes(token))) return "manager";
  if (tokens.some((token) => HR_EMAIL_TOKENS.includes(token))) return "hr";
  return "employee";
}

/**
 * Why the server refused the sign-in.
 *
 * The backend deliberately does not enumerate accounts, so a 401/403 gets one
 * neutral line. Anything the server spells out is passed through rather than
 * replaced with an invented reason.
 */
function describeLoginFailure(failure: unknown, locale: Locale): string {
  const ar = locale === "ar";
  if (failure instanceof ApiError) {
    if (failure.kind === "unauthenticated" || failure.kind === "forbidden") {
      return ar ? "البريد الإلكتروني أو كلمة المرور غير صحيحة." : "Incorrect email or password.";
    }
    if (failure.kind === "server") {
      return ar ? "خطأ من الخادم. حاول تاني." : "The server returned an error. Try again.";
    }
    if (failure.kind === "unreachable") {
      return ar ? "تعذّر الوصول إلى الخادم." : "The server could not be reached.";
    }
    if (failure.message) return failure.message;
  }
  return ar ? "تعذّر تسجيل الدخول." : "Could not sign in.";
}

/** Opt-in dev affordance: `?dev=1` or `?dev=True` reveals the role switcher. */
function devQueryEnabled(): boolean {
  const dev = new URLSearchParams(window.location.search).get("dev");
  return dev !== null && ["1", "true"].includes(dev.toLowerCase());
}

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
    adoptSession,
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
  const [devRole, setDevRole] = useState<Role | null>(null);

  const targetLocale = locale === "ar" ? "en" : "ar";
  const languageLabel = targetLocale === "ar" ? t("switchToArabic") : t("switchToEnglish");

  const devToolsEnabled = devQueryEnabled();
  const effectiveRole = devRole ?? roleFromEmail(identifier);
  const roleLabel = (value: Role) =>
    value === "employee" ? t("roleEmployee") : value === "manager" ? t("roleManager") : t("roleHr");
  const showRoleBlock = devToolsEnabled || (identifier.trim().length > 0 && effectiveRole !== "employee");

  const targetTheme: Exclude<Appearance, "system"> = resolvedTheme === "light" ? "dark" : "light";
  const ThemeIcon = resolvedTheme === "light" ? SunIcon : MoonIcon;

  const submit = async (event: FormEvent) => {
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
    try {
      // The server decides the role. Deriving it from the email locally would leave
      // no session behind, and every server-backed action would 401.
      const me = await login(identifier.trim(), password);
      adoptSession(me);
      navigate("/");
    } catch (failure) {
      if (failure instanceof ApiError && failure.kind === "unreachable") {
        // No backend behind this build: the demo path, unchanged. The screens that
        // read server data say so on their own rather than pretending here.
        setRole(effectiveRole);
        navigate("/");
        return;
      }
      setBusy(false);
      setError(describeLoginFailure(failure, locale));
    }
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
          {showRoleBlock ? (
            <div className="login-role-block">
              {devToolsEnabled ? (
                <fieldset className="login-role-picker">
                  <legend className="field-label">{t("role")}</legend>
                  <div className="role-segmented">
                    {ROLE_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`role-segmented-option${effectiveRole === option ? " is-selected" : ""}`}
                        aria-pressed={effectiveRole === option}
                        onClick={() => setDevRole(option)}
                      >
                        {roleLabel(option)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {identifier.trim().length > 0 ? (
                <p className="muted login-role-hint" role="status">
                  {t("role")}: {roleLabel(effectiveRole)}
                </p>
              ) : null}
            </div>
          ) : null}
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
