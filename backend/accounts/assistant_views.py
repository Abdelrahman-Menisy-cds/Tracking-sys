"""Assistant endpoints — Story H18 (the «مدام عفاف» assistant).

  GET  /api/v1/assistant/config             the CALLER'S own config (no key)
  PUT  /api/v1/assistant/config             set base_url/model/(key)
  POST /api/v1/assistant/test               the Test button (provider's own failure)
  GET  /api/v1/employees/<id>/assistant     HR-only read (no key)
  PUT  /api/v1/employees/<id>/assistant     HR-only write + activate, audited
  POST /api/v1/assistant/chat               the conversation (server-side key only)
  POST /api/v1/assistant/actions/<t>/confirm  run ONE confirmed write

Permission posture: the employee endpoints use the company_views.py precedent
(the standard 403 permission_denied envelope for an authenticated non-HR
caller) because the FRONTEND contract freezes /employees/<id>/assistant as an
HR surface it renders in the employee file; the IsHR class' 404-styled
non-disclosure is the right choice for an employee's manager, so both roles
are denied here and the 403 envelope is what the SPA's error surface expects.
The key, in any response, is only ever the hint.
"""
import concurrent.futures
import json
import logging
import time

from django.db import transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import assistant_chat, assistant_provider, assistant_subscriptions
from accounts.assistant_actions import ActionTokenError
from accounts.assistant_chat import ChatConfigError, assistant_chat as run_assistant_chat, confirm_action
from accounts.assistant_crypto import AssistantSecretError, decrypt_key, encrypt_key, key_hint
from accounts.assistant_serializers import (
    AssistantConfigHRWriteSerializer,
    AssistantConfigReadSerializer,
    AssistantConfigSelfWriteSerializer,
)
from accounts.assistant_subscriptions import (
    PROVIDERS,
    SubscriptionError,
    import_local,
    list_models,
    poll_device_flow,
    provider_capability,
    start_device_flow,
    store_subscription,
    unlink_expired,
)
from accounts.models import AssistantConfig, AuditEvent, User
from accounts.permissions import IsAuthenticated401
from accounts.throttles import MutationRateThrottle
from config.api import error_payload

logger = logging.getLogger(__name__)

# H25: whatever the import does (local store read, row write), it may hold
# the request thread no longer than this. The suite's silent-provider test
# proves the endpoint answers a real error, inside the ceiling, never a 000.
IMPORT_WORK_CEILING_SECONDS = assistant_subscriptions.IMPORT_CEILING_SECONDS


class AssistantChatMessagesSerializer:
    """Tiny role/shape check without a formal DRF class: the chat body is
    {"messages": [{"role": "user"|"assistant", "content": str}, ...]}."""

    MAX_MESSAGES = 40
    MAX_CONTENT_CHARS = 8000

    @classmethod
    def errors(cls, body):
        if not isinstance(body, dict):
            return ["The body must be a JSON object."]
        messages = body.get("messages")
        if not isinstance(messages, list):
            return ["messages must be a list of {role, content}."]
        if not messages:
            return ["messages cannot be empty."]
        if len(messages) > cls.MAX_MESSAGES:
            return [f"At most {cls.MAX_MESSAGES} messages are allowed."]
        for message in messages:
            if not isinstance(message, dict):
                return ["Every message must be an object."]
            if message.get("role") not in ("user", "assistant"):
                return ["Every message role must be user or assistant."]
            content = message.get("content")
            if not isinstance(content, str) or not content.strip():
                return ["Every message needs non-blank content."]
            if len(content) > cls.MAX_CONTENT_CHARS:
                return [f"Every message is limited to {cls.MAX_CONTENT_CHARS} characters."]
        extra = set(body) - {"messages"}
        if extra:
            # Test 10: the chat endpoint never accepts a client-supplied key
            # or base URL — they are refused among the protected fields.
            return [
                {field: ["This field is managed by the server."]}
                for field in sorted(extra)
            ] or ["Unknown fields in the body."]
        return None


def _error(request, code, message, fields, status_code):
    return Response(
        error_payload(code=code, message=message, fields=fields, request=request),
        status=status_code,
    )


def _get_own_config(user) -> AssistantConfig:
    config, _created = AssistantConfig.objects.get_or_create(user=user)
    return config  # noqa: RET504 - return the same row the caller will use


def _get_employee(target_id):
    """The HR-visible workforce account, else None (same visibility as the
    employee admin list: HR actors and break-glass accounts excluded)."""
    return (
        User.objects.filter(
            pk=target_id,
            is_staff=False,
            is_superuser=False,
        )
        .exclude(role=User.Role.HR)
        .first()
    )


def _hr_denied(request):
    return _error(
        request,
        "permission_denied",
        "You do not have permission to perform this action.",
        {},
        status.HTTP_403_FORBIDDEN,
    )


class AssistantConfigView(APIView):
    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        config = _get_own_config(request.user)
        return Response({"data": AssistantConfigReadSerializer(config).data})

    def put(self, request):
        serializer = AssistantConfigSelfWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        config = _get_own_config(request.user)

        if validated.get("mode") == "subscription":
            # H19 subscription mode: link the picked provider. The credential
            # comes from the LOCAL CLI login today (import), the device flow
            # runs through /assistant/subscription/start + /poll. Exactly one
            # credential per row: linking clears the api-key fields.
            # model is OPTIONAL here: a re-save that only changes the model
            # (pulled from /assistant/subscription/models) must not re-import
            # or touch the credential.
            if validated.get("subscription_provider"):
                import_result = import_local(validated["subscription_provider"])
                store_subscription(config, import_result, validated["subscription_provider"], "local")
            if validated.get("model"):
                config.model = validated["model"]
                config.save(update_fields=["model", "updated_at"])
            # Self-serve activation mirrors the api-key rule: a self-serve
            # link IS the gateway click unless HR has ever controlled the row.
            if not config.enabled_by_hr:
                config.is_active = True
                config.save(update_fields=["is_active", "updated_at"])
            config.refresh_from_db()
            return Response({"data": AssistantConfigReadSerializer(config).data})

        # api mode (H18): base_url/model required; also UNLINKS a previous
        # subscription — exactly one credential per row.
        if config.subscription_provider:
            assistant_subscriptions.clear_subscription(config)
            config.refresh_from_db()
        config.base_url = validated["base_url"]
        config.model = validated["model"]
        if validated.get("api_key"):
            # An employee may replace an HR-set key (owner's rule); the new
            # key is marked self by virtue of api_key_set_by = the caller.
            config.api_key_ciphertext = encrypt_key(validated["api_key"])
            config.api_key_hint = key_hint(validated["api_key"])
            config.api_key_set_by = request.user
        # Self-serve activation: linking your own key through /profile IS the
        # gateway click for a row HR has never touched (enabled_by_hr False —
        # the model's default). Without this the freshly linked employee sits
        # on a default is_active=False they never chose: the launcher stays
        # faded after a save (and after a reload — this is what H18 fix-up 2
        # traced). If HR has ever controlled the row (enabled_by_hr True),
        # HR's latest decision stands — a self-save must NOT resurrect a row
        # HR switched off; only the HR toggle may re-enable it.
        if (config.api_key_ciphertext or config.api_key_hint) and not config.enabled_by_hr:
            config.is_active = True
        config.save()
        return Response({"data": AssistantConfigReadSerializer(config).data})


class AssistantTestView(APIView):
    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def post(self, request):
        config = _get_own_config(request.user)
        if not config.is_configured:
            return _error(
                request,
                "not_configured",
                "Link a base URL, an API key, and a model first — or pick a subscription and link it.",
                {},
                status.HTTP_409_CONFLICT,
            )
        started = time.monotonic()
        if config.mode == "subscription":
            # Resolve ONCE (an expiring oauth set is refreshed in this single
            # ensure_fresh pass — never twice for one button press).
            try:
                spec, blob = assistant_subscriptions.ensure_fresh(config)
            except assistant_subscriptions.RefreshFailedError:
                unlink_expired(config)
                return _error(
                    request,
                    "not_configured",
                    "Your subscription login expired and the refresh failed — link it again in settings.",
                    {},
                    status.HTTP_409_CONFLICT,
                )
            except SubscriptionError as error:
                return _error(request, error.code, error.message, {}, status.HTTP_409_CONFLICT)
            if spec.wire_api == "responses":
                # The codex gateway speaks ONLY the Responses SSE wire API
                # (measured: 404 on chat/completions). One 1-token probe over
                # its own shape; the provider's own error text on failure.
                url, call_headers, call_body = assistant_subscriptions.completion_call(
                    spec, blob, config.model,
                    [{"role": "user", "content": "ping"}], [], stream=True,
                )
                try:
                    assistant_subscriptions.post_responses_stream(url, call_headers, call_body)
                except assistant_provider.ProviderResponseError as error:
                    latency = int((time.monotonic() - started) * 1000)
                    return Response({"data": {"ok": False, "latency_ms": latency, "detail": f"HTTP {error.status_code} from {error.url}: {error.detail}"}})
                except assistant_provider.ProviderUnreachableError as error:
                    latency = int((time.monotonic() - started) * 1000)
                    return Response({"data": {"ok": False, "latency_ms": latency, "detail": f"{error.url} is unreachable ({error.raw or 'the connection failed'})"}})
                return Response({"data": {"ok": True, "latency_ms": int((time.monotonic() - started) * 1000), "detail": "connection ok"}})
            base_url, stored_key, extra_headers = (
                spec.base_url,
                assistant_subscriptions.access_token(blob),
                assistant_subscriptions.chat_headers(spec, blob),
            )
        else:
            try:
                stored_key = decrypt_key(config.api_key_ciphertext)
            except AssistantSecretError as error:
                # The stored value exists but this server secret cannot open
                # it (e.g. an explicit ASSISTANT_SECRET_KEY rotated after the
                # save).
                return _error(
                    request,
                    "key_unreadable",
                    str(error),
                    {},
                    status.HTTP_409_CONFLICT,
                )
            base_url, extra_headers = config.base_url, None
        ok, latency_ms, detail = assistant_provider.probe_endpoint(
            base_url=base_url,
            api_key=stored_key,
            model=config.model,
            extra_headers=extra_headers,
        )
        return Response({"data": {"ok": ok, "latency_ms": latency_ms, "detail": detail}})


class AssistantHRConfigView(APIView):
    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def _authorized_target(self, request, target_id):
        if request.user.role != User.Role.HR:
            return None, _hr_denied(request)
        target = _get_employee(target_id)
        if target is None:
            return None, _error(
                request, "not_found", "Not found.", {}, status.HTTP_404_NOT_FOUND
            )
        return target, None

    def get(self, request, target_id):
        target, denial = self._authorized_target(request, target_id)
        if denial is not None:
            return denial
        config = _get_own_config(target)
        return Response({"data": AssistantConfigReadSerializer(config).data})

    def put(self, request, target_id):
        target, denial = self._authorized_target(request, target_id)
        if denial is not None:
            return denial
        serializer = AssistantConfigHRWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        before_snapshot = {}
        with transaction.atomic():
            config = (
                AssistantConfig.objects.select_for_update().filter(user=target).first()
            )
            if config is None:
                config = AssistantConfig(user=target)
            before_snapshot = {
                "base_url": config.base_url,
                "model": config.model,
                "has_key": bool(config.api_key_ciphertext or config.api_key_hint),
                "is_active": config.is_active,
                "enabled_by_hr": config.enabled_by_hr,
            }
            if "base_url" in validated:
                config.base_url = validated["base_url"]
            if "model" in validated:
                config.model = validated["model"]
            if validated.get("api_key"):
                config.api_key_ciphertext = encrypt_key(validated["api_key"])
                config.api_key_hint = key_hint(validated["api_key"])
                config.api_key_set_by = request.user
            if "is_active" in validated:
                config.is_active = validated["is_active"]
                config.enabled_by_hr = validated["is_active"]
            elif config.pk is None and (config.base_url or config.model or validated.get("api_key")):
                config.enabled_by_hr = True
            config.save()
            AuditEvent.objects.create(
                actor=request.user,
                subject=target,
                action="assistant.hr_config_updated",
                request_id=request.request_id or "",
                before=before_snapshot,
                after={
                    "base_url": config.base_url,
                    "model": config.model,
                    "has_key": bool(config.api_key_ciphertext or config.api_key_hint),
                    "is_active": config.is_active,
                    "enabled_by_hr": config.enabled_by_hr,
                    "api_key": "[redacted]" if validated.get("api_key") else "unchanged",
                },
            )
        return Response({"data": AssistantConfigReadSerializer(config).data})


class AssistantSubscriptionCapabilityView(APIView):
    """GET /assistant/subscription/capability?provider=<slug> — what this
    provider HONESTLY supports. H19 fix-up 4: the login button only shows
    where a provider actually offers one; no button exists here that can
    only fail against an invented endpoint."""

    permission_classes = [IsAuthenticated401]

    def get(self, request):
        provider = request.query_params.get("provider")
        try:
            capability = provider_capability(provider or "")
        except SubscriptionError as error:
            return _error(
                request,
                error.code,
                error.message,
                {},
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        return Response({"data": capability})


class AssistantSubscriptionImportView(APIView):
    """POST /assistant/subscription/import — link from the LOCAL CLI login
    the provider already holds on this machine (the demo fallback: the
    `opencode auth login` / `codex login` the owner already ran). The UI
    states plainly (subscription_source="local") where it came from."""

    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        provider = body.get("provider")
        # H25: the segment of the import work that CAN wedge (a CLI-store
        # read on a stalled disk, or any future provider call inside it)
        # runs under a hard ceiling; the DB writes stay on the request
        # thread — SQLite forbids a second writer thread while this
        # request's connection holds the row (the "table is locked" the
        # suite's silent-provider test caught). The endpoint ALWAYS
        # answers: success, or a clear actionable error
        # (`codex_import_failed`), never a hang, never an HTTP 000.

        def _do_import():
            return import_local(provider if isinstance(provider, str) else "")

        ceiling = IMPORT_WORK_CEILING_SECONDS
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="assistant-import")
        try:
            try:
                imported = executor.submit(_do_import).result(timeout=ceiling)
            except concurrent.futures.TimeoutError:
                raise SubscriptionError(
                    "codex_import_failed",
                    f"The provider did not answer within {ceiling} s — try again; if it keeps failing, run the provider's own login once on this machine and retry.",
                ) from None
            except concurrent.futures.CancelledError:
                raise SubscriptionError("codex_import_failed", "The import was cancelled before it completed.") from None
            config = _get_own_config(request.user)
            store_subscription(config, imported, provider if isinstance(provider, str) else "", "local")
        except SubscriptionError as error:
            # H25: the import ALWAYS answers — every provider-side failure
            # mode carries an actionable code (the provider's own status/
            # body travels in the message, scrubbed + truncated), and no
            # timeout path can escape this handler unbounded.
            http_status = {
                "unknown_provider": status.HTTP_422_UNPROCESSABLE_ENTITY,
                "no_local_login": status.HTTP_409_CONFLICT,
                "provider_unreachable": status.HTTP_502_BAD_GATEWAY,
                "provider_error": status.HTTP_502_BAD_GATEWAY,
                "codex_import_failed": status.HTTP_502_BAD_GATEWAY,
            }.get(error.code, status.HTTP_409_CONFLICT)
            return _error(request, error.code, error.message, {}, http_status)
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
        # Self-serve activation mirrors the api-key rule (H18 fix-up 2).
        if not config.enabled_by_hr:
            config.is_active = True
            config.save(update_fields=["is_active", "updated_at"])
        config.refresh_from_db()
        return Response({"data": {"status": "linked", **AssistantConfigReadSerializer(config).data}})


class AssistantSubscriptionStartView(APIView):
    """POST /assistant/subscription/start — begin the provider's OWN device
    authorization flow (H21: for opencode its console endpoints, exactly the
    ones the CLI calls). The answer carries the NON-secret display shapes:
    user_code, the absolute approval URL, interval/expires_in. The secret
    device_code stays server-side (cache, bound to this user)."""

    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        provider = body.get("provider")
        if not isinstance(provider, str):
            provider = ""
        try:
            flow = start_device_flow(request.user, provider)
        except SubscriptionError as error:
            http_status = {
                "unknown_provider": status.HTTP_422_UNPROCESSABLE_ENTITY,
                "no_login_flow": status.HTTP_409_CONFLICT,
                "provider_unreachable": status.HTTP_502_BAD_GATEWAY,
                "provider_error": status.HTTP_502_BAD_GATEWAY,
            }.get(error.code, status.HTTP_409_CONFLICT)
            return _error(request, error.code, error.message, {}, http_status)
        return Response({"data": flow})


class AssistantSubscriptionPollView(APIView):
    """POST /assistant/subscription/poll — ONE poll turn. Pending is a
    200 {"status": "pending"} (the SPA keeps polling); on approval the
    credential is stored ENCRYPTED and the row read shape comes back
    (subscription_source="device") with no token material anywhere."""

    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        provider = body.get("provider")
        if not isinstance(provider, str):
            provider = ""
        try:
            result = poll_device_flow(request.user, provider)
        except SubscriptionError as error:
            http_status = {
                "unknown_provider": status.HTTP_422_UNPROCESSABLE_ENTITY,
                "no_login_flow": status.HTTP_409_CONFLICT,
                "no_active_flow": status.HTTP_409_CONFLICT,
                "flow_expired": status.HTTP_409_CONFLICT,
                "provider_unreachable": status.HTTP_502_BAD_GATEWAY,
                "provider_error": status.HTTP_502_BAD_GATEWAY,
            }.get(error.code, status.HTTP_409_CONFLICT)
            return _error(request, error.code, error.message, {}, http_status)
        return Response({"data": result})


class AssistantSubscriptionModelsView(APIView):
    """GET /assistant/subscription/models — the models the linked
    subscription actually offers; the user picks one of them."""

    permission_classes = [IsAuthenticated401]
    throttle_classes = []

    def get(self, request):
        config = _get_own_config(request.user)
        if config.mode != "subscription" or not config.is_configured:
            return _error(
                request,
                "not_configured",
                "Link a subscription first.",
                {},
                status.HTTP_409_CONFLICT,
            )
        try:
            result = list_models(config)
        except SubscriptionError as error:
            http_status = {
                "provider_unreachable": status.HTTP_502_BAD_GATEWAY,
                "provider_error": status.HTTP_502_BAD_GATEWAY,
            }.get(error.code, status.HTTP_409_CONFLICT)
            return _error(request, error.code, error.message, {}, http_status)
        except assistant_subscriptions.RefreshFailedError:
            unlink_expired(config)
            return _error(
                request,
                "not_configured",
                "Your subscription login expired and the refresh failed — link it again in settings.",
                {},
                status.HTTP_409_CONFLICT,
            )
        return Response({"data": result})


class AssistantChatView(APIView):
    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def post(self, request):
        errors = AssistantChatMessagesSerializer.errors(request.data)
        if errors:
            return _error(
                request,
                "validation_error",
                "Validation failed.",
                {"messages": errors} if len(errors) == 1 and isinstance(errors[0], str) else errors[0],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        config = _get_own_config(request.user)
        try:
            outcome = run_assistant_chat(request.user, config, request.data["messages"])
        except ChatConfigError as error:
            return _error(
                request,
                error.code,
                error.message,
                {},
                status.HTTP_409_CONFLICT,
            )
        except AssistantSecretError as error:
            return _error(
                request,
                "key_unreadable",
                str(error),
                {},
                status.HTTP_409_CONFLICT,
            )
        return Response(
            {
                "data": {
                    "reply": outcome["reply"] or "",
                    "pending_action": outcome["pending_action"],
                    "tool_trace": outcome["tool_trace"],
                }
            }
        )


class AssistantActionConfirmView(APIView):
    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def post(self, request, token):
        try:
            result = confirm_action(request.user, token)
        except ActionTokenError as error:
            code_status = {
                "invalid_token": status.HTTP_400_BAD_REQUEST,
                "expired": status.HTTP_409_CONFLICT,
                "user_mismatch": status.HTTP_403_FORBIDDEN,
                "already_used": status.HTTP_409_CONFLICT,
                "tampered": status.HTTP_400_BAD_REQUEST,
                "unknown_tool": status.HTTP_400_BAD_REQUEST,
                "unsupported_tool": status.HTTP_409_CONFLICT,
                "validation_error": status.HTTP_422_UNPROCESSABLE_ENTITY,
                "permission_denied": status.HTTP_403_FORBIDDEN,
                "not_found": status.HTTP_404_NOT_FOUND,
            }.get(error.code, status.HTTP_400_BAD_REQUEST)
            return _error(request, error.code, error.message, {}, code_status)
        return Response({"data": {"result": result["result"], "tool": result["tool"]}})
