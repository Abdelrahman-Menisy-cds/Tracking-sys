"""Seed the three demo accounts, one per role.

The login screen offers a role picker. It does NOT grant a role — the server
still derives the role from the account you sign into. The picker only chooses
*which* demo account that is, so picking "Manager" and picking a manager email
by hand land in exactly the same place.

Idempotent: safe to re-run, and it only ever touches the three addresses below.
Re-running resets their password to the shared demo one on purpose — these
accounts exist to be clicked through, not to protect anything.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

DEMO_PASSWORD = "demo1234"

DEMO_ACCOUNTS = (
    ("employee@demo.local", "كريم مصطفى", "EMPLOYEE"),
    ("manager@demo.local", "هالة عبد الرحمن", "MANAGER"),
    ("hr@demo.local", "منى شريف", "HR"),
)


class Command(BaseCommand):
    help = "Create or refresh the demo accounts the login role picker selects."

    def handle(self, *args, **options):
        user_model = get_user_model()
        for email, full_name, role in DEMO_ACCOUNTS:
            user, created = user_model.objects.get_or_create(email=email)
            user.full_name = full_name
            user.role = role
            user.is_active = True
            user.is_staff = False
            user.is_superuser = False
            user.set_password(DEMO_PASSWORD)
            user.save()
            verb = "created" if created else "updated"
            self.stdout.write(f"  {verb}  {email:24} {role:9} {full_name}")

        self.stdout.write(f"\n  {len(DEMO_ACCOUNTS)} demo accounts ready — password: {DEMO_PASSWORD}")
