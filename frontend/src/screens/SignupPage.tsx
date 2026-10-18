import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, usePageTitle, type Appearance } from "../app/AppContext";
import { ApiError, signup } from "../app/api";
import type { CompanyProfile, CompanyProfilePatch } from "../app/companyApi";
import { CompanyForm } from "../components/company/CompanyForm";
import BrandLockup from "../components/brand/BrandLockup";
import PageHeader from "../components/layout/PageHeader";
import { MoonIcon, SunIcon } from "../components/icons";
import type { Dict } from "../i18n/dict";

/**
 * /signup - the H34b two-step signup wizard.
 *
 * The owner's requirement: the company-data screen comes FIRST, with the
 * activation code as the LAST field on it (not on a separate screen), and the
 * founding HR account comes second. Submitting step 2 POSTs everything to
 * /auth/signup in ONE call (code + credentials + nested company object); the
 * backend validates the code first, then writes Company + a COMPLETE
 * CompanyProfile + the founding HR user in one transaction and answers
 * signed-in with `needs_company_profile: false`, so the app goes straight to
 * / with no onboarding step.
 *
 * Step 1 reuses the CompanyForm component (same fields, same validation rules,
 * same copy as the company-profile form) and only adds the activation-code
 * field through its `trailing` slot. Nothing is sent on step 1 - the fused
 * request happens once, on step 2.
 *
 * Field mapping (server is authoritative): a server refusal carries
 * `error.fields` where `code`/`email`/`password` are plain arrays but a
 * company refusal is nested `{"company": {field: [...]}}` (or, for a code
 * already bound to a company, a plain `company` array reprimanding the CODE).
 * Every one of those is delivered to the field that caused it: code/company
 * faults return the wizard to step 1 (remounted with the collected values and
 * the per-field errors), password/email faults render inline on step 2.
 */

/**
 * The demo signup code (Story H14b), in the bundle for the same reason as
 * DEMO_MODE's other constants: DEMO_MODE is compile-time, so a real build
 * drops it. When the API is unreachable the demo path has no server to check
 * the code, so the client must judge - this constant IS the demo judge.
 */
const DEMO_SIGNUP_CODE = "Menisy2002";

/** All-empty profile used to seed the remounted step-1 form. */
const COMPANY_EMPTY_PROFILE: CompanyProfile = {
  name: "",
  activity: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  logo_data_url: "",
  commercial_register: "",
  tax_card: "",
  contact_name: "",
  contact_role: "",
  contact_phone: "",
};

/** Why the server refused the signup. The backend answers a wrong or inactive
 * code with a generic non-enumerating 400; anything it spells out is passed
 * through rather than replaced with an invented reason. */
function describeSignupFailure(failure: unknown, locale: "ar" | "en"): string {
  const ar = locale === "ar";
  if (failure instanceof ApiError) {
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

type SignupFieldParts = {
  /** Nested `{"company": {field: [...]}}` refusals, flattened per field. */
  companyFieldErrors: Partial<Record<keyof CompanyProfilePatch, string>>;
  /** `company` carried as an ARRAY: the code is bound and cannot found anew. */
  companyArrayMessage: string | null;
  codeMessage: string | null;
  emailMessage: string | null;
  passwordMessage: string | null;
  /** `non_field_errors` - no single field owns it. */
  formMessage: string | null;
};

/**
 * Split the server's error envelope across the wizard's screens. The declared
 * type is `Record<string, string[]>`, but the company refusals arrive NESTED
 * (or as a plain array) - runtime shapes are checked, not assumed.
 */
function partitionSignupFields(fields: Record<string, string[]> | undefined): SignupFieldParts {
  const parts: SignupFieldParts = {
    companyFieldErrors: {},
    companyArrayMessage: null,
    codeMessage: null,
    emailMessage: null,
    passwordMessage: null,
    formMessage: null,
  };
  if (!fields) return parts;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "company") {
      if (Array.isArray(value)) {
        parts.companyArrayMessage = value.filter(Boolean).join(" · ") || null;
      } else if (value && typeof value === "object") {
        for (const [field, messages] of Object.entries(value as Record<string, unknown>)) {
          const first = Array.isArray(messages) ? messages.filter(Boolean)[0] : null;
          if (first && typeof first === "string") {
            parts.companyFieldErrors[field as keyof CompanyProfilePatch] = first;
          }
        }
      }
      continue;
    }
    const first = Array.isArray(value) ? value.filter(Boolean)[0] : null;
    if (!first) continue;
    if (key === "code") parts.codeMessage = first;
    else if (key === "email") parts.emailMessage = first;
    else if (key === "password") parts.passwordMessage = first;
    else if (key === "non_field_errors") parts.formMessage = first;
    // Any other key (e.g. the legacy company_name) has no home in this wizard.
  }
  return parts;
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="icon" fill="none" focusable="false" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.65} viewBox="0 0 20 20" width="20">
      {/* ds-allow-hardcode: svg path data, "10s" is not a duration */}
      <path /* ds-allow-hardcode: svg path data; "10s" is an arc command, not a duration */ d="M2 10s2.8-4.8 8-4.8S18 10 18 10s-2.8 4.8-8 4.8S2 10 2 10Z" />
      <circle cx="10" cy="10" r="2.4" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" className="icon" fill="none" focusable="false" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.65} viewBox="0 0 20 20" width="20">
      {/* ds-allow-hardcode: svg path data, "10s" is not a duration */}
      <path /* ds-allow-hardcode: svg path data; "10s" is an arc command, not a duration */ d="M2 10s2.8-4.8 8-4.8S18 10 18 10s-2.8 4.8-8 4.8S2 10 2 10Z" />
      <path d="M4 4 16 16" />
    </svg>
  );
}

export default function SignupPage() {
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
  const navigate = useNavigate();
  usePageTitle(t("createAccount"));

  const [step, setStep] = useState<1 | 2>(1);
  /** Remount counter for step 1: every (re-)entry re-seeds the shared form. */
  const [step1Key, setStep1Key] = useState(0);
  const [companyPatch, setCompanyPatch] = useState<CompanyProfilePatch | null>(null);
  const [step1ServerErrors, setStep1ServerErrors] = useState<Partial<Record<keyof CompanyProfilePatch, string>>>({});
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupConfirm, setSignupConfirm] = useState("");
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);
  /** Inline per-field refusals of step 2 (client + server). */
  const [step2FieldErrors, setStep2FieldErrors] = useState<Partial<Record<"email" | "password" | "confirm", string>>>({});
  const [step2Banner, setStep2Banner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targetLocale = locale === "ar" ? "en" : "ar";
  const languageLabel = targetLocale === "ar" ? t("switchToArabic") : t("switchToEnglish");
  const targetTheme: Exclude<Appearance, "system"> = resolvedTheme === "light" ? "dark" : "light";
  // The icon names the theme you would get, not the one you are in - the same
  // convention as the login screen's header buttons.
  const ThemeIcon = resolvedTheme === "light" ? MoonIcon : SunIcon;

  const stepLabel = (index: "1" | "2") =>
    t("signupStepOf").replace("%s", index).replace("%s", "2");
  const hasCompanyPatch = companyPatch !== null && Object.keys(companyPatch).length > 0;
  const step1Seed = (): CompanyProfile => ({ ...COMPANY_EMPTY_PROFILE, ...(companyPatch ?? {}) });

  /** Step 1's only job: VALIDATE locally, collect, advance. No network here -
   * the fused POST happens once, from step 2 (H34b). */
  const collectStep1 = async (patch: CompanyProfilePatch): Promise<void> => {
    setCompanyPatch(patch);
    setStep1ServerErrors({}); // a fresh collection supersedes any older refusals
    if (!code.trim()) {
      setCodeError(t("signupEnterCode"));
      codeRef.current?.focus();
      return; // do NOT advance - CompanyForm just resolves; the wizard stays
    }
    setCodeError(null);
    setStep2FieldErrors({});
    setStep2Banner(null);
    setStep(2);
  };

  const backToStep1 = () => {
    setStep1Key((key) => key + 1); // re-seed the form with what was collected
    setStep1ServerErrors({});
    setStep2FieldErrors({});
    setStep2Banner(null);
    setStep(1);
  };

  /** The hour of truth: ONE POST carrying code + founding credentials + company. */
  const submitSignup = async (event: FormEvent) => {
    // The signup <form>'s own onSubmit is its only entry point: without
    // preventDefault the browser performs a native GET and the page reloads
    // mid-request (the exact reload bug H14b measured on the served build).
    event.preventDefault();
    const clientErrors: Partial<Record<"email" | "password" | "confirm", string>> = {};
    if (!signupEmail.trim()) clientErrors.email = t("signupEnterEmail");
    if (!signupPassword) clientErrors.password = t("signupEnterPassword");
    if (!signupConfirm) clientErrors.confirm = t("signupEnterConfirm");
    else if (signupConfirm !== signupPassword) clientErrors.confirm = t("signupPasswordMismatch");
    if (Object.keys(clientErrors).length > 0) {
      setStep2FieldErrors(clientErrors);
      return;
    }
    if (!hasCompanyPatch) {
      // H34b: without the company patch the server founds a company with NO
      // profile and then bounces the owner to /onboarding/company - the silent
      // half-state that cost two rounds of testing. Refuse LOUDLY and send them
      // back to the screen that collects it.
      setStep2FieldErrors({ email: t("signupCompanyMissing") });
      setStep(1);
      return;
    }
    setBusy(true);
    setStep2FieldErrors({});
    setStep2Banner(null);
    try {
      const me = await signup(signupEmail.trim(), code.trim(), signupPassword, locale, hasCompanyPatch ? companyPatch ?? {} : undefined);
      // Success is a signed-in session whose company profile arrived COMPLETE
      // (needs_company_profile: false): adopt it exactly like sign-in and go
      // straight to / - no onboarding screen, none owed.
      adoptSession(me);
      navigate("/");
      return;
    } catch (failure) {
      if (failure instanceof ApiError && failure.kind === "unreachable" && isDemoMode) {
        // No backend behind this build: the demo path. DEMO_SIGNUP_CODE above
        // is the demo's local judge; the founded account IS the HR (H34b).
        if (code.trim() !== DEMO_SIGNUP_CODE) {
          setBusy(false);
          setCodeError(t("signupInvalidCode"));
          setStep1Key((key) => key + 1);
          setStep(1);
          window.setTimeout(() => codeRef.current?.focus(), 0);
          return;
        }
        setRole("hr");
        navigate("/");
        return;
      }
      setBusy(false);
      const parts = partitionSignupFields(failure instanceof ApiError ? failure.fields : undefined);
      const companyFaults = Object.keys(parts.companyFieldErrors).length > 0;
      if (failure instanceof ApiError && failure.message === "email_in_use" && !parts.emailMessage) {
        // Existing email + valid code: non-enumerating 200 that is NOT a
        // session. The email field of step 2 renders it.
        parts.emailMessage = t("signupEmailInUse");
      }
      if (parts.codeMessage || parts.companyArrayMessage || companyFaults) {
        // Step-1's screen owns these fields: return there, remounted with the
        // collected values AND the refusals under their own fields. A bound
        // code (`company` as an array) reprimands the CODE - the contradiction
        // is the code, and the company screen cannot fix it by editing fields.
        if (companyFaults) setStep1ServerErrors(parts.companyFieldErrors);
        if (parts.companyArrayMessage) setCodeError(t("signupCodeBound"));
        else if (parts.codeMessage) setCodeError(parts.codeMessage);
        // A same-answer password/email fault stays queued for step 2 - it is
        // still true of the values the user will re-submit.
        const queued: Partial<Record<"email" | "password" | "confirm", string>> = {};
        if (parts.emailMessage) queued.email = parts.emailMessage;
        if (parts.passwordMessage) queued.password = parts.passwordMessage;
        setStep2FieldErrors(queued);
        setStep2Banner(null);
        setStep1Key((key) => key + 1);
        setStep(1);
        window.setTimeout(() => codeRef.current?.focus(), 0);
        return;
      }
      const step2Errors: Partial<Record<"email" | "password" | "confirm", string>> = {};
      if (parts.emailMessage) step2Errors.email = parts.emailMessage;
      if (parts.passwordMessage) step2Errors.password = parts.passwordMessage;
      if (Object.keys(step2Errors).length > 0) {
        setStep2FieldErrors(step2Errors);
        return;
      }
      // Nothing maps to a field: the kind-based sentence carries the truth.
      setStep2Banner(describeSignupFailure(failure, locale));
      if (parts.formMessage) setStep2Banner(parts.formMessage);
    }
  };

  /** Tie the inline refusal to the field it came from (a11y wiring). */
  const accountFieldAttributes = (field: "email" | "password" | "confirm") =>
    step2FieldErrors[field]
      ? { "aria-invalid": true as const, "aria-describedby": `signup-account-${field}-error` }
      : {};

  const renderAccountFieldError = (field: "email" | "password" | "confirm") => {
    const message = step2FieldErrors[field];
    if (!message) return null;
    return (
      <span id={`signup-account-${field}-error`} className="request-inline-error" role="alert">{message}</span>
    );
  };

  return (
    <main className="login-page">
      <div className="login-brand-watermark" aria-hidden="true">
        <img src={`/brand/logo-${resolvedTheme}.png`} alt="" />
      </div>
      <section className="work-surface login-panel" aria-labelledby="signup-heading">
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
        <p className="muted login-signup-note">{stepLabel(step === 1 ? "1" : "2")}</p>
        {step === 1 ? (
          <>
            <PageHeader
              title={t("companyOnboardingTitle")}
              subtitle={`${t("companyOnboardingSubtitle")}`}
              headingId="signup-heading"
            />
            {/* The shared company form (same fields/rules as the profile form)
                with the activation code injected as its LAST field. */}
            <CompanyForm
              key={step1Key}
              profile={step1Seed()}
              t={(key: keyof Dict) => t(key)}
              locale={locale}
              submitLabel="signupCompanyNext"
              savingLabel="companySaving"
              onSave={collectStep1}
              initialServerErrors={step1ServerErrors}
              trailing={
                <>
                  <label className="field">
                    <span className="field-label">{t("signupCodeLabel")}</span>
                    <input
                      ref={codeRef}
                      className="input"
                      type="text"
                      name="code"
                      dir="ltr"
                      autoComplete="off"
                      spellCheck={false}
                      value={code}
                      aria-invalid={codeError ? true : undefined}
                      aria-describedby={codeError ? "signup-code-error" : undefined}
                      onChange={(event) => {
                        setCode(event.target.value);
                        setCodeError(null);
                      }}
                    />
                    {codeError ? (
                      <span id="signup-code-error" className="request-inline-error" role="alert">{codeError}</span>
                    ) : null}
                  </label>
                  <p className="login-signup-contact">
                    {t("signupCodeMissing")}{" "}
                    <a
                      href="https://wa.me/201200704564"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="login-signup-whatsapp"
                      aria-label={t("signupPhoneAria")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                      </svg>
                    </a>
                  </p>
                </>
              }
            />
            <p className="login-signup-entry">
              <button
                type="button"
                className="login-signup-toggle"
                onClick={() => navigate("/login")}
              >
                {t("backToSignIn")}
              </button>
            </p>
          </>
        ) : (
          <>
            <PageHeader
              title={t("signupAccountTitle")}
              subtitle={t("signupRoleNote")}
              headingId="signup-heading"
            />
            <form onSubmit={submitSignup} noValidate>
              {step2Banner ? (
                <div className="banner banner-error" role="alert">
                  {step2Banner}
                </div>
              ) : null}
              {hasCompanyPatch ? (
                <p className="muted login-signup-note">{`${t("companyOnboardingTitle")}: ${companyPatch?.name ?? ""}`}</p>
              ) : null}
              <label className="field">
                <span className="field-label">{t("signupEmailLabel")}</span>
                <input
                  className="input"
                  type="email"
                  name="email"
                  dir="ltr"
                  autoComplete="email"
                  spellCheck={false}
                  value={signupEmail}
                  {...accountFieldAttributes("email")}
                  onChange={(event) => {
                    setSignupEmail(event.target.value);
                    setStep2FieldErrors((current) => ({ ...current, email: undefined }));
                  }}
                />
                {renderAccountFieldError("email")}
              </label>
              <label className="field">
                <span className="field-label">{t("signupPasswordLabel")}</span>
                <div className="password-field">
                  <input
                    className="input"
                    type={showSignupPassword ? "text" : "password"}
                    name="new-password"
                    autoComplete="new-password"
                    value={signupPassword}
                    {...accountFieldAttributes("password")}
                    onChange={(event) => {
                      setSignupPassword(event.target.value);
                      setStep2FieldErrors((current) => ({ ...current, password: undefined }));
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
                {renderAccountFieldError("password") ?? <span className="field-hint">{t("signupPasswordRules")}</span>}
              </label>
              <label className="field">
                <span className="field-label">{t("signupConfirmLabel")}</span>
                <div className="password-field">
                  <input
                    className="input"
                    type={showSignupConfirm ? "text" : "password"}
                    name="confirm-password"
                    autoComplete="new-password"
                    value={signupConfirm}
                    {...accountFieldAttributes("confirm")}
                    onChange={(event) => {
                      setSignupConfirm(event.target.value);
                      setStep2FieldErrors((current) => ({ ...current, confirm: undefined }));
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
                {renderAccountFieldError("confirm")}
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
                onClick={backToStep1}
              >
                {t("signupBackToCompany")}
              </button>
            </p>
          </>
        )}
        {isDemoMode && <p className="muted login-demo-note">{t("demoDataNote")}</p>}
      </section>
    </main>
  );
}
