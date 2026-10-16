/**
 * The app's one HTTP client.
 *
 * The frontend was mock-only until the public-holidays register became real: it made
 * zero network calls and had no base URL. Everything server-backed now goes through
 * here, so there is exactly one place that knows how to talk to Django.
 *
 * A base URL is NOT a secret and `VITE_API_BASE_URL` is fine. Credentials are not:
 * anything under `src/` and any `VITE_*` value is compiled verbatim into the public
 * bundle, so the OpenCode Go key lives in the backend's `.env` and never here.
 */

import type { CompanyProfilePatch } from "./companyApi";

/** `VITE_API_BASE_URL` when a deployment sets one, else the dev-proxy path. */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") || "/api/v1";

/** True when we have a base URL to call. The static demo build has none. */
export const API_CONFIGURED = true;

export type ApiFailureKind =
  | "unauthenticated" // 401 — no session on the server
  | "forbidden" // 403/404 — signed in, but not an HR role
  | "unreachable" // network error / no server behind the URL
  | "server" // 5xx
  | "invalid"; // 4xx we can name

export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number;
  /** The backend's own error-envelope code, e.g. "flow_expired" (H24). */
  readonly code?: string;
  /** Per-field messages from the server's error envelope, e.g. {password: ["…"]} (H15b). */
  readonly fields?: Record<string, string[]>;

  constructor(kind: ApiFailureKind, status: number, message: string, fields?: Record<string, string[]>, code?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

/**
 * The CSRF token, as the backend hands it over.
 *
 * Django's default cookie name is NOT in play here: the project sets
 * `CSRF_COOKIE_NAME = "heya_fawda_csrftoken"`, so reading a cookie called
 * `csrftoken` silently finds nothing and every POST comes back 403. The bootstrap
 * endpoint returns the token in its body instead, which needs no name assumption.
 *
 * Django rotates the token on login, so the value is re-adopted from every
 * response that carries a fresh one.
 */
let csrfToken: string | null = null;

async function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  try {
    const response = await fetch(`${API_BASE}/auth/csrf`, { credentials: "include" });
    if (response.ok) {
      const payload = (await response.json()) as { data?: { csrftoken?: string } };
      csrfToken = payload?.data?.csrftoken ?? null;
    }
  } catch {
    /* the POST will fail loudly on its own; guessing here would only hide it */
  }
  return csrfToken;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Give up after this long. A hanging request must not look like a slow success. */
  timeoutMs?: number;
  /** The UI locale, so the server's own validator messages come back in the operator's language. */
  acceptLanguage?: string;
  /**
   * Extra endpoint-mandated headers, e.g. Idempotency-Key (the mutating
   * contract endpoints refuse to run without one). Still ONE HTTP layer:
   * this only forwards what the caller already decided to send.
   */
  headers?: Record<string, string>;
};

/**
 * The signed-in account as the server describes it.
 *
 * `needs_company_profile` (Story H17) is true while the organisation has not
 * completed its profile; the routing gate reads it. It is an OPTIONAL flag:
 * an older backend omits it, and the gate must fail OPEN, so consumers treat
 * a missing value exactly like "no onboarding owed".
 */
export interface ServerIdentity {
  id: number;
  email: string;
  full_name: string;
  role: string;
  /** H17: absent on an older backend — treat exactly like false (fail open). */
  needs_company_profile?: boolean;
}

/**
 * Sign in against Django.
 *
 * The demo's sign-in used to derive a role from the email locally, which meant no
 * session ever existed on the server and every server-backed action returned 401.
 * The SERVER decides the role here; the caller must not re-derive it.
 */
export async function login(email: string, password: string): Promise<ServerIdentity> {
  const payload = await apiRequest<{ data: ServerIdentity }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return payload.data;
}

/** Who the server thinks we are. 401 when there is no session. */
export async function getIdentity(): Promise<ServerIdentity> {
  const payload = await apiRequest<{ data: ServerIdentity }>("/auth/me", { timeoutMs: 8000 });
  return payload.data;
}

/**
 * Self-service signup (Stories H14 + H34b). Same CSRF bootstrap as login().
 *
 * H34b makes the fused body the normal path: the two-step wizard sends the
 * nested `company` object (the step-1 company screen's fields, activation
 * code included at the wizard level) together with the founding HR
 * credentials in ONE request; the backend validates the code first, then
 * writes Company + a COMPLETE CompanyProfile + the founding HR user in one
 * transaction and answers signed-in with `needs_company_profile: false` —
 * so no onboarding step is owed and the caller goes straight to /.
 *
 * Success is a signed-in session: the server creates the HR account and
 * establishes it on the same request (mirroring sign_in), so the payload is
 * the same envelope login() returns.
 *
 * The one non-signup outcome is `email_in_use`: an existing email answered with
 * a valid code returns `{"data": {"outcome": "email_in_use"}}` — non-enumerating,
 * no re-role, no account data. It is NOT a ServerIdentity and must not be
 * adopted as one, so it is raised as an ApiError and the wizard renders
 * its own line for it.
 */
export async function signup(
  email: string,
  code: string,
  password: string,
  locale?: string,
  company?: CompanyProfilePatch,
): Promise<ServerIdentity> {
  const payload = await apiRequest<{ data: ServerIdentity | { outcome?: string } }>("/auth/signup", {
    method: "POST",
    body: company ? { email, code, password, company } : { email, code, password },
    acceptLanguage: locale,
  });
  if ("outcome" in payload.data && payload.data.outcome === "email_in_use") {
    throw new ApiError("invalid", 200, "email_in_use");
  }
  return payload.data as ServerIdentity;
}

export async function logout(): Promise<void> {
  await apiRequest<void>("/auth/logout", { method: "POST" });
}

/** Is the backend actually behind this build? Used to keep the demo path honest. */
export async function serverIsReachable(): Promise<boolean> {
  try {
    await apiRequest<unknown>("/auth/me", { timeoutMs: 4000 });
    return true;
  } catch (error) {
    // 401 means the server IS there, it just has no session for us yet.
    return error instanceof ApiError && error.kind !== "unreachable";
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // A cold refresh drives Nager AND two reasoning-LLM calls, measured at ~348s
  // end to end. A short timeout aborts a call that was going to succeed and
  // reports it as unreachable, which is a lie about what happened.
  const { method = "GET", body, timeoutMs = 600000, acceptLanguage } = options;
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  if (acceptLanguage) headers["Accept-Language"] = acceptLanguage;

  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Every unsafe method needs the token, not just POST: Django enforces CSRF on
  // PATCH and DELETE too, and a missing header there looks exactly like a
  // permission problem.
  if (method !== "GET") {
    const token = await ensureCsrfToken();
    if (token) headers["X-CSRFToken"] = token;
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    // A timeout or a refused connection. There is no server answer to report.
    throw new ApiError(
      "unreachable",
      0,
      error instanceof DOMException && error.name === "AbortError"
        ? "The request timed out."
        : "The server could not be reached.",
    );
  } finally {
    window.clearTimeout(timer);
  }

  if (response.ok) {
    if (response.status === 204) return undefined as T;
    const payload = (await response.json()) as T & { meta?: { csrftoken?: string } };
    // Django rotates the token on login; a stale one would 403 the next POST.
    if (payload?.meta?.csrftoken) csrfToken = payload.meta.csrftoken;
    return payload as T;
  }

  // Prefer the backend's own error envelope: {"error": {"code", "message"}}.
  let message = `Request failed (${response.status}).`;
  let code: string | undefined;
  let fields: Record<string, string[]> | undefined;
  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string; fields?: Record<string, string[]> } };
    if (payload?.error?.code) code = payload.error.code;
    if (payload?.error?.message) message = payload.error.message;
    // A validation failure names the field(s); without this the caller can only print the
    // generic sentence («Validation failed.») and the operator never learns what to fix.
    if (payload?.error?.fields && Object.keys(payload.error.fields).length > 0) fields = payload.error.fields;
  } catch {
    /* a non-JSON error body is not worth guessing at */
  }

  if (response.status === 401) throw new ApiError("unauthenticated", 401, message, fields, code);
  // The permission matrix returns 404 for a non-HR caller (no existence disclosure),
  // so 404 here means "not allowed", not "missing".
  if (response.status === 403 || response.status === 404) {
    throw new ApiError("forbidden", response.status, message, fields, code);
  }
  if (response.status >= 500) throw new ApiError("server", response.status, message, fields, code);
  throw new ApiError("invalid", response.status, message, fields, code);
}
