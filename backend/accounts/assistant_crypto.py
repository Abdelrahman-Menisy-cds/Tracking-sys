"""Fernet encryption for the assistant's at-rest API key (Story H18).

The key material never reaches the database in plaintext and never reaches
a log line. The Fernet key comes from settings.ASSISTANT_SECRET_KEY, which
settings.py reads from the environment (ASSISTANT_SECRET_KEY); when that is
missing it is DERIVED STABLY from Django's SECRET_KEY so a demo run works
with zero configuration — the derivation is deterministic, so decrypting
tomorrow works as long as SECRET_KEY itself does not change. Setting
ASSISTANT_SECRET_KEY explicitly (recommended for anything beyond a demo)
breaks derivation-on-the-fly, so rotate by: set it, then have every user
re-save their key — the old ciphertext simply fails to authenticate.

Every encrypt() output is prefixed with a version tag ("v1.") so the
algorithm can be recognised on read without a second table row per user.
Decrypt failures raise AssistantSecretError; endpoints translate that into
their own clear error and never include the plaintext anywhere.
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from django.conf import settings

# Only generation 1 exists; a future scheme introduces v2 and keeps v1 readable.
_PREFIX_V1 = "v1:"


def _derive_fernet_key() -> bytes:
    """The configured ASSISTANT_SECRET_KEY, or a stable fallback from SECRET_KEY."""
    explicit = getattr(settings, "ASSISTANT_SECRET_KEY", "") or ""
    secret = explicit.strip() or settings.SECRET_KEY
    # urlsafe base64 of sha256(secret) is exactly the 32-byte key Fernet wants.
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


class AssistantSecretError(Exception):
    """Stored ciphertext cannot be opened (or is not present/corrupt)."""


def encrypt_key(plaintext: str) -> bytes:
    """Encrypt one API key for the at-rest column. Never log the input."""
    raw = plaintext.encode("utf-8")
    token = Fernet(_derive_fernet_key()).encrypt(raw)
    return (_PREFIX_V1 + token.decode("utf-8")).encode("utf-8")


def decrypt_key(ciphertext: bytes) -> str:
    """The plaintext of one stored key, or AssistantSecretError."""
    if not ciphertext:
        raise AssistantSecretError("No stored assistant key.")
    try:
        materials = bytes(ciphertext)
        if not materials.startswith(_PREFIX_V1.encode("utf-8")):
            raise AssistantSecretError("Unknown assistant key format.")
        token = materials[len(_PREFIX_V1) :]
        return Fernet(_derive_fernet_key()).decrypt(token).decode("utf-8")
    except (InvalidToken, AssistantSecretError):
        raise AssistantSecretError(
            "The stored assistant key cannot be opened with the current server secret."
        ) from None


def key_hint(plaintext: str) -> str:
    """The display hint only, never the plaintext."""
    tail = plaintext[-4:] if len(plaintext) >= 4 else "••••"
    return f"••••{tail}"
