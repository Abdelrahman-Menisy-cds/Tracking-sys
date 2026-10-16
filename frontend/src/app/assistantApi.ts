/**
 * The مدام عفاف assistant API - brief H18.
 *
 * Thin wrappers over the shared `apiRequest`, exactly like `orgApi`: the
 * session, CSRF, timeouts and the error envelope all come from there, so this
 * file only knows the paths and the shapes.
 *
 * The contract is frozen in brief-H18-afaf-assistant-frontend.md. The one rule
 * everything downstream depends on: the API key NEVER comes back in any
 * response - the config only carries `key_hint` and `key_source`. Nothing in
 * this file or the UIs built on it may ever need to read the raw key.
 */
import { apiRequest } from "./api";

export interface AssistantConfig {
  is_configured: boolean;
  is_active: boolean;
  base_url: string;
  model: string;
  key_hint: string;
  /** "self" = the employee linked it, "hr" = HR set it in the employee file, null = nothing set. */
  key_source: "self" | "hr" | null;
  can_replace_key: boolean;
  /** H19 - derived server-side: "subscription" when a provider credential exists, else "api". */
  mode: "api" | "subscription";
  /** "opencode" | "codex" when linked; "" in api mode. */
  subscription_provider: string;
  /** Display-only masked credential hint (e.g. "••••88"). NEVER a token. */
  subscription_hint: string;
  /** "key" (the CLI's stored provider key - does not expire) | "oauth" (access+refresh). */
  subscription_cred_type: string;
  /** "device" (the in-app login flow) | "local" (imported from this machine's CLI login). */
  subscription_source: string;
  /** oauth only; a key credential does not expire. */
  subscription_expires: string | null;
}

export type AssistantTestResult = {
  ok: boolean;
  latency_ms: number;
  /** The provider's own message on failure; the UI shows this, never raw HTTP text. */
  detail: string;
};

export interface AssistantEmployeeConfig extends Omit<AssistantConfig, "is_configured"> {
  is_active: boolean;
}

export interface AssistantMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * A write the assistant wants to perform. It lives only in the reply until the
 * operator presses تأكيد - confirming runs it against the system.
 */
export interface PendingAssistantAction {
  token: string;
  /** Human-readable action name, e.g. "create_leave_request". */
  name: string;
  /** The action's arguments, rendered as key/value pairs on the card. */
  args?: Record<string, string | number | boolean> | null;
}

export interface AssistantChatReply {
  reply: string;
  pending_action: PendingAssistantAction | null;
  tool_trace?: unknown;
}

export interface AssistantSaveInput {
  base_url: string;
  model: string;
  api_key?: string;
}

/**
 * H19 - the subscription write body: exactly one credential per row, so the
 * picker sends mode="subscription" + the provider, and the server clears the
 * api-key fields itself. Switching to api mode sends the api subset, which
 * unlinks the subscription on the server.
 */
export type AssistantModeSaveInput =
  | ({ mode: "subscription"; subscription_provider: SubscriptionProvider } & Partial<AssistantSaveInput>)
  | ({ mode: "api" } & AssistantSaveInput);

/**
 * H19 fix-up 4 - what a provider honestly supports. The import is the
 * PRIMARY link path; a login flow exists only where the provider itself
 * offers one. The backend never POSTs any /oauth/* path to a provider's
 * API base (the invented /oauth/device/start call is deleted), so the UI
 * must not render a sign-in button where login_flow_available is false.
 */
export interface AssistantSubscriptionCapability {
  provider: string;
  import_available: boolean;
  login_flow_available: boolean;
}

export type AssistantCapabilityShape = AssistantSubscriptionCapability;

export type AssistantPollOutcome =
  | { status: "pending" }
  | ({ status: "linked" } & AssistantConfig);

/**
 * H21c - what POST /assistant/subscription/start returns: the device-login
 * job. The user types user_code at verification_uri; the server holds the
 * token and NEVER returns it. Poll on `interval` until `linked` or expiry.
 */
export interface AssistantSubscriptionStart {
  provider: SubscriptionProvider;
  verification_uri: string;
  user_code: string;
  /** Seconds between polls - the server's own pacing, honoured verbatim. */
  interval?: number;
  /** Seconds until the device code expires. */
  expires_in?: number;
}

/** What the subscription's own model listing returned. */
export interface AssistantModelsResult {
  supported: boolean;
  models: string[];
  detail: string;
}

/** H19 - the subscription presets (owner's rule: ONLY these two logins exist). */
export type SubscriptionProvider = "opencode" | "codex";

export async function getAssistantConfig(locale?: string): Promise<AssistantConfig> {
  const payload = await apiRequest<{ data: AssistantConfig }>("/assistant/config", { acceptLanguage: locale });
  return payload.data;
}

export async function saveAssistantConfig(input: AssistantSaveInput, locale?: string): Promise<AssistantConfig> {
  const payload = await apiRequest<{ data: AssistantConfig }>("/assistant/config", {
    method: "PUT",
    body: input,
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function testAssistant(locale?: string): Promise<AssistantTestResult> {
  const payload = await apiRequest<{ data: AssistantTestResult }>("/assistant/test", {
    method: "POST",
    body: {},
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function getEmployeeAssistant(employeeId: number, locale?: string): Promise<AssistantEmployeeConfig> {
  const payload = await apiRequest<{ data: AssistantEmployeeConfig }>(`/employees/${employeeId}/assistant`, {
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function saveEmployeeAssistant(
  employeeId: number,
  input: AssistantSaveInput & { is_active?: boolean },
  locale?: string,
): Promise<AssistantEmployeeConfig> {
  const payload = await apiRequest<{ data: AssistantEmployeeConfig }>(`/employees/${employeeId}/assistant`, {
    method: "PUT",
    body: input,
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function sendAssistantChat(
  messages: AssistantMessage[],
  locale?: string,
): Promise<AssistantChatReply> {
  const payload = await apiRequest<{ data: AssistantChatReply }>("/assistant/chat", {
    method: "POST",
    body: { messages },
    acceptLanguage: locale,
  });
  return payload.data;
}

export async function confirmAssistantAction(token: string, locale?: string): Promise<{ result: string }> {
  const payload = await apiRequest<{ data: { result: string } }>(`/assistant/actions/${encodeURIComponent(token)}/confirm`, {
    method: "POST",
    body: {},
    acceptLanguage: locale,
  });
  return payload.data;
}

/**
 * The one change-notification channel between the settings widgets and the
 * floating launcher: saving (or an HR save in another tab) re-fetches the
 * config so the faded/enabled state never lies. No storage, no timers.
 */
export const ASSISTANT_CONFIG_CHANGED_EVENT = "hermes:assistant-config-changed";

export function notifyAssistantConfigChanged(): void {
  window.dispatchEvent(new Event(ASSISTANT_CONFIG_CHANGED_EVENT));
}

/* ═══ H19 - the subscription login paths (the server drives the login the ═══
   the provider's own CLI does; no token EVER comes back in these payloads). ═══ */

/**
 * GET /assistant/subscription/capability - what this provider honestly
 * supports, so the panel shows import (and a login button ONLY when the
 * provider actually has one; none do today).
 */
export async function getSubscriptionCapability(
  provider: SubscriptionProvider,
  locale?: string,
): Promise<AssistantSubscriptionCapability> {
  const payload = await apiRequest<{ data: AssistantSubscriptionCapability }>(
    `/assistant/subscription/capability?provider=${encodeURIComponent(provider)}`,
    { acceptLanguage: locale },
  );
  return payload.data;
}

/**
 * POST /assistant/subscription/import - link from THIS machine's CLI login
 * (`opencode auth login` / `codex login`). The response carries the config
 * read shape with `subscription_source: "local"` - the widget shows that.
 */
export async function importSubscription(
  provider: SubscriptionProvider,
  locale?: string,
): Promise<AssistantPollOutcome> {
  const payload = await apiRequest<{ data: AssistantPollOutcome }>("/assistant/subscription/import", {
    method: "POST",
    body: { provider },
    acceptLanguage: locale,
  });
  return payload.data;
}

/** GET /assistant/subscription/models - the models the linked subscription offers. */
export async function getSubscriptionModels(locale?: string): Promise<AssistantModelsResult> {
  const payload = await apiRequest<{ data: AssistantModelsResult }>("/assistant/subscription/models", {
    acceptLanguage: locale,
  });
  return payload.data;
}

/**
 * H21c - POST /assistant/subscription/start: begin the REAL device login.
 * Returns the user code + verification link + pacing; nothing secret in it.
 */
export async function startSubscriptionLogin(
  provider: SubscriptionProvider,
  locale?: string,
): Promise<AssistantSubscriptionStart> {
  const payload = await apiRequest<{ data: AssistantSubscriptionStart }>("/assistant/subscription/start", {
    method: "POST",
    body: { provider },
    acceptLanguage: locale,
  });
  return payload.data;
}

/**
 * H21c - POST /assistant/subscription/poll: ask ONCE whether the user has
 * approved. Callers pace these calls on the interval `start` returned.
 * Pending until the user approves; linked carries the new read shape.
 */
export async function pollSubscriptionLogin(
  provider: SubscriptionProvider,
  locale?: string,
): Promise<AssistantPollOutcome> {
  const payload = await apiRequest<{ data: AssistantPollOutcome }>("/assistant/subscription/poll", {
    method: "POST",
    body: { provider },
    acceptLanguage: locale,
  });
  return payload.data;
}
