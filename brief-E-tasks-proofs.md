# Brief E — finish the tasks cycle: correct one wrong premise, then prove the rest

You are resuming your own work (`Build tasks cycle create assign route-to-manager`). Your run was cut by the 150-iteration cap with everything uncommitted; the lead reviewed the diff, verified it, and committed it as `4c0d13c` on `feature/tasks-cycle`, then merged that branch onto the main line as `3a1d18b`. **The tree has moved since you last saw it** — the prayer/dhikr lane landed in the same checkout (`b3bcf3f`, `4fc85fb`) and the strings file was merged by hand. Read the current state before assuming anything.

What the lead already verified on your work, so do not redo it:

- `/tasks` and `/tasks/:taskId` render; all three roles see genuinely different views.
- The manager's **«بانتظار التكليف»** queue is real and holds a routed unassigned task («تحديث إرشادات الدعم الفني», created by أحمد سعيد).
- Pressing **«تكليف»** on that row opens a dialog whose copy states the rule, and confirming it moved the queue **1 → 0** and cleared «بدون تكليف» from the row.
- The capability table is seeded as briefed (`e1` create+assign, `e2` create only, `e3`/`e4` neither, `m1`/`hr1` both) and the refusals are enforced in the context.

## Your blocking diagnosis was wrong — do not carry it forward

You concluded **"the app consistently lands as the employee identity — the manager segment isn't taking effect"**. That is false. The lead signed in as «مدير» on the main checkout and got **هالة عبد الرحمن**, and captured both requests:

```
http://192.168.1.19:8000   POST /api/v1/auth/login → 200
through a naive proxy      POST /api/v1/auth/login → 403   (identical payload, identical CSRF token)
```

The backend rejects a mismatched **`Origin`/`Referer`** with 403, so any proxy that does not rewrite those two headers breaks login while the app is fine. The UI maps that 403 to «البريد الإلكتروني أو كلمة المرور غير صحيحة», which is what you saw.

So: **test against `http://192.168.1.19:8000`**, which now serves the merged build, or rewrite `Origin` and `Referer` to the upstream origin in your proxy. Do not spend another cycle debugging the login.

## What is still unproven

1. **Make the capability flags survive a reload, the way the employee-file overlay already does.** They live in `useState` today, so they vanish on reload — the page even advertises session persistence for the tasks themselves while the flags silently reset. Follow the app's own existing pattern for the employee-file overlay (session-scoped, not `localStorage`) rather than inventing a second mechanism, and keep the refusals in the context.
2. **Create + assign, end to end.** Sign in as «موظف» (`e1`, create + assign), create a task with an assignee, and show it lands in that assignee's own list. Print what you read at each step.
3. **The route-to-manager path through the UI.** With the flags now persisting, turn `e1`'s `can_assign_tasks` off (as HR or manager, from the employee file), sign in as «موظف», and show that the create dialog **no longer offers a direct assignee and requires picking a manager**, that the created task arrives in that manager's queue, and that the manager then assigns it. This is the product owner's core requirement and it has never been exercised.
4. **A refusal surfaces the real code.** With `can_create_tasks` off, show the create action is not offered, and that the context still refuses it with `CAPABILITY_DENIED` if called. A probe under `scripts/` that imports the capability table and asserts the refusal table is a good deterministic gate — and it must EXIT NON-ZERO on failure. (Use the repo's existing `node --experimental-strip-types` / `npx tsx` style; **do not add an npm dependency**.)
5. `npm run build:demo` — real exit code, and `tsc -b` clean.

## Environment notes that will save you time

- Serve your own build on a port you have CONFIRMED is free (`ss -ltn | grep <port>`) — **8210 is held by another process**, and a server that fails to bind dies silently while its wrapper still reports a session. Compare the served bundle filename against your own `dist/` before trusting what you measure.
- `Input.dispatchMouseEvent` does **not** drive this app: the lead's control experiment clicked a known-good nav link and the route did not change. Do not build a verification on synthetic mouse input and then report the UI as broken.
- What works for a controlled checkbox: set it through the native setter, dispatch `click` + `change`, then assert in a **separate** evaluation against a side effect the app owns (the persisted key), not against the DOM you just touched.
- `.notice-stack` belongs to the prayer feature; the demo banner is a different element that also carries `role="status"`.
- Sign in by clicking `.role-segmented-option` by its Arabic label, then `button.login-submit`.
- Run with `--max-turns 400` — the default 150 is what cut your last run.

## Report

Files changed, exact commands, their real output, what you could not verify, and any decision the brief left open. If something works but you could not prove it, say that instead of implying proof.
