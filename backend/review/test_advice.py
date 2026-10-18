"""«رأي المساعد» tests: the rule verdict is always present; the prose is optional.

The verdict is derived by deterministic rules over existing data; the Arabic
explanation is the assistant's and must be marked ABSENT (never fabricated)
when no assistant is configured. Coverage is a WARNING, never a veto.
"""
from datetime import date

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Department, EmployeeProfile, User
from leavebalances.models import LeaveBalance
from reqs.models import EmployeeRequest, RequestType
from review import advice
from tenants.context import default_company

YEAR = timezone.now().year


def _mk_user(email, role=User.Role.EMPLOYEE, **kw):
    return User.objects.create_user(
        company=default_company(), email=email, password="pass-12345678", role=role, **kw
    )


class AdviceBase(TestCase):
    def setUp(self):
        company = default_company()
        self.company = company
        self.manager = _mk_user("adv-mgr@example.com", role=User.Role.MANAGER, full_name="مدير القسم")
        self.employee = _mk_user("adv-emp@example.com", full_name="موظف")
        self.colleague = _mk_user("adv-col@example.com", full_name="زميل")
        self.colleague2 = _mk_user("adv-col2@example.com", full_name="زميل٢")
        self.manager_other = _mk_user("adv-mgr2@example.com", role=User.Role.MANAGER)

        self.department = Department.objects.create(
            company=company, code="ENG", name_ar="الهندسة", manager=self.manager
        )
        EmployeeProfile.objects.create(company=company, user=self.manager, department=self.department)
        EmployeeProfile.objects.create(
            company=company, user=self.employee, department=self.department, manager=self.manager
        )
        EmployeeProfile.objects.create(company=company, user=self.colleague, department=self.department)
        EmployeeProfile.objects.create(company=company, user=self.colleague2, department=self.department)
        # A manager in no department and with no direct reports: empty scope.
        EmployeeProfile.objects.create(company=company, user=self.manager_other)

        # The seed migration (reqs 0008) already defines «إجازة اعتيادية» for the
        # default company, so adopt it rather than collide with it.
        self.leave, _ = RequestType.objects.get_or_create(
            company=company, name="إجازة اعتيادية", defaults={"requires_manager_approval": True}
        )
        self.non_leave = RequestType.objects.create(
            company=company, name="عهدة", requires_manager_approval=True
        )
        self.hr_type = RequestType.objects.create(
            company=company, name="تظلم", requires_hr_approval=True
        )

    def _client_for(self, user):
        client = APIClient()
        client.force_login(user)
        return client

    def _balance(self, entitled="21", carried="0", request_type=None, employee=None):
        return LeaveBalance.objects.create(
            company=self.company,
            employee=employee or self.employee,
            request_type=request_type or self.leave,
            year=YEAR,
            entitled_days=entitled,
            carried_over_days=carried,
        )

    def _request(
        self,
        *,
        requester=None,
        request_type=None,
        title="إجازة اعتيادية 2026-03-02 إلى 2026-03-04",
        status_value=EmployeeRequest.Status.PENDING_MANAGER,
        submitted_at="now",
    ):
        submitted = timezone.now() if submitted_at == "now" else submitted_at
        return EmployeeRequest.objects.create(
            company=self.company,
            requester=requester or self.employee,
            request_type=request_type or self.leave,
            title=title,
            status=status_value,
            manager_at_submission=self.manager,
            submitted_at=submitted,
        )

    def _approved(self, *, requester=None, title, request_type=None):
        return self._request(
            requester=requester,
            request_type=request_type,
            title=title,
            status_value=EmployeeRequest.Status.APPROVED,
        )

    def _advice(self, request_obj, user=None):
        url = reverse("review:request-advice", kwargs={"pk": request_obj.pk})
        return self._client_for(user or self.manager).get(url)


class AdviceRuleTests(AdviceBase):
    """(a) ample balance + no conflicts -> recommend approve."""

    def test_ample_balance_and_no_conflicts_recommends_approving(self):
        self._balance(entitled="21")
        target = self._request()
        res = self._advice(target)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data["data"]
        self.assertEqual(data["verdict"], advice.VERDICT_RECOMMEND_APPROVE)
        self.assertEqual(data["verdict_label"]["ar"], "يوصى بالاعتماد")
        # The cited facts are all present and carry the rules' own reasons.
        by_rule = {fact["rule"]: fact for fact in data["facts"]}
        self.assertEqual(by_rule["balance"]["supports"], advice.SUPPORTS_APPROVE)
        self.assertEqual(by_rule["balance"]["fact"]["remaining_days"], 21.0)
        self.assertEqual(by_rule["overlap"]["supports"], advice.SUPPORTS_APPROVE)
        self.assertEqual(by_rule["coverage"]["supports"], advice.SUPPORTS_INFO)

    def test_balance_comes_from_leavebalances_not_recomputed(self):
        self._balance(entitled="21", carried="5")
        self._approved(requester=self.employee, title="إجازة 2026-01-05 إلى 2026-01-06")
        target = self._request()
        fact = {f["rule"]: f for f in self._advice(target).data["data"]["facts"]}["balance"]["fact"]
        # used counts the one approved request; remaining = 21 + 5 - 1.
        self.assertEqual(fact["used_days"], 1)
        self.assertEqual(fact["remaining_days"], 25.0)


class AdviceRejectTests(AdviceBase):
    """(b) a request exceeding the balance -> recommend reject, reason cited."""

    def test_request_exceeding_balance_recommends_rejecting(self):
        # remaining 2 days, request names a 3-day period -> insufficient.
        self._balance(entitled="2")
        target = self._request()
        res = self._advice(target)
        data = res.data["data"]
        self.assertEqual(data["verdict"], advice.VERDICT_RECOMMEND_REJECT)
        balance_fact = {f["rule"]: f for f in data["facts"]}["balance"]
        self.assertEqual(balance_fact["supports"], advice.SUPPORTS_REJECT)
        self.assertIn("الرصيد", balance_fact["reason_ar"])
        self.assertEqual(balance_fact["fact"]["requested_units"], 3)


class AdviceOverlapTests(AdviceBase):
    """(c) overlapping approved leave produces the overlap fact."""

    def test_overlapping_approved_leave_is_cited(self):
        self._balance(entitled="21")
        self._approved(requester=self.employee, title="إجازة 2026-03-03 إلى 2026-03-05")
        target = self._request()  # 2026-03-02 .. 2026-03-04
        data = self._advice(target).data["data"]
        overlap_fact = {f["rule"]: f for f in data["facts"]}["overlap"]
        self.assertEqual(overlap_fact["supports"], advice.SUPPORTS_REJECT)
        self.assertEqual(overlap_fact["fact"]["count"], 1)
        self.assertEqual(data["verdict"], advice.VERDICT_RECOMMEND_REJECT)

    def test_non_overlapping_approved_leave_is_not_cited(self):
        self._balance(entitled="21")
        self._approved(requester=self.employee, title="إجازة 2026-05-01 إلى 2026-05-02")
        target = self._request()
        overlap_fact = {f["rule"]: f for f in self._advice(target).data["data"]["facts"]}["overlap"]
        self.assertEqual(overlap_fact["supports"], advice.SUPPORTS_APPROVE)
        self.assertEqual(overlap_fact["fact"]["count"], 0)


class AdviceCoverageTests(AdviceBase):
    """(d) a department-coverage warning appears without flipping to reject."""

    def test_department_coverage_warning_does_not_reject(self):
        self._balance(entitled="21")
        self._approved(requester=self.colleague, title="إجازة 2026-03-02 إلى 2026-03-06")
        target = self._request()  # no personal overlap, ample balance
        data = self._advice(target).data["data"]
        coverage_fact = {f["rule"]: f for f in data["facts"]}["coverage"]
        self.assertEqual(coverage_fact["supports"], advice.SUPPORTS_WARN)
        self.assertEqual(coverage_fact["fact"]["count"], 1)
        # The warning is a warning: the verdict is NEEDS_ATTENTION, never reject.
        self.assertEqual(data["verdict"], advice.VERDICT_NEEDS_ATTENTION)
        self.assertNotEqual(data["verdict"], advice.VERDICT_RECOMMEND_REJECT)


class AdviceScopeTests(AdviceBase):
    """(e) an out-of-scope caller gets the safe 404."""

    def test_out_of_scope_caller_gets_404(self):
        self._balance(entitled="21")
        target = self._request()
        res = self._advice(target, user=self.manager_other)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_nonexistent_id_gets_404(self):
        import uuid

        url = reverse("review:request-advice", kwargs={"pk": uuid.uuid4()})
        res = self._client_for(self.manager).get(url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)


class AdviceAssistantAbsentTests(AdviceBase):
    """(f) no assistant configured -> rule verdict present, explanation absent."""

    def test_no_assistant_configured_still_returns_rule_verdict(self):
        self._balance(entitled="21")
        target = self._request()
        data = self._advice(target).data["data"]
        self.assertEqual(data["verdict"], advice.VERDICT_RECOMMEND_APPROVE)
        self.assertTrue(data["facts"])
        self.assertFalse(data["explanation"]["available"])
        self.assertIsNone(data["explanation"]["text_ar"])
        self.assertEqual(data["explanation"]["reason_unavailable"], "not_configured")

    def test_batch_returns_each_rows_verdict_without_assistant(self):
        self._balance(entitled="21")
        target = self._request()
        second = self._request(title="إجازة اعتيادية 2026-04-06 إلى 2026-04-07")
        url = reverse("review:request-advice-batch") + f"?ids={target.pk},{second.pk}"
        res = self._client_for(self.manager).get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data["data"]
        self.assertEqual(set(data), {str(target.pk), str(second.pk)})
        for row in data.values():
            self.assertEqual(row["verdict"], advice.VERDICT_RECOMMEND_APPROVE)
            self.assertFalse(row["explanation"]["available"])

    def test_batch_omits_out_of_scope_ids(self):
        self._balance(entitled="21")
        target = self._request()
        url = reverse("review:request-advice-batch") + f"?ids={target.pk}"
        res = self._client_for(self.manager_other).get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["data"], {})


class AdvicePeriodTests(AdviceBase):
    """The period is read from the request's free text; unknown -> not checked."""

    def test_period_is_read_from_the_request_text(self):
        self._balance(entitled="21")
        target = self._request(title="إجازة اعتيادية 2026-03-02 إلى 2026-03-04")
        period = self._advice(target).data["data"]["period"]
        self.assertEqual(period["start"], "2026-03-02")
        self.assertEqual(period["end"], "2026-03-04")
        self.assertEqual(period["days"], 3)

    def test_unknown_period_is_reported_not_guessed(self):
        self._balance(entitled="21")
        target = self._request(title="إجازة بلا تواريخ")
        data = self._advice(target).data["data"]
        self.assertIsNone(data["period"])
        by_rule = {f["rule"]: f for f in data["facts"]}
        self.assertFalse(by_rule["overlap"]["fact"]["period_known"])
        self.assertFalse(by_rule["coverage"]["fact"]["period_known"])

    def test_non_leave_type_has_no_balance_rule(self):
        self._balance(entitled="21")
        target = self._request(request_type=self.non_leave, title="عهدة لابتوب")
        balance_fact = {f["rule"]: f for f in self._advice(target).data["data"]["facts"]}["balance"]
        self.assertEqual(balance_fact["supports"], advice.SUPPORTS_INFO)
        self.assertFalse(balance_fact["fact"]["is_leave_type"])


class AdviceHrRuleTests(AdviceBase):
    def test_hr_approval_is_a_cited_fact(self):
        self._balance(entitled="21")
        target = self._request(request_type=self.hr_type, title="تظلم 2026-03-02")
        hr_fact = {f["rule"]: f for f in self._advice(target).data["data"]["facts"]}["hr_approval"]
        self.assertTrue(hr_fact["fact"]["requires_hr_approval"])
        self.assertEqual(hr_fact["supports"], advice.SUPPORTS_INFO)


class AdviceAssistantPresentTests(AdviceBase):
    """The explanation IS the assistant's when one is configured and reachable."""

    def _configure(self):
        from accounts.assistant_crypto import encrypt_key, key_hint
        from accounts.models import AssistantConfig

        AssistantConfig.objects.create(
            company=self.company,
            user=self.manager,
            base_url="https://provider.example/v1",
            model="some-model",
            api_key_ciphertext=encrypt_key("secret-key"),
            api_key_hint=key_hint("secret-key"),
            is_active=True,
        )

    def test_configured_assistant_supplies_the_arabic_explanation(self):
        from unittest import mock

        self._balance(entitled="21")
        target = self._request()
        self._configure()
        with mock.patch(
            "accounts.assistant_provider.chat_round",
            return_value={"role": "assistant", "content": "الرصيد كافٍ ولا تعارض؛ يمكن الاعتماد."},
        ):
            data = self._advice(target).data["data"]
        self.assertTrue(data["explanation"]["available"])
        self.assertEqual(data["explanation"]["text_ar"], "الرصيد كافٍ ولا تعارض؛ يمكن الاعتماد.")
        self.assertEqual(data["verdict"], advice.VERDICT_RECOMMEND_APPROVE)

    def test_provider_error_leaves_the_rule_verdict_intact(self):
        from unittest import mock

        from accounts.assistant_provider import ProviderUnreachableError

        self._balance(entitled="21")
        target = self._request()
        self._configure()
        with mock.patch(
            "accounts.assistant_provider.chat_round",
            side_effect=ProviderUnreachableError("https://provider.example/v1", "dns"),
        ):
            res = self._advice(target)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data["data"]
        self.assertEqual(data["verdict"], advice.VERDICT_RECOMMEND_APPROVE)
        self.assertFalse(data["explanation"]["available"])
        self.assertEqual(data["explanation"]["reason_unavailable"], "provider_error")
        self.assertIsNone(data["explanation"]["text_ar"])
