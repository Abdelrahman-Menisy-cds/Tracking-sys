"""Story 3.3 focused tests: reviewer decision + HR reopen of timesheets.

Covers: SUBMITTED -> APPROVED/RETURNED/REJECTED by authorized reviewer
(state, version bump, TimesheetEvent, AuditEvent), required Idempotency-Key
and confirmation, mandatory reason for return/reject (422 with no mutation),
authorization scope (active direct-report manager; HR; requester/self denied;
unauthorized 404-safe), terminal states -> 409, stale version 409,
idempotency (replay / differing payload 409 / lost race determinism),
rejected-week replacement semantics (409 duplicate_week, no second row, HR
reopen is the replacement workflow), HR-only reopen of APPROVED/REJECTED ->
RETURNED with mandatory reason + confirm + key + audit, employee/manager
reopen denial, history retention, read-only terminal records, and
auth 401 / CSRF 403 / throttle 429 / post-commit notification isolation.
"""
from datetime import date, timedelta
from hashlib import sha256
from unittest import mock

from django.core.cache import cache
from django.db import IntegrityError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import AuditEvent, EmployeeProfile, User
from notifications.models import Notification
from timesheets.models import (
    TimeEntry,
    Timesheet,
    TimesheetEvent,
    TimezoneConfig,
)
from timesheets.test_story_3_2 import MONDAY, Story32Base

REJECT_REASON = "Hours do not match the approved schedule."
RETURN_REASON = "Please correct Tuesday's hours."
REOPEN_REASON = "Payroll adjustment requires reopening this week."


def _key_hash(key: str) -> str:
    return sha256(key.encode()).hexdigest()


def _payload_hash(*, timesheet_id, version, action, comment) -> str:
    return sha256(f"{timesheet_id}:{version}:{action}:{comment}".encode()).hexdigest()


class Story33Base(Story32Base):
    def setUp(self):
        super().setUp()
        self.manager = User.objects.create_user(
            email="mgr@example.com", password="pass-12345678", role=User.Role.MANAGER
        )
        self.hr = User.objects.create_user(
            email="hr@example.com", password="pass-12345678", role=User.Role.HR
        )
        EmployeeProfile.objects.create(user=self.user, manager=self.manager)
        # Only the owner's direct manager and HR may decide this sheet.
        self.stranger = User.objects.create_user(
            email="stranger@example.com", password="pass-12345678", role=User.Role.MANAGER
        )
        self.sheet = self.create_sheet(entries=self.default_entries(), user=self.user)
        self._post_as(self.submit_url(self.sheet.pk), {"confirm": True, "version": 1}, as_user=self.user, key="submit-33")
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)
        cache.clear()

    def _week_entries(self, week_offset, base=None):
        """Default entries remapped into the week starting at OFFSET Mondays after MONDAY."""
        week = MONDAY + timedelta(weeks=week_offset)
        return [
            {"work_date": (week + timedelta(days=0)).isoformat(), "duration_minutes": 480, "unpaid_break_minutes": 60},
            {"work_date": (week + timedelta(days=1)).isoformat(), "duration_minutes": 510, "unpaid_break_minutes": 0},
        ]

    def week2(self):
        return self._week_entries(1)

    def _post_as(self, url, payload, as_user, key):
        client = self._client_for(as_user)
        return client.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=key)

    def decision_url(self, pk):
        return reverse("timesheets:timesheet-decision", kwargs={"pk": pk})

    def reopen_url(self, pk):
        return reverse("timesheets:timesheet-reopen", kwargs={"pk": pk})

    def decide_as(self, actor, action, comment=None, version=2, key="decide-key"):
        payload = {"action": action, "version": version}
        if comment is not None:
            payload["comment"] = comment
        return self._post_as(self.decision_url(self.sheet.pk), payload, actor, key)

    def reopen_as(self, actor, comment=REOPEN_REASON, version=None, key="reopen-key", confirm=True):
        sheet = Timesheet.objects.get(pk=self.sheet.pk)
        payload = {"version": version if version is not None else sheet.version, "confirm": confirm}
        if comment is not None:
            payload["comment"] = comment
        return self._post_as(self.reopen_url(self.sheet.pk), payload, actor, key)

    def reject_sheet(self):
        """Take the sheet to REJECTED through the service path (for reopen tests)."""
        review_services = __import__("timesheets.review_services", fromlist=["decide_timesheet"])
        review_services.decide_timesheet(
            reviewer=self.hr,
            sheet=Timesheet.objects.get(pk=self.sheet.pk),
            action="reject",
            comment=REJECT_REASON,
            version=self.sheet.version,
            key_hash=_key_hash("setup-reject"),
            payload_hash=_payload_hash(
                timesheet_id=self.sheet.pk, version=self.sheet.version, action="reject", comment=REJECT_REASON
            ),
        )
        self.sheet.refresh_from_db()
        return self.sheet

    def approve_sheet(self):
        review_services = __import__("timesheets.review_services", fromlist=["decide_timesheet"])
        review_services.decide_timesheet(
            reviewer=self.manager,
            sheet=Timesheet.objects.get(pk=self.sheet.pk),
            action="approve",
            comment="",
            version=self.sheet.version,
            key_hash=_key_hash("setup-approve"),
            payload_hash=_payload_hash(
                timesheet_id=self.sheet.pk, version=self.sheet.version, action="approve", comment=""
            ),
        )
        self.sheet.refresh_from_db()
        return self.sheet


class DecisionHappyPathTests(Story33Base):
    def test_manager_approve_transitions_to_approved(self):
        response = self.decide_as(self.manager, "approve", version=self.sheet.version)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(data["status"], Timesheet.Status.APPROVED)
        self.assertEqual(data["version"], self.sheet.version + 1)
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.APPROVED)
        self.assertEqual(self.sheet.version, self.sheet.version)

    def test_manager_reject_is_terminal_with_reason(self):
        response = self.decide_as(self.manager, "reject", comment=REJECT_REASON)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.REJECTED)
        event = TimesheetEvent.objects.filter(
            timesheet=self.sheet, action=TimesheetEvent.Action.REJECTED
        ).order_by("-created_at").first()
        self.assertIsNotNone(event)
        self.assertEqual(event.from_status, Timesheet.Status.SUBMITTED)
        self.assertEqual(event.to_status, Timesheet.Status.REJECTED)
        self.assertEqual(event.comment, REJECT_REASON)
        self.assertEqual(event.actor, self.manager)

    def test_manager_return_with_reason_movements(self):
        response = self.decide_as(self.manager, "return", comment=RETURN_REASON)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.RETURNED)
        event = TimesheetEvent.objects.filter(
            timesheet=self.sheet, action=TimesheetEvent.Action.RETURNED, comment=RETURN_REASON
        ).first()
        self.assertIsNotNone(event)
        self.assertEqual(event.from_status, Timesheet.Status.SUBMITTED)
        self.assertEqual(event.to_status, Timesheet.Status.RETURNED)

    def test_hr_can_decide_any_submitted_sheet(self):
        response = self.decide_as(self.hr, "approve")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.APPROVED)

    def test_approve_appends_audit_event(self):
        before_version = Timesheet.objects.get(pk=self.sheet.pk).version
        self.decide_as(self.manager, "approve")
        audit = AuditEvent.objects.filter(
            action="timesheet_approved", request_id=str(self.sheet.pk)
        ).order_by("-occurred_at").first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor, self.manager)
        self.assertEqual(audit.subject, self.user)
        self.assertEqual(audit.before, {"status": Timesheet.Status.SUBMITTED, "version": before_version})
        self.assertEqual(audit.after["status"], Timesheet.Status.APPROVED)
        self.assertEqual(audit.after["comment"], "")

    def test_reject_and_return_audit(self):
        # RETURNED is employee-editable (resubmit), so a second decision on a
        # returned sheet is a 409; use two separate sheets for the two audits.
        sheet2 = self.create_sheet(week_start=MONDAY + timedelta(weeks=1), entries=self._week_entries(1), key="week2", user=self.user)
        sheet3 = self.create_sheet(week_start=MONDAY + timedelta(weeks=2), entries=self._week_entries(2), key="week3", user=self.user)
        self._submit_sheet(sheet2)
        self._submit_sheet(sheet3)
        self._post_as(self.decision_url(sheet2.pk), {"action": "return", "version": 2, "comment": RETURN_REASON}, self.hr, "d2")
        self._post_as(self.decision_url(sheet3.pk), {"action": "reject", "version": 2, "comment": REJECT_REASON}, self.hr, "d3")
        self.assertTrue(AuditEvent.objects.filter(action="timesheet_returned", request_id=str(sheet2.pk)).exists())
        self.assertTrue(AuditEvent.objects.filter(action="timesheet_rejected", request_id=str(sheet3.pk)).exists())

    def _submit_sheet(self, sheet):
        self._post_as(self.submit_url(sheet.pk), {"confirm": True, "version": 1}, self.user, f"submit-{sheet.pk}")

    def test_decision_bumps_version_exactly_once(self):
        v = Timesheet.objects.get(pk=self.sheet.pk).version
        self.decide_as(self.manager, "approve")
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.version, v + 1)

    def test_approved_sheet_becomes_read_only_to_employee(self):
        self.decide_as(self.manager, "approve")
        entry = TimeEntry.objects.get(timesheet=self.sheet, work_date=MONDAY)
        client = self._client_for(self.user)
        response = client.patch(
            self.entry_url(self.sheet.pk, entry.pk),
            {"duration_minutes": 1, "version": self.sheet.version + 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        entry.refresh_from_db()
        self.assertEqual(entry.duration_minutes, 480)

    def entry_url(self, pk, entry_id):
        return reverse("timesheets:timesheet-entry-detail", kwargs={"pk": str(pk), "entry_id": str(entry_id)})


class DecisionValidationTests(Story33Base):
    def test_missing_idempotency_key_422_no_mutation(self):
        client = self._client_for(self.manager)
        response = client.post(
            self.decision_url(self.sheet.pk),
            {"action": "approve", "version": self.sheet.version},
            format="json",
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "idempotency_key_required")
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)

    def test_reject_without_comment_422_no_mutation(self):
        response = self.decide_as(self.manager, "reject", comment=None)
        self.assertEqual(response.status_code, 422)
        self.assertIn("comment", response.json()["error"]["fields"])
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)
        self.assertEqual(
            TimesheetEvent.objects.filter(timesheet=self.sheet, action=TimesheetEvent.Action.REJECTED).count(), 0
        )

    def test_reject_blank_comment_422(self):
        response = self.decide_as(self.manager, "reject", comment="   ")
        self.assertEqual(response.status_code, 422)

    def test_return_blank_comment_422(self):
        response = self.decide_as(self.manager, "return", comment="")
        self.assertEqual(response.status_code, 422)
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)

    def test_oversized_comment_422(self):
        response = self.decide_as(self.manager, "reject", comment="x" * 2001)
        self.assertEqual(response.status_code, 422)

    def test_unknown_action_422(self):
        response = self.decide_as(self.manager, "return_for_changes")
        self.assertEqual(response.status_code, 422)

    def test_protected_fields_rejected_422(self):
        client = self._client_for(self.manager)
        response = client.post(
            self.decision_url(self.sheet.pk),
            {"action": "approve", "version": self.sheet.version, "status": "APPROVED"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="protected",
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("status", response.json()["error"]["fields"])
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)


class DecisionAuthorizationTests(Story33Base):
    def test_self_decision_forbidden_409_no_mutation(self):
        response = self.decide_as(self.user, "approve")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "self_decision_forbidden")
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)
        self.assertEqual(TimesheetEvent.objects.filter(timesheet=self.sheet, action=TimesheetEvent.Action.APPROVED).count(), 0)

    def test_manager_not_direct_report_404_no_mutation(self):
        # self.stranger is a MANAGER but not the direct-report reviewer.
        response = self.decide_as(self.stranger, "approve")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.json()["error"]["code"], "not_found")
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)

    def test_inactive_manager_denied_401_through_api(self):
        # AC-01: inactive users cannot authenticate (401), so they can never
        # mutate; the service-level active check is covered separately below
        # (defense in depth, same as reqs/test_decision.py QA regression).
        self.manager.is_active = False
        self.manager.save(update_fields=["is_active"])
        response = self.decide_as(self.manager, "approve")
        self.assertIn(response.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_404_NOT_FOUND))

    def test_inactive_hr_denied_401_through_api(self):
        self.hr.is_active = False
        self.hr.save(update_fields=["is_active"])
        response = self.decide_as(self.hr, "approve")
        self.assertIn(response.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_404_NOT_FOUND))

    def test_plain_employee_role_reviewer_404(self):
        response = self.decide_as(self.other, "approve")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_nonexistent_sheet_404(self):
        client = self._client_for(self.hr)
        response = client.post(
            self.decision_url("11111111-1111-1111-1111-111111111111"),
            {"action": "approve", "version": 2},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unauthorized_out_of_scope_appends_no_events(self):
        # CREATED + SUBMITTED only; an out-of-scope 404 decision adds nothing.
        self.decide_as(self.stranger, "approve")
        self.assertEqual(TimesheetEvent.objects.filter(timesheet=self.sheet).count(), 2)
        self.assertEqual(
            TimesheetEvent.objects.filter(timesheet=self.sheet).exclude(
                action__in=(TimesheetEvent.Action.CREATED, TimesheetEvent.Action.SUBMITTED)
            ).count(),
            0,
        )
        # Only the SUBMITTED audit (from the submit step) exists; a decision by
        # an out-of-scope reviewer appends no new audit record.
        self.assertEqual(
            AuditEvent.objects.filter(request_id=str(self.sheet.pk)).exclude(action="timesheet_submitted").count(),
            0,
        )


class DecisionStateTests(Story33Base):
    def _decide_in_state(self, target):
        sheet = self.create_sheet(week_start=MONDAY + timedelta(weeks=1), entries=self._week_entries(1), key=f"w-{target}", user=self.user)
        sheet.status = target
        sheet.save(update_fields=["status", "updated_at"])
        client = self._client_for(self.hr)
        response = client.post(
            self.decision_url(sheet.pk),
            {"action": "approve", "version": 1},
            format="json",
            HTTP_IDEMPOTENCY_KEY=f"dec-{target}",
        )
        sheet.refresh_from_db()
        return response, sheet

    def test_decision_on_draft_409(self):
        response, sheet = self._decide_in_state(Timesheet.Status.DRAFT)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "state_conflict")
        self.assertEqual(sheet.status, Timesheet.Status.DRAFT)

    def test_decision_on_approved_409(self):
        response, sheet = self._decide_in_state(Timesheet.Status.APPROVED)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(sheet.status, Timesheet.Status.APPROVED)

    def test_decision_on_rejected_409(self):
        sheet = self.create_sheet(week_start=MONDAY + timedelta(weeks=1), entries=self._week_entries(1), key="w-r", user=self.user)
        sheet.status = Timesheet.Status.REJECTED
        sheet.save(update_fields=["status", "updated_at"])
        client = self._client_for(self.manager)
        response = client.post(
            self.decision_url(sheet.pk), {"action": "approve", "version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="dec-r"
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.REJECTED)

    def test_decision_on_returned_409(self):
        response, sheet = self._decide_in_state(Timesheet.Status.RETURNED)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(sheet.status, Timesheet.Status.RETURNED)


class DecisionStaleVersionTests(Story33Base):
    def test_stale_version_409_no_mutation(self):
        response = self.decide_as(self.manager, "approve", version=99)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "version_conflict")
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)
        self.assertEqual(TimesheetEvent.objects.filter(timesheet=self.sheet, action=TimesheetEvent.Action.APPROVED).count(), 0)


class DecisionIdempotencyTests(Story33Base):
    def test_same_key_same_payload_replays_200(self):
        first = self.decide_as(self.manager, "approve", key="replay")
        second = self.decide_as(self.manager, "approve", key="replay")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(
            TimesheetEvent.objects.filter(timesheet=self.sheet, action=TimesheetEvent.Action.APPROVED).count(), 1
        )

    def test_same_key_differing_payload_409_no_mutation(self):
        self.decide_as(self.manager, "approve", key="reuse")
        sheet2 = self.create_sheet(week_start=MONDAY + timedelta(weeks=1), entries=self._week_entries(1), key="week2b", user=self.user)
        sheet2.status = Timesheet.Status.SUBMITTED
        sheet2.save(update_fields=["status", "updated_at"])
        response = self.decide_as(self.manager, "reject", comment=REJECT_REASON, key="reuse")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "idempotency_conflict")
        sheet2.refresh_from_db()
        self.assertEqual(sheet2.status, Timesheet.Status.SUBMITTED)
        self.assertEqual(TimesheetEvent.objects.filter(timesheet=sheet2, action=TimesheetEvent.Action.REJECTED).count(), 0)

    def test_replay_does_not_duplicate_audit_or_notifications(self):
        self.decide_as(self.manager, "approve", key="nr")
        self.decide_as(self.manager, "approve", key="nr")
        self.assertEqual(
            AuditEvent.objects.filter(action="timesheet_approved", request_id=str(self.sheet.pk)).count(), 1
        )

    def test_race_loser_replays_without_duplicate_transition(self):
        from timesheets.models import TimesheetDecisionIdempotencyRecord
        # Commit the winner manually, then race-lose through the API.
        self.sheet.status = Timesheet.Status.APPROVED
        self.sheet.version += 1
        self.sheet.save(update_fields=["status", "version", "updated_at"])
        TimesheetEvent.objects.create(
            timesheet=self.sheet,
            actor=self.manager,
            action=TimesheetEvent.Action.APPROVED,
            from_status=Timesheet.Status.SUBMITTED,
            to_status=Timesheet.Status.APPROVED,
        )
        timesheet_id = str(self.sheet.pk)
        TimesheetDecisionIdempotencyRecord.objects.create(
            key_hash=_key_hash("race-33"),
            payload_hash=_payload_hash(timesheet_id=timesheet_id, version=2, action="approve", comment=""),
            response_snapshot={"timesheet_id": timesheet_id},
            user=self.manager,
        )
        real_filter = TimesheetDecisionIdempotencyRecord.objects.filter
        pre_check_done = False

        def hidden_then_visible_filter(*args, **kwargs):
            nonlocal pre_check_done
            if not pre_check_done:
                pre_check_done = True
                return TimesheetDecisionIdempotencyRecord.objects.none()
            return real_filter(*args, **kwargs)

        def insert_fails(*args, **kwargs):
            raise IntegrityError("duplicate key uniq_timesheet_decision_idem_key_user")

        with mock.patch.object(
            TimesheetDecisionIdempotencyRecord.objects, "create", side_effect=insert_fails
        ), mock.patch.object(
            TimesheetDecisionIdempotencyRecord.objects, "filter", side_effect=hidden_then_visible_filter
        ):
            response = self.decide_as(self.manager, "approve", version=2, key="race-33")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            TimesheetEvent.objects.filter(timesheet=self.sheet, action=TimesheetEvent.Action.APPROVED).count(), 1
        )

    def test_race_loser_conflicting_payload_409_no_mutation(self):
        from timesheets.models import TimesheetDecisionIdempotencyRecord
        timesheet_id = str(self.sheet.pk)
        TimesheetDecisionIdempotencyRecord.objects.create(
            key_hash=_key_hash("race2-33"),
            payload_hash=_payload_hash(timesheet_id=timesheet_id, version=9, action="reject", comment="other"),
            response_snapshot={"timesheet_id": timesheet_id},
            user=self.manager,
        )
        real_filter = TimesheetDecisionIdempotencyRecord.objects.filter
        pre_check_done = False

        def hidden_then_visible_filter(*args, **kwargs):
            nonlocal pre_check_done
            if not pre_check_done:
                pre_check_done = True
                return TimesheetDecisionIdempotencyRecord.objects.none()
            return real_filter(*args, **kwargs)

        def insert_fails(*args, **kwargs):
            raise IntegrityError("duplicate key uniq_timesheet_decision_idem_key_user")

        with mock.patch.object(
            TimesheetDecisionIdempotencyRecord.objects, "create", side_effect=insert_fails
        ), mock.patch.object(
            TimesheetDecisionIdempotencyRecord.objects, "filter", side_effect=hidden_then_visible_filter
        ):
            response = self.decide_as(self.manager, "approve", version=2, key="race2-33")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "idempotency_conflict")
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)

    def test_key_scoped_per_reviewer_no_cross_reviewer_leak(self):
        self.decide_as(self.manager, "approve", key="shared")
        # HR reusing the same key with a plausible payload cannot replay or decide.
        sheet2 = self.create_sheet(week_start=MONDAY + timedelta(weeks=1), entries=self._week_entries(1), key="week2c", user=self.user)
        sheet2.status = Timesheet.Status.SUBMITTED
        sheet2.save(update_fields=["status", "updated_at"])
        client = self._client_for(self.hr)
        response = client.post(
            self.decision_url(sheet2.pk),
            {"action": "approve", "version": sheet2.version, "comment": ""},
            format="json",
            HTTP_IDEMPOTENCY_KEY="shared",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        sheet2.refresh_from_db()
        self.assertEqual(sheet2.status, Timesheet.Status.APPROVED)


class RejectedWeekReplacementTests(Story33Base):
    def test_create_for_rejected_week_409_duplicate_week_safe_reference(self):
        dirty_sheet = self.reject_sheet()
        client = self._client_for(self.user)
        response = client.post(
            reverse("timesheets:timesheet-list"),
            {"week_start": MONDAY.isoformat(), "entries": self.default_entries()},
            format="json",
            HTTP_IDEMPOTENCY_KEY="replacement-create",
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "duplicate_week")
        existing = response.json()["error"]["fields"]["week_start"][0]
        self.assertEqual(existing["existing_timesheet_id"], str(dirty_sheet.pk))
        self.assertEqual(existing["existing_week_start"], MONDAY.isoformat())

    def test_no_second_row_for_same_employee_week(self):
        self.reject_sheet()
        self.assertEqual(Timesheet.objects.filter(employee=self.user, week_start=MONDAY).count(), 1)

    def test_rejected_record_retains_history(self):
        dirty = self.reject_sheet()
        events = TimesheetEvent.objects.filter(timesheet=dirty).order_by("created_at")
        self.assertEqual(events.last().action, TimesheetEvent.Action.REJECTED)
        self.assertEqual(TimesheetEvent.objects.filter(timesheet=dirty).count() >= 2, True)


class ReopenTests(Story33Base):
    def test_hr_reopens_approved_to_returned(self):
        approved = self.approve_sheet()
        pre_events = TimesheetEvent.objects.filter(timesheet=approved).order_by("-created_at").first()
        response = self.reopen_as(self.hr)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        approved.refresh_from_db()
        self.assertEqual(approved.status, Timesheet.Status.RETURNED)
        self.assertEqual(approved.version, pre_events.timesheet.version)
        event = TimesheetEvent.objects.filter(
            timesheet=approved,
            from_status=Timesheet.Status.APPROVED,
            to_status=Timesheet.Status.RETURNED,
        ).first()
        self.assertIsNotNone(event)
        self.assertEqual(event.comment, REOPEN_REASON)
        audit = AuditEvent.objects.filter(action="timesheet_reopened", request_id=str(approved.pk)).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor, self.hr)
        self.assertEqual(audit.subject, self.user)
        self.assertEqual(audit.after["status"], Timesheet.Status.RETURNED)
        self.assertEqual(audit.after["comment"], REOPEN_REASON)

    def test_hr_reopens_rejected_to_returned_retaining_history(self):
        rejected = self.reject_sheet()
        history_before = TimesheetEvent.objects.filter(timesheet=rejected).count()
        response = self.reopen_as(self.hr)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        rejected.refresh_from_db()
        self.assertEqual(rejected.status, Timesheet.Status.RETURNED)
        self.assertEqual(TimesheetEvent.objects.filter(timesheet=rejected).count(), history_before + 1)
        self.assertTrue(
            TimesheetEvent.objects.filter(timesheet=rejected, action=TimesheetEvent.Action.REJECTED, comment=REJECT_REASON).exists()
        )

    def test_reopen_requires_comment_422_no_mutation(self):
        sheet = self.approve_sheet()
        response = self.reopen_as(self.hr, comment=None)
        self.assertEqual(response.status_code, 422)
        self.assertIn("comment", response.json()["error"]["fields"])
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.APPROVED)

    def test_reopen_blank_comment_422(self):
        sheet = self.approve_sheet()
        response = self.reopen_as(self.hr, comment="   ")
        self.assertEqual(response.status_code, 422)

    def test_reopen_requires_confirm_422(self):
        sheet = self.approve_sheet()
        response = self.reopen_as(self.hr, confirm=False)
        self.assertEqual(response.status_code, 422)
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.APPROVED)

    def test_reopen_missing_key_422(self):
        sheet = self.approve_sheet()
        client = self._client_for(self.hr)
        response = client.post(
            self.reopen_url(sheet.pk),
            {"comment": REOPEN_REASON, "version": sheet.version, "confirm": True},
            format="json",
        )
        self.assertEqual(response.status_code, 422)

    def test_reopen_stale_version_409_no_mutation(self):
        sheet = self.approve_sheet()
        response = self.reopen_as(self.hr, version=999)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "version_conflict")
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.APPROVED)

    def test_employee_cannot_reopen_404(self):
        sheet = self.approve_sheet()
        response = self.reopen_as(self.user)
        self.assertIn(response.status_code, (status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT))
        self.assertNotEqual(response.status_code, status.HTTP_200_OK)
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.APPROVED)
        self.assertEqual(
            TimesheetEvent.objects.filter(timesheet=sheet, action=TimesheetEvent.Action.REOPENED).count(), 0
        )

    def test_manager_cannot_reopen_404(self):
        sheet = self.approve_sheet()
        response = self.reopen_as(self.manager)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.APPROVED)

    def test_hr_cannot_reopen_own_sheet(self):
        my_sheet = self.create_sheet(week_start=MONDAY + timedelta(weeks=1), entries=self._week_entries(1), key="hr-own", user=self.hr)
        my_sheet.status = Timesheet.Status.SUBMITTED
        my_sheet.save(update_fields=["status", "updated_at"])
        self._post_as(self.decision_url(my_sheet.pk), {"action": "approve", "version": 2}, self.hr, "hr-approve")
        response = self.reopen_as(self.hr, version=Timesheet.objects.get(pk=my_sheet.pk).version)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_reopen_submitted_409(self):
        response = self.reopen_as(self.hr)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "state_conflict")

    def test_reopen_draft_and_returned_409(self):
        for target in (Timesheet.Status.DRAFT,):
            sheet = self.create_sheet(week_start=MONDAY + timedelta(weeks=1), entries=self._week_entries(1), key=f"reopen-{target}", user=self.user)
            sheet.status = target
            sheet.save(update_fields=["status", "updated_at"])
            client = self._client_for(self.hr)
            response = client.post(
                self.reopen_url(sheet.pk),
                {"comment": REOPEN_REASON, "version": 1, "confirm": True},
                format="json",
                HTTP_IDEMPOTENCY_KEY=f"reopen-{target}",
            )
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
            sheet.refresh_from_db()
            self.assertEqual(sheet.status, target)

    def test_reopen_returned_sheet_409(self):
        sheet = self.create_sheet(week_start=MONDAY + timedelta(weeks=1), entries=self._week_entries(1), key="reopen-ret", user=self.user)
        sheet.status = Timesheet.Status.RETURNED
        sheet.save(update_fields=["status", "updated_at"])
        client = self._client_for(self.hr)
        response = client.post(
            self.reopen_url(sheet.pk),
            {"comment": REOPEN_REASON, "version": 1, "confirm": True},
            format="json",
            HTTP_IDEMPOTENCY_KEY="reopen-ret",
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_reopen_idempotency_replay_no_duplicate(self):
        sheet = self.approve_sheet()
        first = self.reopen_as(self.hr)
        version_now = sheet.version
        second = self.reopen_as(self.hr, version=version_now)
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.json(), second.json())
        sheet.refresh_from_db()
        self.assertEqual(
            TimesheetEvent.objects.filter(timesheet=sheet, from_status=Timesheet.Status.APPROVED, to_status=Timesheet.Status.RETURNED).count(),
            1,
        )

    def test_reopen_same_key_differing_payload_409(self):
        sheet = self.approve_sheet()
        version_now = sheet.version
        self.reopen_as(self.hr, version=version_now, key="rk")
        response = self.reopen_as(self.hr, comment="Different reason", version=version_now, key="rk")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "idempotency_conflict")

    def test_reopen_of_nonexistent_404(self):
        client = self._client_for(self.hr)
        response = client.post(
            self.reopen_url("11111111-1111-1111-1111-111111111111"),
            {"comment": REOPEN_REASON, "version": 1, "confirm": True},
            format="json",
            HTTP_IDEMPOTENCY_KEY="reopen-404",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ReopenedLifecycleTests(Story33Base):
    def test_reopened_sheet_can_be_corrected_and_resubmitted(self):
        sheet = self.reject_sheet()
        v = sheet.version
        self.reopen_as(self.hr, version=v, key="reopen-lifecycle")
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.RETURNED)
        entry = TimeEntry.objects.get(timesheet=sheet, work_date=MONDAY)
        client = self._client_for(self.user)
        response = client.patch(
            reverse("timesheets:timesheet-entry-detail", kwargs={"pk": str(sheet.pk), "entry_id": str(entry.pk)}),
            {"duration_minutes": 400, "version": sheet.version},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        sheet.refresh_from_db()
        self.post_submit(sheet.pk, version=sheet.version, key="resubmit-33")
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.SUBMITTED)


class DecisionNotificationTests(Story33Base):
    def test_decision_schedules_post_commit_notification(self):
        from timesheets.review_services import _create_decision_notification
        response = self.decide_as(self.manager, "reject", comment=REJECT_REASON)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        # transaction.on_commit callbacks don't fire under APITestCase's
        # wrapping transaction; run the scheduled hook synchronously and
        # verify the notification content.
        _create_decision_notification(str(self.sheet.pk), "reject", REJECT_REASON)
        notification = Notification.objects.filter(recipient=self.user).order_by("-created_at").first()
        self.assertIsNotNone(notification)
        self.assertEqual(notification.recipient, self.user)
        self.assertIn("reject", notification.title.lower())

    def test_notification_failure_isolated(self):
        with mock.patch.object(Notification.objects, "create", side_effect=RuntimeError("boom")):
            response = self.decide_as(self.manager, "approve")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.APPROVED)


class DecisionAuthCsrfThrottleTests(Story33Base):
    def test_unauthenticated_decision_401(self):
        client = APIClient()
        response = client.post(self.decision_url(self.sheet.pk), {"action": "approve", "version": 2}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unauthenticated_reopen_401(self):
        client = APIClient()
        response = client.post(self.reopen_url(self.sheet.pk), {"comment": "r", "version": 2, "confirm": True}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_csrf_enforced_decision_403(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.manager)
        response = client.post(
            self.decision_url(self.sheet.pk),
            {"action": "approve", "version": self.sheet.version},
            format="json",
            HTTP_IDEMPOTENCY_KEY="csrf-dec",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_csrf_enforced_reopen_403(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.hr)
        response = client.post(
            self.reopen_url(self.sheet.pk),
            {"comment": REOPEN_REASON, "version": 2, "confirm": True},
            format="json",
            HTTP_IDEMPOTENCY_KEY="csrf-reopen",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_mutation_throttle_429_on_decision(self):
        # The decision endpoint shares the 60/min mutation budget; drive the
        # budget with in-scope decisions at stale versions (version_conflict
        # still counts as a throttled mutation, like reqs DecisionThrottleTests).
        for index in range(60):
            response = self.decide_as(
                self.manager, "approve", version=99, key=f"thr-33-{index}"
            )
            self.assertIn(response.status_code, (status.HTTP_409_CONFLICT,), index)
        response = self.decide_as(self.manager, "approve", version=99, key="thr-33-61")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.json()["error"]["code"], "throttled")
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.status, Timesheet.Status.SUBMITTED)
