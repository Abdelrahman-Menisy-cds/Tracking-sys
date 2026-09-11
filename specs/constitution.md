# هي فوضى؟ Constitution

**Status:** Draft — requires user approval before application implementation.

## 1. Product boundary

**هي فوضى؟** (Franco / English-facing name: **Heya Fawda?**) is an Arabic-first
bilingual web application for employee requests, timesheets, approvals,
notifications, and role-scoped reporting. It is not an ERP, payroll, biometric
attendance, or generic workflow-builder product.

## 2. Architecture

Use a modular Django monolith with Django REST Framework and PostgreSQL, plus a
React/TypeScript/Vite frontend. Keep domain rules in server-side services. The
AI assistant, when implemented, must call those same services and cannot write
directly to the database.

## 3. Security and authorization

Authentication, role checks, ownership scope, manager reporting-line scope,
object access, list filtering, exports, and assistant tools are enforced on the
server. The client is never an authorization boundary. HR is an application role,
not synonymous with Django superuser.

## 4. Workflow integrity

State transitions are explicit, validated, transactional, and audited. Request
and timesheet histories are append-only. Rejection/return actions require a
comment. Submitted and approved timesheets are immutable unless an explicit,
authorized, audited reopen policy allows otherwise.

## 5. Data integrity

Use database constraints where possible and service validation where needed.
Canonical time duration is stored in minutes. Prevent invalid dates, overlapping
entries, duplicate weekly timesheets, invalid transitions, and reporting-line
cycles.

## 6. Testing standard

Every feature has focused backend and frontend tests. Security-sensitive behavior
gets positive and negative authorization tests. Critical user journeys are tested
in a real browser. A feature is not complete until the relevant checks pass and
the exact commands/results are recorded.

## 7. UX and accessibility

Arabic and English are first-class locales. RTL and LTR are tested, not inferred.
Every screen defines loading, empty, error, validation, disabled, success,
keyboard, mobile, and responsive behavior. Brand humor must not reduce clarity
or professionalism in approvals, permissions, and reports.

## 8. Appearance preference

The application supports `system`, `light`, and `dark` appearance preferences.
`system` is the default: it follows the operating-system `prefers-color-scheme`
setting. A signed-in user may explicitly select light or dark; the preference
must persist server-side and apply before the main UI renders, avoiding a visible
flash of the wrong theme. The interface must remain accessible in every mode.

## 9. Delivery discipline

BMAD artifacts are the planning authority; Git is the source of truth for code.
Use focused branches/worktrees and small commits. QA is a read-only release gate.
No deployment or external production mutation occurs without explicit approval,
verification, and rollback readiness.

## 10. Evidence and honesty

Do not claim an artifact, test, deployment, or integration is complete without
real tool output. State assumptions, blockers, and residual risks plainly.

## 11. Separation

This constitution, the project Team Rules, BMAD artifacts, project skills,
profiles, and memories belong only to Tracking-sys. Odoo Team Rules, skills,
memories, and repositories must remain separate and must not be edited by this
project workflow.
