"""Request draft services: create and edit, transactional with event rows."""
from uuid import uuid4

from django.db import transaction


@transaction.atomic
def create_draft(*, requester, request_type, title, details=""):
    """Create a DRAFT request and its append-only CREATED event."""
    from .models import EmployeeRequest, RequestEvent

    request = EmployeeRequest.objects.create(
        id=uuid4(),
        company=requester.company,  # H30 §2.6: explicit tenant anchor
        requester=requester,
        request_type=request_type,
        title=title,
        details=details,
        status=EmployeeRequest.Status.DRAFT,
    )
    RequestEvent.objects.create(
        request=request,
        company=request.company,  # H30 §2.6: explicit tenant anchor
        actor=requester,
        action=RequestEvent.Action.CREATED,
        from_status=None,
        to_status=EmployeeRequest.Status.DRAFT,
    )
    return request


@transaction.atomic
def edit_draft(*, request, editor, title, details=""):
    """Edit permitted fields of a DRAFT/RETURNED request; append EDITED event."""
    from .models import RequestEvent

    previous_status = request.status
    request.title = title
    request.details = details
    request.version += 1
    request.save(update_fields=["title", "details", "updated_at", "version"])
    RequestEvent.objects.create(
        request=request,
        company=request.company,  # H30 §2.6: explicit tenant anchor
        actor=editor,
        action=RequestEvent.Action.EDITED,
        from_status=previous_status,
        to_status=previous_status,
    )
    return request
