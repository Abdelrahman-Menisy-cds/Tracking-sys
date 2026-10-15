"""Signed, short-lived pending-action tokens (Story H18 confirm flow).

The token carries (user_pk, tool, arguments, issued_at) and is signed with
itsdangerous-style HMAC over a compact JSON payload, using the same server
secret the at-rest key encryption derives from (ASSISTANT_SECRET_KEY, or a
stable SECRET_KEY fallback). Properties the brief demands, and how each is
met:

  * bound to the user      -> user_pk is IN the signed payload, so a token
                              replayed by a different user fails the pk
                              equality check at confirm time.
  * carries exact args     -> arguments are IN the signed payload; tampering
                              breaks the signature.
  * short-lived (~10 min)  -> exp timestamp inside the payload, re-checked at
                              confirm; also verified on signature.
  * single-use             -> a used-token marker in the Django cache, set
                              atomically right before the write runs; a
                              replay finds the marker and is refused.

Plaintext arguments appear in no log (the token is opaque base64; the
arguments only surface to the requesting user's own pending_action payload).
"""
import base64
import hashlib
import hmac
import json
import time

from django.core.cache import cache

TOKEN_LIFETIME_SECONDS = 10 * 60
_CACHE_TTL_SECONDS = TOKEN_LIFETIME_SECONDS + 60
_USED_PREFIX = "assistant_action_used:"

_encoder = json.JSONEncoder(separators=(",", ":"), sort_keys=True)


def _secret() -> bytes:
    from django.conf import settings

    from accounts.assistant_crypto import _derive_fernet_key

    # The Fernet key is itself a derived value; using it directly for HMAC is
    # fine and reuses one derivation.
    return _derive_fernet_key()


def _canonical(arguments) -> str:
    """Sorted-key canonical JSON: the same args always sign identically."""
    return _encoder.encode(arguments if isinstance(arguments, dict) else {})


def sign_action(*, user_pk: int, tool: str, arguments: dict) -> str:
    """One opaque token: base64(payload) + '.' + base64(hmac)."""
    payload = {
        "user_pk": int(user_pk),
        "tool": tool,
        "arguments": arguments,
        "arguments_canonical": _canonical(arguments),
        "issued_at": int(time.time()),
        "exp": int(time.time()) + TOKEN_LIFETIME_SECONDS,
    }
    body = base64.urlsafe_b64encode(_encoder.encode(payload).encode("utf-8")).decode("ascii")
    signature = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


class ActionTokenError(Exception):
    """The token cannot be trusted for this caller; carry a reason code."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(code)


def open_action(token: str, *, user_pk: int):
    """(tool, arguments) if the token is intact, current, and THIS user's.

    Raises ActionTokenError otherwise — malformed/expired/user-mismatch/
    tampered. Replay detection (single-use) happens separately at confirm so
    this function stays pure for validation tests.
    """
    if not isinstance(token, str) or token.count(".") != 1:
        raise ActionTokenError("invalid_token", "The confirmation token is malformed.")
    body, signature = token.split(".", 1)
    expected = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ActionTokenError("invalid_token", "The confirmation token is not valid.")
    try:
        payload = json.loads(base64.urlsafe_b64decode(body.encode("ascii")))
    except (ValueError, json.JSONDecodeError) as error:
        raise ActionTokenError("invalid_token", "The confirmation token is not decodable.") from error
    if not isinstance(payload, dict):
        raise ActionTokenError("invalid_token", "The confirmation token is not valid.")
    if payload.get("exp", 0) < time.time():
        raise ActionTokenError("expired", "This confirmation expired; ask the assistant again.")
    if int(payload.get("user_pk", -1)) != int(user_pk):
        raise ActionTokenError("user_mismatch", "This confirmation belongs to a different user.")
    # Tamper check beyond the signature: arguments must exactly re-hash to the
    # canonical form inside the same signed payload (defends a decode-layer
    # unicode/key-order surprise; the signature itself already covers bytes).
    if _canonical(payload.get("arguments")) != payload.get("arguments_canonical"):
        raise ActionTokenError("tampered", "The action's arguments do not match what was signed.")
    return payload.get("tool"), payload.get("arguments")


def mark_action_used(token: str, *, user_pk: int) -> bool:
    """Atomically claim the token for single use. True = this caller won.

    The cache key embeds a hash of the FULL token (both user-bound payloads
    and signatures differ), so the same token intercepted by another user
    cannot consume this user's expected-key slot either.
    """
    claim_key = _USED_PREFIX + hashlib.sha256(token.encode("ascii")).hexdigest()
    return cache.add(claim_key, int(user_pk), _CACHE_TTL_SECONDS)
