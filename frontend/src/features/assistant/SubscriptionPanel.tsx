import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../app/AppContext";
import { ApiError } from "../../app/api";
import {
  getSubscriptionCapability,
  importSubscription,
  getSubscriptionModels,
  startSubscriptionLogin,
  pollSubscriptionLogin,
  type AssistantConfig,
  type AssistantSubscriptionCapability as AssistantCapabilityShape,
  type AssistantModelsResult,
  type AssistantSubscriptionStart,
  type SubscriptionProvider,
} from "../../app/assistantApi";

/**
 * The H19 subscription half of the assistant widget — ONE implementation,
 * two users (the employee's own /profile widget and HR's employee-file
 * panel hand in their own context, see below).
 *
 * H21c — the owner looked at the opencode tab and said the red import
 * button is NOT the right one: the PRIMARY action is now the real device
 * login («تسجيل الدخول للاشتراك»), driven by the server's
 * /assistant/subscription/start (device code + verification link) and
 * /assistant/subscription/poll (paced on the server's returned interval,
 * stopped at the server's expiry). The import moves DOWN, staying a
 * working secondary control under the honest hint about what it reads.
 *
 * The hard rule the whole panel honours: no token or key is ever shown.
 * There is no reveal affordance; the linked state names the provider, the
 * credential KIND (key/oauth), the source, and the model — nothing else.
 */

/** The subset of the config read shape this panel actually renders. */
export interface SubscriptionView {
  mode: AssistantConfig["mode"];
  subscription_provider: string;
  subscription_cred_type: string;
  subscription_source: string;
  subscription_expires: string | null;
  model: string;
  base_url: string;
}

export interface SubscriptionPanelProps {
  /** The server's current read shape (freshness owned by the parent panel). */
  config: SubscriptionView;
  /** The provider this picker position stands for. */
  provider: SubscriptionProvider;
  /**
   * How a subscription write reaches the server: the employee's own
   * /assistant/config (mode switch), or the HR employee-file
   * /employees/<id>/assistant PUT. The server owns every transition —
   * this panel never derives a state the server did not send.
   */
  applyWrite: (body: Record<string, unknown>) => Promise<SubscriptionView>;
  /** Called after any server-confirmed change: the panel hands over the read
   * shape it received (import/poll/apply all return one) so the parent adopts
   * the SERVER's word; a null/undefined next means "re-read from the server". */
  onChanged: (next?: SubscriptionView) => void;
}

/** What import returns on success: `{status:"linked", ...config}`. */
type LinkedOutcome = { status: "linked" } & AssistantConfig;

function outcomeToView(outcome: LinkedOutcome): SubscriptionView {
  return {
    mode: outcome.mode,
    subscription_provider: outcome.subscription_provider,
    subscription_cred_type: outcome.subscription_cred_type,
    subscription_source: outcome.subscription_source,
    subscription_expires: outcome.subscription_expires,
    model: outcome.model,
    base_url: outcome.base_url,
  };
}

function failureText(error: unknown, fallback: string, signIn?: string): string {
  if (error instanceof ApiError) {
    // A 401 is NOT a network failure: the request reached the server and the
    // server said "not authenticated". Saying «تعذر الاتصال» here sends the
    // user chasing a network problem that does not exist.
    if (error.status === 401 && signIn) return signIn;
    if (error.status >= 500) return `${fallback} (${error.status})`;
    if (error.message) return error.message;
  }
  return fallback;
}

export default function SubscriptionPanel({ config, provider, applyWrite, onChanged }: SubscriptionPanelProps) {
  const { t, locale } = useApp();
  const [importing, setImporting] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [capability, setCapability] = useState<AssistantCapabilityShape | null>(null);
  const [models, setModels] = useState<AssistantModelsResult | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [pickedModel, setPickedModel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const linkedHere = config.mode === "subscription" && config.subscription_provider === provider;
  const state: "unlinked" | "linked" = linkedHere ? "linked" : "unlinked";

  // The unlinked face asks the server ONCE what this provider honestly
  // supports — the capability word decides whether the flow may even start
  // (a provider without a login flow must not show a button that can only
  // fail). Import stays available regardless: it is the legacy path.
  useEffect(() => {
    if (state === "linked") {
      setCapability(null);
      return;
    }
    let cancelled = false;
    getSubscriptionCapability(provider, locale)
      .then((result) => {
        if (!cancelled) setCapability(result);
      })
      .catch(() => {
        // A failed capability read must not fake a login button: default to
        // import-only (the safe, truthful rendering).
        if (!cancelled) setCapability({ provider, import_available: true, login_flow_available: false });
      });
    return () => {
      cancelled = true;
    };
  }, [state, provider, locale]);

  // The linked state fetches the subscription's OWN model list once, so the
  // dropdown offers what the provider actually serves — never a hardcoded list.
  useEffect(() => {
    if (!linkedHere) {
      // Leaving the linked face: clear the stale list synchronously is the
      // point of the cleanup — a warning here is a style note, not a bug.
      setModels(null);
      setModelsLoading(false);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    getSubscriptionModels(locale)
      .then((result) => {
        if (!cancelled) setModels(result);
      })
      .catch(() => {
        // A failed listing must not fake a list: the manual entry below stays.
        if (!cancelled) setModels(null);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linkedHere, locale, onChanged]);

  const runImport = useCallback(async () => {
    setImporting(true);
    setProblem(null);
    try {
      const outcome = await importSubscription(provider, locale);
      if (outcome.status === "linked") {
        // The server's own read shape becomes the state — not a guess.
        onChanged(outcomeToView(outcome));
      }
    } catch (failure) {
      // The import's refusal (no local login) is the server's own sentence.
      setProblem(failureText(failure, t("errorNetwork"), t("signIn")));
    } finally {
      setImporting(false);
    }
  }, [provider, locale, t, onChanged]);

  // Leaving the subscription for another mode is a server write too: an api
  // subset that unlinks the subscription (exactly one credential per row).
  // The parent hands the body shape to applyWrite, so this stays one runner.
  const switchBack = useCallback(async () => {
    setImporting(true);
    setProblem(null);
    try {
      const next = await applyWrite({ mode: "api", base_url: config.base_url || "", model: config.model || "" });
      onChanged(next);
    } catch (failure) {
      setProblem(failureText(failure, t("errorNetwork"), t("signIn")));
    } finally {
      setImporting(false);
    }
  }, [applyWrite, config.base_url, config.model, t, onChanged]);

  const updateModel = useCallback(async () => {
    setSavingModel(true);
    setProblem(null);
    try {
      // The provider's own model id travels to the server, which is the only
      // writer of the row. The subscription write shape re-links the SAME
      // provider — and the server never echoes a token back, so the read
      // shape that returns is safe to render.
      const next = await applyWrite({ mode: "subscription", subscription_provider: provider, model: pickedModel });
      onChanged(next);
    } catch (failure) {
      setProblem(failureText(failure, t("errorNetwork"), t("signIn")));
    } finally {
      setSavingModel(false);
    }
  }, [applyWrite, pickedModel, provider, t, onChanged]);

  const stateLabel = state === "linked" ? t("assistantSubStateLinked") : t("assistantSubStateUnlinked");
  // The device login exists ONLY where the provider genuinely offers one —
  // locked to the server's capability word, exactly like before H21c.
  const loginFlowAvailable = capability?.login_flow_available === true;

  return (
    <div className="assistant-sub-panel" data-provider={provider}>
      <p className="assistant-sub-state page-meta" role="status">
        {stateLabel}
        {state === "linked" && config.model ? (
          <span> · <bdi dir="ltr">{config.model}</bdi></span>
        ) : null}
      </p>

      {state === "linked" ? (
        <>
          <p className="field-hint">
            {config.subscription_source === "device" ? t("assistantSubSourceDevice") : t("assistantSubSourceLocal")}
          </p>
          {/* The credential KIND only: a key does not expire, an oauth set shows
              the expiry — the VALUE is on the server and never in this DOM. */}
          <p className="field-hint">
            {config.subscription_cred_type === "oauth" && config.subscription_expires
              ? `${t("assistantSubProvenanceLine")} (${config.subscription_expires})`
              : t("assistantSubProvenanceLine")}
          </p>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label className="field" style={{ marginBlockEnd: "var(--sp-3)" }}>
              <span className="field-label">{t("assistantSubModelLabel")}</span>
              {modelsLoading ? (
                <span className="field-hint">{t("assistantSubModelsLoading")}</span>
              ) : models && models.supported && models.models.length > 0 ? (
                <select
                  className="input"
                  dir="ltr"
                  value={pickedModel || config.model || models.models[0]}
                  onChange={(event) => setPickedModel(event.target.value)}
                >
                  {models.models.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              ) : models && !models.supported ? (
                <>
                  <input
                    className="input"
                    dir="ltr"
                    type="text"
                    value={pickedModel || config.model || ""}
                    autoComplete="off"
                    placeholder="the provider's own model id"
                    onChange={(event) => setPickedModel(event.target.value)}
                  />
                  <span className="field-hint">{t("assistantSubModelsNone")}</span>
                </>
              ) : (
                /* The listing failed: an honest manual entry instead of a fake list. */
                <>
                  <input
                    className="input"
                    dir="ltr"
                    type="text"
                    value={pickedModel || config.model || ""}
                    autoComplete="off"
                    onChange={(event) => setPickedModel(event.target.value)}
                  />
                  <span className="field-hint">{t("assistantSubModelsNone")}</span>
                </>
              )}
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={savingModel || !pickedModel || pickedModel === config.model}
              onClick={updateModel}
            >
              {savingModel ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("assistantSubModelUpdate")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={switchBack}>
              {t("assistantModeApi")}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* H21c — the PRIMARY action first, inside the standard actions row
              so the whole app reads it as THE action: the real device login,
              or the honest "this provider has no in-app login" sentence when
              the server's capability word says none exists. */}
          {loginFlowAvailable ? (
            <div className="form-actions">
              <DeviceFlow
                provider={provider}
                onChanged={onChanged}
                onProblem={setProblem}
                onBusyChange={setLoginBusy}
              />
            </div>
          ) : (
            <p className="field-hint">{t("assistantSubImportPrimaryHint")}</p>
          )}
          {/* Demoted per the owner's word: import gets a small, secondary
              control under the primary — but it stays exactly as working. */}
          <div className="form-actions assistant-sub-secondary-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={importing || loginBusy}
              onClick={runImport}
            >
              {importing ? <><span className="spinner" aria-hidden="true" />{t("assistantSubImportWorking")}</> : t("assistantSubImportButton")}
            </button>
          </div>
          <span className="field-hint">{t("assistantSubImportHint")}</span>
          {config.mode === "subscription" && config.subscription_provider && config.subscription_provider !== provider ? (
            <span className="field-hint">{t("assistantSubSwitchHint")}</span>
          ) : null}
        </>
      )}

      {problem ? <p className="assistant-error" role="alert">{problem}</p> : null}
    </div>
  );
}

/**
 * H21c — the device-login flow, the primary «تسجيل الدخول للاشتراك» button.
 * 1. POST /assistant/subscription/start → the server's own code, link,
 *    interval and expiry.
 * 2. The code + link render as copyable LTR islands inside the RTL layout.
 * 3. A "waiting for your approval" state polls /assistant/subscription/poll
 *    on the server's interval (fallback ~3s), stopping at the server's
 *    expires_in; expiry/failure shows the retry button again.
 * Kept as its own component so switching provider or linking resets every
 * timer and state bit back to zero — no stale countdown can leak across tabs.
 */
function DeviceFlow({
  provider,
  onChanged,
  onProblem,
  onBusyChange,
}: {
  provider: SubscriptionProvider;
  onChanged: (next?: SubscriptionView) => void;
  onProblem: (message: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, locale } = useApp();
  /** aliveRef flips when this instance stops being the current one. */
  const aliveRef = useRef(true);
  /**
   * H24 — the explicit cancel («إلغاء») is the ONLY in-UI way out of the
   * wait besides linked/expiry. A ref (not state) so the async loop can
   * read it on every tick.
   */
  const cancelRef = useRef(false);
  const [flow, setFlow] = useState<AssistantSubscriptionStart | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [copied, setCopied] = useState(false);
  /** H24 — a transient poll miss keeps the wait alive; this note says so honestly. */
  const [retrying, setRetrying] = useState(false);

  /** H24 — the explicit cancel: end the wait and return to the start button. */
  const cancelWait = useCallback(() => {
    cancelRef.current = true;
    setWaiting(false);
    setFlow(null);
    setRetrying(false);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    onBusyChange(waiting);
  }, [onBusyChange, waiting]);

  const copyCode = useCallback(async () => {
    if (!flow?.user_code) return;
    try {
      await navigator.clipboard.writeText(flow.user_code);
      setCopied(true);
      window.setTimeout(() => {
        if (aliveRef.current) setCopied(false);
      }, 2000);
    } catch {
      /* clipboard blocked: the code is right there to copy by hand */
    }
  }, [flow]);

  const beginLogin = useCallback(async () => {
    onProblem(null);
    cancelRef.current = false;
    setFlow(null);
    setWaiting(false);
    setRetrying(false);
    try {
      const start = await startSubscriptionLogin(provider, locale);
      if (!aliveRef.current) return;
      setFlow(start);
      setWaiting(true);
      // Pace EXACTLY as the server says: its interval (fallback ~3s), hard
      // stop at its expires_in (fallback 10 min so a server without the
      // field cannot poll forever), every tick cancelled on unmount.
      // H24 fix — the sentinel MUST start falsy: `let outcome = "stopped"`
      // made `!outcome` false on the first check, so the loop body (every
      // poll) never ran; the panel fell back to the plain button after the
      // first sleep — the ~5-second reset the owner reported (the server's
      // interval: 5). H24: a transient miss (network error, or the panel's
      // own failure to authenticate) NEVER ends the wait — the code, link
      // and spinner stay; we back off 5s → 10s → 15s and say "retrying".
      // Only linked / server expiry / an explicit «إلغاء» end the wait.
      const baseDelayMs = Math.max(1000, (start.interval && start.interval > 0 ? start.interval : 3) * 1000);
      const deadline = Date.now() + (start.expires_in && start.expires_in > 0 ? start.expires_in : 600) * 1000;
      const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
      let outcome: "linked" | "expired" | null = null;
      let missCount = 0;
      /** H24 — true for exactly one loop turn after a missed poll, so the
       * backoff sleep is the ONLY sleep before the retry: without this the
       * bottom-of-loop interval sleep stacks on top (measured 10s/15s/20s
       * instead of the brief's 5s → 10s → 15s). */
      let justMissed = false;
      while (aliveRef.current && !outcome) {
        if (Date.now() > deadline) {
          outcome = "expired";
          break;
        }
        if (cancelRef.current) break;
        try {
          const poll = await pollSubscriptionLogin(provider, locale);
          if (!aliveRef.current) return;
          if (poll.status === "linked") {
            onChanged(outcomeToView(poll));
            outcome = "linked";
          }
          missCount = 0;
          justMissed = false;
          setRetrying(false);
        } catch (failure) {
          // H24 — a failed poll keeps the wait: be honest about it. The
          // backoff sleep happens at the bottom of the loop (the justMissed
          // gate), NOT inside this catch — see the comment there. Only a
          // TERMINAL server answer that also cleared the flow on its side
          // (the flow is gone; polling further can only 409 again) ends
          // the wait here: flow_expired (the provider's code window
          // closed) and no_pending_flow (the server says no flow exists
          // at all). Everything else — a network drop, a 5xx, any other
          // envelope — is a transient miss: the code, link and spinner
          // STAY, we back off and say "retrying…".
          const code = failure instanceof ApiError ? failure.code : undefined;
          const terminal = code === "flow_expired" || code === "no_pending_flow";
          if (terminal) {
            onProblem(failureText(failure, t("errorNetwork"), t("signIn")));
            outcome = "expired";
          } else {
            missCount += 1;
            justMissed = true;
            setRetrying(true);
          }
        }
        if (outcome) break;
        if (Date.now() > deadline) {
          outcome = "expired";
          break;
        }
        if (cancelRef.current) break;
        // H24 — after a missed poll the backoff sleep above already waited
        // missCount×interval (capped at 15s); do not add the normal interval
        // on top of it — the retry must land at 5s → 10s → 15s as specced.
        if (justMissed) {
          justMissed = false;
        } else {
          await sleep(baseDelayMs);
        }
      }
      if (!aliveRef.current) return;
      setWaiting(false);
      setRetrying(false);
      if (outcome === "expired") {
        // The window closed without approval: the retry button comes back,
        // with the expiry sentence the owner reads before pressing it again.
        setFlow(null);
        onProblem(t("assistantSubExpired"));
      }
    } catch (failure) {
      if (!aliveRef.current) return;
      setWaiting(false);
      setFlow(null);
      setRetrying(false);
      onProblem(failureText(failure, t("errorNetwork"), t("signIn")));
    }
  }, [provider, locale, t, onChanged, onProblem]);

  if (waiting && flow) {
    return (
      <div className="assistant-sub-flow">
        <p className="assistant-sub-state" role="status">
          <span className="spinner" aria-hidden="true" /> {t("assistantSubStateWaiting")}
        </p>
        {/* H24 — a transient miss keeps the wait; this note says so, honestly. */}
        {retrying ? <p className="field-hint" role="status">{t("assistantSubRetrying")}</p> : null}
        <div className="field">
          <span className="field-label">{t("assistantSubCodeLabel")}</span>
          <code className="assistant-sub-code input" dir="ltr">{flow.user_code}</code>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyCode}>
            {copied ? t("assistantSubCopied") : t("assistantSubCopyCode")}
          </button>
        </div>
        <a className="assistant-sub-link" dir="ltr" href={flow.verification_uri} target="_blank" rel="noreferrer">
          {flow.verification_uri
            ? <>{t("assistantSubLinkLabel")} ↗ <span className="visually-hidden">{flow.verification_uri}</span></>
            : t("assistantSubLinkLabel")}
        </a>
        <span className="field-hint">{t("assistantSubCodeWindowHint")}</span>
        {/* H24 — the ONLY in-UI way out of the wait: an explicit cancel that
            ends it and returns to the start button (and a reload restarting
            the panel is equally fine — nothing needs persisting). */}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancelWait}>
            {t("assistantSubCancel")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={beginLogin}
    >
      {t("assistantSubLoginButton")}
    </button>
  );
}
