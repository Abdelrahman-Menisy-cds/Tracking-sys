import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { ApiError } from "../../app/api";
import {
  getEmployeeAssistant,
  saveEmployeeAssistant,
  notifyAssistantConfigChanged,
  type AssistantEmployeeConfig,
  type SubscriptionProvider,
} from "../../app/assistantApi";
import SubscriptionPanel, { type SubscriptionView } from "./SubscriptionPanel";
import { Banner, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";

function viewOf(config: AssistantEmployeeConfig): SubscriptionView {
  return {
    mode: config.mode,
    subscription_provider: config.subscription_provider,
    subscription_cred_type: config.subscription_cred_type,
    subscription_source: config.subscription_source,
    subscription_expires: config.subscription_expires,
    model: config.model,
    base_url: config.base_url,
  };
}

/**
 * HR's assistant widget inside the ONE employee's file — brief H18,
 * extended by H19 with the same three-way mode picker the employee's own
 * widget has, at the top of the card: «مفتاح API» / «اشتراك opencode» /
 * «اشتراك Codex». Subscription bodies travel through THIS employee's HR
 * endpoint (PUT /employees/<id>/assistant, which accepts the mode fields) —
 * never through HR's own config — and the state shown is always the read
 * shape the server returns. The note the owner dictated is still on the
 * widget: the employee cannot read a key HR set, but may replace it.
 *
 * The demo directory's ids are not server ids, so the real account resolves
 * by email exactly like ManagerGrantsPanel does; when the email does not
 * resolve the widget says so instead of pretending.
 */

type Phase = "resolving" | "loading" | "ready" | "error";
/** Which face of the card the picker shows; null = not picked yet. */
type PickedMode = "api" | SubscriptionProvider | null;

function modeFromConfig(config: AssistantEmployeeConfig): PickedMode {
  if (config.mode === "subscription" && config.subscription_provider) {
    return config.subscription_provider as PickedMode;
  }
  return "api";
}

export default function EmployeeAssistantPanel({ employeeEmail }: { employeeEmail?: string | null }) {
  const { t, locale } = useApp();
  const [phase, setPhase] = useState<Phase>("resolving");
  const [attempt, setAttempt] = useState(0);
  const [config, setConfig] = useState<AssistantEmployeeConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [picked, setPicked] = useState<PickedMode>(null);

  const load = useCallback(async (id: number) => {
    setPhase("loading");
    getEmployeeAssistant(id, locale)
      .then((next) => {
        setConfig(next);
        setBaseUrl(next.base_url ?? "");
        setModel(next.model ?? "");
        setIsActive(Boolean(next.is_active));
        setPicked(modeFromConfig(next));
        setApiKey("");
        setKeyTouched(false);
        setDirty(false);
        setPhase("ready");
      })
      .catch((failure) => {
        if (failure instanceof ApiError && failure.kind === "forbidden") setPhase("error");
        else setPhase("error");
        setErrorMessage(failure instanceof ApiError && failure.message ? failure.message : t("errorNetwork"));
        setConfig(null);
      });
  }, [locale, t]);

  // Resolve the real server account by email, like ManagerGrantsPanel.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setPhase("resolving");
      setErrorMessage(null);
      try {
        const { listEmployees } = await import("../../app/orgApi");
        const roster = await listEmployees(locale);
        if (cancelled) return;
        const wanted = (employeeEmail ?? "").trim().toLowerCase();
        const resolved = roster.find((person) => person.email.toLowerCase() === wanted) ?? null;
        if (!resolved) {
          setConfig(null);
          setEmployeeId(null);
          setPhase("ready");
          return;
        }
        setEmployeeId(resolved.id);
        await load(resolved.id);
      } catch (failure) {
        if (!cancelled) {
          setPhase("error");
          setErrorMessage(failure instanceof ApiError && failure.message ? failure.message : t("errorNetwork"));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [employeeEmail, locale, attempt, load, t]);

  const markDirty = () => setDirty(true);

  const save = useCallback(async () => {
    if (employeeId === null) return;
    setSaving(true);
    setNotice(null);
    setProblem(null);
    try {
      const input: { base_url: string; model: string; api_key?: string; is_active: boolean } = {
        base_url: baseUrl.trim(),
        model: model.trim(),
        is_active: isActive,
      };
      if (keyTouched && apiKey.trim()) input.api_key = apiKey.trim();
      const next = await saveEmployeeAssistant(employeeId, input, locale);
      setConfig(next);
      setBaseUrl(next.base_url ?? "");
      setModel(next.model ?? "");
      setIsActive(Boolean(next.is_active));
      setPicked(modeFromConfig(next));
      setApiKey("");
      setKeyTouched(false);
      setDirty(false);
      setNotice(t("assistantAdminSaved"));
      notifyAssistantConfigChanged();
    } catch (failure) {
      setProblem(failure instanceof ApiError && failure.message ? failure.message : t("errorNetwork"));
    } finally {
      setSaving(false);
    }
  }, [apiKey, baseUrl, employeeId, isActive, keyTouched, locale, model, t]);

  // H19 — one writer for subscription bodies on the EMPLOYEE's row: the HR
  // endpoint's partial PUT. The server's read shape that comes back is the
  // only state this widget adopts; if the server's build does not yet apply
  // subscription writes on the employee row, the panel shows exactly what
  // the server returned (nothing invented on the client).
  const applyWrite = useCallback(
    async (body: Record<string, unknown>): Promise<SubscriptionView> => {
      if (employeeId === null) throw new ApiError("invalid", 0, t("errorNetwork"));
      const next = await saveEmployeeAssistant(employeeId, body as unknown as Parameters<typeof saveEmployeeAssistant>[1], locale);
      setConfig(next);
      setBaseUrl(next.base_url ?? "");
      setModel(next.model ?? "");
      setIsActive(Boolean(next.is_active));
      setPicked(modeFromConfig(next));
      setApiKey("");
      setKeyTouched(false);
      setDirty(false);
      return viewOf(next);
    },
    [employeeId, locale, t],
  );

  // A server-confirmed change adopts the handed-over read shape (or re-reads
  // it from the employee's HR endpoint), then notes the save so HR sees what
  // moved; the launcher re-probes too.
  const adoptChange = useCallback((next?: SubscriptionView) => {
    if (next) {
      setConfig((current) => (current ? { ...current, ...next } : current));
    } else if (employeeId !== null) {
      void getEmployeeAssistant(employeeId, locale).then((fresh) => {
        setConfig(fresh);
        setBaseUrl(fresh.base_url ?? "");
        setModel(fresh.model ?? "");
        setIsActive(Boolean(fresh.is_active));
        setPicked(modeFromConfig(fresh));
      }).catch(() => { /* the next save/reload re-probes */ });
    }
    setNotice(t("assistantAdminSaved"));
    notifyAssistantConfigChanged();
  }, [employeeId, locale, t]);

  const keySourceLine = useMemo(() => {
    if (!config || !("key_source" in config)) return null;
    if (config.key_source === "hr") return t("assistantAdminKeyFromHr");
    if (config.key_source === "self") return t("assistantAdminKeyFromSelf");
    return null;
  }, [config, t]);

  const subActive = picked !== null && picked !== "api" && config !== null;

  if (phase === "resolving" || phase === "loading") {
    return (
      <section className="section" aria-labelledby="employee-assistant-heading">
        <div className="section-heading">
          <h2 id="employee-assistant-heading">{t("assistantAdminTitle")}</h2>
        </div>
        <SkeletonRows rows={3} />
      </section>
    );
  }

  if (phase === "error") {
    return (
      <section className="section" aria-labelledby="employee-assistant-heading">
        <div className="section-heading">
          <h2 id="employee-assistant-heading">{t("assistantAdminTitle")}</h2>
        </div>
        {errorMessage ? <Banner tone="error" role="alert">{errorMessage}</Banner> : null}
        <ErrorState onRetry={() => setAttempt((n) => n + 1)} />
      </section>
    );
  }

  if (employeeId === null) {
    return (
      <section className="section" aria-labelledby="employee-assistant-heading">
        <div className="section-heading">
          <h2 id="employee-assistant-heading">{t("assistantAdminTitle")}</h2>
        </div>
        <Banner tone="info">{t("assistantAdminNoRealAccount")}</Banner>
      </section>
    );
  }

  return (
    <section className="section employee-assistant" aria-labelledby="employee-assistant-heading">
      <div className="section-heading">
        <h2 id="employee-assistant-heading">{t("assistantAdminTitle")}</h2>
      </div>
      <p className="page-meta">{t("assistantAdminSubtitle")}</p>

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {problem ? <Banner tone="error" role="alert">{problem}</Banner> : null}

      <div className="work-surface" style={{ marginBlockStart: "var(--sp-4)" }}>
        <Banner tone="info">{t("assistantAdminKeyNote")}</Banner>
        {keySourceLine && config?.key_hint ? (
          <p className="page-meta">{t("assistantKeyHintLine").replace("%s", config.key_hint)}</p>
        ) : null}

        {/* ── H19 — the same three-way mode picker, on the employee's behalf. ── */}
        <fieldset className="assistant-mode-picker" aria-label={t("assistantModeLabel")}>
          <legend className="field-label">{t("assistantModeLabel")}</legend>
          <div className="role-segmented" role="group">
            {(["api", "opencode", "codex"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`role-segmented-option${picked === mode ? " is-selected" : ""}`}
                aria-pressed={picked === mode}
                onClick={() => setPicked(mode)}
              >
                {mode === "api" ? t("assistantModeApi")
                  : mode === "opencode" ? t("assistantModeOpencode")
                    : t("assistantModeCodex")}
              </button>
            ))}
          </div>
          <span className="field-hint">{t("assistantSubSwitchHint")}</span>
        </fieldset>

        {subActive && picked ? (
          <SubscriptionPanel
            config={config}
            provider={picked as SubscriptionProvider}
            applyWrite={applyWrite}
            onChanged={adoptChange}
          />
        ) : null}

        {!subActive ? (
          <form className="quiet-inset" onSubmit={(event) => event.preventDefault()}>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
                <span className="field-label">{t("assistantFieldBaseUrl")}</span>
                <input
                  className="input"
                  dir="ltr"
                  type="url"
                  value={baseUrl}
                  placeholder="https://api.example.com/v1"
                  autoComplete="off"
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    markDirty();
                  }}
                />
              </label>
              <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
                <span className="field-label">{t("assistantFieldModel")}</span>
                <input
                  className="input"
                  dir="ltr"
                  type="text"
                  value={model}
                  placeholder="gpt-4o-mini"
                  autoComplete="off"
                  onChange={(event) => {
                    setModel(event.target.value);
                    markDirty();
                  }}
                />
              </label>
              <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
                <span className="field-label">{t("assistantFieldKey")}</span>
                <input
                  className="input"
                  dir="ltr"
                  type="password"
                  value={apiKey}
                  placeholder="sk-…"
                  autoComplete="new-password"
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setKeyTouched(true);
                  }}
                />
                <span className="field-hint">{t("assistantFieldKeyHint")}</span>
              </label>
            </div>
            <div className="form-actions">
              <label className="field assistant-active-toggle" style={{ marginBlockEnd: 0 }}>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => {
                    setIsActive(event.target.checked);
                    markDirty();
                  }}
                />
                <span className="field-label">{t("assistantAdminActiveToggle")}</span>
                <StatusPill tone={isActive ? "success" : "neutral"} label={isActive ? t("assistantAdminActive") : t("assistantAdminInactive")} />
              </label>
              <span className="field-hint">{t("assistantAdminStickyHint")}</span>
              <button type="button" className="btn btn-primary" disabled={saving || !dirty || !baseUrl.trim() || !model.trim()} onClick={save}>
                {saving ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("save")}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
