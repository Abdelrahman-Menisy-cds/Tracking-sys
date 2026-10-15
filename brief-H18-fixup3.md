# H18 fix-up 3 — the Test button must report the REAL failure

The owner tried the profile widget against their own provider and got:

> الاتصال فشل: **URL Error: unreachable**

Measured from the same machine the server runs on (so the app has no excuse):

| probe | result |
|---|---|
| `curl https://opencode.ai/zen/go/v1/models` | **HTTP 200** — DNS + TLS fine, the host IS reachable |
| `curl https://opencode.ai/zen/go/v1/chat/completions` | **HTTP 404** — that path is not an OpenAI-compatible endpoint |

So "unreachable" is **wrong and useless**: the host is up, and the real answer
was a 404 from a gateway that is not plain OpenAI-compatible. The owner cannot
act on "unreachable" — they need the provider's own status and message.

## What to fix (backend provider client — `accounts/assistant_provider.py`)

1. **Never collapse a failure into a generic word.** Distinguish and surface, in
   the response's `detail` and in the widget: DNS/connect/TLS failure, timeout,
   HTTP status + the provider's own error body (truncated), and a malformed
   response. If the endpoint answers 404 on `/chat/completions`, say that —
   including the URL that was called.
2. **Make the base-URL handling match real gateways.** Accept a base URL with or
   without a trailing `/v1`, **and strip a pasted non-chat suffix**: the owner
   pasted `https://opencode.ai/zen/go/v1/models` (a listing endpoint) and the
   client appended `/chat/completions` to it. Normalise to the chat base and
   **report the final URL used** in the failure detail so a mismatch is visible —
   never silently call a URL the user did not expect.
3. Keep the pass path exactly as it is (a 1-token chat completion), and keep the
   existing green tests green: `pytest -q accounts/test_assistant.py` (21 passed).

## Prove it with real calls (no invented output)

- Point a config at `https://opencode.ai/zen/go/v1` with a dummy key and show the
  **real** detail now returned (expected: an HTTP-status style message such as a
  404/401 naming the URL, **not** "unreachable").
- Point one at `http://127.0.0.1:9/v1` (a dead port) and show that one correctly
  reports a connection failure — the two cases must read differently.
- Point one at your own stub endpoint and show `ok: true` with the latency.
- Paste the actual `detail` strings for all three.

Then hand the widget's display side to the frontend lane if the message needs a
new label (the widget must show the server's `detail` verbatim rather than a
generic sentence). Do not commit, stage, or stash anything.
