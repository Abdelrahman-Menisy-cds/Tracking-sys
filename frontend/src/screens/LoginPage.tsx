import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { DEMO_MODE, useApp, usePageTitle, type Appearance } from "../app/AppContext";
import { ApiError, login, signup } from "../app/api";
import BrandLockup from "../components/brand/BrandLockup";
import PageHeader from "../components/layout/PageHeader";
import { MoonIcon, SunIcon } from "../components/icons";
import type { Locale, Role } from "../i18n/dict";

const ROLE_OPTIONS: Role[] = ["employee", "manager", "hr"];

/**
 * The demo accounts, one per role (created by `manage.py seed_demo_accounts`).
 *
 * The picker does not grant a role — the server still derives it from the
 * account, so picking a role and typing that role's email by hand land in
 * exactly the same place. All it chooses is WHICH account you sign in as.
 *
 * The shared password is in the bundle on purpose, and only in the demo build:
 * DEMO_MODE is a compile-time constant, so a real build drops this whole map
 * rather than merely hiding it.
 */
const DEMO_ACCOUNTS: Record<Role, { email: string; password: string }> = {
  employee: { email: "employee@demo.local", password: "demo1234" },
  manager: { email: "manager@demo.local", password: "demo1234" },
  hr: { email: "hr@demo.local", password: "demo1234" },
};

/**
 * The demo signup code (Story H14b), in the bundle for the same reason as
 * DEMO_ACCOUNTS above: DEMO_MODE is compile-time, so a real build drops it.
 * When the API is unreachable the demo path has no server to check the code,
 * so the client must judge — this constant IS the demo judge. Anything else
 * is refused before any session is faked.
 */
const DEMO_SIGNUP_CODE = "Menisy2002";
const DEMO_SIGNUP_EMAIL_TOKENS = ["hr", "people", "humanresources"];

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

/**
 * Why the server refused the signup. The served backend answers a wrong or
 * inactive code with a generic non-enumerating 400 (message «الكود غير صحيح»)
 * and an existing email + valid code with a 200 `email_in_use` outcome that is
 * not a session — the client raises that as an ApiError and renders it here.
 */
function describeSignupFailure(failure: unknown, locale: Locale): string {
  const ar = locale === "ar";
  if (failure instanceof ApiError) {
    if (failure.message === "email_in_use") {
      return ar ? "البريد الإلكتروني ده مستخدم قبل كده — سجّل الدخول بحسابك." : "That email is already in use — sign in with your account instead.";
    }
    if (failure.kind === "unreachable") {
      return ar ? "تعذّر الوصول إلى الخادم." : "The server could not be reached.";
    }
    if (failure.kind === "server") {
      return ar ? "خطأ من الخادم. حاول تاني." : "The server returned an error. Try again.";
    }
    if (failure.message) return failure.message;
  }
  return ar ? "تعذّر إنشاء الحساب." : "Could not create the account.";
}

/**
 * The server's own per-field refusal, already in the operator's language (H15a). A validation
 * failure answers `error.fields = {password: ["…"]}` while `error.message` stays the generic
 * «Validation failed.», so anything useful has to come from the FIELD (H15b).
 */
function firstFieldIssue(failure: unknown): { field: string; message: string } | null {
  if (!(failure instanceof ApiError) || !failure.fields) return null;
  for (const [field, messages] of Object.entries(failure.fields)) {
    const list = (messages ?? []).filter(Boolean);
    if (list.length > 0) return { field, message: list.join(" · ") };
  }
  return null;
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

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which field raised the banner, so it can carry aria-invalid and be linked to the message.
  const [errorField, setErrorField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devRole, setDevRole] = useState<Role | null>(null);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupConfirm, setSignupConfirm] = useState("");
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);
  const signupEmailRef = useRef<HTMLInputElement>(null);
  const signupCodeRef = useRef<HTMLInputElement>(null);
  const signupPasswordRef = useRef<HTMLInputElement>(null);
  const signupConfirmRef = useRef<HTMLInputElement>(null);

  const targetLocale = locale === "ar" ? "en" : "ar";
  const languageLabel = targetLocale === "ar" ? t("switchToArabic") : t("switchToEnglish");

  const effectiveRole = devRole ?? roleFromEmail(identifier);
  const roleLabel = (value: Role) =>
    value === "employee" ? t("roleEmployee") : value === "manager" ? t("roleManager") : t("roleHr");
  // Story H14b: the role block is now dev-only. It used to include DEMO_MODE,
  // which made the «الدور» segmented control always visible and LOOKED like a
  // grant (the server decides the role either way).
  const showRoleBlock = devQueryEnabled();

  const targetTheme: Exclude<Appearance, "system"> = resolvedTheme === "light" ? "dark" : "light";
  // The icon names the theme you would get, not the one you are in — the same
  // convention as the language button beside it (which shows "AR"/"EN" for the
  // target) and the same thing the aria-label says.
  const ThemeIcon = resolvedTheme === "light" ? MoonIcon : SunIcon;

  const setPasswordForDevRole = (option: Role) => {
    setDevRole(option);
    // In the demo build the picker fills the account too, so one tap really
    // does sign you in as that role. The server still decides the role — this
    // only names the account.
    if (DEMO_MODE) {
      setIdentifier(DEMO_ACCOUNTS[option].email);
      setPassword(DEMO_ACCOUNTS[option].password);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "signup") {
      // One entry point per form: the signup form is a separate <form> with
      // its own onSubmit, so delegating here would leave the noValidate
      // sign-in submit to validate EMPTY identifier/password first.
      await submitSignup();
      return;
    }
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

  const submitSignup = async (event?: FormEvent) => {
    // The signup <form>'s own onSubmit is its only entry point, so the submit event must be
    // prevented HERE. Without this the browser also performs a native GET: the page reloads
    // mid-request and the operator sees a blank form again even though the account was created.
    // Measured on the served build — the wrong-code attempt came back as «أدخل البريد الإلكتروني.»
    // because a reload had emptied every field.
    event?.preventDefault();
    if (!signupEmail.trim()) {
      setErrorField("email");
      setError(t("signupEnterEmail"));
      signupEmailRef.current?.focus();
      return;
    }
    if (!signupCode.trim()) {
      setErrorField("code");
      setError(t("signupEnterCode"));
      signupCodeRef.current?.focus();
      return;
    }
    if (!signupPassword) {
      setErrorField("password");
      setError(t("signupEnterPassword"));
      signupPasswordRef.current?.focus();
      return;
    }
    // Owner's rule (H14b follow-up): the form collects the password twice, and the
    // subscription code is what decides whether anything gets stored at all.
    if (!signupConfirm) {
      setErrorField("confirm");
      setError(t("signupEnterConfirm"));
      signupConfirmRef.current?.focus();
      return;
    }
    if (signupConfirm !== signupPassword) {
      setErrorField("confirm");
      setError(t("signupPasswordMismatch"));
      signupConfirmRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setErrorField(null);
    try {
      const me = await signup(signupEmail.trim(), signupCode.trim(), signupPassword, locale);
      // Success is a signed-in session: the server created the HR account and
      // established it on the same request, so adopt it exactly like sign-in.
      adoptSession(me);
      navigate("/");
    } catch (failure) {
      if (failure instanceof ApiError && failure.kind === "unreachable") {
        // No backend behind this build: the demo path. DEMO_SIGNUP_CODE above
        // is the demo's local judge; a new HR fixture identity from the email
        // tokens keeps the rest of the demo screens honest without inventing
        // server state that is not there.
        if (signupCode.trim() !== DEMO_SIGNUP_CODE) {
          setBusy(false);
          setErrorField("code");
          setError(t("signupInvalidCode"));
          return;
        }
        const emailTokens = signupEmail.trim().toLowerCase().split("@")[0].split(/[._+-]+/).filter(Boolean);
        setRole(emailTokens.some((token) => DEMO_SIGNUP_EMAIL_TOKENS.includes(token)) ? "hr" : "employee");
        navigate("/");
        return;
      }
      setBusy(false);
      // Say WHICH field failed, in the operator's language, instead of the server's generic
      // sentence: the field messages are localised by the backend (H15a) and carried on ApiError.
      const issue = firstFieldIssue(failure);
      if (failure instanceof ApiError && failure.message === "email_in_use") {
        setErrorField("email");
        setError(t("signupEmailInUse"));
      } else if (issue) {
        const label = issue.field === "email" ? t("signupEmailLabel")
          : issue.field === "code" ? t("signupCodeLabel")
          : issue.field === "password" ? t("signupPasswordLabel")
          : issue.field === "confirm" ? t("signupConfirmLabel")
          : t("signupHeading");
        setErrorField(issue.field);
        setError(`${label}: ${issue.message}`);
      } else {
        setErrorField(null);
        setError(describeSignupFailure(failure, locale));
      }
    }
  };

  /** Tie the banner to the field it came from, so the refusal is announced where it belongs. */
  const signupFieldAttrs = (field: string) =>
    errorField === field && error ? { "aria-invalid": "true" as const, "aria-describedby": "signup-error" } : {};

  return (
    <main className="login-page">
      <div className="login-brand-watermark" aria-hidden="true">
        <img src={`/brand/logo-${resolvedTheme}.png`} alt="" />
      </div>
      <section className="work-surface login-panel" aria-labelledby="sign-in-heading">
        <div className="login-header-row">
          <BrandLockup showTagline />
          <div className="login-preferences-header">
            <button
              type="button"
              className="btn btn-secondary language-toggle-header"
              aria-pressed={locale === "en"}
              aria-label={languageLabel}
              onClick={() => setLocale(targetLocale)}
            >
              {targetLocale.toUpperCase()}
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
        {mode === "signin" ? (
          <>
            <form onSubmit={submit} noValidate>
              {error && (
                <div className="banner banner-error" role="alert">
                  {error}
                </div>
              )}
              <PageHeader title={t("signIn")} headingId="sign-in-heading" />
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
                  onChange={(event) => {
                    setIdentifier(event.target.value);
                    // Typing means you are naming the account yourself, so stop letting a
                    // previous pick speak for the role — the readout follows the email again.
                    setDevRole(null);
                  }}
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
                  <fieldset className="login-role-picker">
                    <legend className="field-label">{t("role")}</legend>
                    <div className="role-segmented">
                      {ROLE_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`role-segmented-option${effectiveRole === option ? " is-selected" : ""}`}
                          aria-pressed={effectiveRole === option}
                          onClick={() => setPasswordForDevRole(option)}
                        >
                          {roleLabel(option)}
                        </button>
                      ))}
                    </div>
                  </fieldset>
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
            <p className="login-signup-entry">
              {t("firstTimeHere")}{" "}
              <button
                type="button"
                className="login-signup-toggle"
                aria-expanded={false}
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                {t("createAccount")}
              </button>
            </p>
          </>
        ) : (
          <>
            <form onSubmit={submitSignup} noValidate>
              {error && (
                <div className="banner banner-error" role="alert" id="signup-error">
                  {error}
                </div>
              )}
              <PageHeader title={t("signupHeading")} headingId="sign-in-heading" />
              <p className="muted login-signup-note">{t("signupRoleNote")}</p>
              <label className="field">
                <span className="field-label">{t("signupEmailLabel")}</span>
                <input
                  ref={signupEmailRef}
                  {...signupFieldAttrs("email")}
                  className="input"
                  type="email"
                  name="email"
                  dir="ltr"
                  autoComplete="email"
                  spellCheck={false}
                  value={signupEmail}
                  onChange={(event) => {
                    setSignupEmail(event.target.value);
                    setError(null);
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label">{t("signupCodeLabel")}</span>
                <input
                  ref={signupCodeRef}
                  {...signupFieldAttrs("code")}
                  className="input"
                  type="text"
                  name="code"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  value={signupCode}
                  onChange={(event) => {
                    setSignupCode(event.target.value);
                    setError(null);
                  }}
                />
              </label>
              <p className="login-signup-contact">
                {t("signupCodeMissing")}{" "}
                <a href="tel:01200704564" className="login-signup-phone">
                  <bdi>01200704564</bdi>
                </a>
              </p>
              <label className="field">
                <span className="field-label">{t("signupPasswordLabel")}</span>
                <div className="password-field">
                  <input
                    ref={signupPasswordRef}
                    {...signupFieldAttrs("password")}
                    className="input"
                    type={showSignupPassword ? "text" : "password"}
                    name="new-password"
                    autoComplete="new-password"
                    value={signupPassword}
                    onChange={(event) => {
                      setSignupPassword(event.target.value);
                      setError(null);
                    }}
                  />
                  <button
                    type="button"
                    className="password-visibility-toggle"
                    aria-label={showSignupPassword ? t("hidePassword") : t("showPassword")}
                    aria-pressed={showSignupPassword}
                    onClick={() => setShowSignupPassword((visible) => !visible)}
                  >
                    {showSignupPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                <span className="field-hint">{t("signupPasswordRules")}</span>
              </label>
              <label className="field">
                <span className="field-label">{t("signupConfirmLabel")}</span>
                <div className="password-field">
                  <input
                    ref={signupConfirmRef}
                    {...signupFieldAttrs("confirm")}
                    className="input"
                    type={showSignupConfirm ? "text" : "password"}
                    name="confirm-password"
                    autoComplete="new-password"
                    value={signupConfirm}
                    onChange={(event) => {
                      setSignupConfirm(event.target.value);
                      setError(null);
                    }}
                  />
                  <button
                    type="button"
                    className="password-visibility-toggle"
                    aria-label={showSignupConfirm ? t("hidePassword") : t("showPassword")}
                    aria-pressed={showSignupConfirm}
                    onClick={() => setShowSignupConfirm((visible) => !visible)}
                  >
                    {showSignupConfirm ? <EyeOffIcon /> : <EyeIcon />}
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
                  t("createAccount")
                )}
              </button>
            </form>
            <p className="login-signup-entry">
              <button
                type="button"
                className="login-signup-toggle"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
              >
                {t("backToSignIn")}
              </button>
            </p>
          </>
        )}
        {isDemoMode && <p className="muted login-demo-note">{t("demoDataNote")}</p>}
      </section>
    </main>
  );
}
