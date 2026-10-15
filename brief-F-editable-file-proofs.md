# Brief F — close the editable-file lane: prove the reload race, then prove the round trip

You are resuming your own work (`Build the editable employee file UI (HR admin)`). Your run was cut by the 150-iteration cap; the lead reviewed the uncommitted diff, verified it, and committed it (`2830f35`). The tree has moved since: the tasks lane and a prayer-notification fix landed in the same checkout, and `AppContext.tsx` now carries both. Read the current state before assuming anything.

What the lead already verified on your work — **do not redo it**:

- HR can open `/admin/people/e1`, change «الديانة» MUSLIM → CHRISTIAN, save, and the religion block disappears for that employee on the other screen. The closed loop works, so the gate and the override both function.
- `tsc -b` clean, build clean, the tree committed.

## 1. The reload race — prove it exists before anyone fixes it

You flagged "a reload race" and attributed it to the other lane. **That is a claim, not a finding.** Reproduce it first with real steps and real output:

- If it reproduces, give the exact sequence, the observed wrong value, and the mechanism in the code (what writes, what reads, and in which order), then fix it and leave a test that fails without the fix.
- If it does not reproduce, say so plainly and show what you measured. Do not invent a fix for a race you cannot show, and do not spend the run chasing it — the honest negative is the deliverable.

## 2. The round trip you never proved

Your own definition of done was "everything in the file is editable". The lead verified the religion gate only. Prove the rest:

- Edit several fields (name, phone, job title, department, manager, salary if you exposed it) as HR, save, **hard-reload the page**, and show the edited values are still there and that the read-only views reflect them.
- Show that an employee **without** `canManageDirectory` cannot reach the edit affordance.
- Show what happens on cancel (nothing changes) and that a validation failure does not silently persist.

## 3. Your flagged deviation — keep it, but make it visible

You removed the static `<dl>` block to avoid duplicated fields. Keep that decision; do not revert it. Just state it in your report so the product owner can look at the screen and object if they disagree. The lead is telling them.

## Environment notes that will save you time

- Serve your build on a port you have CONFIRMED is free (`ss -ltn | grep <port>`) — **8210 is held by another process**, and a server that fails to bind dies silently while its wrapper still reports a session. Compare the served bundle filename against your own `dist/` before trusting what you measure.
- Sign in against `http://192.168.1.19:8000` (serves the merged build) or rewrite `Origin`/`Referer` in any proxy you write — a mismatched origin gets a bare **403** from the backend that the UI reports as «البريد الإلكتروني أو كلمة المرور غير صحيحة». Two agents lost time to this on this project.
- `Input.dispatchMouseEvent` does **not** drive this app: the lead's control experiment clicked a known-good nav link and the route did not change. Do not build a verification on synthetic mouse input and then report the UI as broken.
- A controlled checkbox needs the native setter plus `click` + `change`, asserted in a **separate** evaluation against a side effect the app owns.
- `Page.navigate` is a full reload and resets in-memory state — but that is exactly what you must do to test persistence, so keep the two cases separate: in-app clicks for state that must survive navigation, a hard reload for state that must survive the session.
- Run with `--max-turns 400` — the default 150 is what cut your last run.

## Report

Files changed, exact commands, their real output, the race verdict (reproduced / not reproduced, with evidence either way), what you could not verify, and the deviation restated for the product owner.
