"""The «مدام عفاف» conversation loop (Story H18 chat turn).

One POST /assistant/chat runs at most MAX_PROVIDER_ROUNDS provider calls:

  provider round -> if the reply carries tool_calls:
      * read tool  -> executed AS THE CALLER, result appended as a tool
                      message, loop continues;
      * write tool -> NO execution: the loop returns a pending_action built
                      from the tool name + arguments, and the loop ENDS
                      (the confirmation flow is a separate endpoint);
  provider round -> plain content reply -> done.

Every tool result is trimmed to a bounded JSON blob before it goes back to
the provider. The provider's possible failure modes map onto a 200 chat
reply carrying ok: false-style text (the product surface is a chat bubble;
a 500 with no reply text would be a worse experience) — EXCEPT for the
config problems (Test-less configurations) which validate earlier in the
view. Provider failures carry the provider's own status, message, and the
exact URL the client called (never "unreachable" alone; the Test button
and the chat bubble must both be actionable).

The key/base_url used here come ONLY from the caller's stored config — the
chat endpoint never accepts a client-supplied credential.
"""
import json
import logging

from django.http import Http404

from accounts import assistant_provider
from accounts.assistant_actions import sign_action
from accounts.assistant_tools import (
    ALL_TOOL_SPECS,
    MAX_PROVIDER_ROUNDS,
    READ_TOOLS,
    SYSTEM_PROMPT,
    WRITE_TOOLS,
)

logger = logging.getLogger(__name__)

MAX_TOOL_RESULT_CHARS = 4000


class ChatConfigError(Exception):
    """The caller's assistant config cannot support a chat round."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(code)


def _as_json_blob(value) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS] + ' …"truncated"'
    return text


def _tool_call_arguments(call) -> dict:
    raw = call.get("function", {}).get("arguments")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def assistant_chat(user, config, incoming_messages: list) -> dict:
    """The whole turn for ONE /assistant/chat call.

    Returns {"reply": str|None, "pending_action": dict|None, "tool_trace": [...]}.
    Raises ChatConfigError for a config that cannot support a call, and
    AssistantSecretError propagates (the view maps it).
    """
    from accounts.assistant_crypto import AssistantSecretError, decrypt_key
    from accounts import assistant_subscriptions

    if not config.is_configured:
        raise ChatConfigError("not_configured", "Link an active model in your settings first.")
    if not config.is_active:
        raise ChatConfigError("inactive", "The assistant is switched off for your account.")

    if config.mode == "subscription":
        try:
            spec, blob = assistant_subscriptions.ensure_fresh(config)
        except assistant_subscriptions.RefreshFailedError:
            # The refresh already unlinked the row; the launcher fades again
            # with the same hint, and chat explains instead of dying silently.
            raise ChatConfigError(
                "not_configured",
                "Your subscription login expired and the refresh failed — link it again in settings.",
            ) from None
        stored_key = assistant_subscriptions.access_token(blob)
        call_headers = assistant_subscriptions.chat_headers(spec, blob)
        call_base_url = spec.base_url
    else:
        stored_key = decrypt_key(config.api_key_ciphertext)
        call_headers = None
        call_base_url = config.base_url
    provider_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for message in incoming_messages:
        role = message.get("role")
        content = message.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            provider_messages.append({"role": role, "content": content[:MAX_TOOL_RESULT_CHARS]})

    tool_trace = []
    pending_action = None
    reply_text = None

    for _round in range(MAX_PROVIDER_ROUNDS):
        if config.mode == "subscription" and spec.wire_api == "responses":
            # The codex gateway speaks ONLY the Responses SSE wire api
            # (measured: 404 on completions, "Stream must be set to true"
            # otherwise). Build its exact call and consume the stream.
            call = assistant_subscriptions.completion_call(
                spec, blob, config.model, provider_messages, ALL_TOOL_SPECS, stream=True,
            )
            assert call is not None  # wire_api checked directly above
            url, call_headers, call_body = call
            try:
                message = assistant_subscriptions.post_responses_stream(url, call_headers, call_body)
            except assistant_provider.ProviderResponseError as error:
                raise ChatConfigError(
                    "provider_error",
                    f"provider {error.status_code}: {error.detail}",
                )
            except assistant_provider.ProviderUnreachableError as error:
                raise ChatConfigError("provider_error", str(error))
        else:
            try:
                extras = call_headers if config.mode == "subscription" else None
                message = assistant_provider.chat_round(
                    base_url=call_base_url,
                    api_key=stored_key,
                    model=config.model,
                    messages=provider_messages,
                    tools=ALL_TOOL_SPECS,
                    extra_headers=extras,
                )
            except assistant_provider.ProviderResponseError as error:
                raise ChatConfigError(
                    "provider_error",
                    f"provider {error.status_code}: {error.detail}",
                )
            except (assistant_provider.ProviderUnreachableError, assistant_provider.ProviderBadBodyError) as error:
                raise ChatConfigError("provider_error", str(error))

        tool_calls = message.get("tool_calls") or []
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            reply_text = content

        if not tool_calls:
            break

        provider_messages.append(
            {
                "role": "assistant",
                "content": content if isinstance(content, str) else None,
                "tool_calls": tool_calls,
            }
        )

        for call in tool_calls:
            name = (call.get("function") or {}).get("name")
            arguments = _tool_call_arguments(call)
            call_id = call.get("id") or name
            if not isinstance(name, str):
                continue

            if name in READ_TOOLS:
                try:
                    result = READ_TOOLS[name](user, arguments)
                except (Http404,) as error:
                    result = {"ok": False, "error": str(error)}
                except Exception as error:  # noqa: BLE001 - a read failure must not 500 the chat
                    logger.exception("assistant read tool failed tool=%s", name)
                    result = {"ok": False, "error": f"{type(error).__name__}"}
                tool_trace.append({"tool": name, "immediate": True})
                provider_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": _as_json_blob(result),
                    }
                )
                continue

            if name in WRITE_TOOLS:
                validator, _executor = WRITE_TOOLS[name]
                try:
                    validated = validator(user, arguments)
                except Exception as error:  # noqa: BLE001
                    logger.exception("assistant write validation failed tool=%s", name)
                    validated = {"error": "internal", "message": type(error).__name__}
                if "error" in validated:
                    tool_trace.append({"tool": name, "immediate": False, "refused": True})
                    provider_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": _as_json_blob(validated),
                        }
                    )
                    continue
                # NEVER execute inline: mint the pending action from the
                # VALIDATED arguments (the exact values the confirm step will
                # run) and stop the turn.
                token = sign_action(
                    user_pk=user.pk,
                    tool=name,
                    arguments=validated["validated"],
                )
                pending_action = {
                    "token": token,
                    "name": name,
                    "args": validated["validated"],
                }
                tool_trace.append({"tool": name, "immediate": False, "pending": True})
                # Every tool call must be answered with a tool message before
                # the next provider round (the OpenAI shape), including this
                # one: the answer is "the write is minted and waiting for the
                # user's explicit confirmation". The loop stops below, but the
                # outgoing conversation must remain valid if anything asks for
                # another round (MAX_PROVIDER_ROUNDS is shared).
                provider_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": _as_json_blob(
                            {"ok": True, "pending_confirmation": True, "tool": name}
                        ),
                    }
                )
        if pending_action is not None:
            break
    if not reply_text and pending_action is None and not tool_trace:
        # H26: a blank chat bubble is worse than an honest error. Whatever
        # produced no reply AND no tool activity (an upstream anomaly the
        # typed errors above could not catch) surfaces as an actionable
        # message naming the provider and model, never provider internals.
        provider_name = config.subscription_provider or "the linked provider"
        raise ChatConfigError(
            "provider_error",
            f"The {provider_name} model ({config.model}) did not return any text "
            "or action for this turn — try again, and if it keeps happening "
            "check the subscription status in settings.",
        )
    return {
        "reply": reply_text,
        "pending_action": pending_action,
        "tool_trace": tool_trace,
    }


def confirm_action(user, token: str) -> dict:
    """Run ONE pending write (POST /assistant/actions/<token>/confirm).

    Order matters and mirrors the decision services' authorization posture:
    1. open_action — signature/expiry/user binding (raises ActionTokenError).
    2. single-use claim in the cache — replay is refused BEFORE doing work.
    3. the tool's own validation (now refused if anything changed).
    4. the REAL service execution as the user — its PermissionError/LookupError
       surfaces as a permission error, never elevated.
    5. the AuditEvent, written in the same transaction as the write when the
       service has one, else immediately after.
    """
    from accounts.assistant_actions import ActionTokenError, open_action, mark_action_used
    from accounts.assistant_tools import WRITE_TOOLS
    from accounts.models import AuditEvent

    try:
        tool, arguments = open_action(token, user_pk=user.pk)
    except ActionTokenError as error:
        raise ActionTokenError(error.code, error.message)
    if not isinstance(tool, str) or tool not in WRITE_TOOLS:
        raise ActionTokenError("unknown_tool", "That action is not a confirmable write.")

    _validator, executor = WRITE_TOOLS[tool]
    if executor is None:
        raise ActionTokenError("unsupported_tool", "This write has no backend implementation yet.")
    if not mark_action_used(token, user_pk=user.pk):
        raise ActionTokenError("already_used", "This confirmation was already used.")

    try:
        validated = _validator(user, arguments if isinstance(arguments, dict) else {})
    except Exception as error:  # noqa: BLE001 - a validator crash must not mutate
        raise ActionTokenError("validation_error", f"The action is no longer valid ({type(error).__name__}).")
    if "error" in validated:
        raise ActionTokenError("validation_error", validated.get("message") or "The action is no longer valid.")
    if validated["validated"] != arguments:
        raise ActionTokenError("tampered", "The arguments no longer match what was confirmed.")

    try:
        result = executor(user, validated["validated"])
    except PermissionError:
        raise ActionTokenError("permission_denied", "You do not have permission to perform this action.") from None
    except LookupError:
        raise ActionTokenError("not_found", "The target of this action no longer exists.") from None
    except Http404:
        raise ActionTokenError("not_found", "The target of this action no longer exists.") from None
    except Exception as error:  # noqa: BLE001 - a service crash must not 500 as "confirmed"
        raise ActionTokenError("execution_failed", f"The action could not be run ({type(error).__name__}).") from error

    AuditEvent.objects.create(
        actor=user,
        subject=user,
        action=f"assistant.{tool}",
        request_id="",
        before={},
        after={
            "tool": tool,
            "arguments": validated["validated"],
            "result_status": result.get("status"),
        },
    )
    return {"ok": True, "tool": tool, "result": result}
