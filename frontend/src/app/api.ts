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

  constructor(kind: ApiFailureKind, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
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
  method?: "GET" | "POST";
  body?: unknown;
  /** Give up after this long. A hanging request must not look like a slow success. */
  timeoutMs?: number;
};

/** The signed-in account as the server describes it. */
export interface ServerIdentity {
  id: number;
  email: string;
  full_name: string;
  role: string;
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
  const { method = "GET", body, timeoutMs = 600000 } = options;
  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST") {
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
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload?.error?.message) message = payload.error.message;
  } catch {
    /* a non-JSON error body is not worth guessing at */
  }

  if (response.status === 401) throw new ApiError("unauthenticated", 401, message);
  // The permission matrix returns 404 for a non-HR caller (no existence disclosure),
  // so 404 here means "not allowed", not "missing".
  if (response.status === 403 || response.status === 404) {
    throw new ApiError("forbidden", response.status, message);
  }
  if (response.status >= 500) throw new ApiError("server", response.status, message);
  throw new ApiError("invalid", response.status, message);
}
