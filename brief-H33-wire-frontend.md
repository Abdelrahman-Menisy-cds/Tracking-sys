# H33 — wire the demo screens to the real API (remove the frontend mock data)

The owner's requirement, and the reason the app "doesn't link": **16 screens
render hardcoded mock data and never call the backend.**

Verified in a real browser as `hr@acme.test` (HR of a brand-new company):
- `/api/v1/employees` → `{"data":[],"meta":{"count":0}}` — the API is correct.
- The HR panel still paints **11 invented employees** (كريم مصطفى، هالة عبد
  الرحمن، أحمد سعيد، نور الدين، سلمى فؤاد، طارق منصور، سارة حمدي، حسن فاروق،
  دينا زكريا، ماجد كامل …) with hours and «لسه مسجّلش» rows.
- The mechanism: `useMockList(() => mockFetch(...))` /
  `import { ... } from "../mock/data"` — a DIRECT read, no API call and no
  fallback. `src/mock/data.ts` is 968 lines of fake rows.

**Tenant isolation is already correct on the server** (H30 work, 651 tests
green). The screens just never ask it anything.

## Scope

The 16 screens importing `mock/data`, `mockFetch` or `useMockList`:

```
admin/AdminAnnouncementsPage.tsx   admin/AdminOverviewPage.tsx
admin/AdminPeopleDetailPage.tsx    admin/AdminPeoplePage.tsx
admin/AdminSettingsPage.tsx        admin/ScheduleEditorDialog.tsx
AttendancePage.tsx                 HomePage.tsx
MyRequestsPage.tsx                 MyTimesheetsPage.tsx
NotificationsPage.tsx              ProfilePage.tsx
RequestDetailPage.tsx              TaskDetailPage.tsx
TasksPage.tsx                      TeamReviewsPage.tsx
```

Replace each mock read with the real endpoint. The API already exists — do NOT
change the backend:
`auth/me`, `company`, `employees`, `employees/<id>`, `departments`,
`manager-grants`, `requests`, `requests/<uuid>`, `requests/<uuid>/attachments`,
`requests/<uuid>/submit|cancel|decision`, `review/requests/queue`,
`review/requests/<uuid>`, `review/timesheets/queue`, `review/timesheets/<uuid>`,
`reports/<category>/dashboard|rows|totals|csv`, `holidays`, `notifications`,
`assistant/config`, `assistant/chat`.

## Rules

- **The server already scopes every read to the caller's company.** The
  frontend must NOT filter by company, must NOT send a company id, and must
  never invent a client-side tenant. If a list comes back empty, the screen
  shows an honest empty state — **fake rows are exactly the bug being fixed**.
- Use the existing client in `src/app/api.ts` (it already handles the error
  envelope and CSRF). Do not add a second HTTP layer.
- Keep the visual design, layout and Arabic copy as they are. This is a wiring
  task, not a redesign.
- Remove `src/mock/data.ts` usage screen by screen; when no screen imports a
  mock module, delete the mock files (and any now-unused demo helpers) so the
  demo rows cannot come back.
- Keep the demo banner ONLY if something is still genuinely demo after the
  wiring; otherwise drop it.
- **Prove it:** `npm run check` (tsc) clean, `npm run build` succeeds, and for
  each wired screen state in the report which endpoint replaced which mock and
  what an empty response now renders.
- Do not commit, stage or stash. Do not touch port 8080.
- If a screen needs data no endpoint provides, **say so in the report** — do
  not invent a client-side computation to hide it.
