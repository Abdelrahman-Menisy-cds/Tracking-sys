# H24 — the waiting state must NOT reset (the owner is thrown out after ~5s)

The owner, verbatim: **«الصفحه دي بتقفل عطول ف 5 ث تقريبا. المفروض متقفلش طول م
احنا بنعمل ربط لحد م الربط يتم او اني الغي الربط او اعمل ريلود مثلا»**

Screenshot shows the correct waiting UI («في انتظار الموافقة — كمّل التسجيل في
الصفحة اللي فتحتها», the code `R0H6-A3UCW`, «افتح صفحة الموافقة ↗») — and then it
falls back to the plain button ~5 seconds later, which is exactly the server's
`interval: 5` from `start`. So the **first poll** fails and the panel treats it as
"window closed without approval" (`SubscriptionPanel.tsx` ~line 424) and resets.

Server side is verified working (I ran it): `POST /assistant/subscription/poll`
with an **empty body** and a valid session returns `{"status":"pending"}` for both
providers — including from a fresh signup. `capability` returns
`login_flow_available: true` for both. So the failure is in **how the panel
polls**, not in the flow.

## Fix (frontend)

1. **Find and fix the real poll failure** — most likely the request is not
   authenticated like the rest of the app (the API client's CSRF/session handling
   for POST) or a response-shape mismatch; the same client's other POSTs work
   (`import` does). Prove which with the actual status/body (log it in the probe).
2. **Never reset the waiting state on a transient error**: a failed poll must
   keep the code + link + waiting UI, keep polling (with backoff, e.g. 5s → 10s →
   15s), and show a small honest "retrying…" note. Only these end the wait:
   - **linked** (success) → linked state + model list;
   - **expiry** (the server's `expires_in`, or a terminal server error such as
     `no_pending_flow` / a device-flow terminal error) → clear message + start
     again;
   - **the user cancels** → add an explicit **«إلغاء»** button that ends the wait
     and returns to the start button (that is the only in-UI way out).
3. A **reload** naturally restarts the panel — no persistence needed.
4. Keep everything else (the import fallback, the markdown rendering, the
   api-key tab, the honest hint, no token ever shown) as it is.

## Note from the previous (interrupted) attempt

The probe screenshots came out showing the **onboarding tour overlay**
(«الخطوة 1 من 2» … «التالي» / «تخطي الجولة»), not the subscription panel — so the
30s assertion never actually ran. **Dismiss the tour first** (click «تخطي الجولة»,
or clear the flag it sets in localStorage) before asserting anything about the
panel. Also: the previous run was killed mid-work, so verify whether your edits
are actually in the files (`git diff --stat`) before redoing them.

## Prove it

- A real probe against **`http://localhost:8080`** (the host's LAN IP changed —
  `192.168.1.19` is dead; use localhost), click «تسجيل الدخول للاشتراك»,
  assert the code + link render, then **wait ≥ 30 seconds** and assert the waiting
  state is **still** on screen (not the plain button) and that polls are still
  happening — plus a screenshot at ~2s and another at ~30s under
  `/home/menisy/.hermes/cache/scratch/h24-shots/`. Paste the poll responses the
  browser actually got.
- If a poll legitimately returns a terminal error, show it plainly instead of
  silently resetting.

Do not commit, stage, or stash. Report real output; say plainly what still fails.
