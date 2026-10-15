import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../../app/AppContext";
import {
  getAssistantConfig,
  ASSISTANT_CONFIG_CHANGED_EVENT,
  type AssistantConfig,
} from "../../app/assistantApi";
import AssistantPanel from "./AssistantPanel";

/**
 * The floating مدام عفاف launcher — brief H18, piece 1.
 *
 * The owner's rule, enforced here and nowhere else: while the employee has no
 * active model linked (nothing configured, or is_active false), the button is
 * FADED and NOT enabled — it does not open the chat — but hovering it OR
 * focusing it (Tab keeps it reachable: aria-disabled, not disabled) says they
 * need to link an active model from the settings, and the hint carries a link
 * straight to the profile widget, so the recovery is one click away.
 *
 * The config is fetched once on mount and re-fetched whenever a settings
 * widget saves (ASSISTANT_CONFIG_CHANGED_EVENT), so the state never lies.
 */
export default function AssistantLauncher() {
  const { t, locale } = useApp();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const reload = useCallback(() => {
    getAssistantConfig(locale)
      .then((next) => setConfig(next))
      .catch(() => {
        // Unreachable backend / no endpoints yet: keep the launcher faded rather
        // than guessing a state — the next save event or reload re-probes.
        setConfig((current) => current ?? null);
      });
  }, [locale]);

  useEffect(() => {
    reload();
    const onChange = () => reload();
    window.addEventListener(ASSISTANT_CONFIG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ASSISTANT_CONFIG_CHANGED_EVENT, onChange);
  }, [reload]);

  const enabled = Boolean(config?.is_configured && config?.is_active);

  const openPanel = () => {
    if (!enabled) return;
    setPanelOpen(true);
  };

  return (
    <>
      <div className="assistant-launcher-wrap">
        <button
          type="button"
          className={`assistant-launcher${enabled ? "" : " assistant-launcher-muted"}`}
          aria-disabled={enabled ? undefined : "true"}
          aria-expanded={panelOpen}
          aria-label={enabled ? t("assistantOpenChat") : t("assistantNeedsModelHint")}
          title={enabled ? undefined : t("assistantNeedsModelHint")}
          onClick={openPanel}
        >
          <img src="/brand/afaf.png" alt="" width={56} height={56} className="assistant-launcher-face" />
        </button>
        {!enabled ? (
          <div className="assistant-launcher-hint" role="tooltip">
            <span>{t("assistantNeedsModelHint")}</span>
            <Link to="/profile#assistant" className="assistant-launcher-hint-link">
              {t("assistantGoToSettings")}
            </Link>
          </div>
        ) : null}
      </div>
      {panelOpen && config ? <AssistantPanel config={config} open={panelOpen} onClose={() => setPanelOpen(false)} /> : null}
    </>
  );
}
