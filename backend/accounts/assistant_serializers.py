"""Assistant config serializers — Story H18 (+H19 subscription).

Read shapes contain NO key material beyond the hints; the plaintext (and
the ciphertext) never leave the server. Every field the SPA's
assistantApi.ts reads is always present, so the UI never has to guess.
"""
from rest_framework import serializers


class AssistantConfigReadSerializer(serializers.Serializer):
    """The H18 shape extended by H19's subscription fields."""

    is_configured = serializers.BooleanField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    base_url = serializers.CharField(read_only=True)
    model = serializers.CharField(read_only=True)
    key_hint = serializers.SerializerMethodField()
    key_source = serializers.SerializerMethodField()
    can_replace_key = serializers.SerializerMethodField()
    mode = serializers.CharField(read_only=True)
    subscription_provider = serializers.CharField(read_only=True)
    subscription_hint = serializers.CharField(read_only=True)
    subscription_cred_type = serializers.CharField(read_only=True)
    subscription_source = serializers.CharField(read_only=True)
    subscription_expires = serializers.DateTimeField(read_only=True, allow_null=True)

    def get_key_hint(self, config):
        return config.api_key_hint

    def get_key_source(self, config):
        return config.key_source

    def get_can_replace_key(self, config):
        # Every authenticated owner may replace their own key — including when
        # HR set the previous one (the owner's explicit rule).
        return True


class AssistantConfigSelfWriteSerializer(serializers.Serializer):
    """PUT /assistant/config body (the caller's own config).

    api mode (H18): base_url/model required, api_key optional — replacing an
    existing key is always allowed (brief: "An employee may replace an HR-set
    key"). subscription mode (H19): mode="subscription" links the provider
    picked on the widget; subscription=null unlinks (the launcher fades).
    Anything else in the body is a protected field: 422 with no mutation,
    matching the DraftCreateSerializer policy.
    """

    base_url = serializers.URLField(max_length=300, required=False)
    model = serializers.CharField(max_length=120, trim_whitespace=True, required=False)
    api_key = serializers.CharField(
        max_length=512,
        required=False,
        allow_blank=False,
        trim_whitespace=False,
        write_only=True,
    )
    mode = serializers.ChoiceField(choices=["api", "subscription"], required=False)
    subscription_provider = serializers.ChoiceField(
        choices=["opencode", "codex"], required=False, allow_null=True
    )

    def validate(self, attrs):
        mode = attrs.get("mode")
        if mode != "subscription":
            if attrs.get("subscription_provider") is not None:
                raise serializers.ValidationError(
                    {"subscription_provider": ["Only sent with mode=subscription."]}
                )
        else:
            # Linking requires a provider; CHANGING ONLY THE MODEL keeps the
            # linked credential untouched (the models/<list> UI flow).
            if attrs.get("subscription_provider") is None and not attrs.get("model"):
                raise serializers.ValidationError(
                    {"subscription_provider": ["Pick a provider (opencode or codex)."]}
                )
        protected = set(self.initial_data) - {
            "base_url", "model", "api_key", "mode", "subscription_provider",
        }
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        return attrs


class AssistantConfigHRWriteSerializer(serializers.Serializer):
    """PUT /employees/<id>/assistant body (HR, the employee's file).

    Every field optional (partial=True usage at the view): base_url, model,
    api_key, is_active (the activation toggle). H19 adds the subscription
    subset (hr links a provider subscription on the employee's behalf).
    enabled_by_hr has no setter — the service flips it together with
    is_active; supplying it directly is a protected field.
    """

    base_url = serializers.URLField(max_length=300, required=False, allow_blank=False)
    model = serializers.CharField(max_length=120, required=False, allow_blank=False, trim_whitespace=True)
    api_key = serializers.CharField(
        max_length=512,
        required=False,
        allow_blank=False,
        trim_whitespace=False,
        write_only=True,
    )
    is_active = serializers.BooleanField(required=False)
    mode = serializers.ChoiceField(choices=["api", "subscription"], required=False)
    subscription_provider = serializers.ChoiceField(
        choices=["opencode", "codex"], required=False, allow_null=True
    )

    def validate(self, attrs):
        mode = attrs.get("mode")
        if mode == "subscription":
            # Linking requires a provider; CHANGING ONLY THE MODEL keeps the
            # linked credential untouched — the same rule the self-serve
            # serializer applies, so one client body serves both endpoints.
            if attrs.get("subscription_provider") is None and not attrs.get("model"):
                raise serializers.ValidationError(
                    {"subscription_provider": ["Pick a provider (opencode or codex)."]}
                )
        elif attrs.get("subscription_provider") is not None:
            raise serializers.ValidationError(
                {"subscription_provider": ["Only sent with mode=subscription."]}
            )
        protected = set(self.initial_data) - {
            "base_url", "model", "api_key", "is_active", "mode", "subscription_provider",
        }
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        return attrs
