# Brief C — the tasks cycle: create, assign, and route-to-manager

**You are working in an ISOLATED COPY of the repo at `/home/menisy/Desktop/Me/tracking_system_project-tasks`. Another agent is editing the main checkout at the same time. Do not touch the main checkout, do not push, do not fetch. Work and commit only here. Start writing code within your first 15 minutes.**

## Project

- Repo root (yours): `/home/menisy/Desktop/Me/tracking_system_project-tasks`
- Frontend: `frontend/` — React + TS + Vite, Arabic-first **RTL**, English secondary.
- Read these first, they are the patterns to follow: `frontend/src/app/AppContext.tsx` (all state + capabilities), `frontend/src/app/AppShell.tsx` (nav), `frontend/src/main.tsx` (routes), `frontend/src/mock/data.ts` + `frontend/src/mock/attendance.ts` (fixtures), `frontend/src/i18n/dict.ts` (**both** locales — AR ~300-520, EN ~840-1060), `frontend/src/screens/admin/AdminPeopleDetailPage.tsx` (how a screen + draft/save bar is built), `frontend/src/screens/admin/AdjustLeaveDialog.tsx` (a dialog).
- Design tokens only (`--sp-*`, `--surface-*`, `--text-*`, `--border-*`, `--radius-*`, `--font-size-*`) — see `frontend/src/styles/global.css`.
- Build: `cd frontend && npm run build:demo` (tsc -b + vite → `frontend/dist/`). **No new npm dependencies.**

## The cycle to build

The product owner's words, verbatim:

> عاوزين نضيف سايكل جديده عباره عن ان المدير يقدر يعمل تساكات ويعمل اساين لموظف عليها و يبقى عند المدير والاتش ار صلاحيات يقدروا يحددوا مين من الموظفين يقدر يعمل تاسكات ويبقى فيه اوبشن ينفع يعمل عليها اساين ولا لا ولو لا يبقى لازم لما يعمل التسكايه يضغط على زرار يختار مدير فتروح للمدير انه من ضمن شغله يعمل اساين لحد على التاسك دي

Decoded:

1. A **manager** can create tasks and assign an employee to them.
2. **Manager and HR** can each decide, per employee, **who is allowed to create tasks**.
3. There is also a second per-employee flag: whether they can **assign** a task themselves.
4. **If a creator cannot assign**: at creation they must **choose a manager** (a button/control to pick one), the task is routed to that manager, and **assigning someone to it becomes part of that manager's work**.

## Model

Two per-employee flags, both settable by a manager and by HR:

- `can_create_tasks: boolean`
- `can_assign_tasks: boolean`

Rules that must actually be enforced in the context, not just in the UI:

- Creating a task requires `can_create_tasks`. Otherwise the action is refused with an honest code (`CAPABILITY_DENIED`), and the UI does not offer it.
- Assigning (choosing the task's assignee) requires `can_assign_tasks`.
- If the creator **has** `can_assign_tasks`: the create dialog assigns the assignee directly.
- If the creator **does not**: the create dialog **requires picking a manager** (a select over managers), and the created task is routed to that manager in an **unassigned** state. It appears in that manager's **incoming / needs-assignment** list, and only someone with `can_assign_tasks` can put an assignee on it.
- A manager has both flags. **HR may hold both**, but check how the existing capabilities model treats HR before assuming — follow the codebase's convention rather than inventing a parallel one.
- The task creator is always recorded. The assignee, once set, sees it in their own task list.
- Reassignment after the fact: allowed for anyone with `can_assign_tasks` (record it; do not silently overwrite history).

## Task shape

Sensible minimum, extend only if the UI genuinely needs it:
`id`, `title`, `description`, `created_by`, `assignee | null`, `routed_to_manager | null`, `status` (`OPEN` / `IN_PROGRESS` / `DONE` / `CANCELLED` — justify any change), `priority`, `due_date?`, `created_at`, and an append-only trail of assignment events so the detail view can show who routed it and who assigned it.

## Screens

Follow the existing app's conventions for page structure, headings, empty states, and error surfacing (banners with real codes, never a fake success).

- **Tasks list** — the employee's own tasks, plus (for a manager) the tasks they created and their incoming needs-assignment queue. Tabs or sections are fine; make the needs-assignment queue impossible to miss.
- **Create task dialog** — shows the assign control when the creator can assign, and the **manager picker** when they cannot. If the picker is required and empty, the save is refused with a visible error.
- **Task detail** — the trail, the current assignee, the status.
- **Where the flags are set** — HR sets them from the existing employee file area; a manager sets them for their reports. Find the right surface in the existing code rather than inventing a new admin screen; if there is genuinely no good home, say so in your report and pick the closest one, and keep it consistent with how other per-employee settings are edited.
- **Nav** — add the entry in `AppShell.tsx` where the other sections live.

## Fixtures

Seed `frontend/src/mock/` with enough to exercise every path: at least one employee who can create **and** assign, one who can create but **cannot** assign (so they must route to a manager), one who cannot create at all, and a manager with an incoming unassigned task. Use the existing directory ids so names resolve.

## Hard constraints

- Enforce permissions **in the context**, next to the other mutations — the UI mirrors, it does not decide.
- Every new user-visible string in **both** Arabic and English.
- Keyboard accessible: dialog focus handling as the existing dialogs do, controls reachable and operable, visible focus.
- `npm run build:demo` clean, zero TypeScript errors.
- Commit in this checkout, with a message that explains **why**. Do not `git push`, do not merge, do not touch the main checkout.

## Verifying in the browser (this part needs care)

The demo you can see at `http://192.168.1.19:8000` serves the **main checkout's** build, not yours — so do not test against it, and do not rebuild the main checkout.

The app talks to a backend API on that same origin (`/api/v1/...`, cookie + CSRF). So to test **your** build end to end: serve your own `frontend/dist/` on a free port (e.g. `8020`) with a tiny node static server that **proxies `/api/*` to `http://127.0.0.1:8000`**, and drive headless Chrome over CDP against `http://127.0.0.1:8020`. Harnesses to read for the pattern: `/tmp/h2-name.mjs`, `/tmp/h2-part.mjs` in the main checkout (read-only). Sign in by clicking `.role-segmented-option` (e.g. «مدير» / «موارد بشرية») then `button.login-submit`.

If the proxy path does not work, **say so** and verify what you can at the type/unit level — do not claim a browser verification you did not run.

## Definition of done — prove it, do not describe it

1. `npm run build:demo` — real exit code.
2. A creator **with** assign rights: create a task, assign it, show it lands in the assignee's list.
3. A creator **without** assign rights: show the assign control is absent and the **manager picker is required**; create it; show it arrives in that manager's needs-assignment queue; show the manager assigns it; show the assignee now sees it.
4. Show a refused action surfaces the real code (`CAPABILITY_DENIED`) rather than a fake success.
5. An employee who **cannot create**: show the create action is not offered, and that the context refuses it if called anyway.
6. Print the real output you read at each step.

Report back: files changed, exact commands, their real output, anything you could not verify, and any decision you had to make that this brief left open.
