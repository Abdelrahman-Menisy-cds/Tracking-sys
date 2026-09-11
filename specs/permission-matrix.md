---
title: "Heya Fawda? — Permission Matrix"
status: approved
user_approval_date: 2026-09-11
traceability: [prd.md, _bmad-output/planning-artifacts/product/product-policy-decisions.md, specs/constitution.md]
---

| Capability | Employee | Manager | HR |
|---|---:|---:|---:|
| View/edit permitted own profile | Yes | Yes | Yes |
| Edit authoritative employee fields | No | No | Yes |
| Create/edit own Draft/Returned request | Yes | Yes | Yes |
| Read own request/timesheet history | Yes | Yes | Yes |
| Cancel own request before decision | Yes | Yes | Yes |
| Review active direct-report requests/timesheets | No | Yes | Yes, only when capability granted |
| Review organization requests/timesheets | No | No | Yes, visibility separate from action |
| Configure request types | No | No | Yes |
| Manage employees/reporting lines/roles/status | No | No | Yes |
| Own weekly timesheet entries | Yes | Yes | Yes |
| Approve/reject/return in scope | No | Yes | Yes, policy-gated |
| Substitute for manager | No | No | Yes, explicit reason and audit |
| Reopen Approved/Rejected timesheet | No | No | Yes, mandatory reason/confirmation/audit |
| View/download authorized attachments | Own | Direct-report scope | Explicit attachment-view capability |
| Team CSV reports | No | Yes | Yes |
| Organization CSV reports/audit export | No | No | Yes |
| Self-approve any workflow | No | No | No |

All list, detail, search, counts, dashboards, attachments, events, and exports use server-derived scope. Inaccessible objects disclose no existence (404 policy). HR is not superuser. Every decision is state- and capability-gated, transactional, version-checked, and audited.
