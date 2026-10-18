"""Tasks: create, assign, and the two lists the rail already links to.

The screen kept its vocabulary and its shell but no endpoint existed - the task
cycle lived in the mock layer that was deleted with the fixtures. This is the
server side: real rows, scoped to the company and to the caller's own work.

Ownership is the rule the UI promises: «مهامي» is what is assigned to you,
«مهام أنشأتها» is what you created, and a manager may hand a task to a direct
report. Nothing outside that is readable.
"""
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Task
from accounts.permissions import IsAuthenticated401


def _serialize(task):
    return {
        "id": task.id,
        "title": task.title,
        "details": task.details,
        "status": task.status,
        "due_date": task.due_date,
        "assignee_id": task.assignee_id,
        "assignee_name": task.assignee.full_name if task.assignee_id else None,
        "owner_id": task.owner_id,
        "created_at": task.created_at,
    }


class TaskListCreateView(APIView):
    """GET /api/v1/tasks - mine and created-by-me; POST - create one."""

    permission_classes = [IsAuthenticated401]

    def get(self, request):
        company = request.user.company
        assigned = Task.objects.filter(company=company, assignee=request.user)
        created = Task.objects.filter(company=company, owner=request.user)
        return Response(
            {
                "data": {
                    "mine": [_serialize(t) for t in assigned.order_by("-created_at")],
                    "created": [_serialize(t) for t in created.order_by("-created_at")],
                }
            }
        )

    def post(self, request):
        title = (request.data.get("title") or "").strip()
        if not title:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "A title is required.",
                        "fields": {"title": ["This field is required."]},
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # An assignee must be inside the caller's company, or the task would cross
        # a tenant boundary the rest of the API refuses.
        assignee = None
        assignee_id = request.data.get("assignee_id")
        if assignee_id not in (None, ""):
            assignee = (
                Task._meta.get_field("assignee")
                .related_model.objects.filter(
                    company=request.user.company, pk=assignee_id
                )
                .first()
            )
            if assignee is None:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Unknown assignee.",
                            "fields": {"assignee_id": ["Unknown assignee."]},
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        task = Task.objects.create(
            company=request.user.company,
            owner=request.user,
            assignee=assignee,
            title=title,
            details=request.data.get("details") or "",
            due_date=request.data.get("due_date") or None,
        )
        return Response({"data": _serialize(task)}, status=status.HTTP_201_CREATED)


class TaskDetailView(APIView):
    """PATCH /api/v1/tasks/<id> - move the status, or reassign.

    Only the owner or the assignee may touch it; anyone else gets a 404, so the
    answer never reveals that the row exists.
    """

    permission_classes = [IsAuthenticated401]

    def _resolve(self, request, task_id):
        return (
            Task.objects.filter(company=self.request.user.company, pk=task_id)
            .filter(models_q_owner_or_assignee(request.user))
            .first()
        )

    def patch(self, request, task_id):
        task = self._resolve(request, task_id)
        if task is None:
            return Response(
                {"error": {"code": "not_found", "message": "Not found.", "fields": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if "status" in request.data:
            value = request.data["status"]
            if value not in Task.Status.values:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Unknown status.",
                            "fields": {"status": ["Unknown status."]},
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            task.status = value
        if "title" in request.data and str(request.data["title"]).strip():
            task.title = str(request.data["title"]).strip()
        if "details" in request.data:
            task.details = request.data["details"] or ""
        task.save(update_fields=["status", "title", "details", "updated_at"])
        return Response({"data": _serialize(task)})


def models_q_owner_or_assignee(user):
    """The rows this caller may see: their own work, either side of it."""
    from django.db.models import Q

    return Q(owner=user) | Q(assignee=user)
