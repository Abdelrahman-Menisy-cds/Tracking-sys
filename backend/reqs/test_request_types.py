"""GET /api/v1/request-types — the «طلب جديد» picker's real source.

The screen was a shell because nothing listed the organisation's request
types. These tests pin the contract the picker depends on: only the caller's
company's ACTIVE rows, in the shape the draft-create endpoint accepts, and
never without a session. The last test is the honesty link between the two:
whatever this endpoint lists must be creatable, and the rows it withholds
must be the rows create refuses.
"""
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Company, User
from reqs.models import EmployeeRequest, RequestType
from tenants.context import default_company


class RequestTypeListTests(APITestCase):
    def setUp(self):
        # The migration seed (reqs/0008) already puts the four org types into
        # __default__; clear them so this test owns exactly its own rows (the
        # leavebalances suite resets the same way).
        RequestType.objects.all().delete()
        self.company = default_company()
        self.other_company = Company.objects.create(slug="other-co", name="Other Co")
        self.user = User.objects.create_user(
            company=self.company, email="picker@example.com", password="pass-12345678"
        )
        self.active = RequestType.objects.create(
            company=self.company, name="إجازة اعتيادية", requires_hr_approval=True
        )
        self.inactive = RequestType.objects.create(
            company=self.company, name="نوع موقوف", is_active=False
        )
        self.foreign = RequestType.objects.create(
            company=self.other_company, name="نوع شركة أخرى", requires_hr_approval=True
        )
        self.url = reverse("reqs:request-type-list")
        self.client.force_login(self.user)

    def test_lists_the_active_types_of_the_callers_company(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()["data"]
        self.assertEqual([row["id"] for row in data], [self.active.pk])
        self.assertEqual(data[0]["name"], "إجازة اعتيادية")
        self.assertIs(data[0]["requires_hr_approval"], True)
        # Exactly the serializer the create form needs to render the routing hint.
        self.assertEqual(set(data[0]), {"id", "name", "requires_hr_approval"})

    def test_inactive_type_is_absent(self):
        response = self.client.get(self.url)

        ids = [row["id"] for row in response.json()["data"]]
        self.assertNotIn(self.inactive.pk, ids)

    def test_another_companys_type_is_absent(self):
        response = self.client.get(self.url)

        ids = [row["id"] for row in response.json()["data"]]
        self.assertNotIn(self.foreign.pk, ids)

    def test_unauthenticated_caller_is_refused(self):
        self.client.logout()

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertNotIn("data", response.json())

    def test_ordering_is_deterministic_by_name(self):
        later = RequestType.objects.create(company=self.company, name="طلب لاحق")

        response = self.client.get(self.url)

        names = [row["name"] for row in response.json()["data"]]
        self.assertEqual(names, sorted([self.active.name, later.name]))

    def test_listed_types_are_exactly_the_creatable_ones(self):
        """Every listed id creates a draft; the withheld ones are refused 422."""
        listed = self.client.get(self.url).json()["data"]

        for row in listed:
            created = self.client.post(
                reverse("reqs:request-list"),
                {"request_type_id": row["id"], "title": f"مسودة {row['name']}"},
            )
            self.assertEqual(created.status_code, status.HTTP_201_CREATED, row)
            self.assertEqual(created.json()["data"]["request_type"]["id"], row["id"])

        for withheld in (self.inactive, self.foreign):
            refused = self.client.post(
                reverse("reqs:request-list"),
                {"request_type_id": withheld.pk, "title": "لا يجب أن تُنشأ"},
            )
            self.assertEqual(refused.status_code, 422, withheld)

        self.assertEqual(EmployeeRequest.objects.count(), len(listed))
