/** S01 — Sign-in (demo): single-column form, language/appearance controls, role picker. */
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import type { Role } from "../i18n/dict";

export default function LoginPage() {
  const { t, locale, setLocale, setRole, appearance, setAppearance } = useApp();
  usePageTitle(t("signIn"));
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setDemoRole] = useState<Role>("employee");
  const navigate = useNavigate();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
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
    // Demo only: no real authentication. Session sign-in is not claimed.
    window.setTimeout(() => {
      setBusy(false);
      setRole(role);
      navigate("/");
    }, 500);
  };

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "48px auto",
        padding: "var(--sp-6)",
        background: "var(--surface)",
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 30 }}>
          <bdi>{t("brand")}</bdi>
        </h1>
        <p style={{ color: "var(--text-muted)", margin: 0 }}>{t("descriptor")}</p>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("tagline")}</p>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>{t("language")}</span>
          <select
            className="select"
            style={{ width: "auto" }}
            aria-label={t("language")}
            value={locale}
            onChange={(e) => setLocale(e.target.value as "ar" | "en")}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>{t("appearance")}</span>
          <select
            className="select"
            style={{ width: "auto" }}
            aria-label={t("appearance")}
            value={appearance}
            onChange={(e) => setAppearance(e.target.value as "system" | "light" | "dark")}
          >
            <option value="system">{t("appearanceSystem")}</option>
            <option value="light">{t("appearanceLight")}</option>
            <option value="dark">{t("appearanceDark")}</option>
          </select>
        </label>
      </div>

      <form onSubmit={onSubmit} noValidate>
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
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("password")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={passwordRef}
              className="input"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            >
              {showPassword ? t("hidePassword") : t("showPassword")}
            </button>
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t("role")} — {t("demoHint")}</span>
          <select
            className="select"
            value={role}
            onChange={(e) => setDemoRole(e.target.value as Role)}
          >
            <option value="employee">{t("roleEmployee")}</option>
            <option value="manager">{t("roleManager")}</option>
            <option value="hr">{t("roleHr")}</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? (
            <>
              <span aria-hidden="true" className="spinner" />
              {t("loading")}
            </>
          ) : (
            t("signIn")
          )}
        </button>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12 }}>{t("demoDataNote")}</p>
      </form>
    </div>
  );
}
