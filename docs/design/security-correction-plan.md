هي فوضى؟ — Security Correction Plan

Status: corrective design only; no production source, tests, or existing documents changed
Branch reviewed: design/frontend-redesign-v2
Authority: docs/design/final-design-specification.md
QA evidence: docs/design/gpt55-premium-implementation-review.md

1. Purpose and boundary

This plan addresses only the QA blockers involving authorization boundaries, direct URL record access, client role switching, cross-role data leakage, mutation authority, stale-version conflicts, and unknown mutation outcomes. It deliberately does not prescribe the unrelated visual, focus, attachment, localization, or responsive corrections in the QA review.

The current frontend remains a mock-data visual demo until a separately authorized API-integration task. A demo fixture may illustrate role-specific screens and failure states, but it must never be presented as authentication or authorization. In an integrated build, Django/DRF is the authority for identity, active-account status, capabilities, scope, object visibility, workflow state, version, mutation result, and audit history. React may hide or show affordances for usability; it cannot grant authority. A later assistant must use the same Django services and checks.

Evidence qualification: the review artifact identifies the original commit's C1/C2/C3 and H1/H3 findings. Earlier inspection observed in-flight changes in AppContext.tsx and RequestDetailPage.tsx; those changes were not treated as a release or verification result and must pass the checks below. The branch state changed during review, so this plan does not infer authorship or approval from the current diff. No test or browser execution was performed for this plan.

2. Required invariants

1. Every read and command passes, in order where applicable: authenticated principal, active account, capability, ownership or approved reporting-line scope, object state/action legality, current reviewer/assignee or submission snapshot, expected version, and command-specific idempotency/confirmation requirements.
2. A direct URL is not a second access path. Its response must be computed from the same scoped query used by the linked list. A missing and an unauthorized identifier use the same safe unavailable/not-found behavior whenever existence disclosure is not authorized.
3. Counts, previews, lists, details, events, attachments, search, dashboards, and exports derive from one principal-scoped query policy. A client-supplied role, employee id, scope, status, version, reviewer, routing flag, or authoritative status is never trusted.
4. Personal work and review work are separate capabilities. A manager's own records never become direct-report records merely because the selected view says Manager. HR visibility never implies edit, decision, export, substitution, or reopen authority.
5. Every accepted state change is one server transaction containing the locked re-check, one legal transition, version increment, append-only domain event, audit event, and durable idempotency result. Notifications and other external effects occur after commit.
6. A 409 version conflict reloads the latest authoritative record and asks for a new decision. An unknown mutation outcome is neither success nor failure and is never replayed automatically.

3. Minimal frontend corrections for the demo build

These are the smallest changes that make the visual demo truthful without pretending to implement production authorization. They belong to the frontend implementation owner; they do not replace backend controls.

F1. Make personal and review routes independently scoped

Evidence: the QA review found that the original RequestDetailPage merged myRequests and teamRequests and disclosed r-2001 at /requests/r-2001. The current working tree now resolves this route from myRequestItems only; this is an uncommitted correction that must be verified, not assumed complete. TimesheetDetailPage and notification related-record links need the same treatment.

Correction:
- Personal /requests/:id and /timesheets/:id resolve only the selected demo identity's personal collection.
- Review detail uses a separate /reviews/... route and a separate review collection/capability fixture. Never fall back from one collection to another.
- An unknown, out-of-scope, or unavailable id renders the same neutral unavailable surface and does not render title, requester/employee, status, details, attachment metadata, timeline, counts, or a link that confirms existence.
- Notification links navigate only when the related-object availability field is true and the destination performs its own scope check; the link itself is not authority.
- Keep the route and query context when linking back, but do not put a role or permission decision in the URL.

Acceptance checks:
- Employee opening a manager request id and a random id receives indistinguishable safe content.
- Manager opening a personal-only id through /reviews and an unrelated team id through /requests receives the corresponding safe surface.
- No protected record or count appears during the loading phase.

F2. Bound role switching to a demo/test identity selector, not capability authorization

Evidence: AppContext stores role in React state and derives canReview from it; AppShell and LoginPage expose selectors. The current working tree adds DEMO_MODE and per-role roleData, which is directionally correct but is not a production authentication mechanism.

Correction:
- Compile or route the role/state controls only into an explicitly named demo/reviewer build (for example, Vite mode demo). Do not ship the selector in the production shell or production sign-in path.
- In demo mode, selecting a role selects a complete fixture identity: stable user id, personal records, review scope, notifications, and permitted demo actions. It must not mean “grant this capability to the current user.”
- In the future integrated provider, remove setRole from the authorization path. Bootstrap auth/me and capabilities before rendering protected navigation, labels, counts, records, or actions; render a neutral shell while unresolved.
- Treat server-returned per-record permission data as an affordance only. The server command must re-authorize even if the client has a stale can_decide=true.
- Do not use a browser-stored role or bearer token as authentication. Django session/CSRF integration follows the approved contract.

Acceptance checks:
- A production build contains no role selector, demo fixture controls, or client-derived review capability.
- In a demo build, role switching changes fixture identity and scope only; it cannot reveal records outside that fixture's declared collections.
- A capability-loading fixture does not flash review navigation, names, counts, or action buttons.

F3. Isolate demo state by fixture identity and prevent stale async writes

Evidence: the original QA review found provider-global personal records and notification state. The current working tree introduces a RecordData object keyed by role, but asynchronous callbacks still close over the selected role and mutations are not versioned or guarded against an identity change during the delay.

Correction:
- Keep all mutable demo collections under a stable fixture identity key, not under a mutable global list. Initialize each identity from an immutable deep-cloned fixture so one identity's edits cannot mutate another identity's baseline through shared references.
- On role/fixture identity change, cancel or invalidate in-flight demo reads and mutations. A response created for identity A must not write to identity B after a switch.
- Give each fixture identity its own personal requests, personal timesheets, review queue, and notifications. Do not use empty arrays as an implicit statement of authorization unless the fixture explicitly models “no records.”
- Record the actor identity in every demo event and bind a command to the identity that opened the record. A role switch while a dialog is open must close or invalidate that dialog.

Acceptance checks:
- Create a request, submit a timesheet, decide a review record, and mark a notification read as each demo identity; switch identities during and after each operation; no state, actor, title, unread count, or timeline event crosses identities.
- A late response from the prior identity changes neither the active identity's records nor its notifications.

F4. Make demo mutations explicitly authoritative within the fixture and truthful on failure

Evidence: the original review found local review decisions that did not refresh the pending queue and did not model conflict/unknown outcomes. Current code now returns a local record for some actions, but review decision errors still collapse into a generic error and permit the confirm path to be replayed.

Correction:
- Model mutations as a typed fixture boundary returning an authoritative record, not as direct component state edits. The returned record must include status, version, permitted actions, next stage, and appended event data.
- Disable all duplicate activation while submitting. After confirmed review, remove the item from the pending queue by re-running the same scoped pending query, preserve tab/filter state, and show the returned result before closing or moving focus.
- Add explicit demo outcomes for `version_conflict` and `unknown_outcome`. A conflict replaces the stale record with the latest fixture record and requires a new intentional choice. Unknown outcome says confirmation was not received, marks the record as needing refresh/reconciliation, and does not invoke the mutation again.
- Do not label a local update “server confirmed.” Demo copy must say non-persistent fixture transition; integrated copy may claim success only after a 200 response containing the authoritative result.

Acceptance checks:
- Approve, reject, and return each produce one visible authoritative fixture result and remove the pending item from the queue.
- A conflict provides Refresh/reconsider, does not append an event, and does not replay the choice.
- An unknown outcome provides Refresh/reconcile, does not claim success or failure, and does not automatically retry.

4. Backend-required corrections before API integration or production

B1. Establish one capability and scope policy used by every read and command

Current positive controls: owner-scoped request and timesheet list/detail helpers return safe 404s; review queues scope before filtering/counting/pagination; notification related-object availability is checked against the viewer; review commands re-check authorization under a row lock; report outputs use one scope/filter source.

Required correction:
- Expose explicit server capability data from the authenticated identity (at minimum personal requests, personal timesheets, notifications, review requests, review timesheets, each organization visibility capability, each administration capability, reports, exports, substitution, and reopen). Do not make role equality the only client contract.
- Make one policy object/function answer “may view this object” and “may invoke this action.” Keep read visibility and command authority distinct where policy requires it, but make the distinction explicit and testable. `permissions.can_decide` must never claim more than the command service will accept.
- Resolve the manager policy discrepancy before release. Current review reads use the current active direct-report relationship, while request decision services use `manager_at_submission`; timesheet decisions use the current profile relationship. This can show an action in one surface and deny it in another. Recommended minimum: document the approved transfer rule, then use the same policy for queue, detail, permission flags, and command re-check; add cases for manager change, inactive manager, inactive reviewer, HR requester, and self-review. Do not silently widen to hierarchy or organization scope.
- Keep HR read visibility separate from HR decision/edit/export/reopen capabilities. A visible organization record must serialize no action unless that specific capability and current state grant it.

B2. Scope the target before returning or mutating it, including command endpoints

Evidence: review GET detail endpoints correctly filter a scoped queryset first. In contrast, RequestDecisionView and the timesheet decision/reopen views initially fetch by unscoped primary key and rely on the service's later locked authorization check. No unauthorized representation is currently returned, but this violates the approved “scoped lookup before mutation” boundary and makes future changes unsafe.

Correction:
- Change command entry points to pass the principal and opaque id to a service that resolves the target through the appropriate scoped queryset and then locks that row; or perform a scope query before obtaining the instance and re-check it under `select_for_update()`.
- Preserve uniform disclosure: out-of-scope and nonexistent objects return the same safe 404 envelope where the permission matrix requires no existence disclosure. Self-decision remains explicitly denied according to the approved disclosure policy without applying the transition.
- Apply parent scope first for events and attachments, and fresh parent scope again for download. Never authorize an attachment or event from its id alone.

Required negative tests:
- Employee, unrelated manager, former manager, inactive reviewer, and HR without the relevant capability cannot read or mutate an object by guessed URL, altered filter, event id, attachment id, or idempotency key.
- The response body, status semantics, timing budget, and counts do not disclose the hidden object's title, owner, status, or existence.

B3. Make every retryable command idempotent in the same transaction as the transition

Evidence: decision and timesheet command services place idempotency lookup/insert with the locked transition. Request submission is different: RequestSubmitView looks up `SubmissionIdempotencyRecord` by globally unique `key_hash`, calls `submit_request`, and records the idempotency snapshot afterward. A concurrent or connection-lost submission can therefore have a committed transition before its key record exists; the global key lookup can also expose a stored response if another user presents the same key.

Correction:
- Scope request-submission idempotency by authenticated user, endpoint/command, and key; use a database uniqueness constraint on that scope. Do not perform a global key-only lookup or return another user's snapshot.
- Move idempotency lookup, version/state validation, transition, domain event, audit event, and response snapshot into one locked atomic transaction, following the decision/timesheet pattern. A same-key/same-payload request replays the stored safe response; a different payload returns `409 idempotency_conflict`.
- Apply the same endpoint/user scoping rule to every future create, submit, decision, cancel, reopen, upload, and assistant command. Retain only minimum safe response metadata.
- The first request may still produce an unknown client outcome after commit. Reconciliation must use GET and the durable idempotency record; it must never infer failure from a timeout or blindly repeat the mutation.

B4. Enforce server-owned fields and state transitions at both serializer and service boundaries

Current controls are useful: serializers reject client-supplied status, manager, assignee, and protected fields; request routing reads RequestType and the manager snapshot server-side; timesheet changes use locked version checks; reject/return reasons are validated; self-approval is denied.

Required correction:
- Preserve the explicit field allowlists and ensure every new endpoint has one. Client input may contain only command data, expected version, explicit confirmation where required, and idempotency key in the header.
- Re-read role, active status, reporting line/snapshot, request type routing, object status, and version inside the locked service transaction. Never rely on a serializer, cached `User`, `can_decide` flag, or prior GET.
- Return stable errors: `401` unauthenticated, safe `404` for undisclosed scope, `403` for an authenticated capability denial where disclosure is allowed, `409 version_conflict` for stale state, `409 state_conflict` for an illegal current transition, and `422` for command validation. Every error includes the request id and no unauthorized object data.
- Do not allow HR role or Django superuser status to bypass application capability checks. Break-glass operations, if later introduced, need a separate audited policy.

B5. Define the reconciliation contract for stale and unknown outcomes

API response contract:
- `409 version_conflict`: `{error: {code, message, fields: {version: [...]}, request_id}}`; no state change. The client must GET the scoped record, replace its stale view with the returned/latest record, preserve safe user-entered reason text where possible, and require a new intentional command.
- `409 state_conflict`: the record is no longer eligible for that action; refresh the scoped record and remove it from the pending queue if appropriate. No automatic replay.
- `200` command success: `{data: authoritative_record}` including current status, version, permitted actions, next stage where disclosure is allowed, and append-only history needed by the UI.
- Unknown network outcome: the client says confirmation was not received and performs a read/reconcile operation only. It must not manufacture a success/failure state and must not resend the mutation without a new user action.

Backend requirements:
- Every mutation has an idempotency record or an equivalent reconciliation key committed atomically with the business result.
- Audit and domain event rows are written exactly once for a committed transition. A retry after an unknown outcome returns the original safe result, never a second event.
- If a required audit insert cannot commit for a critical transition, the business mutation rolls back. Post-commit notifications cannot roll back the transition and are retried independently.

Frontend demo requirements:
- Add deterministic fixtures for stale version, state conflict, transport timeout after commit, and transport timeout before commit. The before/after-commit distinction must be resolved by refresh, not guessed from the exception.
- Keep valid comment/form values through all four outcomes. The confirm control is disabled during submission and cannot be activated from the unknown/error state without an intentional reconcile path.

B6. Audit authorization outcomes without creating a data-leak channel

For every accepted request/timesheet command, atomically audit actor, subject, action, from/to status, versions, request id, source channel, and safe metadata. For denied commands, audit the denial at an appropriate rate without putting hidden record details in the caller response or unbounded logs. Never record passwords, session/CSRF tokens, authorization headers, attachment bytes, or unrestricted comments. Audit idempotency replay as a replay outcome only when policy requires it; it must not expose another actor's snapshot.

5. Minimal API/query contract to hand to frontend integration

Authentication bootstrap:
- `GET /api/v1/auth/me` returns the authenticated active identity and server-composed capabilities before protected UI renders.
- `POST /api/v1/auth/logout` invalidates the session; inactive accounts cannot continue commands.

Personal queries:
- `GET /api/v1/requests` and `GET /api/v1/timesheets` return only owner-scoped records.
- `GET /api/v1/requests/{id}` and `GET /api/v1/timesheets/{id}` use the same owner scope and safe 404 behavior as their lists.

Review queries:
- `GET /api/v1/review/requests/queue` and `/timesheets/queue` scope before filters, count, pagination, and serialization.
- Review detail uses the same scope policy as its queue. A read-only record has no decision action merely because it is visible.

Commands:
- Request submit, request decision/cancel, timesheet submit/decision/reopen, and entry edits take an expected version and required idempotency key where defined. They return an authoritative record or a stable conflict/validation envelope.
- Command authorization is re-evaluated at execution time; a frontend-generated employee id, role, status, assignee, or permission flag is ignored or rejected.

Derived outputs:
- Dashboard counts, previews, reports, CSV exports, events, and attachments reuse the same scope context and rerun authorization at execution/download time. Export permission is separate from read permission and remains bounded to 10,000 rows.

6. Verification matrix and release gate

The following must pass before API integration is accepted, and the demo must cover the frontend rows marked Demo:

| Area | Employee | Manager/direct report | HR | Required result |
|---|---|---|---|---|
| Personal list/detail URL | own only | own only | own only | hidden ids are safe unavailable/404 |
| Review list/detail URL | no review surface | approved scope only | independently granted scope only | same scope for queue, detail, count, and action |
| Direct URL to another role's record | denied | denied when outside policy | only with explicit visibility capability | no title, status, timeline, attachment, or existence leak |
| Client role switch | Demo fixture only | Demo fixture only | Demo fixture only | never changes production authority |
| Review decision | no | permitted object/state only | policy-gated object/state only | server re-check, one event, one audit, version increment |
| State/version stale | Demo + API | Demo + API | Demo + API | 409/reconcile; no replay |
| Timeout/unknown result | Demo + API | Demo + API | Demo + API | refresh/reconcile only; no claim or automatic retry |
| Idempotency key reuse | own command scope | own command scope | own command scope | same payload replay; different payload 409; no cross-user snapshot |
| Notifications/related links | recipient only | recipient only | recipient only | availability is recalculated for current viewer |
| Reports/exports | denied | only explicit team/report capability | only explicit organization/report capability | same scoped query, bounded and audited |

Automated/API tests:
- Role × endpoint × action × object scope for active, inactive, anonymous, self, unrelated manager, former manager, and HR-without-capability users.
- Guessed request, timesheet, review, event, attachment, notification, report, export, and idempotency-key identifiers.
- Concurrent same-key and different-key commands; connection loss after commit; exactly one transition/event/audit row.
- Stale version after a second writer; current authoritative response; no automatic replay; safe preservation of entered reason.
- Changed reporting line and manager deactivation between GET and command; queue `can_decide` and command result remain consistent with the approved policy.
- Altered status, version, role, requester, employee, manager, assignee, routing, and permission fields are rejected without mutation.

Frontend/demo checks:
- Employee direct navigation to manager request `r-2001` and an unknown id; manager/HR navigation to personal ids through review URLs; notifications pointing to unavailable records.
- Switch identity during list load, detail load, form submission, decision submission, and notification update; no late response crosses the identity boundary.
- Review success removes the pending row and recomputes count from the same scoped fixture query.
- Conflict and unknown fixtures never show a false success and never replay a command.

Release gate:

Do not approve API integration or production deployment until the backend tests prove the scope and idempotency corrections, the frontend build proves the demo boundary and identity isolation, and a real-browser matrix verifies no protected content flashes while capabilities resolve. Passing lint/build alone is insufficient evidence for these security contracts.

7. Trade-offs and residual risk

A safe unavailable surface sacrifices helpful “record not found” specificity for confidentiality; this is the correct trade-off for undisclosed objects. Server-composed capabilities and repeated scope checks add query and implementation complexity, but prevent a client role switch or guessed URL from becoming an authorization path. Transactional idempotency can retain response metadata and increase database work; that cost is accepted to make retries and transport failures safe.

The visual demo cannot prove Django authorization, CSRF, session invalidation, PostgreSQL locking, or real network unknown outcomes. It can only prove that the UI does not imply authority, leak fixture data across identities, or replay modeled failures. Those properties remain backend and integration release gates. Manager transfer/substitution semantics are still policy-sensitive; until one rule is approved and shared by queue/detail/command policy, manager-decision behavior remains release-blocked.

Handoff

Objective: implement the minimal frontend demo-boundary corrections and backend authorization/idempotency corrections above, then return to QA with reproducible evidence.

Files/artifacts: docs/design/security-correction-plan.md

Evidence used: docs/design/gpt55-premium-implementation-review.md, docs/design/final-design-specification.md, frontend route/context/mock files, backend auth/permission/query/service/view/serializer/model files, and specs/permission-matrix.md.

Next owner: frontend_engineer for F1–F4; backend_engineer for B1–B6; qa_reviewer for the verification matrix; release_operator for the release gate. No commit is requested by this plan.

OBSERVATION: The repository-root TEAM_RULES.md is absent; the project profile rules at /home/menisy/.hermes/profiles/architect_security/TEAM_RULES.md were used → preserve this explicit evidence note in future security handoffs rather than treating the missing repository file as approval.