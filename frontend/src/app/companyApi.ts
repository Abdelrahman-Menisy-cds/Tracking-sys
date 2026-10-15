/**
 * The company profile API — Story H17.
 *
 * The organisation's identity is one singleton row on the server ("who is this
 * company?" is a property of the organisation, not of the person). The read
 * shape carries `needs_profile` next to the row so the mandatory onboarding
 * gate can be driven by the SAME answer that feeds the settings widget,
 * instead of a separate "is it complete?" computation drifting on the client.
 *
 * Thin wrappers over the shared `apiRequest`: same session, CSRF header on
 * PATCH, error envelope. The backend's 400 (merged profile still missing a
 * required field) arrives as 422-style per-field data on `ApiError.fields`,
 * which the onboarding form translates per field.
 */
import { apiRequest } from "./api";

/** The company identity exactly as the server stores it. All string fields; optional ones may be empty. */
export type CompanyProfile = {
  name: string;
  activity: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logo_data_url: string;
  commercial_register: string;
  tax_card: string;
  contact_name: string;
  contact_role: string;
  contact_phone: string;
  /** Server-managed metadata, present when a row already exists. */
  updated_at?: string;
};

/** GET/PATCH /api/v1/company — `profile` null until the row is first saved. */
export type CompanyState = { profile: CompanyProfile | null; needs_profile: boolean };

/** A partial write: the caller sends only the fields it wants to change. */
export type CompanyProfilePatch = Partial<Omit<CompanyProfile, "updated_at">>;

/**
 * The four fields the owner made mandatory; every other field is optional.
 * `needs_profile` on the server is computed from these, and the onboarding
 * summary reads them from the same array so the two lists never drift.
 */
export const REQUIRED_COMPANY_FIELDS = ["name", "activity", "address", "phone"] as const;

/** server says which of the still-missing fields are required ones. */
export function missingRequiredFields(profile: CompanyProfile | null): string[] {
  if (!profile) return [...REQUIRED_COMPANY_FIELDS];
  return REQUIRED_COMPANY_FIELDS.filter((field) => !profile[field]?.trim());
}

export async function fetchCompany(locale?: string): Promise<CompanyState> {
  const payload = await apiRequest<{ data: CompanyState }>("/company", { acceptLanguage: locale });
  return payload.data ?? { profile: null, needs_profile: true };
}

export async function saveCompany(patch: CompanyProfilePatch, locale?: string): Promise<CompanyState> {
  const payload = await apiRequest<{ data: CompanyState }>("/company", {
    method: "PATCH",
    body: patch,
    acceptLanguage: locale,
  });
  return payload.data ?? { profile: null, needs_profile: true };
}
