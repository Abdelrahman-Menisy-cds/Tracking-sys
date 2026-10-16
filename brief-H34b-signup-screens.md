# H34b — the company-first signup screens (frontend)

The owner's requirement, verbatim:

> عاوز الشاشه بتاعت بيانات الشركه تظهر قبل الشاشه دي بس تبقي ف اخرها فيلد كود
> التفعيل وبعدها لو تمم ينقلوا انه ينشأ اول حساب وهو الاتش ار وبكدا ننشأ شركه
> جديده في الداتابيز بعد م نتاكد ان كل حاجه تمم

## The flow to build

Replace today's order (signup → then a forced `/onboarding/company` gate) with:

**Step 1 — بيانات الشركة**, the same fields the company-profile form already
has (name, activity, address, phone required; email, website, commercial
register, tax card, contact name/role/phone optional), with
**the activation code as the LAST field on this screen** — not on a separate
screen.

**Step 2 — أول حساب (الـHR)**: email + password (and the same validators the
current signup screen already surfaces).

Submitting step 2 posts everything to `POST /api/v1/auth/signup` in one call:

```json
{ "code": "...", "email": "...", "password": "...",
  "company": { "name": "...", "activity": "...", "address": "...", "phone": "...", ... } }
```

The backend task (H34) is adding that body to the same endpoint: it validates
the code first, then creates the Company + a COMPLETE CompanyProfile + the
founding HR user in ONE transaction, and answers signed-in with
`needs_company_profile: false`. Build against that contract; if the backend is
not there yet when you test, say so in the report rather than working around it.

On success the app goes **straight to `/`** — no onboarding screen, because the
profile arrived complete. Keep the existing `/onboarding/company` route working
for any account whose profile is still incomplete (legacy/partial data), but it
must no longer be on the new-signup path.

## Rules

- Keep the design, layout and Arabic copy. This is a flow change, not a
  redesign.
- Reuse the existing company-profile form component/validation if one exists —
  do not duplicate the field rules.
- Errors must map to the field that caused them: an `invalid_code` answer
  belongs on the code field (step 1), a weak password on the password field
  (step 2). Never a generic network message (that bug was fixed once already in
  `SubscriptionPanel`/`api.ts` — do not reintroduce it).
- Verify with `npm run lint` and `npm run build` (there is no `npm run check`).
- Do not touch the backend. Do not commit, stage or stash. Do not touch port 8080.
- Report: the two screens' files, how a field error reaches its field, and what
  an invalid code renders.
