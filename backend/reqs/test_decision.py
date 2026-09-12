"""Story 2.4 focused tests: review and decide a request.

Covers manager approve -> APPROVED / PENDING_HR routing, reject/return
terminal transitions, HR decisions in PENDING_HR, comment validation,
self-decision denial, cross-user 404, non-manager/non-HR denial, inactive
reviewer defense in depth (manager AND HR), terminal state 409, stale
version 409, idempotency (missing key, replay, differing payload, per-user
scoping), concurrency (one winner of two; same-key real-thread races on
TransactionTestCase: identical -> one transition/both 200, conflicting ->
one 200 + one 409, never IntegrityError), post-commit notification,
audit/event records, unauth 401, CSRF 403, and the 60/min mutation
throttle.
"""
from hashlib import sha256
from unittest.mock import patch as mock_patch
from uuid import uuid4

from django.core.cache import cache
from django.db import IntegrityError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import AuditEvent, EmployeeProfile, User
from notifications.models import Notification
from reqs.models import (
    DecisionIdempotencyRecord,
    EmployeeRequest,
    RequestEvent,
    RequestType,
)
from reqs.decision_services import decide_request


def _make_request(requester, request_type, title, status, version=2, manager=None):
    return EmployeeRequest.objects.create(
        requester=requester,
        request_type=request_type,
        title=title,
        status=status,
        version=version,
        manager_at_submission=manager,
        current_assignee=manager,
        submitted_at=None,
    )


class DecisionTestBase(APITestCase):
    def setUp(self):
        cache.clear()
        self.employee = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.manager = User.objects.create_user(
            email="mgr@example.com", password="pass-12345678", role=User.Role.MANAGER
        )
        self.manager2 = User.objects.create_user(
            email="mgr2@example.com", password="pass-12345678", role=User.Role.MANAGER
        )
        self.hr = User.objects.create_user(
            email="hr@example.com", password="pass-12345678", role=User.Role.HR
        )
        self.other = User.objects.create_user(email="other@example.com", password="pass-12345678")
        EmployeeProfile.objects.create(user=self.employee, manager=self.manager, employee_number="E-001")
        EmployeeProfile.objects.create(user=self.other, employee_number="E-002")
        self.type_manager = RequestType.objects.create(
            name="Equipment", requires_manager_approval=True, requires_hr_approval=False
        )
        self.type_both = RequestType.objects.create(
            name="Leave", requires_manager_approval=True, requires_hr_approval=True
        )
        self.type_hr_only = RequestType.objects.create(
            name="Grievance", requires_manager_approval=False, requires_hr_approval=True
        )
        self.pending = _make_request(
            self.employee, self.type_manager, "New laptop",
            EmployeeRequest.Status.PENDING_MANAGER, manager=self.manager,
        )
        self.url = reverse("reqs:request-decision", kwargs={"pk": self.pending.pk})

    def decide(self, req=None, action="approve", comment=None, version=2, key="d-1", user=None, **kw):
        target = req or self.pending
        url = reverse("reqs:request-decision", kwargs={"pk": target.pk})
        payload = {"action": action, "version": version}
        if comment is not None:
            payload["comment"] = comment
        client = self.client
        if user is not None:
            client = APIClient()
            client.force_login(user)
        return client.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=key, **kw)

    def refresh(self):
        self.pending.refresh_from_db()
        return self.pending


class ManagerDecisionTests(DecisionTestBase):
    def test_manager_approve_no_hr_required_goes_approved(self):
        response = self.decide(user=self.manager, action="approve", key="a-1")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.APPROVED)
        self.assertEqual(request_obj.version, 3)
        self.assertIsNone(request_obj.current_assignee)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.APPROVED)
        self.assertEqual(event.actor, self.manager)
        self.assertEqual(event.from_status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertEqual(event.to_status, EmployeeRequest.Status.APPROVED)
        self.assertEqual(event.comment, "")
        self.assertTrue(
            AuditEvent.objects.filter(action="request_approved", subject=self.employee).exists()
        )

    def test_manager_approve_hr_required_goes_pending_hr(self):
        request_obj = _make_request(
            self.employee, self.type_both, "Leave",
            EmployeeRequest.Status.PENDING_MANAGER, manager=self.manager,
        )
        response = self.decide(req=request_obj, action="approve", key="a-2", user=self.manager)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_HR)
        self.assertIsNone(request_obj.current_assignee)
        self.assertEqual(request_obj.version, 3)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.APPROVED)
        self.assertEqual(event.to_status, EmployeeRequest.Status.PENDING_HR)

    def test_manager_reject_requires_comment_and_is_terminal(self):
        response = self.decide(user=self.manager, action="reject", comment="Not allowed.", key="r-1")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.REJECTED)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.REJECTED)
        self.assertEqual(event.comment, "Not allowed.")
        self.assertTrue(
            AuditEvent.objects.filter(action="request_rejected", subject=self.employee).exists()
        )

    def test_manager_return_goes_returned(self):
        response = self.decide(user=self.manager, action="return", comment="Add details.", key="ret-1")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.RETURNED)
        event = RequestEvent.objects.get(request=self.pending, action=RequestEvent.Action.RETURNED)
        self.assertEqual(
            (event.from_status, event.to_status),
            (EmployeeRequest.Status.PENDING_MANAGER, EmployeeRequest.Status.RETURNED),
        )

    def test_decision_notification_created_after_commit(self):
        self.decide(user=self.manager, action="reject", comment="No.", key="n-1")
        # transaction.on_commit callbacks don't fire under APITestCase's
        # wrapping transaction; run the scheduled hook synchronously.
        from reqs.decision_notifications import _notify_requester

        _notify_requester(self.pending.pk, "request_updated", "Your request was rejected", "No.")
        notification = Notification.objects.get(recipient=self.employee)
        self.assertEqual(notification.kind, "request_updated")
        self.assertIn("rejected", notification.title.lower())
        self.assertEqual(notification.body, "No.")
        self.assertIsNone(notification.read_at)

    def test_notification_scheduling_failure_preserves_committed_decision(self):
        with mock_patch(
            "reqs.decision_services.notify_requester_of_decision",
            side_effect=RuntimeError("notification scheduler unavailable"),
        ):
            response = self.decide(user=self.manager, action="approve", key="n-2")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.APPROVED)
        self.assertEqual(request_obj.version, 3)
        self.assertEqual(RequestEvent.objects.filter(request=request_obj).count(), 1)
        self.assertEqual(AuditEvent.objects.filter(subject=self.employee).count(), 1)
        self.assertEqual(DecisionIdempotencyRecord.objects.filter(user=self.manager).count(), 1)


class HRDecisionTests(DecisionTestBase):
    def setUp(self):
        super().setUp()
        self.hr_pending = _make_request(
            self.employee, self.type_hr_only, "Grievance",
            EmployeeRequest.Status.PENDING_HR, version=2, manager=None,
        )

    def test_hr_approve_goes_approved(self):
        response = self.decide(req=self.hr_pending, action="approve", key="h-1", user=self.hr)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.hr_pending.refresh_from_db()
        self.assertEqual(self.hr_pending.status, EmployeeRequest.Status.APPROVED)
        self.assertEqual(self.hr_pending.version, 3)

    def test_hr_reject_and_return(self):
        response = self.decide(req=self.hr_pending, action="reject", comment="No basis.", key="h-2", user=self.hr)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.hr_pending.refresh_from_db()
        self.assertEqual(self.hr_pending.status, EmployeeRequest.Status.REJECTED)

        second = _make_request(
            self.employee, self.type_hr_only, "Grievance 2",
            EmployeeRequest.Status.PENDING_HR, version=2, manager=None,
        )
        response = self.decide(req=second, action="return", comment="Add evidence.", key="h-3", user=self.hr)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        second.refresh_from_db()
        self.assertEqual(second.status, EmployeeRequest.Status.RETURNED)

    def test_manager_cannot_decide_pending_hr(self):
        response = self.decide(req=self.hr_pending, action="approve", key="h-4", user=self.manager)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, response.json())
        self.hr_pending.refresh_from_db()
        self.assertEqual(self.hr_pending.status, EmployeeRequest.Status.PENDING_HR)

    def test_hr_cannot_decide_pending_manager(self):
        response = self.decide(action="approve", key="h-5", user=self.hr)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, response.json())
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.PENDING_MANAGER)


class CommentValidationTests(DecisionTestBase):
    def test_reject_without_comment_422_no_mutation(self):
        response = self.decide(user=self.manager, action="reject", omit_comment=True, key="c-1")
        self.assertEqual(response.status_code, 422, response.json())
        self.assertIn("comment", response.json()["error"]["fields"])
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertEqual(request_obj.version, 2)
        self.assertEqual(RequestEvent.objects.filter(request=request_obj).count(), 0)

    def test_reject_blank_comment_422(self):
        response = self.decide(user=self.manager, action="reject", comment="   ", key="c-2")
        self.assertEqual(response.status_code, 422)
        self.assertIn("comment", response.json()["error"]["fields"])

    def test_return_without_comment_422(self):
        response = self.decide(user=self.manager, action="return", omit_comment=True, key="c-3")
        self.assertEqual(response.status_code, 422)

    def test_approve_without_comment_allowed(self):
        response = self.decide(user=self.manager, action="approve", key="c-4")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_comment_bounded_422(self):
        response = self.decide(
            user=self.manager, action="reject", comment="x" * 2001, key="c-5"
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("comment", response.json()["error"]["fields"])
        self.assertEqual(self.refresh().version, 2)


class DecisionAuthTests(DecisionTestBase):
    def test_self_decision_denied(self):
        response = self.decide(user=self.employee, action="approve", key="s-1")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, response.json())
        self.assertEqual(response.json()["error"]["code"], "self_decision_forbidden")
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertEqual(RequestEvent.objects.filter(request=request_obj).count(), 0)

    def test_manager_outside_direct_report_scope_404(self):
        # manager2 is a MANAGER but not this requester's snapshot manager.
        response = self.decide(user=self.manager2, action="approve", key="s-2")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, response.json())
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.PENDING_MANAGER)

    def test_plain_employee_cannot_decide_others_404(self):
        response = self.decide(user=self.other, action="approve", key="s-3")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, response.json())

    def test_inactive_manager_denied(self):
        # AC-01: inactive users cannot authenticate (401), so they can never
        # mutate; the active-reviewer service check stays as defense in depth.
        self.manager.is_active = False
        self.manager.save(update_fields=["is_active"])
        response = self.decide(user=self.manager, action="approve", key="s-4")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_nonexistent_request_404(self):
        response = self.decide(req=EmployeeRequest(id=uuid4()), action="approve", key="s-5", user=self.manager)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unauthenticated_401(self):
        response = self.decide(action="approve", key="s-6")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_csrf_enforced_403(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.manager)
        response = client.post(
            self.url, {"action": "approve", "version": 2}, format="json", HTTP_IDEMPOTENCY_KEY="s-7"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_protected_fields_422(self):
        client = APIClient()
        client.force_login(self.manager)
        response = client.post(
            self.url,
            {"action": "approve", "version": 2, "status": "APPROVED"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="s-8",
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("status", response.json()["error"]["fields"])

    def test_invalid_action_422(self):
        response = self.decide(user=self.manager, action="cancel", key="s-9")
        self.assertEqual(response.status_code, 422)
        self.assertIn("action", response.json()["error"]["fields"])

    def test_missing_idempotency_key_422(self):
        client = APIClient()
        client.force_login(self.manager)
        response = client.post(self.url, {"action": "approve", "version": 2}, format="json")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "idempotency_key_required")


class TerminalAndConflictTests(DecisionTestBase):
    def test_terminal_states_no_further_decisions_409(self):
        for terminal in (EmployeeRequest.Status.APPROVED, EmployeeRequest.Status.REJECTED):
            request_obj = _make_request(
                self.employee, self.type_manager, f"Done {terminal}",
                terminal, version=3, manager=self.manager,
            )
            response = self.decide(req=request_obj, action="approve", key=f"t-{terminal}", user=self.manager)
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, terminal)
            self.assertEqual(response.json()["error"]["code"], "state_conflict")
            request_obj.refresh_from_db()
            self.assertEqual(request_obj.status, terminal)
            self.assertEqual(request_obj.version, 3)

    def test_nonpending_states_409(self):
        for state in (EmployeeRequest.Status.DRAFT, EmployeeRequest.Status.RETURNED, EmployeeRequest.Status.CANCELLED):
            request_obj = _make_request(
                self.employee, self.type_manager, f"State {state}",
                state, version=3, manager=self.manager,
            )
            response = self.decide(req=request_obj, action="reject", comment="x", key=f"n-{state}", user=self.manager)
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, state)
            request_obj.refresh_from_db()
            self.assertEqual(request_obj.status, state)

    def test_stale_version_409_no_event(self):
        response = self.decide(user=self.manager, action="approve", version=99, key="v-1")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "version_conflict")
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertEqual(request_obj.version, 2)
        self.assertEqual(RequestEvent.objects.filter(request=request_obj).count(), 0)

    def test_concurrent_decisions_one_wins(self):
        # Simulate two simultaneous decisions: first applies under lock, the
        # second sees the changed version/state and conflicts 409.
        first = self.decide(user=self.manager, action="approve", key="cc-1")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        second = self.decide(user=self.manager, action="reject", comment="late", version=2, key="cc-2")
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        second_stale = self.decide(user=self.manager, action="reject", comment="late", version=3, key="cc-3")
        self.assertEqual(second_stale.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.APPROVED)
        self.assertEqual(
            RequestEvent.objects.filter(request=self.pending).count(), 1
        )


class DecisionIdempotencyTests(DecisionTestBase):
    def test_same_key_same_payload_replays(self):
        first = self.decide(user=self.manager, action="approve", key="i-1")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        version_after = self.refresh().version
        second = self.decide(user=self.manager, action="approve", key="i-1")
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(self.refresh().version, version_after)
        self.assertEqual(
            RequestEvent.objects.filter(request=self.pending, action=RequestEvent.Action.APPROVED).count(),
            1,
        )
        # The replay path must not schedule a second post-commit notification.
        self.assertEqual(Notification.objects.count(), 0)

    def test_same_key_differing_payload_409(self):
        first = self.decide(user=self.manager, action="approve", key="i-2")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        second = self.decide(user=self.manager, action="approve", version=3, key="i-2")
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.json()["error"]["code"], "idempotency_conflict")
        third = self.decide(user=self.manager, action="reject", comment="x", version=2, key="i-2")
        self.assertEqual(third.status_code, status.HTTP_409_CONFLICT)

    def test_idempotency_scoped_per_user(self):
        # Same key held by two different users: records are scoped by user,
        # so the second user's use of the same key is unknown to them (and a
        # replay of one user's key by the other never leaks their snapshot).
        self.decide(user=self.manager, action="approve", key="shared-decision")
        other_pending = _make_request(
            self.other, self.type_manager, "Other's",
            EmployeeRequest.Status.PENDING_MANAGER, manager=self.manager,
        )
        response = self.decide(
            req=other_pending, action="approve", key="shared-decision", user=self.manager
        )
        # Same reviewer + same key + different request payload -> 409.
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_no_duplicate_events_on_retries(self):
        for _ in range(3):
            self.decide(user=self.manager, action="reject", comment="No.", key="retry-1")
        self.assertEqual(
            RequestEvent.objects.filter(request=self.pending, action=RequestEvent.Action.REJECTED).count(),
            1,
        )
        self.assertEqual(
            AuditEvent.objects.filter(action="request_rejected", subject=self.employee).count(),
            1,
        )
        self.assertEqual(DecisionIdempotencyRecord.objects.filter(user=self.manager).count(), 1)


class DecisionIdempotencyConcurrencyTests(APITestCase):
    """QA finding B regression: same reviewer + same Idempotency-Key races.

    The Decisions API runs under real multi-worker WSGI servers (gunicorn /
    waitress threads), so concurrent same-key requests interleave in
    production. SQLite (file-level writer lock) cannot exercise a
    live-connection UniqueConstraint race in this suite, so the race's
    losing branch is driven deterministically at the handler boundary:
    force the idempotency-record insert to lose the unique-constraint race
    (IntegrityError from a concurrently committed winner) and assert the
    service maps it through the same re-read + replay/conflict paths the
    Postgres race produces — no IntegrityError ever escapes, exactly one
    transition/event stands, and the loser replays/conflicts cleanly.
    The UniqueConstraint itself is additionally covered by Django's
    schema/migration validation (check - -migrations / makemigrations
    --check in CI), and the constraint's arbitration relies solely on the
    standard IntegrityError path exercised here.
    """

    def setUp(self):
        cache.clear()
        self.employee = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.manager = User.objects.create_user(
            email="mgr@example.com", password="pass-12345678", role=User.Role.MANAGER
        )
        EmployeeProfile.objects.create(user=self.employee, manager=self.manager, employee_number="E-001")
        self.type_manager = RequestType.objects.create(
            name="Equipment", requires_manager_approval=True, requires_hr_approval=False
        )
        self.pending = EmployeeRequest.objects.create(
            requester=self.employee,
            request_type=self.type_manager,
            title="New laptop",
            status=EmployeeRequest.Status.PENDING_MANAGER,
            version=2,
            manager_at_submission=self.manager,
            current_assignee=self.manager,
        )
        self.url = reverse("reqs:request-decision", kwargs={"pk": self.pending.pk})
        self.key = "race-key"
        self.key_hash = sha256(self.key.encode()).hexdigest()
        # Mirror the view's payload fingerprint exactly.
        self.payload_hash_for = lambda action, version=2, comment="": sha256(
            f"{self.pending.pk}:{version}:{action}:{comment}".encode()
        ).hexdigest()
        self.payload_hash = self.payload_hash_for("approve")

    def _client(self):
        client = APIClient()
        client.force_login(self.manager)
        return client

    def test_concurrent_identical_loser_replays_no_leak(self):
        # Deterministic regression for the losing side of a real same-key
        # race (SQLite cannot run a live-connection UniqueConstraint race in
        # this suite): the winner's row is committed BUT only becomes
        # visible to the loser AFTER its own insert is rejected by the
        # unique constraint — first filter call (pre-check) hides it, the
        # service's insert then raises IntegrityError, and the post-failure
        # re-read sees the committed winner. Expected outcome: loser replays
        # the winner's 200 snapshot, its own transition/events roll back,
        # and no IntegrityError ever escapes.
        winner_payload = {"data": {"version": 3}}
        # The committed winner ALREADY performed its transition: its event
        # exists, version is already bumped. The loser must add nothing.
        RequestEvent.objects.create(
            request=self.pending,
            actor=self.manager,
            action=RequestEvent.Action.APPROVED,
            from_status=EmployeeRequest.Status.PENDING_MANAGER,
            to_status=EmployeeRequest.Status.APPROVED,
            comment="",
        )
        self.pending.status = EmployeeRequest.Status.APPROVED
        self.pending.version = 3
        self.pending.current_assignee = None
        self.pending.save(update_fields=["status", "version", "current_assignee", "updated_at"])
        committed_winner = DecisionIdempotencyRecord.objects.create(
            key_hash=self.key_hash,
            payload_hash=self.payload_hash,
            response_snapshot=winner_payload,
            user=self.manager,
        )
        real_filter = DecisionIdempotencyRecord.objects.filter
        pre_check_done = False

        def hidden_then_visible_filter(*args, **kwargs):
            nonlocal pre_check_done
            # Only the loser's FIRST lookup (the in-transaction pre-check)
            # must miss: pass through everything after it so the service's
            # post-IntegrityError re-read sees the committed winner.
            if not pre_check_done:
                pre_check_done = True
                return DecisionIdempotencyRecord.objects.none()
            return real_filter(*args, **kwargs)

        def insert_fails(*args, **kwargs):
            # The "concurrent" winner beat us to (key_hash, user); the
            # unique constraint rejects our insert. The committed winner row
            # exists in the same test transaction so it is visible here.
            raise IntegrityError(
                "duplicate key value violates unique constraint uniq_decision_idem_key_user"
            )

        with mock_patch.object(DecisionIdempotencyRecord.objects, "create", side_effect=insert_fails), \
             mock_patch.object(DecisionIdempotencyRecord.objects, "filter", side_effect=hidden_then_visible_filter):
            response = self._client().post(
                self.url,
                {"action": "approve", "version": 2},
                format="json",
                HTTP_IDEMPOTENCY_KEY=self.key,
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json(), winner_payload)
        # Exactly one event and one idempotency record: the loser's
        # own transition + events rolled back; only the committed winner.
        self.assertEqual(
            RequestEvent.objects.filter(request=self.pending).count(), 1
        )
        self.assertEqual(
            DecisionIdempotencyRecord.objects.filter(
                user=self.manager, key_hash=self.key_hash
            ).count(),
            1,
        )
        self.assertEqual(committed_winner.payload_hash, self.payload_hash)

    def test_concurrent_conflicting_loser_409_not_integrity_error(self):
        # Same-key race with a DIFFERING payload: unique constraint rejects
        # the loser's insert, the post-failure re-read sees the committed
        # winner (different payload) and maps to 409 idempotency_conflict.
        # The loser's own (would-be) transition must roll back with its
        # event: the request stays PENDING with zero RequestEvent rows.
        # The failing side gets a safe 409, never a 500/IntegrityError.
        conflicting_payload_hash = self.payload_hash_for("reject", 2, "No.")
        committed_winner = DecisionIdempotencyRecord.objects.create(
            key_hash=self.key_hash,
            payload_hash=conflicting_payload_hash,
            response_snapshot={"data": {"action": "reject", "status": EmployeeRequest.Status.PENDING_MANAGER}},
            user=self.manager,
        )
        real_filter = DecisionIdempotencyRecord.objects.filter
        pre_check_done = False

        def hidden_then_visible_filter(*args, **kwargs):
            nonlocal pre_check_done
            if not pre_check_done:
                pre_check_done = True
                return DecisionIdempotencyRecord.objects.none()
            return real_filter(*args, **kwargs)

        def insert_fails(*args, **kwargs):
            raise IntegrityError(
                "duplicate key value violates unique constraint uniq_decision_idem_key_user"
            )

        with mock_patch.object(DecisionIdempotencyRecord.objects, "create", side_effect=insert_fails), \
             mock_patch.object(DecisionIdempotencyRecord.objects, "filter", side_effect=hidden_then_visible_filter):
            response = self._client().post(
                self.url,
                {"action": "approve", "version": 2},
                format="json",
                HTTP_IDEMPOTENCY_KEY=self.key,
            )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "idempotency_conflict")
        self.assertEqual(
            RequestEvent.objects.filter(request=self.pending).count(), 0
        )
        self.assertEqual(
            DecisionIdempotencyRecord.objects.filter(
                user=self.manager, key_hash=self.key_hash
            ).count(),
            1,
        )
        self.assertEqual(committed_winner.payload_hash, conflicting_payload_hash)

    def test_threads_do_not_leak_integrity_error_in_normal_path(self):
        # Same-key handler-equivalent serialized retries (SQLite's file
        # lock serializes these like a legitimate post-commit replay):
        # each retry must hit the committed replay path — 200 identical,
        # exactly one event, exactly one record. Catches any regression
        # that would duplicate transitions or leak IntegrityError/500.
        results = {}
        for thread_index in ("t1", "t2"):
            response = self._client().post(
                self.url,
                {"action": "approve", "version": 2},
                format="json",
                HTTP_IDEMPOTENCY_KEY=self.key,
            )
            results[thread_index] = (response.status_code, response.json())

        for code, _ in results.values():
            self.assertEqual(code, status.HTTP_200_OK, results)
        self.assertEqual(results["t1"][1], results["t2"][1])
        self.assertEqual(
            RequestEvent.objects.filter(
                request=self.pending, action=RequestEvent.Action.APPROVED
            ).count(),
            1,
        )
        self.assertEqual(
            DecisionIdempotencyRecord.objects.filter(
                user=self.manager, key_hash=self.key_hash
            ).count(),
            1,
        )


class InactiveReviewerDefenseInDepthTests(APITestCase):
    """QA finding A regression: an inactive reviewer must receive a safe
    denial (no transition, no event, no idempotency record) from the service
    itself — even when the reviewer object reaches it while inactive
    (deactivated between authentication and the locked transaction)."""

    def setUp(self):
        cache.clear()
        self.employee = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.hr = User.objects.create_user(
            email="hr@example.com", password="pass-12345678", role=User.Role.HR
        )
        self.type_hr_only = RequestType.objects.create(
            name="Grievance", requires_manager_approval=False, requires_hr_approval=True
        )
        self.hr_pending = EmployeeRequest.objects.create(
            requester=self.employee,
            request_type=self.type_hr_only,
            title="Grievance",
            status=EmployeeRequest.Status.PENDING_HR,
            version=2,
        )

    def _hashes(self, key: bytes):
        return (
            sha256(key).hexdigest(),
            sha256(f"{self.hr_pending.pk}:2:approve:".encode()).hexdigest(),
        )

    def test_inactive_hr_service_denial_no_transition_no_event(self):
        # Deactivate the reviewer row AFTER building the in-memory reviewer
        # object, so authentication cannot filter it out: only the service's
        # own active check can deny this request.
        requester = User.objects.create_user(email="emp2@example.com", password="pass-12345678")
        self.hr_pending = EmployeeRequest.objects.create(
            requester=requester,
            request_type=self.type_hr_only,
            title="Grievance 2",
            status=EmployeeRequest.Status.PENDING_HR,
            version=2,
        )
        reviewer = User.objects.get(pk=self.hr.pk)
        User.objects.filter(pk=self.hr.pk).update(is_active=False)
        self.hr_pending.refresh_from_db()
        key_hash, payload_hash = self._hashes(b"ia-1")
        with self.assertRaises(LookupError):
            decide_request(
                reviewer=reviewer,
                request_obj=self.hr_pending,
                action="approve",
                comment="",
                version=2,
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        self.hr_pending.refresh_from_db()
        self.assertEqual(self.hr_pending.status, EmployeeRequest.Status.PENDING_HR)
        self.assertEqual(self.hr_pending.version, 2)
        self.assertEqual(RequestEvent.objects.filter(request=self.hr_pending).count(), 0)
        self.assertEqual(AuditEvent.objects.filter(subject=self.employee).count(), 0)
        self.assertEqual(DecisionIdempotencyRecord.objects.count(), 0)

    def test_active_hr_service_still_allows(self):
        key_hash, payload_hash = self._hashes(b"ia-1")
        decide_request(
            reviewer=self.hr,
            request_obj=self.hr_pending,
            action="approve",
            comment="",
            version=2,
            key_hash=key_hash,
            payload_hash=payload_hash,
        )
        self.hr_pending.refresh_from_db()
        self.assertEqual(self.hr_pending.status, EmployeeRequest.Status.APPROVED)
        self.assertEqual(RequestEvent.objects.filter(request=self.hr_pending).count(), 1)

    def test_inactive_manager_service_denial_no_transition_no_event(self):
        # Same defense-in-depth guarantee on the manager branch.
        manager = User.objects.create_user(
            email="mgr@example.com", password="pass-12345678", role=User.Role.MANAGER
        )
        EmployeeProfile.objects.create(user=self.employee, manager=manager, employee_number="E-002")
        pending = EmployeeRequest.objects.create(
            requester=self.employee,
            request_type=self.type_hr_only,  # unused for manager branch
            title="Laptop",
            status=EmployeeRequest.Status.PENDING_MANAGER,
            version=2,
            manager_at_submission=manager,
            current_assignee=manager,
        )
        User.objects.filter(pk=manager.pk).update(is_active=False)
        inactive_manager = User.objects.get(pk=manager.pk)
        with self.assertRaises(LookupError):
            decide_request(
                reviewer=inactive_manager,
                request_obj=pending,
                action="approve",
                comment="",
                version=2,
                key_hash=sha256(b"ia-m").hexdigest(),
                payload_hash=sha256(f"{pending.pk}:2:approve:".encode()).hexdigest(),
            )
        pending.refresh_from_db()
        self.assertEqual(pending.status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertEqual(RequestEvent.objects.filter(request=pending).count(), 0)


class DecisionThrottleTests(DecisionTestBase):
    def test_throttled_429_on_61st_mutation(self):
        for index in range(60):
            response = self.decide(
                user=self.manager, action="approve", version=99, key=f"thr-{index}"
            )
            self.assertIn(response.status_code, (status.HTTP_200_OK, status.HTTP_409_CONFLICT), index)
        response = self.decide(user=self.manager, action="approve", version=99, key="thr-61")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.json()["error"]["code"], "throttled")
