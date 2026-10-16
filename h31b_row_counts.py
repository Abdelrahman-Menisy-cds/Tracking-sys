"""H31b R1 — row counts for the accounts/timezone tables (before/after).

Usage: python row_counts.py [label]  — prints table, count pairs.
"""

import os
import sys

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.db import connection  # noqa: E402

TABLES = [
    "accounts_company",
    "accounts_user",
    "accounts_department",
    "accounts_employeeprofile",
    "accounts_managergrant",
    "accounts_subscriptioncode",
    "accounts_auditevent",
    "accounts_assistantconfig",
    "accounts_pendingdeviceflow",
    "accounts_companyprofile",
    "timesheets_timezoneconfig",
    "django_migrations",
]

label = sys.argv[1] if len(sys.argv) > 1 else "counts"
print(f"--- {label} ---")
with connection.cursor() as cursor:
    for table in TABLES:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            print(f"{table}: {cursor.fetchone()[0]}")
        except Exception as error:  # noqa: BLE001 — a missing table is data
            print(f"{table}: MISSING ({type(error).__name__})")
