# H18 — "مدام عفاف" assistant: frontend (floating button, chat panel, settings)

## What the owner asked for

A floating assistant button inside the app, named **مدام عفاف — شؤون العاملين**,
with the character art already saved at `frontend/public/brand/afaf.png` (use it
as the button's face). Tapping it opens a chat where the user can ask for things
and the assistant can **carry out actions in the system**.

Owner's rules, verbatim in intent:
- While the employee has **no active model linked**, the icon must be **visibly
  faded and not enabled** — and **hovering it must say** that they need to link
  an active model from the settings.
- The employee links their **own** provider in a widget on their **profile**
  page: base URL + API key + model, with a **Test button** that proves the
  connection. **No provider presets** (the owner rejected shipping any).
- **HR can do it for the employee from the employee's file**, and then the
  employee **cannot read that key — but can replace it**.
- The assistant **reads freely** and **asks for confirmation before any action
  that changes data**.

This is the frontend half; the backend half (`brief-H18-afaf-assistant-backend.md`)
is landing **in parallel** — implement against the frozen contract below.

## Repository and runtime (verified, do not re-derive)

- Repo `/home/menisy/Desktop/Me/tracking_system_project`, frontend in
  `frontend/` (React 19 + TS + Vite, react-router-dom 7). Build:
  `npm run build:demo` (runs `tsc -b`; a type error fails it), lint: `npm run lint`.
- Served app + API: `http://192.168.1.19:8080`. Fresh HR signup in probes:
  `POST /api/v1/auth/signup` with subscription code `Menisy2002`.
- CDP probe pattern: see `frontend/scripts/probe-h17-company-onboarding.mjs`.
- **All user-facing text lives in `frontend/src/i18n/dict.ts`** (Arabic **and**
  English blocks). The character's name is Arabic-only by nature — keep the
  display name as the owner wrote it in both blocks if a translation would be
  odd, but every other label must be translated.
- **Do not commit, stage, or stash anything** — the tree holds another task's
  uncommitted work.

## API contract (frozen — implement against exactly this)

- `GET /api/v1/assistant/config` → `{is_configured, is_active, base_url, model,
  key_hint, key_source: "self"|"hr"|null, can_replace_key}`. The key is never
  returned — build the UI so it never needs it.
- `PUT /api/v1/assistant/config` → `{base_url, model, api_key?}`.
- `POST /api/v1/assistant/test` → `{ok, latency_ms, detail}`.
- `GET|PUT /api/v1/employees/<id>/assistant` → HR-only; read + set
  `base_url`/`model`/`api_key` and toggle `is_active`.
- `POST /api/v1/assistant/chat` → `{messages: [...]}` in, `{reply,
  pending_action|null, tool_trace}` out. A `pending_action` is the assistant
  asking permission for a write.
- `POST /api/v1/assistant/actions/<token>/confirm` → runs it.

## What to build

1. **Floating button** (`src/features/assistant/AssistantLauncher.tsx`), mounted
   once in the app shell next to the tour: the afaf art in a round floating
   control at the bottom corner (RTL-aware). While the config is missing or
   `is_active` is false it renders **faded** (`aria-disabled="true"`,
   `tabIndex={0}` still so the hint is reachable), does not open the panel, and
   on hover **and** focus shows the hint that they must link an active model
   from the settings — with a link straight to the profile widget.
2. **Chat panel** (`src/features/assistant/AssistantPanel.tsx`): a side panel
   titled with the persona, a message list, a composer, a typing state, and the
   provider/model shown subtly at the top. A `pending_action` renders as a card
   naming the action and its arguments, with **تأكيد** and **إلغاء** — nothing
   is sent to the system until تأكيد. Errors surface in Arabic, never as raw
   HTTP text. Keep the transcript in component state (no localStorage).
3. **Profile widget** (`src/screens/profile/AssistantSettingsPanel.tsx`, mounted
   as its own widget in `src/screens/ProfilePage.tsx`): base URL, API key, model,
   a **Test connection** button showing the real result (ok + latency, or the
   provider's message), and — when `key_source` is `"hr"` — a line saying the key
   was set by HR, it cannot be read, and it **can be replaced** (the field starts
   empty with a replace action). Show the current `key_hint`.
4. **HR panel** in the employee file (`src/screens/admin/AdminPeopleDetailPage.tsx`):
   the same fields plus an **activation toggle**, with a note that the employee
   will not be able to read the key but may replace it.
5. **Tour**: add a step for the floating button (the tour registry in
   `src/features/tour/TourGuide.tsx`).
6. **Dict**: every new label, hint, tooltip, and error, in Arabic and English.

## Verification (real runs, paste the output)

1. `npm run build:demo` (must pass `tsc -b`) and `npm run lint`.
2. A new probe `scripts/probe-h18-afaf-assistant.mjs` that, against the running
   app with a **fresh HR signup**, proves — one printed line per check plus a
   final pass/fail line:
   - with nothing linked, the launcher is faded and `aria-disabled`, and hovering
     it shows the hint text;
   - after saving a config (base URL + key + model) and pressing **Test**, the
     button's state becomes enabled;
   - the chat panel opens, a message sends, and a reply renders;
   - a write request shows a confirmation card, and nothing changes until تأكيد
     is pressed (prove it by checking the app state before/after);
   - the profile widget shows `key_hint` and never the raw key.
   Point the config at a **local stub OpenAI-compatible server you start
   yourself** inside the probe (a tiny node http server answering
   `/chat/completions`) so the whole path is proven without any real provider
   key. Assert on that stub's received requests too — that is how you prove the
   app really called it.
   If the backend endpoints are not live yet, retry with backoff for up to ~15
   minutes before reporting exactly which check you could not run.
3. Screenshots (the faded launcher with its hint, the open chat panel with a
   confirmation card, and the profile widget) under
   `/home/menisy/.hermes/cache/scratch/h18-shots/`.

Every claim must be backed by real command output. No placeholders, no "should
work", no invented screenshots.
