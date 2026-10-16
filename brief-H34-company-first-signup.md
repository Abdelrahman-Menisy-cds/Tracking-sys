# H34 — one-shot company registration (backend)

The owner's requirement, verbatim:

> عاوز الشاشه بتاعت بيانات الشركه تظهر قبل الشاشه دي بس تبقي ف اخرها فيلد كود
> التفعيل وبعدها لو تمم ينقلوا انه ينشأ اول حساب وهو الاتش ار وبكدا ننشأ شركه
> جديده في الداتابيز بعد م نتاكد ان كل حاجه تمم

So the flow becomes, in this order:
1. **Company data** first (name, activity, address, phone, …) with the
   **activation code as the LAST field on that same screen**;
2. then **the first account — the HR** (email + password);
3. and only once everything is valid, **the company is created in the DB**.

Today the order is the reverse (`POST /auth/signup` creates the HR and their
company first, then the app forces `/onboarding/company` because
`needs_company_profile` is true). That leaves a company in the DB when the
owner abandons the onboarding, and it makes the owner fill the company data
after the account already exists.

## What to build

Extend `POST /api/v1/auth/signup` (same URL; keep the existing body working so
nothing else breaks) to accept, in ONE transaction:

```
{
  "code": "<activation code>",
  "email": "<HR email>", "password": "...",
  "company": { "name": ..., "activity": ..., "address": ..., "phone": ...,
               "email"?, "website"?, "commercial_register"?, "tax_card"?,
               "contact_name"?, "contact_role"?, "contact_phone"? }
}
```

Behaviour:
- The code is validated FIRST (unchanged semantics: `invalid_code` is generic,
  the account lookup stays non-enumerating, password validators unchanged).
- The company is created **only after every field validates**: `Company` + a
  COMPLETE `CompanyProfile` for it + the founding `User(role=HR, company=…)`,
  all inside one `transaction.atomic()`. If anything fails, **nothing is
  written** — that is the whole point of the owner's ordering.
- The response must leave the caller signed in and with
  **`needs_company_profile: false`** (the profile arrived complete), so the
  frontend goes straight into the app with no onboarding step.
- A tenantless operator code still founds a NEW company (H30 §2.5, as shipped);
  a code bound to a company still joins that company — but joining with company
  data supplied is a contradiction: answer a clear 400 and write nothing.
- Required-field validation must reuse the SAME rules the company-profile view
  uses today (`company_serializers`), so the two paths cannot drift.

## Rules

- Do not change the existing response shape of the current 3-field signup.
- Do not touch the frontend (a separate task does the two screens).
- Tests: happy path (company + profile + HR + signed in + `needs_company_profile
  false`), each invalid field leaves **zero** new rows (assert counts), invalid
  code writes nothing, bound-code + company data → 400 and nothing written,
  duplicate email behaviour unchanged.
- `cd backend && pytest -o addopts=""` must stay green except the known
  env-driven cookie test (`accounts/tests.py::test_login_active_user_sets_authenticated_rotated_secure_session`,
  which fails only because the local `.env` sets
  `DJANGO_ALLOW_INSECURE_COOKIES=1`; the live service sends `Secure` + HSTS).
- Do not commit, stage or stash. Do not touch port 8080.
