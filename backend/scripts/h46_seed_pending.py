"""Reproduce the owner's 19-row condition locally.

The PENDING_HR rows in hr@demo.local's company were seeded straight into the
DB with submitted_at=NULL, so `-submitted_at` sorts them to the back and the
queue's first page holds only 3 decidable rows. A PENDING_HR row that was
never submitted is the anomaly; giving 19 of them a real submitted_at makes
the queue look like the deployed one (19 decidable rows, ordered by
submitted_at) while created_at stays as seeded.

Run: DJANGO_USE_SQLITE=1 .venv/bin/python manage.py shell -c "exec(open('scripts/h46_seed_pending.py').read())"
"""
import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from reqs.models import EmployeeRequest

U = get_user_model()
hr = U.objects.get(email="hr@demo.local")
qs = list(
    EmployeeRequest.objects.filter(company=hr.company, status=EmployeeRequest.Status.PENDING_HR)
    .order_by("id")
)
base = timezone.now()
chosen = qs[:19]
ids = []
for i, row in enumerate(chosen):
    # Spread submissions over the last three days, newest first in the queue.
    row.submitted_at = base - timedelta(hours=i * 5 + 1)
    row.save(update_fields=["submitted_at"])
    ids.append(str(row.id))
print("seeded", len(ids))
print(json.dumps(ids))
