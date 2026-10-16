import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../../app/api";
import {
  REQUIRED_COMPANY_FIELDS,
  type CompanyProfile,
  type CompanyProfilePatch,
} from "../../app/companyApi";
import { Banner } from "../ui";
import type { Dict, Locale } from "../../i18n/dict";

type DictKey = keyof Dict;

/**
 * The H17 company form - one shared implementation, two users.
 *
 * It renders inline (no dialog) both inside the mandatory /onboarding/company
 * page and inside the CompanyProfilePanel edit mode on /admin/settings, so the
 * two screens cannot drift: same fields, same validation mapping, same logo
 * pipeline. The caller owns the data flow - it hands over the current profile
 * (null = nothing yet) and a `save` promise, and receives per-field errors back
 * translated, plus a success line.
 *
 * Validation order matches the server's contract: required fields must be
 * present and locally well-formed first (the client can reply faster than a
 * round trip for blank/pattern misses); anything the server still refuses
 * (per-field 4xx) is re-rendered under the same field it names.
 */

/** The translatable local validators, exactly mirroring the backend's rules. */
const FIELD_KEYS: Record<keyof CompanyProfilePatch, { label: DictKey; hint?: DictKey }> = {
  name: { label: "companyNameLabel" },
  activity: { label: "companyActivityLabel" },
  address: { label: "companyAddressLabel" },
  phone: { label: "companyPhoneLabel", hint: "companyFieldPhone" },
  email: { label: "companyEmailLabel" },
  website: { label: "companyWebsiteLabel", hint: "companyFieldUrl" },
  logo_data_url: { label: "companyLogoLabel", hint: "companyFieldLogo" },
  commercial_register: { label: "companyRegisterLabel" },
  tax_card: { label: "companyTaxCardLabel" },
  contact_name: { label: "companyContactNameLabel" },
  contact_role: { label: "companyContactRoleLabel" },
  contact_phone: { label: "companyContactPhoneLabel", hint: "companyFieldPhone" },
};

type TextFields = Omit<CompanyProfilePatch, "logo_data_url">;

const TEXT_FIELDS = Object.keys(FIELD_KEYS).filter(
  (field) => field !== "logo_data_url",
) as Array<keyof TextFields>;

const PHONE_PATTERN = /^[0-9\s+\-()]+$/u;

/** Client-side mirror of the server's validators - only fast, cheap misses. */
function validate(values: TextFields, logo: string | null, locale: Locale): Partial<Record<keyof TextFields | "logo_data_url", string>> {
  const ar = locale === "ar";
  const errors: ReturnType<typeof validate> = {};
  const required = (field: keyof TextFields) => !values[field]?.trim() && (errors[field] ??= ar ? "هذا الحقل مطلوب." : "This field is required.");
  for (const field of REQUIRED_COMPANY_FIELDS) required(field as keyof TextFields);
  for (const field of ["phone", "contact_phone"] as const) {
    const value = values[field]?.trim() ?? "";
    if (value && !PHONE_PATTERN.test(value)) {
      errors[field] = ar ? "الرقم يقبل أرقام وفراغات و + - ( ) فقط." : "Digits, spaces and + - ( ) only.";
    }
  }
  if ((values.website?.trim() ?? "") && !/^https?:\/\//i.test(values.website!.trim())) {
    errors.website = ar ? "أدخل رابطًا صحيحًا." : "Enter a valid URL.";
  }
  if (logo && !logo.startsWith("data:image/")) {
    errors.logo_data_url = ar ? "الشعار لازم يبدأ بصيغة صورة صحيحة." : "The logo must be a valid image data URL.";
  }
  return errors;
}

/**
 * Downscale a picked image to a data URL of at most ~200 KB.
 *
 * canvas加 PNG re-encodes losslessly and can INFLATE photos, so JPEG output is
 * preferred; only PNG sources that stay small keep their format. Steps down by
 * halves rather than one fixed target so small logos keep their detail.
 */
export function downscaleLogo(file: File, maxBytes = 200 * 1024, maxDimension = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("decode_failed"));
      image.onload = () => {
        let width = image.naturalWidth;
        let height = image.naturalHeight;
        const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) { reject(new Error("canvas_unavailable")); return; }
        context.drawImage(image, 0, 0, width, height);
        // JPEG re-encodes at descending quality (photos dominate); a PNG source
        // keeps its format once only, because alpha cannot survive JPEG.
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        const qualities = mime === "image/png" ? [1] : [0.85, 0.7, 0.55, 0.4, 0.3];
        for (const quality of qualities) {
          const candidate = canvas.toDataURL(mime, quality);
          if (candidate.length <= maxBytes * 4 / 3) { // chars ≈ bytes × 4/3 after base64
            resolve(candidate);
            return;
          }
        }
        // One further halved pass before giving up (loop bound keeps it bounded).
        const shrunk = document.createElement("canvas");
        shrunk.width = Math.max(1, Math.round(width / 2));
        shrunk.height = Math.max(1, Math.round(height / 2));
        const shrunkContext = shrunk.getContext("2d");
        if (!shrunkContext) { reject(new Error("canvas_unavailable")); return; }
        shrunkContext.drawImage(canvas, 0, 0, shrunk.width, shrunk.height);
        const last = shrunk.toDataURL("image/jpeg", 0.4);
        if (last.length <= maxBytes * 4 / 3) resolve(last);
        else reject(new Error("too_large"));
      };
      image.src = String(reader.result);
    };
  });
}

/** Downscale data URLs check retained for callers that pre-check a stored URL. */
export function dataUrlFits(url: string, maxBytes: number): boolean {
  const base64 = url.split(",")[1] ?? "";
  return Math.floor(base64.length * 3 / 4) <= maxBytes;
}

export type CompanyFormHandle = {
  values: TextFields;
  logo: string | null;
  /** Client-side validation ONLY; the server remains the authority on save. */
  invalid: Partial<Record<keyof TextFields | "logo_data_url", string>>;
};

export function CompanyForm({
  profile,
  onSave,
  onCancel,
  t,
  locale,
  submitLabel,
  savingLabel,
  onSaved,
  onDone,
  compact = false,
  trailing = null,
  initialServerErrors,
}: {
  profile: CompanyProfile | null;
  onSave: (patch: CompanyProfilePatch) => Promise<void>;
  onCancel?: () => void;
  t: (key: DictKey) => string;
  locale: Locale;
  submitLabel: DictKey;
  savingLabel: DictKey;
  /** After a successful save: the settled company state from the server. */
  onSaved?: (profile: CompanyProfile | null, needsProfile: boolean) => void;
  /** When submit-level (non-field) failure must be surfaced by the parent page. */
  onDone?: (failure: { message: string } | null) => void;
  compact?: boolean;
  /**
   * H34b: extra fields the parent renders INSIDE this form, after the
   * optional group - the signup wizard puts the activation-code field here so
   * the code stays the LAST field of the company screen and Enter still
   * submits the same form. The parent owns that field's state entirely.
   */
  trailing?: ReactNode;
  /**
   * H34b: per-field server refusals to seed at mount. The fused signup POST
   * can reject a company field from step 2's submit; the wizard re-enters
   * this screen (remounted via key) with the collected values AND these
   * errors so each refusal lands under the field that caused it.
   */
  initialServerErrors?: Partial<Record<keyof TextFields | "logo_data_url", string>>;
}) {
  const seed = profile ?? {
    name: "", activity: "", address: "", phone: "",
    email: "", website: "", logo_data_url: "",
    commercial_register: "", tax_card: "",
    contact_name: "", contact_role: "", contact_phone: "",
  };
  const [values, setValues] = useState<TextFields>(() => {
    const clone: Record<string, string> = {};
    for (const field of TEXT_FIELDS) clone[field] = (seed as unknown as Record<string, string>)[field] ?? "";
    return clone as TextFields;
  });
  const [logo, setLogo] = useState<string>(() => seed.logo_data_url || "");
  const [logoBusy, setLogoBusy] = useState(false);
  const [clientErrors, setClientErrors] = useState<Partial<Record<keyof TextFields | "logo_data_url", string>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<keyof TextFields | "logo_data_url", string>>>(initialServerErrors ?? {});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { fileRef.current = null; }, []);

  const setField = (field: keyof TextFields, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
    setClientErrors((current) => ({ ...current, [field]: undefined }));
  };

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setClientErrors((current) => ({ ...current, logo_data_url: t("companyLogoBadType") }));
      return;
    }
    setLogoBusy(true);
    setClientErrors((current) => ({ ...current, logo_data_url: undefined }));
    try {
      const url = await downscaleLogo(file);
      setLogo(url);
    } catch (error) {
      setClientErrors((current) => ({
        ...current,
        logo_data_url: error instanceof Error && error.message === "too_large" ? t("companyLogoTooLarge") : t("companyErrorGeneric"),
      }));
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const local = validate(values, logo || null, locale);
    if (Object.keys(local).length > 0) {
      setClientErrors(local);
      setBanner(null);
      return;
    }
    setBusy(true);
    setBanner(null);
    setServerErrors({});
    const patch: CompanyProfilePatch = {
      ...values,
      name: (values.name ?? "").trim(),
      activity: (values.activity ?? "").trim(),
      address: (values.address ?? "").trim(),
      phone: (values.phone ?? "").trim(),
      logo_data_url: logo,
    };
    for (const key of Object.keys(patch) as Array<keyof CompanyProfilePatch>) {
      if (typeof patch[key] === "string" && (patch[key] as string).trim() === "" && key !== "logo_data_url") {
        (patch as Record<string, unknown>)[key] = "";
      }
    }
    try {
      await onSave(patch);
    } catch (failure) {
      const fieldMap: Partial<Record<keyof TextFields | "logo_data_url", string>> = {};
      let line = t("companyErrorGeneric");
      if (failure instanceof ApiError) {
        if (failure.kind === "unreachable") line = t("companyErrorUnreachable");
        else if (failure.kind === "server") line = t("companyErrorServer");
        for (const [field, messages] of Object.entries(failure.fields ?? {})) {
          const first = (messages ?? []).filter(Boolean)[0];
          if (first) fieldMap[field as keyof TextFields] = first;
        }
      }
      setServerErrors(fieldMap);
      setBanner(Object.keys(fieldMap).length === 0 ? line : null);
      setBusy(false);
      onDone?.({ message: line });
      return;
    }
    setBusy(false);
    onDone?.(null);
    onSaved?.(null, false); // parent re-reads the settled state itself
  };

  const fieldName = (field: keyof TextFields | "logo_data_url"): string =>
    field === "logo_data_url" ? t("companyLogoLabel") : t(FIELD_KEYS[field].label);
  void fieldName;
  const fieldError = (field: keyof TextFields | "logo_data_url"): string | undefined =>
    clientErrors[field] ?? serverErrors[field];

  const inlineAttrs = (field: keyof TextFields | "logo_data_url") => {
    const message = fieldError(field);
    return message
      ? ({ "aria-invalid": true as const, "aria-describedby": `company-field-${String(field)}-error` })
      : {};
  };

  const renderField = (field: keyof TextFields, type: string = "text") => {
    const { label, hint } = FIELD_KEYS[field];
    const message = fieldError(field);
    return (
      <label className="field" key={field}>
        <span className="field-label">
          {t(label)}
          {(REQUIRED_COMPANY_FIELDS as readonly string[]).includes(field) ? (
            <span className="field-required">{t("adminRequiredMark")}</span>
          ) : null}
        </span>
        <input
          className="input"
          type={type}
          name={field}
          dir={["phone", "contact_phone", "email", "website"].includes(field) ? "ltr" : undefined}
          value={values[field] ?? ""}
          onInput={(event) => setField(field, (event.target as HTMLInputElement).value)}
          {...inlineAttrs(field)}
        />
        {message ? (
          <span id={`company-field-${String(field)}-error`} className="request-inline-error" role="alert">{message}</span>
        ) : hint ? (
          <span className="field-hint">{t(hint)}</span>
        ) : null}
      </label>
    );
  };

  const requiredFieldList = (REQUIRED_COMPANY_FIELDS as ReadonlyArray<keyof TextFields>).filter((field) => !values[field]?.trim());

  return (
    <form className={compact ? "company-form company-form-compact" : "company-form"} onSubmit={submit} noValidate>
      <div className="company-required-instructions">
        <Banner tone="info">
          {requiredFieldList.length > 0 ? t("companyMissingSummary").replace("%s", requiredFieldList.map((field) => t(FIELD_KEYS[field].label)).join(locale === "ar" ? "، " : ", ")) : t("companyMissingNothing")}
        </Banner>
      </div>
      <fieldset className="company-form-group">
        <legend className="field-label">{t("companyOnboardingRequiredHeading")}</legend>
        <div className="company-form-grid">
          {renderField("name")}
          {renderField("activity")}
          {renderField("address")}
          {renderField("phone", "tel")}
        </div>
      </fieldset>
      <fieldset className="company-form-group">
        <legend className="field-label">{t("companyOnboardingOptionalHeading")}</legend>
        <div className="company-form-grid">
          {renderField("email", "email")}
          {renderField("website", "url")}
          {renderField("commercial_register")}
          {renderField("tax_card")}
          {renderField("contact_name")}
          {renderField("contact_role")}
          {renderField("contact_phone", "tel")}
        </div>
        <div className="field">
          <span className="field-label" id="company-logo-label">{t("companyLogoLabel")}</span>
          <div className="company-logo-row">
            {logo ? (
              <img className="company-logo-preview" src={logo} alt={t("companyLogoLabel")} />
            ) : (
              <span className="company-logo-none">{t("companyWidgetNoLogo")}</span>
            )}
            <input
              ref={fileRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg"
              aria-labelledby="company-logo-label"
              onChange={(event) => void pickLogo(event.target.files?.[0])}
            />
            <button type="button" className="btn btn-secondary" disabled={logoBusy} onClick={() => fileRef.current?.click()}>
              {t(logo ? "companyLogoChange" : "companyLogoChoose")}
            </button>
            {logo ? (
              <button type="button" className="btn btn-ghost" disabled={logoBusy} onClick={() => setLogo("")}>
                {t("companyLogoRemove")}
              </button>
            ) : null}
          </div>
          <span className="field-hint">
            {logoBusy ? t("companyLogoBusy") : fieldError("logo_data_url") ? fieldError("logo_data_url") : t("companyLogoHint")}
          </span>
        </div>
      </fieldset>
      {trailing}
      {banner ? <Banner tone="error" role="alert">{banner}</Banner> : null}
      <div className="form-actions company-form-actions">
        {onCancel ? (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>
            {t("cancel")}
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy || logoBusy}>
          {busy ? (
            <><span className="spinner" aria-hidden="true" />{t(savingLabel)}</>
          ) : t(submitLabel)}
        </button>
      </div>
    </form>
  );
}
