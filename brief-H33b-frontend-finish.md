# H33b — finish wiring the demo screens (14 files left) + fix TeamReviewsPage

The previous run (26 min, ended early) wired 5 screens and added
`src/app/requestsApi.ts`, `timesheetsApi.ts`, `notificationsApi.ts`,
`format.ts`, `serverTypes.ts`. **It also left `TeamReviewsPage.tsx` broken** —
its own last note says "SafeReviewUnavailable definition got cut off at the end
(the shim removal ate it)". Fix that FIRST; the file must compile.

## Verification commands (the previous brief named a script that does not exist)

`frontend/package.json` has: `dev`, `build`, `build:demo`, `lint`,
`check:contrast`, `probe:hr`, `preview`. There is **no `npm run check`**. Use:
- `npm run lint` — type/lint gate
- `npm run build` — must succeed

## Still importing the mock (14 files) — finish these

```
admin/AdjustLeaveDialog.tsx        admin/AdminAnnouncementsPage.tsx
admin/AdminOverviewPage.tsx        admin/AdminPeopleDetailPage.tsx
admin/AdminPeoplePage.tsx          admin/AdminSettingsPage.tsx
admin/adminShared.tsx              admin/ScheduleEditorDialog.tsx
AttendancePage.tsx                 HomePage.tsx
MyRequestsPage.tsx                 ProfilePage.tsx
TaskDetailPage.tsx                 TasksPage.tsx
```
(MyRequestsPage was touched but still imports the mock — check it.)

Endpoints available (backend is done; do NOT change it): `auth/me`, `company`,
`employees`, `employees/<id>`, `departments`, `manager-grants`, `requests`,
`requests/<uuid>`, `requests/<uuid>/attachments`, `requests/<uuid>/submit|cancel|decision`,
`review/requests/queue`, `review/requests/<uuid>`, `review/timesheets/queue`,
`review/timesheets/<uuid>`, `reports/<category>/dashboard|rows|totals|csv`,
`holidays`, `notifications`, `assistant/config`, `assistant/chat`.

## Rules (unchanged, and they matter)

- The server already scopes every read to the caller's company. The frontend
  must NOT filter by company, must NOT send a company id, and must never invent
  a client-side tenant. An empty list renders an honest empty state — fake rows
  are the exact bug being removed.
- Use the existing client in `src/app/api.ts` and the new `*Api.ts` modules.
  Do not add another HTTP layer.
- Keep the design, layout and Arabic copy. Wiring, not redesign.
- When no screen imports a mock module any more, delete `src/mock/*` so the
  fake rows cannot come back.
- Do not commit, stage or stash. Do not touch port 8080.
- **Report per screen**: which endpoint replaced which mock, and what an empty
  response renders. If a screen needs data no endpoint provides, say so.
- **Work in small batches and keep the tree compiling** — do not leave a file
  half-edited like last time. Run `npm run lint` after every 3–4 screens.
