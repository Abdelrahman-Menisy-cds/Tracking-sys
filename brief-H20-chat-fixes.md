# H20 — three things the owner hit in the مدام عفاف chat

Verbatim from the owner, with the assistant's own words in the screenshots:

1. **«المفروض تعرف ترد»** — asked «عندي إجازات قد اي» it answered «المؤسسة عندكم مش
   بتتبع رصيد الإجازات أصلاً» and offered other things. Honest, but it should be
   able to **answer**.
2. **«المفروض متتطلبش مني ال id بتاع الريكويست تايب»** — asked for a day of
   ordinary leave it replied: «محتاج منك رقم النوع بتاع الإجازة الاعتيادية (الـ
   id) … ومفيش عندي أداة أستعرض بيها أنواع الطلبات من هنا». It must resolve that
   itself.
3. **«النجوم والعلامات الخاصه المفروض الحاجه دي تتظبط»** — the chat shows raw
   `**` (e.g. «**ساعاتك», «**رقم نوع الطلب (RequestType id)**») instead of bold.

## What I measured (build on this, do not guess)

- `backend/reqs/models.py` has `RequestType` (line 14) — and the table is
  **EMPTY**: `RequestType.objects.all()` → `[]`. The assistant cannot resolve a
  type it cannot list, and there is nothing to list.
- `backend/accounts/assistant_tools.py` exposes read tools: `read_my_requests`,
  `read_my_timesheets`, `read_my_leave_balance`, `read_my_tasks`,
  `read_my_attendance`, `read_review_queue`, `read_employee_directory`,
  `read_departments` — and **no tool for request types** (nor for a leave
  balance computed from anything).
- There is **no entitlement/balance model** in the tree (only `RequestType`
  matched a balance/entitlement search). So "the org does not track balances" was
  literally true — the fix is to compute, not to claim.

## Backend lane (backend_engineer)

1. **`read_request_types`** (read, immediate): list the request types the caller
   may use, with `id`, `name`, and any code/leave flag the model has — so the
   assistant resolves «إجازة اعتيادية» by **name** and never asks the user for an
   id. If the table is empty, say that plainly **and** tell the user an HR/admin
   must define the types — never ask for a raw id.
2. **Seed the request types** so the feature is usable: a data migration (or a
   management command, documented) creating the ordinary set the app's own UI
   expects — at minimum an ordinary/annual leave type and a sick leave type,
   matching whatever the existing `RequestType` fields and the app's screens
   already assume. Read the app's own UI/API first and mirror it exactly; do not
   invent a second vocabulary.
3. **Answer the balance question with real numbers**: extend
   `read_my_leave_balance` (or add `read_my_leave_balance_for_type`) so it
   returns, per leave type: the entitlement, the days already taken from
   approved requests, and the remainder — computed from the data that exists.
   If an entitlement is not configured anywhere, return the used days and say the
   entitlement is not configured, instead of claiming the org does not track
   balances. Keep it the caller's own data (a manager must not see an employee's
   balance through the assistant unless their role allows it).
4. Keep the existing tests green — `pytest -q accounts/test_assistant.py
   accounts/test_assistant_subscription.py` currently **40 passed** — and add
   tests for the new tool(s) and the balance maths.
5. Prove with a live chat: ask «عندي إجازات قد اي» and «عايز آخد يوم إجازة اعتيادي
   بكرة» on the running server and paste the real responses — the first must
   carry real numbers, the second must resolve the type itself and return a
   pending action (never ask the user for an id).

## Frontend lane (frontend_engineer)

1. **Render the assistant's markdown** in the chat panel
   (`src/features/assistant/AssistantPanel.tsx`): at minimum **bold**, inline
   code, bullet lists, numbered lists, and line breaks — the model replies with
   `**…**` and `-` lists today and they show raw. Render safely: the text comes
   from a model, so build elements (or a tiny, dependency-light renderer) rather
   than injecting HTML; no `dangerouslySetInnerHTML` with unsanitised input.
2. Keep the transcript state, the confirmation card, the launcher behaviour, and
   the i18n as they are.
3. Verify with `npm run build:demo` (must pass `tsc -b`) and `npm run lint`, then
   a probe against `http://192.168.1.19:8080` that sends a message which makes the
   assistant answer with bold + a list, and asserts the DOM contains a `<strong>`
   (or equivalent) and **no** literal `**` in the rendered message. Screenshot it
   under `/home/menisy/.hermes/cache/scratch/h20-shots/`.

Neither lane commits, stages, or stashes. Report real command output; never fake
a result.
