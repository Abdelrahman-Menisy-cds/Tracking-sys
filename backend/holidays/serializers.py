from rest_framework import serializers

from holidays.models import PublicHoliday


class PublicHolidaySerializer(serializers.ModelSerializer):
    """Read shape for the register. Every row carries its provenance:
    source (NAGER/LLM/MANUAL), is_manual_override and needs_confirmation,
    so the frontend can never present an unconfirmed LLM proposal as
    official."""

    class Meta:
        model = PublicHoliday
        fields = (
            "id",
            "country_code",
            "date",
            "name",
            "name_local",
            "source",
            "is_manual_override",
            "needs_confirmation",
            "is_recurring",
            "external_id",
            "year",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class HolidayRefreshRequestSerializer(serializers.Serializer):
    """POST /api/v1/holidays/refresh body. Both fields optional: defaults
    (current year, EG) are applied by the view."""

    year = serializers.IntegerField(required=False, min_value=1974, max_value=2100)
    country = serializers.CharField(required=False, min_length=2, max_length=2)

    def validate_country(self, value):
        value = value.strip().upper()
        if not value.isalpha():
            raise serializers.ValidationError(
                "country must be a 2-letter ISO 3166-1 alpha-2 code."
            )
        return value
