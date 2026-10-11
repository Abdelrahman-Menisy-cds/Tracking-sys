"""Seed a subscription code idempotently (Story H14).

The value NEVER lives in the source: pass it via --code or the
SIGNUP_CODE environment variable. Re-running with the same value updates
the label/active state in place instead of duplicating the row.
"""
import os

from accounts.models import SubscriptionCode
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Create or refresh a subscription code for self-service HR signup "
        "(Story H14). Code comes from --code or $SIGNUP_CODE."
    )

    def add_arguments(self, parser):
        parser.add_argument("--code", help="The subscription code value (or set SIGNUP_CODE).")
        parser.add_argument("--label", default="", help="Short operator note for this code.")

    def handle(self, *args, **options):
        value = options["code"] or os.environ.get("SIGNUP_CODE")
        if not value:
            raise CommandError(
                "No code given: pass --code '<value>' or set the SIGNUP_CODE environment variable."
            )
        code, created = SubscriptionCode.objects.update_or_create(
            code=value,
            defaults={"label": options["label"], "is_active": True},
        )
        verb = "created" if created else "refreshed"
        self.stdout.write(f"  {verb}  subscription code {code.code!r} (label={code.label!r}, active={code.is_active})")
