from __future__ import annotations

import argparse
import importlib.util
import json
import os
import runpy
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "bin" / "gcal_cli.py"
SPEC = importlib.util.spec_from_file_location("gcal_cli_test_module", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
gcal_cli = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gcal_cli
SPEC.loader.exec_module(gcal_cli)


class FakeCreds:
    def __init__(
        self,
        *,
        valid: bool = False,
        expired: bool = False,
        refresh_token: str | None = None,
        payload: str = '{"token": "value"}',
    ) -> None:
        self.valid = valid
        self.expired = expired
        self.refresh_token = refresh_token
        self.payload = payload
        self.refresh_calls = 0

    def refresh(self, _request: object) -> None:
        self.refresh_calls += 1
        self.valid = True
        self.expired = False

    def to_json(self) -> str:
        return self.payload


class FakeRequestBuilder:
    def __init__(self, payload: object) -> None:
        self.payload = payload

    def execute(self) -> object:
        return self.payload


class FakeEventsApi:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.next_payload: object = {"items": []}

    def list(self, **kwargs: object) -> FakeRequestBuilder:
        self.calls.append(("list", kwargs))
        return FakeRequestBuilder(self.next_payload)

    def get(self, **kwargs: object) -> FakeRequestBuilder:
        self.calls.append(("get", kwargs))
        return FakeRequestBuilder(self.next_payload)

    def insert(self, **kwargs: object) -> FakeRequestBuilder:
        self.calls.append(("insert", kwargs))
        return FakeRequestBuilder(self.next_payload)

    def patch(self, **kwargs: object) -> FakeRequestBuilder:
        self.calls.append(("patch", kwargs))
        return FakeRequestBuilder(self.next_payload)

    def delete(self, **kwargs: object) -> FakeRequestBuilder:
        self.calls.append(("delete", kwargs))
        return FakeRequestBuilder(self.next_payload)


class FakeCalendarListApi:
    def __init__(self, payload: object) -> None:
        self.payload = payload
        self.calls: list[str] = []

    def list(self) -> FakeRequestBuilder:
        self.calls.append("list")
        return FakeRequestBuilder(self.payload)


class FakeFreebusyApi:
    def __init__(self, payload: object) -> None:
        self.payload = payload
        self.calls: list[dict[str, object]] = []

    def query(self, **kwargs: object) -> FakeRequestBuilder:
        self.calls.append(kwargs)
        return FakeRequestBuilder(self.payload)


class FakeService:
    def __init__(self) -> None:
        self.events_api = FakeEventsApi()
        self.calendar_list_api = FakeCalendarListApi({"items": []})
        self.freebusy_api = FakeFreebusyApi({"calendars": {}})

    def events(self) -> FakeEventsApi:
        return self.events_api

    def calendarList(self) -> FakeCalendarListApi:
        return self.calendar_list_api

    def freebusy(self) -> FakeFreebusyApi:
        return self.freebusy_api


def namespace(**kwargs: object) -> argparse.Namespace:
    return argparse.Namespace(**kwargs)


def make_http_error(status: int, reason: str | None = None) -> Exception:
    payload = {"error": {"errors": []}}
    if reason is not None:
        payload["error"]["errors"].append({"reason": reason})
    response = types.SimpleNamespace(status=status, reason=f"status-{status}")
    return gcal_cli.HttpError(response, json.dumps(payload).encode("utf-8"))


class GcalCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.base_path = Path(self.temp_dir.name)
        self.config_path = self.base_path / "config.json"
        self.token_path = self.base_path / "token.json"
        self.credentials_path = self.base_path / "credentials.json"

    def test_default_and_save_load_config_roundtrip(self) -> None:
        config = gcal_cli.default_config()
        self.assertIn("credentials_path", config)
        loaded_default = gcal_cli.load_config(self.config_path)
        self.assertEqual(loaded_default["default_timezone"], gcal_cli.DEFAULT_TIMEZONE)
        gcal_cli.save_config({"default_timezone": "UTC"}, self.config_path)
        loaded = gcal_cli.load_config(self.config_path)
        self.assertEqual(loaded["default_timezone"], "UTC")
        self.assertIn("token_path", loaded)

    def test_load_config_rejects_non_object(self) -> None:
        self.config_path.write_text("[]", encoding="utf-8")
        with self.assertRaises(gcal_cli.CliError) as context:
            gcal_cli.load_config(self.config_path)
        self.assertEqual(context.exception.code, "INVALID_CONFIG")

    def test_json_helpers(self) -> None:
        self.assertEqual(
            gcal_cli.json_ok("events.upcoming", items=[]),
            {"ok": True, "command": "events.upcoming", "items": []},
        )
        self.assertEqual(
            gcal_cli.json_error("AUTH_REQUIRED", "Run gcal auth init", step="bootstrap"),
            {
                "ok": False,
                "error": {
                    "code": "AUTH_REQUIRED",
                    "message": "Run gcal auth init",
                    "step": "bootstrap",
                },
            },
        )

    def test_parse_rfc3339_and_dates_validation(self) -> None:
        parsed = gcal_cli.parse_rfc3339("2026-03-30T09:00:00Z")
        self.assertEqual(parsed.utcoffset().total_seconds(), 0)
        self.assertEqual(gcal_cli.parse_iso_date("2026-03-30"), "2026-03-30")
        with self.assertRaises(gcal_cli.CliError):
            gcal_cli.parse_rfc3339("2026-03-30T09:00:00")
        with self.assertRaises(gcal_cli.CliError):
            gcal_cli.parse_rfc3339("not-a-timestamp")
        with self.assertRaises(gcal_cli.CliError):
            gcal_cli.parse_iso_date("30-03-2026")

    def test_require_google_dependencies_guard(self) -> None:
        gcal_cli.require_google_dependencies()
        with mock.patch.object(gcal_cli, "GOOGLE_IMPORT_ERROR", ImportError("missing deps")):
            with self.assertRaises(gcal_cli.CliError) as context:
                gcal_cli.require_google_dependencies()
        self.assertEqual(context.exception.code, "DEPENDENCIES_MISSING")

    def test_load_credentials_from_disk_none_when_missing(self) -> None:
        with mock.patch.object(gcal_cli, "require_google_dependencies"):
            self.assertIsNone(gcal_cli.load_credentials_from_disk(self.token_path, gcal_cli.SCOPES))

    def test_load_and_save_credentials(self) -> None:
        fake_creds = FakeCreds(valid=True)
        self.token_path.write_text('{"token": "stored"}', encoding="utf-8")
        with (
            mock.patch.object(gcal_cli, "require_google_dependencies"),
            mock.patch.object(gcal_cli.Credentials, "from_authorized_user_file", return_value=fake_creds),
        ):
            creds = gcal_cli.load_credentials_from_disk(self.token_path, gcal_cli.SCOPES)
        self.assertIs(creds, fake_creds)
        gcal_cli.save_credentials_to_disk(fake_creds, self.token_path)
        self.assertEqual(self.token_path.read_text(encoding="utf-8"), fake_creds.to_json())

    def test_ensure_creds_happy_path_refresh_and_failures(self) -> None:
        self.credentials_path.write_text("{}", encoding="utf-8")
        valid = FakeCreds(valid=True)
        refreshing = FakeCreds(valid=False, expired=True, refresh_token="refresh-token")
        stale = FakeCreds(valid=False, expired=False, refresh_token=None)

        with mock.patch.object(gcal_cli, "load_credentials_from_disk", return_value=valid):
            self.assertIs(gcal_cli.ensure_creds(gcal_cli.SCOPES, self.credentials_path, self.token_path), valid)

        with (
            mock.patch.object(gcal_cli, "load_credentials_from_disk", return_value=refreshing),
            mock.patch.object(gcal_cli, "save_credentials_to_disk") as save_mock,
            mock.patch.object(gcal_cli, "Request", return_value=object()),
        ):
            refreshed = gcal_cli.ensure_creds(gcal_cli.SCOPES, self.credentials_path, self.token_path)
        self.assertIs(refreshed, refreshing)
        save_mock.assert_called_once()

        with mock.patch.object(gcal_cli, "load_credentials_from_disk", return_value=None):
            with self.assertRaises(gcal_cli.CliError) as context:
                gcal_cli.ensure_creds(gcal_cli.SCOPES, self.credentials_path, self.token_path)
        self.assertEqual(context.exception.exit_code, gcal_cli.EXIT_AUTH_REQUIRED)

        with mock.patch.object(gcal_cli, "load_credentials_from_disk", return_value=stale):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.ensure_creds(gcal_cli.SCOPES, self.credentials_path, self.token_path)

        with self.assertRaises(gcal_cli.CliError):
            gcal_cli.ensure_creds(gcal_cli.SCOPES, self.credentials_path.with_name("missing.json"), self.token_path)

    def test_ensure_creds_refresh_error_maps_to_auth_required(self) -> None:
        self.credentials_path.write_text("{}", encoding="utf-8")
        broken = FakeCreds(valid=False, expired=True, refresh_token="refresh-token")

        def fail_refresh(_request: object) -> None:
            raise gcal_cli.RefreshError("nope")

        broken.refresh = fail_refresh  # type: ignore[assignment]
        with (
            mock.patch.object(gcal_cli, "load_credentials_from_disk", return_value=broken),
            mock.patch.object(gcal_cli, "Request", return_value=object()),
        ):
            with self.assertRaises(gcal_cli.CliError) as context:
                gcal_cli.ensure_creds(gcal_cli.SCOPES, self.credentials_path, self.token_path)
        self.assertEqual(context.exception.code, "AUTH_REQUIRED")

    def test_build_calendar_service(self) -> None:
        with (
            mock.patch.object(gcal_cli, "require_google_dependencies"),
            mock.patch.object(gcal_cli, "build", return_value="service") as build_mock,
        ):
            service = gcal_cli.build_calendar_service(FakeCreds(valid=True))
        self.assertEqual(service, "service")
        build_mock.assert_called_once()

    def test_get_google_reason_and_retryable_detection(self) -> None:
        retryable = make_http_error(403, "rateLimitExceeded")
        non_retryable = make_http_error(403, "forbidden")
        transient = make_http_error(500, None)
        no_content = types.SimpleNamespace(content=b"", resp=types.SimpleNamespace(status=403))
        invalid_content = types.SimpleNamespace(content=b"{", resp=types.SimpleNamespace(status=403))
        status_only = types.SimpleNamespace(
            content=json.dumps({"error": {"status": "quotaExceeded"}}).encode("utf-8"),
            resp=types.SimpleNamespace(status=403),
        )
        non_string_reason = types.SimpleNamespace(
            content=json.dumps({"error": {"errors": [{"reason": 123}]}}).encode("utf-8"),
            resp=types.SimpleNamespace(status=403),
        )
        self.assertEqual(gcal_cli.get_google_reason(retryable), "rateLimitExceeded")
        self.assertIsNone(gcal_cli.get_google_reason(no_content))  # type: ignore[arg-type]
        self.assertIsNone(gcal_cli.get_google_reason(invalid_content))  # type: ignore[arg-type]
        self.assertEqual(gcal_cli.get_google_reason(status_only), "quotaExceeded")  # type: ignore[arg-type]
        self.assertIsNone(gcal_cli.get_google_reason(non_string_reason))  # type: ignore[arg-type]
        self.assertTrue(gcal_cli.is_retryable_error(retryable))
        self.assertFalse(gcal_cli.is_retryable_error(non_retryable))
        self.assertTrue(gcal_cli.is_retryable_error(transient))
        self.assertFalse(gcal_cli.is_retryable_error(make_http_error(404, "notFound")))
        self.assertTrue(gcal_cli.is_retryable_error(ConnectionError("network")))
        self.assertFalse(gcal_cli.is_retryable_error(ValueError("nope")))

    def test_with_backoff_retries_and_stops(self) -> None:
        calls = {"count": 0}
        sleeps: list[float] = []

        def flaky() -> str:
            calls["count"] += 1
            if calls["count"] < 3:
                raise make_http_error(429, "rateLimitExceeded")
            return "ok"

        result = gcal_cli.with_backoff(flaky, sleeper=sleeps.append, rand=lambda: 0.0)
        self.assertEqual(result, "ok")
        self.assertEqual(sleeps, [1.0, 2.0])

        with self.assertRaises(Exception):
            gcal_cli.with_backoff(lambda: (_ for _ in ()).throw(ValueError("boom")), max_attempts=2)

    def test_runtime_config_and_auth_status(self) -> None:
        config = {
            "credentials_path": str(self.credentials_path),
            "token_path": str(self.token_path),
            "default_timezone": "UTC",
        }
        self.credentials_path.write_text("{}", encoding="utf-8")
        self.token_path.write_text("{}", encoding="utf-8")
        creds = FakeCreds(valid=True, expired=False, refresh_token="token")
        with (
            mock.patch.object(gcal_cli, "load_config", return_value=config),
            mock.patch.object(gcal_cli, "load_credentials_from_disk", return_value=creds),
            mock.patch.object(gcal_cli, "save_config") as save_mock,
        ):
            payload = gcal_cli.cmd_auth_status(namespace())
        self.assertTrue(payload["valid"])
        self.assertTrue(payload["refreshable"])
        self.assertTrue(payload["token_exists"])
        save_mock.assert_called_once()

    def test_get_runtime_config_and_get_service(self) -> None:
        config = {
            "credentials_path": str(self.credentials_path),
            "token_path": str(self.token_path),
            "default_timezone": "UTC",
        }
        creds = FakeCreds(valid=True)
        with (
            mock.patch.object(gcal_cli, "load_config", return_value=config),
            mock.patch.object(gcal_cli, "ensure_creds", return_value=creds) as ensure_mock,
            mock.patch.object(gcal_cli, "build_calendar_service", return_value="service") as build_mock,
        ):
            loaded_config, credentials_path, token_path = gcal_cli.get_runtime_config(namespace())
            service, _, _, config_result = gcal_cli.get_service(namespace())
        self.assertEqual(loaded_config, config)
        self.assertEqual(credentials_path, self.credentials_path)
        self.assertEqual(token_path, self.token_path)
        self.assertEqual(service, "service")
        self.assertEqual(config_result, config)
        ensure_mock.assert_called_once()
        build_mock.assert_called_once_with(creds)

    def test_auth_status_without_token_and_with_none_creds(self) -> None:
        config = {
            "credentials_path": str(self.credentials_path),
            "token_path": str(self.token_path),
            "default_timezone": "UTC",
        }
        with (
            mock.patch.object(gcal_cli, "load_config", return_value=config),
            mock.patch.object(gcal_cli, "save_config"),
        ):
            missing_token_payload = gcal_cli.cmd_auth_status(namespace())
        self.assertFalse(missing_token_payload["token_exists"])

        self.token_path.write_text("{}", encoding="utf-8")
        with (
            mock.patch.object(gcal_cli, "load_config", return_value=config),
            mock.patch.object(gcal_cli, "load_credentials_from_disk", return_value=None),
            mock.patch.object(gcal_cli, "save_config"),
        ):
            none_creds_payload = gcal_cli.cmd_auth_status(namespace())
        self.assertFalse(none_creds_payload["valid"])

    def test_auth_status_handles_token_load_failure(self) -> None:
        config = {
            "credentials_path": str(self.credentials_path),
            "token_path": str(self.token_path),
            "default_timezone": "UTC",
        }
        self.token_path.write_text("{}", encoding="utf-8")
        with (
            mock.patch.object(gcal_cli, "load_config", return_value=config),
            mock.patch.object(gcal_cli, "load_credentials_from_disk", side_effect=ValueError("bad token")),
            mock.patch.object(gcal_cli, "save_config"),
        ):
            payload = gcal_cli.cmd_auth_status(namespace())
        self.assertEqual(payload["token_error"], "bad token")

    def test_auth_init(self) -> None:
        self.credentials_path.write_text("{}", encoding="utf-8")
        fake_flow = mock.Mock()
        fake_creds = FakeCreds(valid=True)
        fake_flow.run_local_server.return_value = fake_creds
        args = namespace(credentials=str(self.credentials_path), token=str(self.token_path), port=8765)
        with (
            mock.patch.object(gcal_cli, "require_google_dependencies"),
            mock.patch.object(gcal_cli.InstalledAppFlow, "from_client_secrets_file", return_value=fake_flow),
            mock.patch.object(gcal_cli, "save_credentials_to_disk") as save_creds,
            mock.patch.object(gcal_cli, "save_config") as save_config,
        ):
            payload = gcal_cli.cmd_auth_init(args)
        self.assertEqual(payload["command"], "auth.init")
        save_creds.assert_called_once()
        save_config.assert_called_once()

        args_missing = namespace(
            credentials=str(self.credentials_path.with_name("missing.json")),
            token=str(self.token_path),
            port=8765,
        )
        with mock.patch.object(gcal_cli, "require_google_dependencies"):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_auth_init(args_missing)

    def test_calendars_and_events_read_commands(self) -> None:
        service = FakeService()
        service.calendar_list_api = FakeCalendarListApi(
            {
                "items": [
                    {
                        "id": "primary",
                        "summary": "Primary",
                        "timeZone": "Australia/Brisbane",
                        "accessRole": "owner",
                        "primary": True,
                    }
                ]
            }
        )
        service.events_api.next_payload = {
            "items": [
                {
                    "id": "evt-1",
                    "status": "confirmed",
                    "summary": "Dentist",
                    "start": {"dateTime": "2026-03-30T09:00:00+10:00"},
                    "end": {"dateTime": "2026-03-30T10:00:00+10:00"},
                }
            ]
        }
        config = {"default_timezone": "Australia/Brisbane"}
        args = namespace(calendar="primary", hours=12, limit=10, timezone=None)
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            calendars = gcal_cli.cmd_calendars_list(namespace())
            upcoming = gcal_cli.cmd_events_upcoming(args)
        self.assertTrue(calendars["items"][0]["primary"])
        self.assertEqual(upcoming["items"][0]["summary"], "Dentist")
        self.assertEqual(service.events_api.calls[0][0], "list")

        between_args = namespace(
            calendar="primary",
            start="2026-03-30T09:00:00+10:00",
            end="2026-03-30T11:00:00+10:00",
            timezone="Australia/Brisbane",
        )
        service.events_api.next_payload = {
            "id": "evt-1",
            "status": "confirmed",
            "summary": "Dentist",
            "start": {"dateTime": "2026-03-30T09:00:00+10:00"},
            "end": {"dateTime": "2026-03-30T10:00:00+10:00"},
        }
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            between = gcal_cli.cmd_events_between(between_args)
            get_payload = gcal_cli.cmd_events_get(namespace(calendar="primary", event_id="evt-1"))
        self.assertEqual(between["start"], "2026-03-30T09:00:00+10:00")
        self.assertEqual(get_payload["item"]["id"], "evt-1")

        bad_between = namespace(
            calendar="primary",
            start="2026-03-30T11:00:00+10:00",
            end="2026-03-30T09:00:00+10:00",
            timezone="Australia/Brisbane",
        )
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_events_between(bad_between)

    def test_freebusy_command(self) -> None:
        service = FakeService()
        service.freebusy_api = FakeFreebusyApi(
            {
                "calendars": {
                    "primary": {
                        "busy": [{"start": "2026-03-30T09:00:00+10:00", "end": "2026-03-30T10:00:00+10:00"}]
                    }
                }
            }
        )
        config = {"default_timezone": "Australia/Brisbane"}
        args = namespace(
            calendar="primary",
            start="2026-03-30T09:00:00+10:00",
            end="2026-03-30T17:00:00+10:00",
            timezone=None,
        )
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            payload = gcal_cli.cmd_freebusy(args)
        self.assertEqual(payload["items"][0]["start"], "2026-03-30T09:00:00+10:00")

        args_bad = namespace(
            calendar="primary",
            start="2026-03-30T17:00:00+10:00",
            end="2026-03-30T09:00:00+10:00",
            timezone=None,
        )
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_freebusy(args_bad)

    def test_event_body_builders_and_create_command(self) -> None:
        timed_args = namespace(
            calendar="primary",
            summary="Meeting",
            start="2026-03-30T09:00:00+10:00",
            end="2026-03-30T10:00:00+10:00",
            timezone="Australia/Brisbane",
            location="Office",
            description="Discuss roadmap",
            attendee=["a@example.com"],
            all_day=False,
            start_date=None,
            end_date=None,
        )
        timed_body = gcal_cli.build_timed_event_body(timed_args)
        self.assertEqual(timed_body["attendees"], [{"email": "a@example.com"}])
        minimal_timed = namespace(
            calendar="primary",
            summary="Quiet meeting",
            start="2026-03-30T09:00:00+10:00",
            end="2026-03-30T10:00:00+10:00",
            timezone=None,
            location=None,
            description=None,
            attendee=None,
            all_day=False,
            start_date=None,
            end_date=None,
        )
        minimal_body = gcal_cli.build_timed_event_body(minimal_timed)
        self.assertNotIn("timeZone", minimal_body["start"])
        self.assertNotIn("location", minimal_body)
        self.assertNotIn("description", minimal_body)
        self.assertNotIn("attendees", minimal_body)
        with self.assertRaises(gcal_cli.CliError):
            invalid_range = namespace(**{**vars(minimal_timed), "end": "2026-03-30T08:00:00+10:00"})
            gcal_cli.build_timed_event_body(invalid_range)

        all_day_args = namespace(
            calendar="primary",
            summary="Leave",
            start=None,
            end=None,
            timezone=None,
            location="Home",
            description="Vacation",
            attendee=None,
            all_day=True,
            start_date="2026-03-30",
            end_date="2026-03-31",
        )
        self.assertEqual(gcal_cli.build_all_day_event_body(all_day_args)["start"]["date"], "2026-03-30")
        self.assertEqual(gcal_cli.build_all_day_event_body(all_day_args)["location"], "Home")
        self.assertEqual(gcal_cli.build_all_day_event_body(all_day_args)["description"], "Vacation")
        minimal_all_day = namespace(**{**vars(all_day_args), "location": None, "description": None})
        minimal_all_day_body = gcal_cli.build_all_day_event_body(minimal_all_day)
        self.assertNotIn("location", minimal_all_day_body)
        self.assertNotIn("description", minimal_all_day_body)
        with self.assertRaises(gcal_cli.CliError):
            bad_dates = namespace(**{**vars(all_day_args), "end_date": "2026-03-30"})
            gcal_cli.build_all_day_event_body(bad_dates)

        service = FakeService()
        service.events_api.next_payload = {
            "id": "evt-1",
            "status": "confirmed",
            "summary": "Meeting",
            "start": {"dateTime": "2026-03-30T09:00:00+10:00"},
            "end": {"dateTime": "2026-03-30T10:00:00+10:00"},
        }
        config = {"default_timezone": "Australia/Brisbane"}
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            payload = gcal_cli.cmd_events_create(timed_args)
        self.assertEqual(payload["item"]["id"], "evt-1")
        self.assertEqual(service.events_api.calls[0][0], "insert")

        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            payload_all_day = gcal_cli.cmd_events_create(all_day_args)
        self.assertEqual(payload_all_day["command"], "events.create")

        invalid_timed = namespace(**{**vars(timed_args), "end": None})
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_events_create(invalid_timed)

        invalid_mix = namespace(**{**vars(all_day_args), "start": "2026-03-30T09:00:00+10:00", "end": "2026-03-30T10:00:00+10:00"})
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_events_create(invalid_mix)

        invalid_all_day = namespace(**{**vars(timed_args), "all_day": False, "start_date": "2026-03-30"})
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_events_create(invalid_all_day)

        missing_dates = namespace(**{**vars(all_day_args), "start_date": None, "end_date": None})
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_events_create(missing_dates)

    def test_events_update_and_delete_commands(self) -> None:
        service = FakeService()
        service.events_api.next_payload = {
            "id": "evt-1",
            "status": "confirmed",
            "summary": "Updated",
            "start": {"dateTime": "2026-03-30T09:00:00+10:00"},
            "end": {"dateTime": "2026-03-30T10:00:00+10:00"},
        }
        config = {"default_timezone": "Australia/Brisbane"}
        args = namespace(
            calendar="primary",
            event_id="evt-1",
            summary="Updated",
            start="2026-03-30T09:00:00+10:00",
            end="2026-03-30T10:00:00+10:00",
            timezone="Australia/Brisbane",
            location="Clinic",
            description="Bring forms",
        )
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            payload = gcal_cli.cmd_events_update(args)
            deleted = gcal_cli.cmd_events_delete(namespace(calendar="primary", event_id="evt-1"))
        self.assertEqual(payload["item"]["summary"], "Updated")
        self.assertTrue(deleted["deleted"])

        timezone_free_update = namespace(
            calendar="primary",
            event_id="evt-1",
            summary=None,
            start="2026-03-30T09:00:00+10:00",
            end="2026-03-30T10:00:00+10:00",
            timezone=None,
            location=None,
            description=None,
        )
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            timezone_free_payload = gcal_cli.cmd_events_update(timezone_free_update)
        self.assertEqual(timezone_free_payload["command"], "events.update")

        empty_update = namespace(
            calendar="primary",
            event_id="evt-1",
            summary=None,
            start=None,
            end=None,
            timezone=None,
            location=None,
            description=None,
        )
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_events_update(empty_update)

        partial_time = namespace(
            calendar="primary",
            event_id="evt-1",
            summary=None,
            start="2026-03-30T09:00:00+10:00",
            end=None,
            timezone=None,
            location=None,
            description=None,
        )
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_events_update(partial_time)

        inverted_time = namespace(
            calendar="primary",
            event_id="evt-1",
            summary=None,
            start="2026-03-30T10:00:00+10:00",
            end="2026-03-30T09:00:00+10:00",
            timezone=None,
            location=None,
            description=None,
        )
        with mock.patch.object(gcal_cli, "get_service", return_value=(service, self.credentials_path, self.token_path, config)):
            with self.assertRaises(gcal_cli.CliError):
                gcal_cli.cmd_events_update(inverted_time)

    def test_build_parser_and_main_success_and_failures(self) -> None:
        parser = gcal_cli.build_parser()
        args = parser.parse_args(["auth", "status"])
        self.assertIs(args.func, gcal_cli.cmd_auth_status)

        class FakeParser:
            def __init__(self, func: object) -> None:
                self._func = func

            def parse_args(self, _argv: object) -> argparse.Namespace:
                return argparse.Namespace(func=self._func)

        with mock.patch.object(gcal_cli, "build_parser", return_value=FakeParser(lambda _args: {"ok": True, "command": "auth.status"})):
            with mock.patch("sys.stdout", new_callable=mock.MagicMock()) as stdout:
                exit_code = gcal_cli.main(["auth", "status"])
        self.assertEqual(exit_code, gcal_cli.EXIT_SUCCESS)
        self.assertTrue(stdout.write.called)

        failing_cli = lambda _args: (_ for _ in ()).throw(  # noqa: E731
            gcal_cli.CliError("AUTH_REQUIRED", "Run gcal auth init", gcal_cli.EXIT_AUTH_REQUIRED)
        )
        with mock.patch.object(gcal_cli, "build_parser", return_value=FakeParser(failing_cli)):
            exit_code = gcal_cli.main(["auth", "status"])
        self.assertEqual(exit_code, gcal_cli.EXIT_AUTH_REQUIRED)

        http_error = make_http_error(404, "notFound")
        failing_http = lambda _args: (_ for _ in ()).throw(http_error)  # noqa: E731
        with mock.patch.object(gcal_cli, "build_parser", return_value=FakeParser(failing_http)):
            exit_code = gcal_cli.main(["auth", "status"])
        self.assertEqual(exit_code, gcal_cli.EXIT_NOT_FOUND)

        failing_runtime = lambda _args: (_ for _ in ()).throw(RuntimeError("boom"))  # noqa: E731
        with mock.patch.object(gcal_cli, "build_parser", return_value=FakeParser(failing_runtime)):
            exit_code = gcal_cli.main(["auth", "status"])
        self.assertEqual(exit_code, gcal_cli.EXIT_GOOGLE_API)

    def test_map_http_error_and_event_normalization(self) -> None:
        not_found = gcal_cli.map_http_error(make_http_error(404, "notFound"))
        generic = gcal_cli.map_http_error(make_http_error(403, "forbidden"))
        without_status = gcal_cli.map_http_error(
            gcal_cli.HttpError(types.SimpleNamespace(status=None, reason="bad"), json.dumps({"error": {}}).encode("utf-8"))
        )
        self.assertEqual(not_found.code, "NOT_FOUND")
        self.assertEqual(generic.code, "GOOGLE_API_ERROR")
        self.assertEqual(without_status.details, {})
        normalized = gcal_cli.normalize_event({"id": "evt-1", "status": "confirmed"})
        self.assertEqual(normalized["attendees"], [])

    def test_run_as_main_entrypoint(self) -> None:
        run_home = self.base_path / "fake-home"
        run_home.mkdir()
        with (
            mock.patch.dict(os.environ, {"HOME": str(run_home)}, clear=False),
            mock.patch.object(sys, "argv", [str(MODULE_PATH), "auth", "status"]),
        ):
            with self.assertRaises(SystemExit) as context:
                runpy.run_path(str(MODULE_PATH), run_name="__main__")
        self.assertEqual(context.exception.code, gcal_cli.EXIT_SUCCESS)


if __name__ == "__main__":
    unittest.main()
