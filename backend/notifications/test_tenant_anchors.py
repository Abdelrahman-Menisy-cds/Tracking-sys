"""H30 R2 tests (§2.6 step 8): notifications tenant anchoring.

Notification.company is DENORMALIZED from recipient (mirrored at save time);
create_notification sets it explicitly too (notifications/services.py).
"""

import pytest

from accounts.models import Company, User
from notifications.models import Notification
from tenants.context import default_company

pytestmark = pytest.mark.django_db


def test_notification_mirrors_recipient_company():
    company_b = Company.objects.create(slug="ntf-b", name="NTF B")
    recipient = User.objects.create_user(
        company=company_b, email="ntf.b@x.test", password="pass-12345678"
    )

    notification = Notification.objects.create(recipient=recipient, kind="k", title="t")

    assert notification.company == company_b


def test_notification_via_create_notification_sets_company(db):
    from notifications.services import create_notification

    recipient = User.objects.create_user(
        company=default_company(), email="ntf.a@x.test", password="pass-12345678"
    )

    notification = create_notification(recipient=recipient, kind="k", title="t")

    assert notification.company == recipient.company
