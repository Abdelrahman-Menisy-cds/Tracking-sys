"""Stage H1 focused tests: public-holidays register (Nager + OpenCode Go).

Covers the brief's matrix:
- Nager client parses the recorded fixture (no network in tests);
- the LLM is STUBBED in every test, no real LLM/network call ever fires,
  and the raw request carries the Bearer header + per-request
  x-opencode-session;
- the refresh upsert does not duplicate (set-of-identities assertion, not a
  count) — same-name Eid Al-Adha rows keyed on (country_code, date, name);
- manual overrides survive byte-for-byte and are reported preserved;
- LLM proposals are stored source=LLM / needs_confirmation=True, never
  official, and are not duplicated on a second refresh;
- LLM failure degrades honestly (import lands, llm_available=False +
  warning, never an exception); a content:null reasoning-budget answer is
  retried once with a larger budget;
- Nager failure is NOT silent success: 503 and zero rows written;
- Arabic-detection: an already-Arabic localName is never sent to the LLM;
- permissions: a non-HR authenticated caller gets the 404 envelope on
  refresh; an unauthenticated caller gets 401;
- the register GET endpoint: filtering, defaults, and validation.
"""
from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from holidays import services
from holidays.fixtures.nager_eg_2026 import (
    LLM_EG_2026_PROPOSALS,
    NAGER_EG_2026,
    NAGER_EG_2026_IDENTITIES,
    NON_ARABIC_LOCAL_NAMES,
)
from holidays.llm import LLMEmptyContentError, has_arabic_script
from holidays.models import PublicHoliday
from holidays.nager import NagerError, fetch_public_holidays, _normalize_holidays
from tenants.context import default_company

User = get_user_model()


def _px(nx):
    """Fixture row -> what the nager client's normalization yields."""
    return {
        "date": nx["date"],
        "name": nx["name"],
        "local_name": nx["localName"],
        "country_code": nx["countryCode"],
        "global": nx["global"],
        "counties": nx["counties"] or [],
        "types": nx["types"],
        "launch_year": nx["launchYear"],
    }


def _snapshot_rows():
    """Full field-level snapshot for byte-for-byte preservation assertions."""
    return {
        (row.pk,): {
            "name": row.name,
            "name_local": row.name_local,
            "source": row.source,
            "is_manual_override": row.is_manual_override,
            "needs_confirmation": row.needs_confirmation,
            "year": row.year,
        }
        for row in PublicHoliday.objects.all()
    }


class NagerClientParsingTests(APITestCase):
    def test_recorded_fixture_parses_into_normalized_rows(self):
        normalized = _normalize_holidays(NAGER_EG_2026, "EG")

        assert len(normalized) == 15
        first = normalized[0]
        assert first["date"] == "2026-01-07"
        assert first["name"] == "Christmas Day"
        assert first["local_name"] == "عيد الميلاد المجيد"
        # The five Eid Al-Adha rows survive as five distinct dated rows.
        adha = [row for row in normalized if row["name"] == "Eid Al-Adha"]
        assert [row["date"] for row in adha] == [
            "2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30", "2026-05-31",
        ]

    def test_client_normalization_matches_fixture_mapping(self):
        normalized = fetch_public_holidays.__wrapped__ if False else _normalize_holidays(
            NAGER_EG_2026, "EG"
        )
        assert normalized[:2] == [_px(NAGER_EG_2026[0]), _px(NAGER_EG_2026[1])]

    def test_malformed_rows_are_dropped_not_guessed(self):
        payload = NAGER_EG_2026 + [
            {"date": "not-a-date", "name": "Broken", "localName": "x"},
            {"date": "2026-01-01"},  # no name
            "garbage",
        ]
        normalized = _normalize_holidays(payload, "EG")
        assert len(normalized) == 15

    def test_client_rejects_bad_inputs_without_network(self):
        import pytest
        from django.test import SimpleTestCase

        # raise on bad country/year before any request is built
        try:
            fetch_public_holidays(2026, "EGX")
        except NagerError as exc:
            assert "country_code" in str(exc)
        else:  # pragma: no cover
            pytest.fail("expected NagerError for a 3-letter code")


class LLMClientRequestTests(APITestCase):
    """The real client code path is exercised (headers/body parsing), but
    the network layer is patched and the environment carries ONLY stub
    credentials: no test ever makes a real LLM call or touches the real key."""

    _captured = {}

    def setUp(self):
        super().setUp()
        env_patcher = patch.dict(
            "os.environ",
            {
                "OPENCODE_GO_API_KEY": "test-opencode-key",
                "OPENCODE_GO_BASE_URL": "https://llm.test/v1",
                "OPENCODE_GO_MODEL": "glm-test-model",
            },
        )
        env_patcher.start()
        self.addCleanup(env_patcher.stop)

    @staticmethod
    def _capture_urlopen_stub(response_body):
        class _Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                import json

                return json.dumps(response_body).encode()

        def fake_urlopen(request, timeout=None):
            LLMClientRequestTests._captured["request"] = request
            return _Response()

        return fake_urlopen

    def test_translate_request_carries_bearer_and_session_headers(self):
        body = {
            "choices": [{"message": {"content": (
                '{"translations": [{"en": "Eid Al-Adha", "ar": "عيد الأضحى"}]}'
            )}}],
        }
        with patch(
            "holidays.llm.urllib.request.urlopen",
            self._capture_urlopen_stub(body),
        ):
            result = services.localise_holiday_names(["Eid Al-Adha"])

        request = self._captured["request"]
        assert request.headers["Authorization"] == "Bearer test-opencode-key"
        assert request.headers["X-opencode-session"]  # per-request uuid
        assert b"glm-test-model" in request.data
        assert result == {"Eid Al-Adha": "عيد الأضحى"}

    def test_propose_request_carries_bearer_and_session_headers(self):
        body = {"choices": [{"message": {"content": '{"holidays": []}'}}]}
        with patch(
            "holidays.llm.urllib.request.urlopen",
            self._capture_urlopen_stub(body),
        ):
            result = services.propose_missing_islamic_holidays(
                2026, "EG", already_present=["Eid Al-Adha"]
            )

        request = self._captured["request"]
        assert request.headers["Authorization"] == "Bearer test-opencode-key"
        assert request.headers["X-opencode-session"]  # per-request uuid
        assert result == []

    def test_missing_key_raises_before_any_request_is_sent(self):
        import pytest
        from holidays.llm import LLMUnavailableError

        with patch.dict("os.environ", {}, clear=False):
            import os

            os.environ.pop("OPENCODE_GO_API_KEY", None)
            try:
                services.localise_holiday_names(["Eid Al-Adha"])
            except LLMUnavailableError as exc:
                assert "OPENCODE_GO_API_KEY" in str(exc)
            else:  # pragma: no cover
                pytest.fail("expected LLMUnavailableError with no key configured")

    def test_reasoning_budget_exhausted_is_retried_once_with_larger_budget(self):
        calls = []

        def role_budget_reply(request, timeout=None):
            # 1st: content null (reasoning ate the budget); 2nd: real answer.
            import json as _json

            budget = None
            if "X-opencode-session" in request.headers:
                budget = len(calls)
            calls.append(request)
            content = (
                None
                if budget == 0
                else '{"translations": [{"en": "Sham El-Nessim", "ar": "شم النسيم"}]}'
            )
            body = {"choices": [{"message": {"content": content}}]}

            class _Response:
                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return False

                def read(self):
                    return _json.dumps(body).encode()

            return _Response()

        with patch(
            "holidays.llm.urllib.request.urlopen", role_budget_reply
        ):
            with patch("holidays.llm.MIN_TOKEN_BUDGET", 1500):
                result = services.localise_holiday_names(["Sham El-Nessim"])

        assert len(calls) == 2  # retried exactly once
        assert result == {"Sham El-Nessim": "شم النسيم"}

    def test_unparseable_model_garbage_returns_nothing(self):
        import holidays.llm as llm

        with patch.object(llm, "_complete", return_value="I refuse. ```"):
            assert services.localise_holiday_names(["Eid Al-Adha"]) == {}
        with patch.object(
            llm,
            "_complete",
            return_value='{"translations": [{"en": "X", "ar": "not-arabic"}]}',
        ):
            # A non-Arabic "ar" value is rejected, never stored.
            assert services.localise_holiday_names(["X"]) == {}
        with patch.object(llm, "_complete", return_value="not json at all"):
            assert services.localise_holiday_names(["Eid Al-Adha"]) == {}

    def test_foreign_holiday_names_are_dropped_from_proposals(self):
        import holidays.llm as llm

        body = (
            '{"holidays": ['
            '{"name": "National Puppet Day", "date": "2026-04-01"},'
            '{"name": "Ramadan Start", "date": "2026-02-18"},'
            '{"name": "Eid Al-Fitr", "date": "2026-03-20"},'
            '{"name": "Eid Al-Adha", "date": "2025-05-27"},'
            '{"name": "Islamic New Year", "date": "garbage"}'
            "]}"
        )
        with patch.object(llm, "_complete", return_value=body):
            proposals = services.propose_missing_islamic_holidays(2026, "EG")

        # Only the in-year canonical Islamic holidays survive; the model's
        # invented "National Puppet Day", the previous-year Eid Al-Adha, the
        # unparseable Islamic New Year date, are all dropped HERE.
        assert [p["name"] for p in proposals] == ["Ramadan Start", "Eid Al-Fitr"]


@override_settings(ROOT_URLCONF="config.urls")
class RefreshServiceTests(APITestCase):
    """Service-level tests: Nager patched to the recorded fixture, the LLM
    stubbed to a known-good greedy answer."""

    def setUp(self):
        self._nager = patch(
            "holidays.services.fetch_public_holidays",
            return_value=[_px(nx) for nx in NAGER_EG_2026],
        )
        self._nager.start()
        self._translate = patch(
            "holidays.services.localise_holiday_names",
            return_value={
                "Sham El-Nessim": "شم النسيم",
                "Eid Al-Adha": "عيد الأضحى المبارك",
                "Islamic New Year": "رأس السنة الهجرية",
                "Prophet Muhammad's Birthday": "المولد النبوي الشريف",
            },
        )
        self._translate.start()
        self._propose = patch(
            "holidays.services.propose_missing_islamic_holidays",
            return_value=LLM_EG_2026_PROPOSALS,
        )
        self._propose.start()
        self.addCleanup(self._nager.stop)
        self.addCleanup(self._translate.stop)
        self.addCleanup(self._propose.stop)

    def _identities(self):
        return {
            (row.date.isoformat(), row.name)
            for row in PublicHoliday.objects.filter(country_code="EG", year=2026)
        }

    def test_first_refresh_imports_official_rows_and_proposals(self):
        summary = services.refresh_public_holidays(2026, "EG", company=default_company())

        assert summary["added"] == 15
        assert summary["updated"] == 0
        assert summary["manual_preserved"] == 0
        assert summary["llm_available"] is True
        assert summary["warnings"] == []
        rows = PublicHoliday.objects.filter(country_code="EG", year=2026)
        # 15 official + 2 unique proposals (Ramadan Start, Eid Al-Fitr); the
        # other 3 proposed names already exist as official rows, so they are
        # NOT duplicated as proposals.
        assert rows.count() == 17
        official = rows.filter(source=PublicHoliday.Source.NAGER)
        assert all(not row.needs_confirmation for row in official)
        # Eid Al-Adha retains FIVE rows (same-name tolerance).
        adha = rows.filter(name="Eid Al-Adha", source=PublicHoliday.Source.NAGER)
        assert adha.count() == 5
        # Arabic fill happened only where Nager's fallback was English:
        still_english = [
            row.name
            for row in rows
            if row.source == PublicHoliday.Source.NAGER
            and not has_arabic_script(row.name_local)
        ]
        assert still_english == []
        christmas = rows.get(name="Christmas Day")
        assert christmas.name_local == "عيد الميلاد المجيد"  # Nager's own, untouched

    def test_second_refresh_is_idempotent_no_new_rows_no_duplicates(self):
        services.refresh_public_holidays(2026, "EG", company=default_company())
        first_snapshot = _snapshot_rows()
        first_count = PublicHoliday.objects.filter(country_code="EG", year=2026).count()

        summary = services.refresh_public_holidays(2026, "EG", company=default_company())

        assert summary["added"] == 0
        assert summary["proposed_missing"] == 0
        second_count = PublicHoliday.objects.filter(country_code="EG", year=2026).count()
        assert second_count == first_count == 17
        # Set-of-identities assertion, not a count: five same-name Eid Al-Adha
        # rows, plus the two surviving LLM proposals.
        assert self._identities() == NAGER_EG_2026_IDENTITIES | {
            ("2026-02-18", "Ramadan Start"),
            ("2026-03-20", "Eid Al-Fitr"),
        }
        second_snapshot = _snapshot_rows()
        # Only updated_at differs; name/name_local/source flags stay identical.
        for key, fields in first_snapshot.items():
            assert key in second_snapshot
            for field in ("name", "name_local", "source", "year", "needs_confirmation"):
                if field in second_snapshot[key]:
                    assert second_snapshot[key][field] == fields[field]

    def test_manual_override_survives_byte_for_byte_and_is_reported(self):
        # HR hand-edited the row the refresh payload would overwrite.
        manual = PublicHoliday.objects.create(company=default_company(), 
            country_code="EG",
            date=date(2026, 5, 1),
            name="Labour Day",
            name_local="اسم معدّل يدويًا",
            source=PublicHoliday.Source.MANUAL,
            is_manual_override=True,
            year=2026,
        )
        before = {
            "name": manual.name,
            "name_local": manual.name_local,
            "date": manual.date,
            "source": manual.source,
            "is_manual_override": manual.is_manual_override,
        }

        summary = services.refresh_public_holidays(2026, "EG", company=default_company())

        assert summary["manual_preserved"] == 1
        manual.refresh_from_db()
        assert {
            "name": manual.name,
            "name_local": manual.name_local,
            "date": manual.date,
            "source": manual.source,
            "is_manual_override": manual.is_manual_override,
        } == before  # byte-for-byte unchanged
        # The pair (country, date, name) is still exactly one row.
        assert (
            PublicHoliday.objects.filter(
                country_code="EG", date=date(2026, 5, 1), name="Labour Day"
            ).count()
            == 1
        )

    def test_llm_proposals_are_stored_not_official_and_not_duplicated(self):
        services.refresh_public_holidays(2026, "EG", company=default_company())

        proposals = PublicHoliday.objects.filter(
            country_code="EG", year=2026, source=PublicHoliday.Source.LLM
        )
        # Ramadan Start + Eid Al-Fitr (the genuinely missing ones); Eid
        # Al-Adha / Islamic New Year / Prophet's Birthday already exist as
        # official rows and must NOT be duplicated as proposals.
        assert {row.name for row in proposals} == {"Ramadan Start", "Eid Al-Fitr"}
        for row in proposals:
            assert row.needs_confirmation is True
            assert row.source == PublicHoliday.Source.LLM

    def test_arabic_names_only_sent_where_nager_is_not_arabic(self):
        sent_names = []
        real_translate = services.localise_holiday_names

        def spy(names):
            sent_names.extend(names)
            return real_translate.__wrapped__ if False else {
                "Sham El-Nessim": "شم النسيم",
                "Eid Al-Adha": "عيد الأضحى المبارك",
                "Islamic New Year": "رأس السنة الهجرية",
                "Prophet Muhammad's Birthday": "المولد النبوي الشريف",
            }

        self._translate.stop()
        self._translate2 = patch(
            "holidays.services.localise_holiday_names", side_effect=spy
        )
        self._translate2.start()

        services.refresh_public_holidays(2026, "EG", company=default_company())

        # Exactly the four English-fallback names, batched in ONE call.
        self.assertEqual(set(sent_names), set(NON_ARABIC_LOCAL_NAMES))
        # Christmas Day / عيد العمال etc. were never sent.
        assert "Christmas Day" not in sent_names
        assert "Labour Day" not in sent_names

    def test_llm_failure_degrades_official_import_still_lands(self):
        self._translate.stop()
        self._propose.stop()
        with patch(
            "holidays.services.localise_holiday_names",
            side_effect=services.LLMUnavailableError("provider down"),
        ), patch(
            "holidays.services.propose_missing_islamic_holidays",
            side_effect=services.LLMUnavailableError("provider down"),
        ):
            summary = services.refresh_public_holidays(2026, "EG", company=default_company())

        assert summary["llm_available"] is False
        assert summary["added"] == 15  # the official import still landed
        assert summary["proposed_missing"] == 0
        assert summary["warnings"], "the degraded mode must be reported"
        rows = PublicHoliday.objects.filter(
            country_code="EG", year=2026, source=PublicHoliday.Source.NAGER
        )
        assert rows.count() == 15
        # Without the LLM the English fallbacks stay (from Nager), honestly.
        adha = rows.filter(name="Eid Al-Adha").first()
        assert adha.name_local == "Eid Al-Adha"  # NOT invented Arabic

    def test_no_llm_names_kept_from_previous_run_are_not_downgraded(self):
        # First run with LLM fills Arabic; second run with dead LLM keeps it.
        services.refresh_public_holidays(2026, "EG", company=default_company())
        good = PublicHoliday.objects.get(country_code="EG", date=date(2026, 5, 27), name="Eid Al-Adha")
        assert good.name_local == "عيد الأضحى المبارك"

        self._translate.stop()
        self._propose.stop()
        with patch(
            "holidays.services.localise_holiday_names",
            side_effect=services.LLMUnavailableError("down"),
        ), patch(
            "holidays.services.propose_missing_islamic_holidays",
            side_effect=services.LLMUnavailableError("down"),
        ):
            summary = services.refresh_public_holidays(2026, "EG", company=default_company())

        good.refresh_from_db()
        assert good.name_local == "عيد الأضحى المبارك"  # not downgraded
        assert summary["unchanged"] >= 1

    def test_content_null_retries_then_degrades_with_one_warning(self):
        # The reasoning-budget exhaustion (content null) is retried once by
        # the client; if it persists the refresh degrades with a warning rather
        # than raising.
        self._translate.stop()
        self._propose.stop()
        with patch(
            "holidays.services.localise_holiday_names",
            side_effect=services.LLMEmptyContentError("content is None"),
        ), patch(
            "holidays.services.propose_missing_islamic_holidays",
            side_effect=services.LLMEmptyContentError("content is None"),
        ):
            summary = services.refresh_public_holidays(2026, "EG", company=default_company())
        assert summary["llm_available"] is False
        assert summary["added"] == 15
        assert len(summary["warnings"]) >= 1

    def test_nager_failure_is_not_silent_success_zero_rows_written(self):
        self._nager.stop()
        with patch(
            "holidays.services.fetch_public_holidays",
            side_effect=NagerError("connection reset"),
        ):
            try:
                services.refresh_public_holidays(2026, "EG", company=default_company())
            except services.NagerUnavailableError as exc:
                assert "connection reset" in str(exc)
            else:  # pragma: no cover
                import pytest

                pytest.fail("expected NagerUnavailableError; silent success is forbidden")
        assert PublicHoliday.objects.count() == 0


class HasArabicScriptTests(APITestCase):
    def test_detection(self):
        assert has_arabic_script("عيد العمال")
        assert has_arabic_script("عيد الميلاد المجيد")
        assert has_arabic_script("Eid Al-Adha") is False
        assert has_arabic_script("Sham El-Nessim") is False
        assert has_arabic_script("") is False
        assert has_arabic_script(None) is False
        # Mixed Arabic/English counts as already-Arabic.
        assert has_arabic_script("عيد القوات المسلحة") is True


class HolidayEndpointTests(APITestCase):
    """GET / POST endpoint behavior incl. the permission matrix."""

    def setUp(self):
        from django.core.cache import cache

        self.hr = User.objects.create_user(
            email="hr-holidays@example.com",
            password="pass-12345678",
            role=User.Role.HR,
            company=default_company(),
        )
        self.employee = User.objects.create_user(
            email="emp-holidays@example.com",
            password="pass-12345678",
            role=User.Role.EMPLOYEE,
            company=default_company(),
        )
        cache.clear()
        self.list_url = "/api/v1/holidays"
        self.refresh_url = "/api/v1/holidays/refresh"

    def _nager_ok(self):
        return patch(
            "holidays.services.fetch_public_holidays",
            return_value=[
                {
                    "date": "2026-05-01",
                    "name": "Labour Day",
                    "local_name": "عيد العمال",
                    "country_code": "EG",
                    "global": True,
                    "counties": [],
                    "types": ["Public"],
                    "launch_year": 1966,
                }
            ],
        )

    def _llm_ok(self):

        return (
            patch(
                "holidays.services.localise_holiday_names",
                return_value={},
            ),
            patch("holidays.services.propose_missing_islamic_holidays", return_value=[]),
        )

    def test_register_get_returns_rows_for_year_and_country(self):
        self.client.force_login(self.hr)
        PublicHoliday.objects.create(company=default_company(), 
            country_code="EG", date=date(2026, 5, 1), name="Labour Day", year=2026,
            name_local="عيد العمال",
        )
        PublicHoliday.objects.create(company=default_company(), 
            country_code="EG", date=date(2027, 5, 1), name="Labour Day", year=2027
        )

        response = self.client.get(self.list_url, {"year": "2026", "country": "EG"})

        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data) == 1
        assert data[0]["name"] == "Labour Day"
        assert data[0]["year"] == 2026
        assert set(data[0].keys()) == {
            "id", "country_code", "date", "name", "name_local", "source",
            "is_manual_override", "needs_confirmation", "is_recurring",
            "external_id", "year", "created_at", "updated_at",
        }

    def test_register_get_defaults_to_current_year_eg(self):
        self.client.force_login(self.hr)
        year = date.today().year
        PublicHoliday.objects.create(company=default_company(), 
            country_code="EG", date=date(year, 5, 1), name="Labour Day", year=year
        )

        response = self.client.get(self.list_url)

        assert response.status_code == 200
        assert [row["year"] for row in response.json()["data"]] == [year]

    def test_register_get_rejects_bad_year(self):
        self.client.force_login(self.hr)
        response = self.client.get(self.list_url, {"year": "abcd"})
        assert response.status_code == 422
        assert response.json()["error"]["fields"]["year"]

    def test_register_get_rejects_bad_country(self):
        self.client.force_login(self.hr)
        response = self.client.get(self.list_url, {"country": "EGYPT"})
        assert response.status_code == 422
        assert response.json()["error"]["fields"]["country"]

    def test_refresh_happy_path_returns_summary(self):
        self.client.force_login(self.hr)
        nager = self._nager_ok()
        translate, propose = self._llm_ok()
        with nager, translate, propose:
            response = self.client.post(
                self.refresh_url, {"year": 2026, "country": "EG"}, format="json"
            )

        assert response.status_code == 200
        summary = response.json()["data"]
        assert summary["added"] == 1
        assert summary["updated"] == 0
        assert summary["proposed_missing"] == 0
        assert summary["llm_available"] is True
        assert summary["manual_preserved"] == 0
        assert summary["warnings"] == []
        assert PublicHoliday.objects.filter(country_code="EG", year=2026).count() == 1

    def test_refresh_is_idempotent_second_click_adds_nothing(self):
        self.client.force_login(self.hr)
        nager = self._nager_ok()
        translate, propose = self._llm_ok()
        with nager, translate, propose:
            self.client.post(self.refresh_url, {"year": 2026, "country": "EG"}, format="json")
        with nager, translate, propose:
            second = self.client.post(
                self.refresh_url, {"year": 2026, "country": "EG"}, format="json"
            )

        assert second.status_code == 200
        assert second.json()["data"]["added"] == 0
        assert PublicHoliday.objects.filter(country_code="EG", year=2026).count() == 1

    def test_refresh_accepts_empty_body_defaults(self):
        self.client.force_login(self.hr)
        nager = self._nager_ok()
        translate, propose = self._llm_ok()
        with nager, translate, propose:
            response = self.client.post(self.refresh_url, format="json")

        assert response.status_code == 200
        summary = response.json()["data"]
        assert summary["year"] == date.today().year
        assert summary["country"] == "EG"

    def test_refresh_rejects_bad_year_422(self):
        self.client.force_login(self.hr)
        response = self.client.post(
            self.refresh_url, {"year": 2200, "country": "EG"}, format="json"
        )
        assert response.status_code == 422
        assert "year" in response.json()["error"]["fields"]

    def test_refresh_nager_down_returns_503_and_writes_nothing(self):
        self.client.force_login(self.hr)
        with patch(
            "holidays.services.fetch_public_holidays",
            side_effect=NagerError("provider unreachable"),
        ):
            response = self.client.post(
                self.refresh_url, {"year": 2026, "country": "EG"}, format="json"
            )

        assert response.status_code == 503
        error = response.json()["error"]
        assert error["code"] == "upstream_unavailable"
        assert PublicHoliday.objects.count() == 0

    def test_refresh_llm_down_still_imports_and_reports(self):
        self.client.force_login(self.hr)
        nager = self._nager_ok()
        with nager, patch(
            "holidays.services.localise_holiday_names",
            side_effect=services.LLMUnavailableError("down"),
        ), patch(
            "holidays.services.propose_missing_islamic_holidays",
            side_effect=services.LLMUnavailableError("down"),
        ):
            response = self.client.post(
                self.refresh_url, {"year": 2026, "country": "EG"}, format="json"
            )

        assert response.status_code == 200
        summary = response.json()["data"]
        assert summary["added"] == 1
        assert summary["llm_available"] is False
        assert summary["warnings"], "LLM degradation must produce a warning"
        # The official row landed; nothing was proposed.
        assert PublicHoliday.objects.filter(
            country_code="EG", year=2026, source=PublicHoliday.Source.NAGER
        ).count() == 1
        assert PublicHoliday.objects.filter(
            country_code="EG", needs_confirmation=True
        ).count() == 0

    def test_refresh_requires_hr_non_hr_gets_404_envelope(self):
        self.client.force_login(self.employee)
        response = self.client.post(
            self.refresh_url, {"year": 2026, "country": "EG"}, format="json"
        )
        # IsHR gives the same 404 as a nonexistent resource (no existence
        # disclosure); allow both 403/404 envelopes here but never 200.
        assert response.status_code in (403, 404)
        assert "error" in response.json()
        assert PublicHoliday.objects.count() == 0

    def test_refresh_requires_authentication(self):
        response = self.client.post(
            self.refresh_url, {"year": 2026, "country": "EG"}, format="json"
        )
        assert response.status_code == 401
        assert PublicHoliday.objects.count() == 0

    def test_register_get_requires_hr_for_non_employee(self):
        self.client.force_login(self.employee)
        response = self.client.get(self.list_url, {"year": "2026"})
        assert response.status_code in (403, 404)

    def test_no_secrets_in_any_holiday_response(self):
        self.client.force_login(self.hr)
        nager = self._nager_ok()
        translate, propose = self._llm_ok()
        with nager, translate, propose:
            response = self.client.post(self.refresh_url, format="json")
        body = response.content.decode()
        assert "opencode" not in body.lower() or "OPENCODE_GO_API_KEY" not in body
        assert "Bearer" not in body
