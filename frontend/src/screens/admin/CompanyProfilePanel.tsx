import { useCallback, useEffect, useState } from "react";
import {
  fetchCompany,
  saveCompany,
  REQUIRED_COMPANY_FIELDS,
  type CompanyProfilePatch,
  type CompanyState,
} from "../../app/companyApi";
import { CompanyForm } from "../../components/company/CompanyForm";
import { Banner, SkeletonRows } from "../../components/ui";
import { EditIcon, InfoIcon } from "../../components/icons";
import type { Dict, Locale } from "../../i18n/dict";

type DictKey = keyof Dict;

/**
 * The Company profile widget (Story H17) — one card on /admin/settings,
 * beside the schedule, leave, and holidays cards, never a paragraph inside
 * another widget.
 *
 * It is its OWN server-backed read (GET /company) with the app's honest
 * lifecycle: skeleton rows while loading, one precise failure line when the
 * API does not answer (retried through the retry control), the saved identity
 * as a read-out (logo, name, activity, address, phone, contact, legal
 * numbers), and an edit mode reusing the exact same CompanyForm the
 * onboarding page uses — one implementation, two screens.
 */
export function CompanyProfilePanel({ t, locale }: { t: (key: DictKey) => string; locale: Locale }) {
  const [state, setState] = useState<CompanyState | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    fetchCompany(locale)
      .then((loaded) => {
        if (cancelled) return;
        setState(loaded);
        setPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, locale]);

  const save = useCallback(
    async (patch: CompanyProfilePatch) => {
      setBusy(true);
      const settled = await saveCompany(patch, locale);
      if (!settled) {
        setBusy(false);
        setFeedback({ tone: "error", text: t("companyErrorGeneric") });
        return;
      }
      setState(settled);
      setEditing(false);
      setBusy(false);
      setPhase("ready");
      setFeedback({ tone: "success", text: t("companyWidgetSaved") });
    },
    [locale, t],
  );

  const missing = state?.profile
    ? REQUIRED_COMPANY_FIELDS.filter((field) => !state.profile?.[field]?.trim())
    : [...REQUIRED_COMPANY_FIELDS];

  const renderFact = (label: DictKey, value: string | null) => (
    <div key={label}>
      <dt>{t(label)}</dt>
      <dd>{value ? <bdi>{value}</bdi> : <span className="page-meta">{t("companyWidgetNoLogo")}</span>}</dd>
    </div>
  );

  return (
    <section className="work-surface section" aria-labelledby="settings-company-heading" id="settings-company">
      <div className="section-heading">
        <h2 id="settings-company-heading">{t("companyWidgetTitle")}</h2>
        <span className="page-meta">{t("companyWidgetSubtitle")}</span>
        {state?.profile && !editing ? (
          <button
            type="button"
            className="btn btn-ghost btn-compact icon-only"
            aria-label={t("companyWidgetEdit")}
            onClick={() => {
              setFeedback(null);
              setEditing(true);
            }}
          >
            <EditIcon />
          </button>
        ) : null}
      </div>

      {feedback ? <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner> : null}

      {phase === "loading" ? (
        <div aria-busy="true">
          <SkeletonRows rows={3} />
        </div>
      ) : phase === "error" ? (
        <div className="error-region" role="alert">
          <InfoIcon className="state-icon" />
          <p>{t("companyErrorUnreachable")}</p>
          <button className="btn btn-secondary" onClick={() => setAttempt((current) => current + 1)}>
            {t("retry")}
          </button>
        </div>
      ) : editing ? (
        <CompanyForm
          profile={state?.profile ?? null}
          t={t}
          locale={locale}
          submitLabel="save"
          savingLabel="saving"
          onSave={save}
          onCancel={() => {
            setEditing(false);
            setFeedback(null);
          }}
          compact
        />
      ) : state?.profile ? (
        <>
          <div className="company-widget-identity">
            {state.profile.logo_data_url ? (
              <img className="company-widget-logo" src={state.profile.logo_data_url} alt={t("companyLogoLabel")} />
            ) : (
              <span className="company-widget-logo company-widget-logo-none">{t("companyWidgetNoLogo")}</span>
            )}
            <div>
              <strong className="company-widget-name"><bdi>{state.profile.name}</bdi></strong>
              <div className="page-meta">{state.profile.activity ? <bdi>{state.profile.activity}</bdi> : null}</div>
            </div>
          </div>
          <dl className="decision-facts company-widget-facts">
            {renderFact("companyFactAddress", state.profile.address)}
            {renderFact("companyFactPhone", state.profile.phone)}
            {state.profile.email ? renderFact("companyFactEmail", state.profile.email) : null}
            {state.profile.website ? renderFact("companyFactWebsite", state.profile.website) : null}
            {state.profile.commercial_register || state.profile.tax_card ? (
              <div>
                <dt>{t("companyWidgetLegalHeading")}</dt>
                <dd>
                  {[state.profile.commercial_register, state.profile.tax_card]
                    .filter(Boolean)
                    .map((value, index) => (
                      <span key={index}>
                        {index > 0 ? <span className="page-meta"> · </span> : null}
                        <bdi>{value}</bdi>
                      </span>
                    ))}
                </dd>
              </div>
            ) : null}
            {state.profile.contact_name || state.profile.contact_phone ? (
              <div>
                <dt>{t("companyWidgetContactHeading")}</dt>
                <dd>
                  {[state.profile.contact_name, state.profile.contact_role ? `(${state.profile.contact_role})` : "", state.profile.contact_phone]
                    .filter(Boolean)
                    .map((value, index) => (
                      <span key={index}>
                        {index > 0 ? <span className="page-meta"> · </span> : null}
                        <bdi>{value}</bdi>
                      </span>
                    ))}
                </dd>
              </div>
            ) : null}
          </dl>
          {missing.length > 0 && !busy ? (
            <Banner tone="warning">
              {t("companyWidgetMissingNote").replace(
                "%s",
                missing.map((field) => t(companyFieldLabel(field))).join(locale === "ar" ? "، " : ", "),
              )}
            </Banner>
          ) : null}
        </>
      ) : (
        <div className="empty-region company-widget-empty">
          <InfoIcon className="state-icon" />
          <p>{t("companyWidgetEmpty")}</p>
          <div className="state-actions">
            <button type="button" className="btn btn-primary" onClick={() => { setFeedback(null); setEditing(true); }}>
              {t("companyWidgetEdit")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function companyFieldLabel(field: (typeof REQUIRED_COMPANY_FIELDS)[number]): DictKey {
  const map = {
    name: "companyNameLabel",
    activity: "companyActivityLabel",
    address: "companyAddressLabel",
    phone: "companyPhoneLabel",
  } as const;
  return map[field];
}
