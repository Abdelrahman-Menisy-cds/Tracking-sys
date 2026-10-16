import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/AppContext";
import { ApiError } from "../../app/api";
import { Banner, ErrorState, SkeletonRows } from "../../components/ui";
import {
  getAssistantConfig,
  saveAssistantConfig,
  testAssistant,
  notifyAssistantConfigChanged,
  type AssistantConfig,
  type AssistantTestResult,
  type SubscriptionProvider,
} from "../../app/assistantApi";
import SubscriptionPanel, { type SubscriptionView } from "./SubscriptionPanel";

function viewOf(config: AssistantConfig): SubscriptionView {
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
 * The employee's OWN assistant-provider widget on /profile - brief H18,
 * extended by H19 with a three-way mode picker at the top of the card:
 * «مفتاح API» keeps the base URL + model + key fields exactly as they were;
 * «اشتراك opencode» / «اشتراك Codex» swap them for the subscription login
 * panel (sign-in button, state line, device-flow code + link, import, and
 * once linked the subscription's own model dropdown). The server owns every
 * state transition - this widget renders what the read shape says.
 */

type Phase = "loading" | "ready" | "error";
/** Which face of the card the picker shows; null = not picked yet. */
type PickedMode = "api" | SubscriptionProvider | null;

function modeFromConfig(config: AssistantConfig): PickedMode {
  // The server's read shape is the one source of truth: a linked row opens on
  // its linked face, everything else opens on the api-key face it had before.
  if (config.mode === "subscription" && config.subscription_provider) {
    return config.subscription_provider as PickedMode;
  }
  return "api";
}

export default function AssistantSettingsPanel() {
  const { t, locale } = useApp();
  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState(0);
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [picked, setPicked] = useState<PickedMode>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AssistantTestResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Loading a config the server refuses to answer (or answers 5xx) is an
  // explicit retry state, not a spinner: the widget must not sit on its
  // skeleton forever when the backend is unreachable.
  useEffect(() => {
    let stale = false;
    setPhase("loading");
    getAssistantConfig(locale)
      .then((next) => {
        if (stale) return;
        setConfig(next);
        setBaseUrl(next.base_url ?? "");
        setModel(next.model ?? "");
        setPicked(modeFromConfig(next));
        setPhase("ready");
      })
      .catch(() => {
        if (!stale) setPhase("error");
      });
    return () => {
      stale = true;
    };
  }, [locale, attempt]);

  const save = useCallback(async () => {
    setSaving(true);
    setNotice(null);
    setProblem(null);
    try {
      // Only send the key when the operator actually typed one - the server
      // never echoes it, and an empty field with an HR key must NOT erase it
      // by accident (can_replace_key decides whether replacing is allowed).
      const input: { base_url: string; model: string; api_key?: string } = {
        base_url: baseUrl.trim(),
        model: model.trim(),
      };
      if (keyTouched && apiKey.trim()) input.api_key = apiKey.trim();
      const next = await saveAssistantConfig(input, locale);
      setConfig(next);
      setBaseUrl(next.base_url ?? "");
      setModel(next.model ?? "");
      setPicked(modeFromConfig(next));
      setApiKey("");
      setKeyTouched(false);
      setNotice(t("assistantSettingsSaved"));
      notifyAssistantConfigChanged();
    } catch (failure) {
      setProblem(failure instanceof ApiError && failure.message ? failure.message : t("errorNetwork"));
    } finally {
      setSaving(false);
    }
  }, [apiKey, baseUrl, keyTouched, locale, model, t]);

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setProblem(null);
    try {
      setTestResult(await testAssistant(locale));
    } catch (failure) {
      // The test endpoint failing is still a real answer shown in Arabic.
      setProblem(failure instanceof ApiError && failure.message ? failure.message : t("errorNetwork"));
    } finally {
      setTesting(false);
    }
  }, [locale, t]);

  // H19 - one writer for subscription bodies: the server's own PUT, and the
  // read shape it returns becomes the state (never a locally-derived state).
  const applyWrite = useCallback(
    async (body: Record<string, unknown>): Promise<SubscriptionView> => {
      const next = await saveAssistantConfig(body as unknown as Parameters<typeof saveAssistantConfig>[0], locale);
      setConfig(next);
      setBaseUrl(next.base_url ?? "");
      setModel(next.model ?? "");
      setPicked(modeFromConfig(next));
      setApiKey("");
      setKeyTouched(false);
      setTestResult(null);
      return viewOf(next);
    },
    [locale],
  );

  // A server-confirmed change (import/poll/apply) adopts the handed-over read
  // shape, or re-reads the config when none was carried. Either way the
  // launcher re-probes so the faded/enabled state never lies.
  const adoptChange = useCallback((next?: SubscriptionView) => {
    if (next) {
      setConfig((current) => (current ? { ...current, ...next } : current));
    } else {
      void getAssistantConfig(locale).then((fresh) => {
        setConfig(fresh);
        setBaseUrl(fresh.base_url ?? "");
        setModel(fresh.model ?? "");
        setPicked(modeFromConfig(fresh));
      }).catch(() => { /* the next save/reload re-probes */ });
    }
    notifyAssistantConfigChanged();
  }, [locale]);

  const dirty = keyTouched || baseUrl !== (config?.base_url ?? "") || model !== (config?.model ?? "");
  const subActive = picked !== null && picked !== "api" && config !== null;

  return (
    <section className="section assistant-settings" id="assistant" aria-labelledby="assistant-settings-heading">
      <div className="section-heading">
        <h2 id="assistant-settings-heading">{t("assistantSettingsTitle")}</h2>
      </div>
      <p className="page-meta">{t("assistantSettingsSubtitle")}</p>

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {problem ? <Banner tone="error" role="alert">{problem}</Banner> : null}
      {phase === "loading" ? <SkeletonRows rows={3} /> : null}
      {phase === "error" ? <ErrorState onRetry={() => setAttempt((n) => n + 1)} /> : null}

      {phase === "ready" && config ? (
        <div className="work-surface" style={{ marginBlockStart: "var(--sp-4)" }}>
          {!config.is_configured ? <Banner tone="info">{t("assistantSettingsNotLinked")}</Banner> : null}
          {config.key_source === "hr" ? (
            <Banner tone="info">
              {t("assistantKeyFromHr")}
              {config.key_hint ? ` ${t("assistantKeyHintLine").replace("%s", config.key_hint)}` : ""}
            </Banner>
          ) : null}

          {/* ── H19 - the three-way mode picker, first thing on the card. ── */}
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
              <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" /* ds-allow-hardcode: attribute-table column */ }}>
                <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
                  <span className="field-label">{t("assistantFieldBaseUrl")}</span>
                  <input
                    className="input"
                    dir="ltr"
                    type="url"
                    value={baseUrl}
                    placeholder="https://api.example.com/v1"
                    autoComplete="off"
                    onChange={(event) => setBaseUrl(event.target.value)}
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
                    onChange={(event) => setModel(event.target.value)}
                  />
                </label>
                <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
                  <span className="field-label">
                    {config.key_source === "hr" ? t("assistantFieldKeyReplace") : t("assistantFieldKey")}
                  </span>
                  <input
                    className="input"
                    dir="ltr"
                    type="password"
                    value={apiKey}
                    placeholder={config.key_source === "hr" ? t("assistantFieldKeyHiddenPlaceholder") : "sk-…"}
                    autoComplete="new-password"
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setKeyTouched(true);
                    }}
                  />
                  <span className="field-hint">
                    {config.key_source === "self" && config.key_hint
                      ? t("assistantKeyHintLine").replace("%s", config.key_hint)
                      : t("assistantFieldKeyHint")}
                  </span>
                </label>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" disabled={testing || saving} onClick={runTest}>
                  {testing ? <><span className="spinner" aria-hidden="true" />{t("assistantTesting")}</> : t("assistantTestButton")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !dirty || !baseUrl.trim() || !model.trim()}
                  onClick={save}
                >
                  {saving ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("save")}
                </button>
              </div>
              {testResult ? (
                testResult.ok ? (
                  <Banner tone="success">{t("assistantTestOk").replace("%s", String(testResult.latency_ms))}</Banner>
                ) : (
                  // The provider's own message, shown as-is but inside the UI's voice.
                  <Banner tone="error" role="alert">{t("assistantTestFail").replace("%s", testResult.detail || t("assistantTestUnknown"))}</Banner>
                )
              ) : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
