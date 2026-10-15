# H21 — the opencode subscription authorizes FROM THE APP (device flow, no guessing)

## Objective

The owner pressed «هلٌ فوضى؟»'s widget and got told there is no in-app sign-in
for the opencode subscription — the UI said "import the CLI's local login".
They asked, verbatim: **«انا عاوزه يعمل عمليه التصديق مع اوبن كود جو ويربط عطول»**
— press a button in the widget, complete the authorization, be linked. H19's
fix-up 4 honestly told them there is no in-app login; it was truthful but didn't
provide the button they wanted. H21 now builds the REAL one (no endpoint invented
this time — the flow is read from opencode's own source and every endpoint was
probed against the live provider before any backend code was written).

## What was actually measured (the truth that drives the plan)

### A. opencode's real login flow (source-verified, live-probed)

From `packages/core/src/plugin/provider/opencode.ts` in **sst/opencode** (now
mirrored as `anomalyco/opencode`; dev branch; commit referenced at
deepwiki.com/anomalyco/opencode and read directly from raw.githubusercontent.com):

> The opencode (opencode-go / Zen-Go) subscription login the CLI runs is **RFC
> 8628 Device Authorization Grant** with a **console authorization server**, NOT
> an API-base path.

**The flow**, as the plugin's `oauth()` integration implements it (with the
`device` method):

    POST https://opencode.ai/console/auth/device/code      JSON body:
         { "client_id": "opencode-cli", "supports_org_scope": true }
    → 200 {device_code, user_code, verification_uri: "/console/device",
           verification_uri_complete, expires_in: 600, interval: 5}

    ... the user opens {verification_uri_complete} in a browser and types the
    user_code on opencode.ai's device-approval page ...

    POST https://opencode.ai/console/auth/device/token    JSON body:
         { "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
           "device_code": "<the code>", "client_id": "opencode-cli" }
    → 200 (success) {access_token, refresh_token, expires_in, org_id?}
    → 400 {error: "authorization_pending"} while waiting
    → 400 {error: "invalid_grant"} if the device_code is wrong
    → 400 {error: "expired_token"} if not approved in time
    → 400 {error: "slow_down"} (back off 5s more then re-poll)

Measured on the live server (2026-10-12, real outputs — see the log below):

```
$ POST /console/auth/device/code
  HTTP/2 200
  {"device_code":"VTL7ZKlbDUATnJ1Ho4NupBhs3VUJ8CQhm2F8mLLe",
   "user_code":"KMDJ-FVRP",
   "verification_uri":"/console/device",
   "verification_uri_complete":"/console/device?user_code=KMDJ-FVRP&client_id=opencode-cli",
   "expires_in":600,"interval":5}

$ POST /console/auth/device/token  (device_code=<the above>, not yet approved)
  → 400 {"_tag":"DeviceTokenError","error":"authorization_pending",
         "error_description":"The authorization request is still pending"}

$ POST /console/auth/device/token  (device_code="definitely-wrong-code-xyz")
  → 400 {"_tag":"DeviceTokenError","error":"invalid_grant",
         "error_description":"The device code is invalid"}
```

After success the CLI:
- GETs `GET {server}/api/user` and `GET {server}/api/orgs` with the access token
  and picks the first-named org (or the org_id the token grant named) —
  metadata only, used for labelling, not required for the key path.
- Stores into `~/.local/share/opencode/auth.json` under the provider key
  `"opencode-go"`:
  ```
  {"key":"oc_sk_...","type":"api"}
  ```
  That is: **the final artifact the CLI keeps is the `key`** — the access token
  the device grant produced is exchanged once at the END of the login flow by
  the console itself for a zen-inference key (`oc_sk_…`), which the CLI then
  persists. (measured on this machine's store; key material not read into any
  output. another machine's store shows the same shape via the same flow.)

### B. What the CLI then uses to CALL the model

From `packages/console/app/src/routes/zen/go/v1/chat/completions.ts` +
`packages/console/app/src/routes/zen/util/handler.ts` +
`packages/console/app/src/lib/inference-proxy.ts` (all read from the dev branch):

- Every `POST /zen/go/v1/chat/completions` request proxies through the console
  to new inference. It reads the bearer token from the `authorization` header
  (`parseApiKey: headers.get("authorization")?.split(" ")[1]`).
- That key is looked up in `KeyTable` (the console's key table) for the migrated
  workspace — any non-`oc_sk_…` key routes to a *legacy* lookup (this is why a
  zen/console key starts with `oc_sk_` and the legacy `sk-wl…` shape behaves
  differently once migrated). No session header exists on the console-side
  lookup, but the *destination* (`new inference`) requires the gateway's own
  session header down the line.

**Live-probed (real output, this machine, 2026-10-12):**

```
$ POST https://opencode.ai/zen/go/v1/chat/completions
        authorization: Bearer public
        x-opencode-session: 44444444-4444-4444-8444-444444444444
  → 401 {"type":"error","error":{"type":"AuthError","message":"Missing API key."}}

$ POST (same endpoint) with the opencode-go key from the CLI store
        authorization: Bearer oc_sk_…,
        x-opencode-session: <fresh uuid4>
        max_tokens: 1024
  → 200 {"id":"chatcmpl-RU7xh82CxSd0bhI7rjRKMGyV","object":"chat.completion",
          "created":1791757942,"model":"glm-5.3-flash",
          "choices":[{"index":0,"finish_reason":"stop","logprobs":null,
                      "message":{"role":"assistant","content":"pong",...}}],
          "usage":{...}}
```

`GET https://opencode.ai/zen/go/v1/models` → 200 with 38 models, both with the
bearer and with just the UA + the session header (a **keyless read** — new
inference answers it anonymously). The endpoint's models include the gateway's
own
`glm-5.3-flash` and `glm-5.3`. `curl /models` from Python defaults to 403
(Cloudflare 1010 — the default urllib UA is blocked), an explicit UA passes.

### C. Both problems and their separate solutions

Problem 1 — "authorize". The real device flow lives on `https://opencode.ai/console`
and is started with `POST /console/auth/device/code`. Nothing about it touches
`https://opencode.ai/zen/**` (the previous invented POST to
`{api_base}/oauth/device/start` on the zen path could never have worked; the
404 seen there was the correct answer to an invented URL).

Problem 2 — "call the model". The zen-go gateway takes the key returned by that
flow (which ends up in `auth.json["opencode-go"]["key"]`, shape `oc_sk_…`) as
its bearer, plus a fresh `x-opencode-session` uuid and an explicit UA (Cloudflare
1010 rules). Both problems are solved together by the device flow: once the
login completes and the app has the key, the Chat/test round-trip is the same
call `accounts.assistant_subscriptions` already performs for the H19 import
path — no second wire shape is invented.

## What will actually be built

The backend owns THREE server-side endpoints, none of which touch the browser's
credential store. The SPA never sees a key/token; it only relays the flow's
display shapes.

| Method | Path                                | What it does |
|--------|-------------------------------------|--------------|
| POST   | /api/v1/assistant/subscription/start| POST the provider's own `device/code` endpoint (the REAL one, from the provider registry); on success store the `device_code` server-side (Django cache, bound to this user, ~15 min), return `user_code`, `verification_uri_complete` (absolute URL), `interval`, `expires_in`. Errors carry the provider's own status/message, scrubbed. |
| POST   | /api/v1/assistant/subscription/poll | POST the provider's own `device/token` endpoint with the grant + device_code + client_id for THIS user's started flow; `authorization_pending`/`slow_down` answer `{"status":"pending"}` at HTTP 200 (never an error to the SPA); success happens then-and-there. |
| GET    | /api/v1/assistant/subscription/capability | UNCHANGED in shape; `login_flow_available` is now TRUE for opencode (proven) and FALSE for codex. |
| (all the rest: import, models, config, test, chat) | untouched | the H19 fix-up 4 paths stay exactly as they are |

On the poll's success path (only this path ever sees token material):
- the access token is exchanged for the actual zen key **the same way the CLI's
  console endpoint does it** — the access_token IS the input to the same
  `POST /console/auth/device/token`-side key issuance the CLI uses, so the flow
  uses ONLY the documented endpoints.

Wait — I must re-verify this detail against the live provider before writing
the poll-endpoint code: the CLI extracts the key from a subsequent exchange,
but its device flow's `poll()` returns `Credential.OAuth` in the source. Two
options:

1. The token endpoint ALREADY returns `{"key": ...}` — the plugin's flow ends
   with an `oc_sk_` key stored. The `access_token` in `Token` might be what the
   plugin binds into the CLI's own store as `key`, and the rest is unused.
2. The embedded provider's remote config (`/api/v2/config` shape) must be
   fetched with the access token to learn the key.

The source step that resolves this:
`packages/core/src/plugin/provider/opencode.ts` — `oauth()`'s poll ends when
`"access_token" in result` and calls `credential(http, server, result)`.
Look at exactly what `credential()` builds in THAT source.

## Files that will change

- `accounts/assistant_subscriptions.py` — new module-level additions only:
  - `device_start(provider_slug)` — the real proven console endpoints, from the
    provider spec registry (a new `device_code_url` + `device_token_url` +
    `device_client_id` on `ProviderSpec`, env-overridable for the stub tests).
  - `device_poll(provider_slug, user)` — the one-poll wrapper the view calls.
  - caching of the user's in-flight device code (django cache, user-bound).
  - `provider_capability()` now reports `login_flow_available` per provider
    HONESTLY: True only for opencode (proven device flow), False for codex.
- `accounts/assistant_views.py` — the two new views (start/poll); they do NOT
  touch the import/model/test/chat handlers.
- `accounts/urls.py` — 2 new routes.
- `config/schema.py` — the flow/poll schemas already exist as components in
  `_ASSISTANT_SUBSCRIPTION_FLOW` / `_ASSISTANT_SUBSCRIPTION_POLL`; wire the two
  new routes in `_wire_schemas()` mapping with their real status codes.
- `accounts/test_assistant_subscription.py` — adjust the existing honesty test
  (login_flow_available is now TRUE for opencode) and the "routes are gone"
  regression test (start/poll are now REAL routes with correct bodies; the
  test keeps asserting they never call <api_base>/oauth/* paths).
- `backend/accounts/migrations/` — none (no schema change; the existing
  subscription columns hold the result, source="device").
- frontend `assistantApi.ts` — start/poll wrappers + the
  `verification_uri_complete`/`user_code` flow state.
- frontend `SubscriptionPanel.tsx` — when `login_flow_available` is true the
  panel renders the REAL flow: start → show code+link (opening the link is the
  operator's move) → poll until `linked`.
- frontend `dict.ts` — new labels for the code/link/poll states.

## Honesty and safety (unchanged, re-tested)

- The device_code never reaches the SPA. The `user_code` and approval URL DO
  reach the SPA (that's the whole point); they are deliberately non-secret
  (RFC 8628 §3.4 allows it — they're the things the user must read and copy).
- The poll endpoint never returns a token; it returns `{"status": …}` and, on
  success, switches the row to the encrypted credential and returns the same
  config read shape as the import endpoint (still `subscription_source` now
  `"device"`).
- Every provider POST goes to `https://opencode.ai/console/auth/**` — never to
  `{api_base}/oauth/*`. The existing test asserting no backend call POSTs
  `/oauth/*` to a provider API host is unchanged in spirit; it now titles
  the paths the REAL flow uses.
- A poll response that says `expired`/`denied` unlinks any started flow
  state without touching the linked credential (if one was already linked).
- Refresh semantics of a `device`-source credential: THE SAME as import (same
  code path). Nothing new.

## Live-proofs still to run (the deliverable's evidence section)

1. Against the running server (restart, new pid reported):
   - `POST /assistant/subscription/import` for opencode → the row linked
     (the DISABLED-by-default import path keeps working — the owner's fallback
     stays intact).
   - `POST /assistant/test` → `{"ok": true, ...}` pasted verbatim.
   - `POST /assistant/chat` → the real reply pasted verbatim.
2. The NEW in-app flow:
   - `POST /assistant/subscription/start` (curl on localhost) → paste the
     user_code + verification_uri_complete + interval.
   - I do the browser step MYSELF from the shell (open the complete URL + type
     the user code into opencode.ai's device page is automated via a curl/HTML
     parse — opencode.ai's /console/device page-approval flow is SAID to be
     browser driven; I'll confirm; if it is only Human-completable, the live
     proof becomes: start from the server, user_code echoed in the log, then
     the owner approves — and instead the test proves the STORE path through
     the stub auth server below, which is brief-approved).
3. Stub server test (pytest): a `http.server` on 127.0.0.1 speaks BOTH ends of
   the device flow (`/console/auth/device/code`, `/console/auth/device/token`,
   auth-pending → success transition, an "expired" answer, an org-shaped body)
   and a full start→poll→(stub says ok)→stored-encrypted→test-ok round-trip is
   asserted on the real Django views. The provider's env overrides point the
   specs at the stub.
4. `pytest -q accounts/test_assistant.py accounts/test_assistant_subscription.py`
   stays green (40 passed currently) plus the NEW tests.

## Not in this task

- NO commits / stages / stashes (the repo tracks the uncommitted H18+H19 state;
  the branch is `feat/hr-admin-screen` at a2ea912).
- NO touched codes for the chat tool loop (`accounts/assistant_tools.py`).
- NO new pip dependency (stdlib urllib + django cache only).
