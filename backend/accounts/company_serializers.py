"""Company profile serializers — Story H17 (HR only).

The company profile is the organisation's own identity (اسم الشركة, النشاط,
المقر، تليفون الشركة). Writes are allowlisted the same way employee and
department writes are: anything not named here is refused before it can touch
the row. The read shape is the write shape plus ``updated_at``/``updated_by_id``.
"""
from django.core.validators import RegexValidator
from rest_framework import serializers

from accounts.models import AuditEvent, CompanyProfile

#: digits, spaces, +, - and parentheses only (server is the authority).
PHONE_VALIDATOR = RegexValidator(
    regex=r"^[0-9+()\- ]*$",
    message="Phone accepts digits, spaces, +, - and parentheses only.",
)
#: The frontend resizes the logo before sending; the server still checks the
#: envelope and the cap rather than trusting either.
LOGO_MAX_LENGTH = 200_000

#: Snapshot fields for one stored state (AuditEvent.before / .after).
_AUDIT_FIELDS = (
    "name",
    "activity",
    "address",
    "phone",
    "email",
    "website",
    "logo_data_url",
    "commercial_register",
    "tax_card",
    "contact_name",
    "contact_role",
    "contact_phone",
    "updated_by_id",
)


class CompanyProfileReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyProfile
        fields = list(_AUDIT_FIELDS[:-1]) + ["updated_at", "updated_by_id"]


class CompanyProfileWriteSerializer(serializers.ModelSerializer):
    """Partial-update allowlist; the view instantiates it with partial=True.

    Field-level checks (logo envelope/cap, phone charset, blank required)
    run here; the merged-set completeness gate runs in the view AFTER the
    merge, because only the merged result can tell whether a partial update
    broke completeness.
    """

    phone = serializers.CharField(max_length=32, required=False, validators=[PHONE_VALIDATOR])
    contact_phone = serializers.CharField(
        max_length=32, required=False, allow_blank=True, validators=[PHONE_VALIDATOR]
    )
    logo_data_url = serializers.CharField(
        required=False, allow_blank=True, max_length=LOGO_MAX_LENGTH
    )

    class Meta:
        model = CompanyProfile
        fields = [
            "name",
            "activity",
            "address",
            "phone",
            "email",
            "website",
            "logo_data_url",
            "commercial_register",
            "tax_card",
            "contact_name",
            "contact_role",
            "contact_phone",
        ]
        extra_kwargs = {
            "name": {"max_length": 200, "required": False, "allow_blank": False},
            "activity": {"max_length": 200, "required": False, "allow_blank": False},
            "address": {"max_length": 300, "required": False, "allow_blank": False},
            "email": {"required": False, "allow_blank": True},
            "website": {"required": False, "allow_blank": True},
            "commercial_register": {"max_length": 64, "required": False, "allow_blank": True},
            "tax_card": {"max_length": 64, "required": False, "allow_blank": True},
            "contact_name": {"max_length": 120, "required": False, "allow_blank": True},
            "contact_role": {"max_length": 120, "required": False, "allow_blank": True},
        }

    def validate_logo_data_url(self, value):
        if not value:
            return ""
        if not value.startswith("data:image/"):
            raise serializers.ValidationError(
                "The logo must be a data:image/...;base64 string."
            )
        return value

    def validate(self, attrs):
        # Trim only the display fields; registration numbers etc. are stored
        # verbatim so an HR entry like " 123456 " stays what HR typed.
        for field in ("name", "activity", "address"):
            if field in attrs and attrs[field] is not None:
                attrs[field] = attrs[field].strip()
        return attrs


def merged_missing_required(profile, validated_data):
    """Required fields that are blank AFTER applying ``validated_data``.

    ``profile`` may be None (no row yet). This is the single computation both
    the PATCH completeness gate and ``needs_profile`` share, so the API can
    never disagree with itself about whether the profile is complete.
    """
    missing = []
    for field in CompanyProfile.REQUIRED_FIELDS:
        if field in validated_data:
            value = validated_data[field]
        elif profile is not None:
            value = getattr(profile, field)
        else:
            value = ""
        if not (value or "").strip():
            missing.append(field)
    return missing


def apply_profile_update(*, profile, validated_data, actor, request_id=""):
    """Apply a merged partial update + append the audit event, atomically.

    Singleton semantics follow ``TimezoneConfig``: exactly one row at pk=1.
    Returns ``(profile, event)`` where ``event`` is None when nothing changed.
    Callers run this inside ``transaction.atomic``; a raise rolls everything
    back, so a rejected update stores nothing.
    """
    before = {field: getattr(profile, field) for field in _AUDIT_FIELDS} if profile is not None else None

    if profile is None:
        profile = CompanyProfile(pk=1)
    for field, value in validated_data.items():
        setattr(profile, field, value)
    profile.updated_by = actor

    changed = {
        field: getattr(profile, field)
        for field in _AUDIT_FIELDS
        if (before or {}).get(field) != getattr(profile, field)
    }
    profile.save()

    event = None
    if changed:
        event = AuditEvent.objects.create(
            actor=actor,
            subject=actor,
            action="company_profile.updated",
            request_id=request_id or "",
            before={field: (before or {}).get(field) for field in changed},
            after={field: getattr(profile, field) for field in changed},
        )
    return profile, event
