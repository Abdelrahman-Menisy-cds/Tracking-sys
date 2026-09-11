---
title: "هي فوضى؟ / Heya Fawda? — Product Brief"
status: approved-baseline-with-open-policy-decisions
created: 2026-09-11
updated: 2026-09-11
workflow: BMAD BMM product-definition fast path
owner: product_lead
---

# هي فوضى؟ / Heya Fawda?
Employee Operations · Tracking-sys only

## Evidence and decision status
This brief synthesizes the local sources below; it is not an approved implementation contract. The PDF is challenge input, not unquestionable policy. No interviews, pilot results, market validation, or application tests are claimed.

- [S1] `docs/PROJECT_CONTEXT.md`, Product and Rules: names, Arabic-first bilingual website, project separation and approval gate.
- [S2] `specs/constitution.md`, §§1–11: draft product, authorization, integrity, accessibility, appearance and delivery constraints; constitution still requires approval.
- [S3] `.hermes/plans/2026-09-10_021026-employee-operations-blueprint.md`, §§1, 4, 5, 8–10: locked choices, proposed scope/workflows, deferrals and open decisions.
- [S4] `Employee_Requests_and_Time_Tracking_System.pdf`, pp.2–7: problem, roles, modules, journeys, quality and delivery; pp.8–12: challenge schedule and evaluation. All 13 pages were extracted with Poppler; the final page contains only its page number.
- [S5] `/home/menisy/.hermes/profiles/product_lead/TEAM_RULES.md`, rules 2, 8–12: approval gates, security ownership and handoff discipline.

User-locked names remain exactly **هي فوضى؟** and **Heya Fawda?**; do not translate the product name literally. BMAD BMM supersedes the PDF's SpecKit-led process; accepted requirements retain SpecKit-compatible traceability in `specs/`. Arabic-first with a complete English switch, RTL/LTR, and System/Light/Dark appearance (System default; signed-in override persisted server-side before main UI rendering) are established project choices. Architecture/security ownership remains with `architect_security`. [S1; S2 §§2–3,7–9; S3 §§1,5]

## Problem, value proposition and intended outcomes
Fragmented requests and time reporting obscure ownership, pending decisions and recorded hours. Employees need a clear submission/status path; managers need a scoped review queue; HR needs consistent organization-wide oversight. [S4 pp.2–3]

Heya Fawda? brings requests, weekly timesheets and accountable decisions into one secure, Arabic-first workspace: employees can see what happens next, managers can act on their team's pending work, and HR can inspect consistent histories and summaries. The value is clarity and traceability, not surveillance or automated personnel judgment. [S3 §4; S4 pp.2–4]

[ASSUMPTION A1] The initial pilot serves one organization with an established employee-to-manager reporting structure. Organization size, sponsor, current tools and rollout cohort are unvalidated. Proposed outcome measures are submission completion, submission-to-decision elapsed time and correction/resubmission rate. Baselines and numerical targets require user agreement; no productivity improvement is claimed yet.

## Actors and access boundary
| Actor | Need and proposed access |
|---|---|
| Employee | Secure sign-in, own permitted profile fields, own request drafts/attachments/history and personal timesheets/hours. |
| Manager | Employee self-service plus direct-report requests, decisions, timesheet review, team dashboard and scoped CSV reports. |
| HR | Employee/reporting-line/role/account administration, request-type configuration, organization-wide requests, timesheets and reports; HR is not Django superuser. |

Source: S3 §§4.1–4.2; S4 pp.2–3. Server-side scope applies equally to lists, details, attachments, search, counts, dashboards and exports. [S2 §3]

[ASSUMPTION A2] Retain direct-report-only manager scope for MVP, as described in the PDF and proposed matrix; the master plan §9 still lists hierarchy scope as open. HR visibility does not by itself authorize overrides, employee-record edits or self-approval; those decision rights require approval.

## MVP boundary
Included for the first coherent release, subject to approval of the unresolved policies:
- Authentication/sign-out, own profile, inactive-account handling; HR employee and reporting-line administration; server-enforced role and ownership scope.
- Request types, draft creation/editing, supporting attachments, submission, manager review and conditional HR review, visible status and append-only history. Reject/return requires a comment.
- Weekly timesheets with daily time entries, draft/returned editing, submission, manager approval or correction return and history. Submitted/approved records are read-only absent an approved audited reopen policy.
- Role-scoped dashboards; search/filter/sort/pagination; in-app submission/decision notifications; hours and request summaries with scoped manager/HR CSV exports.
- Responsive, keyboard-accessible Arabic/English journeys and explicit loading, empty, error, validation, disabled and success states; all appearance modes.

Sources: S3 §§4.3–4.6; S2 §§3–8; S4 pp.3–5. API documentation, health checks, automated authorization/journey tests and deployment documentation are delivery requirements, not extra user-facing modules. A later release needs a verified live URL and demo access for each role; this brief does not authorize deployment. [S3 §§4.5,4.9; S4 pp.5–7; S5]

## Core user journeys
1. Employee request: sign in → choose an active request type → save details and permitted attachments → submit → see status and responsible reviewer → receive the decision. A returned request includes a reason and can be corrected/resubmitted; HR reviews only when the approved type policy requires it. [S3 §4.3; S4 p.4; A3 below]
2. Manager decision: open scoped pending work → inspect the request and history → approve, reject or return with the required comment → employee sees the updated status; a conditional HR step is not presented as final approval. [S3 §§4.2–4.3]
3. Employee time reporting: open a weekly draft → enter daily time and review totals → submit → entries become read-only → manager approves or returns with a correction reason → employee corrects and resubmits returned work. [S2 §§4–5; S3 §4.4]
4. HR oversight: maintain employees, reporting lines and request types → inspect organization-wide pending work → handle authorized HR review → filter and export request/hour summaries. Visibility and decision authority remain distinct. [S3 §§4.1–4.2; S4 p.3; A2–A3]

## Starter stories and testable acceptance criteria
These seed the PRD; they are not a complete approved story backlog or executed test results.

| Story | Acceptance evidence required |
|---|---|
| As an employee, I can track my request without exposing a colleague's records. | Given a valid own draft, submission records the new state and actor/time history. Another employee cannot read or change it through details, lists, attachments or exports. [S2 §§3–4] |
| As a reviewer, I can issue an accountable decision. | Reject/return without a comment fails without changing state; an authorized valid decision records actor, timestamp and transition. A manager outside the approved reporting scope cannot decide. Conditional HR routing follows the approved type policy, not client input. [S3 §4.3; A2–A3] |
| As an employee, I can submit reliable weekly hours and correct returned work. | Duplicate employee/week containers, invalid dates, negative durations and overlapping entries are rejected; totals use canonical minutes. Submitted/approved entries cannot be edited; a returned sheet can be corrected and resubmitted with preserved history. Time-boundary cases await A5. [S2 §§4–5; S3 §4.4] |
| As a manager or HR user, I can trust the scope of a report. | Applying identical filters yields consistent list/summary/export scope; another manager's employees never appear in a manager's results. Employee access to organization reports is denied. [S2 §3; S3 §4.9] |
| As an Arabic- or English-speaking user, I can complete the same core tasks. | Request submission and timesheet correction are exercised by keyboard on mobile and desktop in RTL and LTR; loading/error/empty/success states are checked. System follows OS appearance and a saved explicit override applies before main UI rendering. [S2 §§7–8] |

## Non-goals and deferred scope
Not an ERP, payroll engine, biometric/kiosk attendance system or generic workflow builder. Defer leave accrual/balances, projects/cost codes, broad employee document management, scheduled/advanced analytics, email/SMS/push, SSO/MFA, native mobile apps, multi-tenancy and real-time sockets. The voice/text AI assistant is a late feature, not part of the core MVP. A leave request type, if approved, does not imply an entitlement engine. No new architecture choices or application code are part of this phase. [S2 §1; S3 §§4.6,8]

## Unresolved rules and focused approval questions
Every assumption below is provisional and requires explicit user approval before becoming a product contract.

- [ASSUMPTION A3] Manager-first review with HR approval determined by request type is the working flow. Which launch types need HR? What happens for no manager, absent/inactive reviewers, a changed manager or a request by a manager/HR user? Can HR substitute for a manager, and how is self-approval prevented? Submission-time manager snapshot is proposed in S3 §4.3; reassignment semantics are not settled.
- [ASSUMPTION A4] Use correction return rather than a separate terminal timesheet rejection in the draft journey. S4 p.3 and S3 §4.5 mention rejection, while S3 §§4.4,4.8 omit it. Is terminal rejection required? Pending approval, assume no cancellation after submission and no reopening approved records; who may cancel/reopen, from which states and with what audit reason?
- [ASSUMPTION A5] Weekly containers and canonical minutes are the baseline, not a complete time policy. Approve week start, authoritative timezone, overnight/DST handling, breaks, rounding, daily limits and overlap validation for duration-only input before detailed acceptance criteria are finalized. No values are invented here.
- [ASSUMPTION A6] Attachments are required but cannot launch without an approved file-type/size policy, download scope and retention/deletion policy. Which supporting documents are expected, and may returned/submitted attachments be changed? Profile edit fields and employee-data retention also need agreement.
- [ASSUMPTION A7] The PDF's final judging date of 5 October 2026 is a planning input, not a newly accepted delivery promise. Does that schedule still bind this project? Confirm pilot owner/cohort, success targets and deployment target. [S4 pp.8,12]

## Risks and next handoff
- Authorization leakage or ambiguous HR overrides: require an approved role/action/scope matrix and negative access tests before implementation. Owner: architect_security, with business authority confirmed by the user.
- Workflow contradictions and time-policy gaps: resolve A2–A5 before state-machine/API contracts; do not silently fill gaps. Owner: product_lead + user.
- Sensitive attachments and workforce data: approve A6 and obtain security review before upload implementation. Owner: user + architect_security.
- Scope/schedule pressure and unvalidated adoption: keep deferred features out, confirm A1/A7 and baseline outcomes with the pilot sponsor. Owner: product_lead + user.
- Arabic/English parity and appearance regressions: UX must specify both directions and all states; QA verifies real journeys. Owner: ux_brand_designer, then qa_reviewer.

OBSERVATION: S3 §3 still says BMAD is missing although §10 records installation; S3 also mixes timesheet rejection into scope without defining its transition → use the installed workflow and surface the policy conflict for approval; no shared guidance was silently edited.

Handoff objective: obtain user approval of this brief, the draft constitution and unresolved business rules; then produce the PRD, permission matrix, state machines and complete acceptance criteria with traceability into `specs/`. Next owners after approval: ux_brand_designer for bilingual journeys/brand direction and architect_security for authority boundaries and architecture contracts. No external handoff, implementation authorization, commit, deployment or test-pass claim is implied by creating this draft.
