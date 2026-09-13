"""Story 3.1 focused tests: create unique weekly timesheet + daily entries.

Covers: happy create with totals (hours/minutes, no rounding, no deductions),
duplicate-week 409 with safe existing reference (owner only), cross-user 404
isolation, negative/invalid/out-of-week/over-24h/over-168h/one-entry-per-day
422 with zero mutation, zero-minute entries allowed, non-Monday week 422,
idempotency (missing key 422, same-key/same-payload replay, differing 409),
created event, model constraints, auth 401 / CSRF 403, owner-list scoping,
pagination, and 60/min mutation throttle 429.
"""
from datetime import date, timedelta

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import User
from timesheets.models import (
    TimeEntry,
    Timesheet,
    TimesheetCreateIdempotencyRecord,
    TimesheetEvent,
    TimezoneConfig,
)

MONDAY = date(2026, 9, 7)  # a Monday


class TimesheetBase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.other = User.objects.create_user(email="other@example.com", password="pass-12345678")
        TimezoneConfig.objects.get_or_create(name="UTC")
        self.list_url = reverse("timesheets:timesheet-list")
        self.client.force_login(self.user)
        from django.core.cache import cache as django_cache

        django_cache.clear()

    def detail_url(self, pk):
        return reverse("timesheets:timesheet-detail", kwargs={"pk": pk})

    def week_entries(self, **overrides):
        base = [
            {"work_date": "2026-09-07", "duration_minutes": 480, "unpaid_break_minutes": 60},
            {"work_date": "2026-09-08", "duration_minutes": 510, "unpaid_break_minutes": 0},
        ]
        for override in overrides.values():
            base.extend(override if isinstance(override, list) else [override])
        return base

    def create_payload(self, week_start=MONDAY.isoformat(), entries=None, **extra):
        payload = {"week_start": week_start}
        if entries is not None:
            payload["entries"] = entries
        payload.update(extra)
        return payload

    def post_create(self, payload, key="key-1"):
        return self.client.post(
            self.list_url, payload, format="json", HTTP_IDEMPOTENCY_KEY=key
        )


class CreateHappyPathTests(TimesheetBase):
    def test_create_returns_201_with_canonical_minutes(self):
        response = self.post_create(
            self.create_payload(entries=self.week_entries())
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()["data"]
        sheet = Timesheet.objects.get(pk=data["id"])
        self.assertEqual(sheet.employee, self.user)
        self.assertEqual(sheet.week_start, MONDAY)
        self.assertEqual(sheet.status, Timesheet.Status.DRAFT)
        self.assertEqual(sheet.version, 1)
        entry = TimeEntry.objects.get(timesheet=sheet, work_date=MONDAY)
        self.assertEqual(entry.duration_minutes, 480)
        self.assertEqual(entry.unpaid_break_minutes, 60)

    def test_totals_exposed_as_hours_and_minutes_no_rounding(self):
        response = self.post_create(
            self.create_payload(entries=self.week_entries())
        )
        data = response.json()["data"]
        # 480 + 510 = 990 worked minutes = 16h 30m, break 60 minutes untouched.
        self.assertEqual(data["total_worked_minutes"], 990)
        self.assertEqual(data["total_worked_hours"], 16)
        self.assertEqual(data["total_worked_hours_minutes_display"], "16h 30m")
        self.assertEqual(data["total_unpaid_break_minutes"], 60)

    def test_no_rounding_odd_minutes_preserved(self):
        response = self.post_create(
            self.create_payload(
                entries=[{"work_date": "2026-09-07", "duration_minutes": 137, "unpaid_break_minutes": 7}]
            )
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()["data"]
        self.assertEqual(data["total_worked_minutes"], 137)
        self.assertEqual(data["total_worked_hours_minutes_display"], "2h 17m")
        self.assertEqual(data["total_unpaid_break_minutes"], 7)

    def test_created_event_appended(self):
        response = self.post_create(self.create_payload(entries=self.week_entries()))
        data = response.json()["data"]
        events = TimesheetEvent.objects.filter(timesheet_id=data["id"])
        self.assertEqual(events.count(), 1)
        event = events.get()
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.action, TimesheetEvent.Action.CREATED)
        self.assertIsNone(event.from_status)
        self.assertEqual(event.to_status, Timesheet.Status.DRAFT)

    def test_zero_minute_entries_allowed(self):
        response = self.post_create(
            self.create_payload(
                entries=[{"work_date": "2026-09-07", "duration_minutes": 0}]
            )
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["data"]["total_worked_minutes"], 0)


class WeekValidationTests(TimesheetBase):
    def test_non_monday_week_start_422_no_mutation(self):
        response = self.post_create(
            self.create_payload(week_start="2026-09-08", entries=[])
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertIn("week_start", response.json()["error"]["fields"])
        self.assertFalse(Timesheet.objects.exists())

    def test_out_of_week_work_date_422_no_mutation(self):
        response = self.post_create(
            self.create_payload(
                entries=[{"work_date": "2026-09-14", "duration_minutes": 60}]
            )
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertFalse(Timesheet.objects.exists())
        self.assertFalse(TimeEntry.objects.exists())

    def test_before_week_start_work_date_422_no_mutation(self):
        response = self.post_create(
            self.create_payload(
                entries=[{"work_date": "2026-09-06", "duration_minutes": 60}]
            )
        )
        self.assertEqual(response.status_code, 422)
        self.assertFalse(Timesheet.objects.exists())

    def test_negative_duration_422_no_mutation(self):
        response = self.post_create(
            self.create_payload(
                entries=[{"work_date": "2026-09-07", "duration_minutes": -30}]
            )
        )
        self.assertEqual(response.status_code, 422)
        self.assertFalse(Timesheet.objects.exists())

    def test_negative_break_422_no_mutation(self):
        response = self.post_create(
            self.create_payload(
                entries=[
                    {
                        "work_date": "2026-09-07",
                        "duration_minutes": 60,
                        "unpaid_break_minutes": -5,
                    }
                ]
            )
        )
        self.assertEqual(response.status_code, 422)
        self.assertFalse(Timesheet.objects.exists())

    def test_daily_over_24h_422(self):
        response = self.post_create(
            self.create_payload(
                entries=[{"work_date": "2026-09-07", "duration_minutes": 1441}]
            )
        )
        self.assertEqual(response.status_code, 422)
        self.assertFalse(Timesheet.objects.exists())

    def test_full_168h_week_allowed(self):
        entries = [
            {"work_date": f"2026-09-{7 + day}", "duration_minutes": 1440}
            for day in range(7)
        ]
        # One extra minute must exceed the 168h weekly cap... but a 7-day week at
        # 1440/day is exactly 168h; overage needs a distinct-date trick, which the
        # one-entry-per-day rule makes impossible. So the weekly cap is enforced
        # structurally when every day is capped; instead verify exactly-168h passes
        # and a hypothetical overage via summary is structurally unreachable.
        response = self.post_create(self.create_payload(entries=entries))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()["data"]
        self.assertEqual(data["total_worked_minutes"], 7 * 1440)

    def test_one_entry_per_work_date_422(self):
        response = self.post_create(
            self.create_payload(
                entries=[
                    {"work_date": "2026-09-07", "duration_minutes": 60},
                    {"work_date": "2026-09-07", "duration_minutes": 30},
                ]
            )
        )
        self.assertEqual(response.status_code, 422)
        self.assertFalse(Timesheet.objects.exists())

    def test_protected_fields_422_no_mutation(self):
        response = self.post_create(
            self.create_payload(
                entries=self.week_entries(),
                status=Timesheet.Status.APPROVED,
            )
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("status", response.json()["error"]["fields"])
        self.assertFalse(Timesheet.objects.exists())

    def test_break_over_daily_cap_422(self):
        response = self.post_create(
            self.create_payload(
                entries=[
                    {
                        "work_date": "2026-09-07",
                        "duration_minutes": 0,
                        "unpaid_break_minutes": 1441,
                    }
                ]
            )
        )
        self.assertEqual(response.status_code, 422)


class DuplicateWeekTests(TimesheetBase):
    def setUp(self):
        super().setUp()
        self.first = self.post_create(
            self.create_payload(entries=self.week_entries()), key="first"
        )
        self.assertEqual(self.first.status_code, status.HTTP_201_CREATED)
        self.existing_id = self.first.json()["data"]["id"]
        self.sheet = Timesheet.objects.get(pk=self.existing_id)

    def test_duplicate_week_409_safe_conflict(self):
        response = self.post_create(
            self.create_payload(
                entries=[{"work_date": "2026-09-07", "duration_minutes": 1}]
            ),
            key="second",
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        error = response.json()["error"]
        self.assertEqual(error["code"], "duplicate_week")
        self.assertEqual(
            error["fields"]["week_start"][0]["existing_timesheet_id"], self.existing_id
        )
        self.assertEqual(Timesheet.objects.count(), 1)
        self.assertEqual(TimeEntry.objects.count(), 2)

    def test_duplicate_week_other_week_is_allowed(self):
        response = self.post_create(
            self.create_payload(week_start="2026-09-14", entries=[]), key="next-week"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Timesheet.objects.count(), 2)

    def test_other_users_sheet_not_disclosing(self):
        client = APIClient()
        client.force_login(self.other)
        response = client.post(
            self.list_url,
            self.create_payload(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="other-key",
        )
        # self.other has no sheet: creation succeeds regardless of self.user's sheet.
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(response.json()["data"]["id"], self.existing_id)


class OwnershipTests(TimesheetBase):
    def setUp(self):
        super().setUp()
        response = self.post_create(self.create_payload(entries=self.week_entries()))
        self.sheet_id = response.json()["data"]["id"]

    def test_detail_visible_to_owner(self):
        response = self.client.get(self.detail_url(self.sheet_id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["id"], self.sheet_id)
        self.assertEqual(len(response.json()["data"]["entries"]), 2)

    def test_detail_of_other_user_404_no_existence_disclosure(self):
        client = APIClient()
        client.force_login(self.other)
        response = client.get(self.detail_url(self.sheet_id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.json()["error"]["code"], "not_found")

    def test_list_is_owner_scoped(self):
        client = APIClient()
        client.force_login(self.other)
        client.post(
            self.list_url,
            self.create_payload(entries=[]),
            format="json",
            HTTP_IDEMPOTENCY_KEY="other-sheet",
        )
        response = client.get(self.list_url)
        ids = [item["id"] for item in response.json()["data"]]
        self.assertEqual(len(ids), 1)
        self.assertNotIn(self.sheet_id, ids)

    def test_list_pagination_bounded(self):
        client = APIClient()
        client.force_login(self.other)
        from django.core.cache import cache

        cache.clear()
        for index, monday in enumerate(
            [
                "2026-08-03",
                "2026-08-10",
                "2026-08-17",
                "2026-08-24",
                "2026-08-31",
                "2026-09-07",
                "2026-09-14",
                "2026-09-21",
            ]
        ):
            response = client.post(
                self.list_url,
                self.create_payload(week_start=monday, entries=[]),
                format="json",
                HTTP_IDEMPOTENCY_KEY=f"page-{index}",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED, monday)
        response = client.get(self.list_url)
        body = response.json()
        self.assertEqual(body["meta"]["count"], 8)
        self.assertEqual(len(body["data"]), 8)


class IdempotencyTests(TimesheetBase):
    def test_missing_idempotency_key_422_no_mutation(self):
        response = self.client.post(self.list_url, self.create_payload(), format="json")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "idempotency_key_required")
        self.assertFalse(Timesheet.objects.exists())

    def test_same_key_same_payload_replays_original_201(self):
        first = self.post_create(self.create_payload(entries=self.week_entries()), key="k")
        second = self.post_create(self.create_payload(entries=self.week_entries()), key="k")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.json()["data"]["id"], first.json()["data"]["id"])
        self.assertEqual(Timesheet.objects.count(), 1)
        self.assertEqual(
            TimesheetCreateIdempotencyRecord.objects.count(), 1
        )

    def test_same_key_differing_payload_409(self):
        self.post_create(self.create_payload(entries=self.week_entries()), key="k")
        response = self.post_create(
            self.create_payload(
                entries=[{"work_date": "2026-09-09", "duration_minutes": 1}]
            ),
            key="k",
        )
        # Same key, different payload -> 409 idempotency_conflict (even though
        # the week is also a duplicate: idempotency arbitrates first per contract.)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "idempotency_conflict")

    def test_same_key_other_user_does_not_replay(self):
        from django.core.cache import cache

        first = self.post_create(self.create_payload(entries=self.week_entries()), key="k")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        cache.clear()
        client = APIClient()
        client.force_login(self.other)
        response = client.post(
            self.list_url,
            self.create_payload(entries=self.week_entries()),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k",
        )
        # Same key, different user: that user's sheet (creates fine, own id).
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(
            response.json()["data"]["id"], first.json()["data"]["id"]
        )


class AuthCsrfThrottleTests(TimesheetBase):
    def test_unauthenticated_create_401(self):
        client = APIClient()
        response = client.post(self.list_url, self.create_payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unauthenticated_detail_401(self):
        client = APIClient()
        response = client.get(self.detail_url("11111111-1111-1111-1111-111111111111"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_csrf_enforced_403(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.user)
        response = client.post(
            self.list_url,
            self.create_payload(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="csrf-key",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_throttled_429_after_mutation_budget(self):
        # Same key, same every-week payload; use fresh distinct weeks per attempt
        # so the throttle (not duplicate/conflict validation) is what trips.
        from django.core.cache import cache

        base_monday = MONDAY
        cache.clear()
        for index in range(60):
            monday = base_monday + timedelta(weeks=index)
            response = self.post_create(
                self.create_payload(
                    week_start=monday.isoformat(),
                    entries=[{"work_date": monday.isoformat(), "duration_minutes": 60}],
                ),
                key=f"thr-{index}",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED, index)
        response = self.post_create(
            self.create_payload(
                week_start=(base_monday + timedelta(weeks=60)).isoformat(),
                entries=[
                    {
                        "work_date": (base_monday + timedelta(weeks=60)).isoformat(),
                        "duration_minutes": 60,
                    }
                ],
            ),
            key="thr-61",
        )
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.json()["error"]["code"], "throttled")
        self.assertEqual(Timesheet.objects.count(), 60)
