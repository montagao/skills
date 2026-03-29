#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
import json
import os
import random
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Sequence

try:
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError as exc:  # pragma: no cover - exercised via runtime guard
    GOOGLE_IMPORT_ERROR = exc
    RefreshError = Exception  # type: ignore[assignment]
    Request = object  # type: ignore[assignment]
    Credentials = object  # type: ignore[assignment]
    HttpError = Exception  # type: ignore[assignment]
    InstalledAppFlow = object  # type: ignore[assignment]
    build = None  # type: ignore[assignment]
else:
    GOOGLE_IMPORT_ERROR = None

DEFAULT_CONFIG_DIR = Path.home() / ".config" / "openclaw-google-calendar"
DEFAULT_CREDENTIALS_PATH = DEFAULT_CONFIG_DIR / "credentials.json"
DEFAULT_TOKEN_PATH = DEFAULT_CONFIG_DIR / "token.json"
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.json"
DEFAULT_TIMEZONE = "Australia/Brisbane"
DEFAULT_CALENDAR = "primary"
SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.freebusy",
]

EXIT_SUCCESS = 0
EXIT_AUTH_REQUIRED = 2
EXIT_BAD_INPUT = 3
EXIT_GOOGLE_API = 4
EXIT_NOT_FOUND = 5

RETRYABLE_STATUSES = {429, 500, 502, 503, 504}
RETRYABLE_REASONS = {
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "quotaExceeded",
    "backendError",
}


@dataclass
class CliError(Exception):
    code: str
    message: str
    exit_code: int
    details: dict[str, Any] | None = None


def default_config() -> dict[str, Any]:
    return {
        "credentials_path": str(DEFAULT_CREDENTIALS_PATH),
        "token_path": str(DEFAULT_TOKEN_PATH),
        "default_timezone": DEFAULT_TIMEZONE,
    }


def load_config(config_path: Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    config = default_config()
    if config_path.exists():
        with config_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            raise CliError("INVALID_CONFIG", "Config file must contain a JSON object", EXIT_BAD_INPUT)
        config.update({key: value for key, value in data.items() if value is not None})
    return config


def save_config(config: dict[str, Any], config_path: Path = DEFAULT_CONFIG_PATH) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with config_path.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2, sort_keys=True)
        handle.write("\n")


def load_credentials_from_disk(
    token_path: Path,
    scopes: Sequence[str] | None = None,
) -> Credentials | None:
    require_google_dependencies()
    if not token_path.exists():
        return None
    return Credentials.from_authorized_user_file(str(token_path), scopes or SCOPES)


def save_credentials_to_disk(creds: Credentials, token_path: Path) -> None:
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(creds.to_json(), encoding="utf-8")


def require_google_dependencies() -> None:
    if GOOGLE_IMPORT_ERROR is not None:
        raise CliError(
            "DEPENDENCIES_MISSING",
            f"Google Calendar dependencies are not installed: {GOOGLE_IMPORT_ERROR}",
            EXIT_BAD_INPUT,
        )


def ensure_creds(
    scopes: Sequence[str],
    credentials_path: Path,
    token_path: Path,
) -> Credentials:
    if not credentials_path.exists():
        raise CliError(
            "AUTH_REQUIRED",
            f"Missing credentials file at {credentials_path}. Run gcal auth init.",
            EXIT_AUTH_REQUIRED,
        )

    creds = load_credentials_from_disk(token_path, scopes)
    if creds is None:
        raise CliError("AUTH_REQUIRED", "Run gcal auth init", EXIT_AUTH_REQUIRED)
    if creds.valid:
        return creds
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except RefreshError as exc:
            raise CliError("AUTH_REQUIRED", f"Token refresh failed: {exc}", EXIT_AUTH_REQUIRED) from exc
        save_credentials_to_disk(creds, token_path)
        return creds
    raise CliError("AUTH_REQUIRED", "Run gcal auth init", EXIT_AUTH_REQUIRED)


def build_calendar_service(creds: Credentials) -> Any:
    require_google_dependencies()
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def json_ok(command: str, **payload: Any) -> dict[str, Any]:
    result = {"ok": True, "command": command}
    result.update(payload)
    return result


def json_error(code: str, message: str, **details: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": False, "error": {"code": code, "message": message}}
    if details:
        payload["error"].update(details)
    return payload


def emit_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True))


def parse_rfc3339(value: str) -> datetime:
    candidate = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise CliError("INVALID_TIMESTAMP", f"Invalid RFC3339 timestamp: {value}", EXIT_BAD_INPUT) from exc
    if parsed.tzinfo is None:
        raise CliError("INVALID_TIMESTAMP", f"Timestamp must include a timezone offset: {value}", EXIT_BAD_INPUT)
    return parsed


def parse_iso_date(value: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise CliError("INVALID_DATE", f"Invalid YYYY-MM-DD date: {value}", EXIT_BAD_INPUT) from exc
    return value


def get_google_reason(error: HttpError) -> str | None:
    content = getattr(error, "content", b"")
    if not content:
        return None
    try:
        payload = json.loads(content.decode("utf-8"))
    except (AttributeError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    details = payload.get("error", {})
    errors = details.get("errors", [])
    if errors and isinstance(errors, list):
        reason = errors[0].get("reason")
        if isinstance(reason, str):
            return reason
    reason = details.get("status")
    return reason if isinstance(reason, str) else None


def is_retryable_error(error: Exception) -> bool:
    if isinstance(error, HttpError):
        status = getattr(getattr(error, "resp", None), "status", None)
        if status in RETRYABLE_STATUSES:
            return True
        if status == 403:
            return get_google_reason(error) in RETRYABLE_REASONS
        return False
    return isinstance(error, (ConnectionError, TimeoutError, OSError))


def with_backoff(
    fn: Callable[[], Any],
    *,
    max_attempts: int = 5,
    base_delay: float = 1.0,
    sleeper: Callable[[float], None] = time.sleep,
    rand: Callable[[], float] = random.random,
) -> Any:
    attempt = 1
    while True:
        try:
            return fn()
        except Exception as exc:
            if attempt >= max_attempts or not is_retryable_error(exc):
                raise
            delay = base_delay * (2 ** (attempt - 1)) + rand()
            sleeper(delay)
            attempt += 1


def normalize_event(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event.get("id"),
        "status": event.get("status"),
        "summary": event.get("summary"),
        "description": event.get("description"),
        "location": event.get("location"),
        "htmlLink": event.get("htmlLink"),
        "created": event.get("created"),
        "updated": event.get("updated"),
        "start": event.get("start", {}),
        "end": event.get("end", {}),
        "attendees": event.get("attendees", []),
    }


def get_runtime_config(args: argparse.Namespace) -> tuple[dict[str, Any], Path, Path]:
    config = load_config()
    credentials_path = Path(getattr(args, "credentials", None) or config["credentials_path"])
    token_path = Path(getattr(args, "token", None) or config["token_path"])
    return config, credentials_path, token_path


def get_service(args: argparse.Namespace) -> tuple[Any, Path, Path, dict[str, Any]]:
    config, credentials_path, token_path = get_runtime_config(args)
    creds = ensure_creds(SCOPES, credentials_path, token_path)
    return build_calendar_service(creds), credentials_path, token_path, config


def cmd_auth_status(args: argparse.Namespace) -> dict[str, Any]:
    config, credentials_path, token_path = get_runtime_config(args)
    save_config(config)
    credentials_exists = credentials_path.exists()
    token_exists = token_path.exists()
    valid = False
    expired = False
    refreshable = False
    token_error = None

    if token_exists:
        try:
            creds = load_credentials_from_disk(token_path, SCOPES)
        except Exception as exc:  # pragma: no cover - covered via tests through direct patching
            token_error = str(exc)
        else:
            if creds is not None:
                valid = bool(creds.valid)
                expired = bool(creds.expired)
                refreshable = bool(creds.refresh_token)

    return json_ok(
        "auth.status",
        credentials_path=str(credentials_path),
        token_path=str(token_path),
        credentials_exists=credentials_exists,
        token_exists=token_exists,
        valid=valid,
        expired=expired,
        refreshable=refreshable,
        token_error=token_error,
    )


def cmd_auth_init(args: argparse.Namespace) -> dict[str, Any]:
    require_google_dependencies()
    credentials_path = Path(args.credentials).expanduser()
    token_path = Path(args.token).expanduser()
    if not credentials_path.exists():
        raise CliError("AUTH_REQUIRED", f"Missing credentials file at {credentials_path}", EXIT_AUTH_REQUIRED)

    flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
    with contextlib.redirect_stdout(sys.stderr):
        creds = flow.run_local_server(
            host="127.0.0.1",
            port=args.port,
            open_browser=False,
            authorization_prompt_message="Open this URL in your browser to authorize access:\n{url}",
            success_message="Authorization received. You can close this window.",
        )

    save_credentials_to_disk(creds, token_path)
    config = default_config()
    config.update(
        {
            "credentials_path": str(credentials_path),
            "token_path": str(token_path),
            "default_timezone": DEFAULT_TIMEZONE,
        }
    )
    save_config(config)
    return json_ok(
        "auth.init",
        credentials_path=str(credentials_path),
        token_path=str(token_path),
        scopes=list(SCOPES),
    )


def cmd_calendars_list(args: argparse.Namespace) -> dict[str, Any]:
    service, _, _, _ = get_service(args)
    response = with_backoff(lambda: service.calendarList().list().execute())
    items = [
        {
            "id": item.get("id"),
            "summary": item.get("summary"),
            "timeZone": item.get("timeZone"),
            "accessRole": item.get("accessRole"),
            "primary": bool(item.get("primary", False)),
        }
        for item in response.get("items", [])
    ]
    return json_ok("calendars.list", items=items)


def cmd_events_upcoming(args: argparse.Namespace) -> dict[str, Any]:
    service, _, _, config = get_service(args)
    timezone_name = args.timezone or config["default_timezone"]
    now = datetime.now(tz=UTC)
    end = now + timedelta(hours=args.hours)
    response = with_backoff(
        lambda: service.events()
        .list(
            calendarId=args.calendar,
            timeMin=now.isoformat(),
            timeMax=end.isoformat(),
            maxResults=args.limit,
            singleEvents=True,
            orderBy="startTime",
            timeZone=timezone_name,
        )
        .execute()
    )
    items = [normalize_event(item) for item in response.get("items", [])]
    return json_ok(
        "events.upcoming",
        calendar=args.calendar,
        timezone=timezone_name,
        items=items,
    )


def cmd_events_between(args: argparse.Namespace) -> dict[str, Any]:
    service, _, _, config = get_service(args)
    timezone_name = args.timezone or config["default_timezone"]
    start = parse_rfc3339(args.start)
    end = parse_rfc3339(args.end)
    if start >= end:
        raise CliError("INVALID_RANGE", "Start time must be before end time", EXIT_BAD_INPUT)

    response = with_backoff(
        lambda: service.events()
        .list(
            calendarId=args.calendar,
            timeMin=start.isoformat(),
            timeMax=end.isoformat(),
            singleEvents=True,
            orderBy="startTime",
            timeZone=timezone_name,
        )
        .execute()
    )
    items = [normalize_event(item) for item in response.get("items", [])]
    return json_ok(
        "events.between",
        calendar=args.calendar,
        timezone=timezone_name,
        start=start.isoformat(),
        end=end.isoformat(),
        items=items,
    )


def cmd_events_get(args: argparse.Namespace) -> dict[str, Any]:
    service, _, _, _ = get_service(args)
    event = with_backoff(
        lambda: service.events().get(calendarId=args.calendar, eventId=args.event_id).execute()
    )
    return json_ok(
        "events.get",
        calendar=args.calendar,
        item=normalize_event(event),
    )


def cmd_freebusy(args: argparse.Namespace) -> dict[str, Any]:
    service, _, _, config = get_service(args)
    timezone_name = args.timezone or config["default_timezone"]
    start = parse_rfc3339(args.start)
    end = parse_rfc3339(args.end)
    if start >= end:
        raise CliError("INVALID_RANGE", "Start time must be before end time", EXIT_BAD_INPUT)

    response = with_backoff(
        lambda: service.freebusy()
        .query(
            body={
                "timeMin": start.isoformat(),
                "timeMax": end.isoformat(),
                "timeZone": timezone_name,
                "items": [{"id": args.calendar}],
            }
        )
        .execute()
    )
    busy = response.get("calendars", {}).get(args.calendar, {}).get("busy", [])
    return json_ok(
        "freebusy",
        calendar=args.calendar,
        timezone=timezone_name,
        start=start.isoformat(),
        end=end.isoformat(),
        items=busy,
    )


def build_timed_event_body(args: argparse.Namespace) -> dict[str, Any]:
    start = parse_rfc3339(args.start)
    end = parse_rfc3339(args.end)
    if start >= end:
        raise CliError("INVALID_RANGE", "Start time must be before end time", EXIT_BAD_INPUT)
    start_payload: dict[str, Any] = {"dateTime": start.isoformat()}
    end_payload: dict[str, Any] = {"dateTime": end.isoformat()}
    if args.timezone:
        start_payload["timeZone"] = args.timezone
        end_payload["timeZone"] = args.timezone
    body: dict[str, Any] = {
        "summary": args.summary,
        "start": start_payload,
        "end": end_payload,
    }
    if args.location:
        body["location"] = args.location
    if args.description:
        body["description"] = args.description
    if args.attendee:
        body["attendees"] = [{"email": attendee} for attendee in args.attendee]
    return body


def build_all_day_event_body(args: argparse.Namespace) -> dict[str, Any]:
    start_date = parse_iso_date(args.start_date)
    end_date = parse_iso_date(args.end_date)
    if start_date >= end_date:
        raise CliError("INVALID_RANGE", "start-date must be before end-date", EXIT_BAD_INPUT)
    body: dict[str, Any] = {
        "summary": args.summary,
        "start": {"date": start_date},
        "end": {"date": end_date},
    }
    if args.location:
        body["location"] = args.location
    if args.description:
        body["description"] = args.description
    return body


def cmd_events_create(args: argparse.Namespace) -> dict[str, Any]:
    service, _, _, config = get_service(args)
    timezone_name = args.timezone or config["default_timezone"]

    if args.all_day:
        if args.start or args.end:
            raise CliError(
                "INVALID_INPUT",
                "Timed arguments cannot be combined with --all-day",
                EXIT_BAD_INPUT,
            )
        if not args.start_date or not args.end_date:
            raise CliError(
                "INVALID_INPUT",
                "All-day events require --start-date and --end-date",
                EXIT_BAD_INPUT,
            )
        body = build_all_day_event_body(args)
    else:
        if args.start_date or args.end_date:
            raise CliError(
                "INVALID_INPUT",
                "All-day arguments require --all-day",
                EXIT_BAD_INPUT,
            )
        if not args.start or not args.end:
            raise CliError(
                "INVALID_INPUT",
                "Timed events require --start and --end",
                EXIT_BAD_INPUT,
            )
        body = build_timed_event_body(args)

    event = with_backoff(
        lambda: service.events()
        .insert(calendarId=args.calendar, body=body, sendUpdates="none")
        .execute()
    )
    return json_ok(
        "events.create",
        calendar=args.calendar,
        timezone=timezone_name,
        item=normalize_event(event),
    )


def cmd_events_update(args: argparse.Namespace) -> dict[str, Any]:
    service, _, _, config = get_service(args)
    timezone_name = args.timezone or config["default_timezone"]
    body: dict[str, Any] = {}

    if args.summary:
        body["summary"] = args.summary
    if args.location:
        body["location"] = args.location
    if args.description:
        body["description"] = args.description

    if args.start or args.end:
        if not args.start or not args.end:
            raise CliError("INVALID_INPUT", "Provide both --start and --end together", EXIT_BAD_INPUT)
        start = parse_rfc3339(args.start)
        end = parse_rfc3339(args.end)
        if start >= end:
            raise CliError("INVALID_RANGE", "Start time must be before end time", EXIT_BAD_INPUT)
        body["start"] = {"dateTime": start.isoformat()}
        body["end"] = {"dateTime": end.isoformat()}
        if args.timezone:
            body["start"]["timeZone"] = args.timezone
            body["end"]["timeZone"] = args.timezone

    if not body:
        raise CliError("INVALID_INPUT", "No updates were provided", EXIT_BAD_INPUT)

    event = with_backoff(
        lambda: service.events()
        .patch(
            calendarId=args.calendar,
            eventId=args.event_id,
            body=body,
            sendUpdates="none",
        )
        .execute()
    )
    return json_ok(
        "events.update",
        calendar=args.calendar,
        timezone=timezone_name,
        item=normalize_event(event),
    )


def cmd_events_delete(args: argparse.Namespace) -> dict[str, Any]:
    service, _, _, _ = get_service(args)
    with_backoff(
        lambda: service.events()
        .delete(calendarId=args.calendar, eventId=args.event_id, sendUpdates="none")
        .execute()
    )
    return json_ok(
        "events.delete",
        calendar=args.calendar,
        event_id=args.event_id,
        deleted=True,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local Google Calendar CLI for OpenClaw")
    subcommands = parser.add_subparsers(dest="command_group", required=True)

    auth = subcommands.add_parser("auth")
    auth_subcommands = auth.add_subparsers(dest="auth_command", required=True)
    auth_status = auth_subcommands.add_parser("status")
    auth_status.set_defaults(func=cmd_auth_status)

    auth_init = auth_subcommands.add_parser("init")
    auth_init.add_argument("--credentials", required=True)
    auth_init.add_argument("--token", required=True)
    auth_init.add_argument("--port", type=int, default=8765)
    auth_init.set_defaults(func=cmd_auth_init)

    calendars = subcommands.add_parser("calendars")
    calendars_subcommands = calendars.add_subparsers(dest="calendars_command", required=True)
    calendars_list = calendars_subcommands.add_parser("list")
    calendars_list.set_defaults(func=cmd_calendars_list)

    events = subcommands.add_parser("events")
    events_subcommands = events.add_subparsers(dest="events_command", required=True)

    events_upcoming = events_subcommands.add_parser("upcoming")
    events_upcoming.add_argument("--calendar", default=DEFAULT_CALENDAR)
    events_upcoming.add_argument("--hours", type=int, default=24)
    events_upcoming.add_argument("--limit", type=int, default=20)
    events_upcoming.add_argument("--timezone", default=None)
    events_upcoming.set_defaults(func=cmd_events_upcoming)

    events_between = events_subcommands.add_parser("between")
    events_between.add_argument("--calendar", default=DEFAULT_CALENDAR)
    events_between.add_argument("--start", required=True)
    events_between.add_argument("--end", required=True)
    events_between.add_argument("--timezone", default=None)
    events_between.set_defaults(func=cmd_events_between)

    events_get = events_subcommands.add_parser("get")
    events_get.add_argument("--calendar", default=DEFAULT_CALENDAR)
    events_get.add_argument("--event-id", required=True)
    events_get.set_defaults(func=cmd_events_get)

    events_create = events_subcommands.add_parser("create")
    events_create.add_argument("--calendar", default=DEFAULT_CALENDAR)
    events_create.add_argument("--summary", required=True)
    events_create.add_argument("--start")
    events_create.add_argument("--end")
    events_create.add_argument("--timezone", default=None)
    events_create.add_argument("--location")
    events_create.add_argument("--description")
    events_create.add_argument("--attendee", action="append")
    events_create.add_argument("--all-day", action="store_true")
    events_create.add_argument("--start-date")
    events_create.add_argument("--end-date")
    events_create.set_defaults(func=cmd_events_create)

    events_update = events_subcommands.add_parser("update")
    events_update.add_argument("--calendar", default=DEFAULT_CALENDAR)
    events_update.add_argument("--event-id", required=True)
    events_update.add_argument("--summary")
    events_update.add_argument("--start")
    events_update.add_argument("--end")
    events_update.add_argument("--timezone", default=None)
    events_update.add_argument("--location")
    events_update.add_argument("--description")
    events_update.set_defaults(func=cmd_events_update)

    events_delete = events_subcommands.add_parser("delete")
    events_delete.add_argument("--calendar", default=DEFAULT_CALENDAR)
    events_delete.add_argument("--event-id", required=True)
    events_delete.set_defaults(func=cmd_events_delete)

    freebusy = subcommands.add_parser("freebusy")
    freebusy.add_argument("--calendar", default=DEFAULT_CALENDAR)
    freebusy.add_argument("--start", required=True)
    freebusy.add_argument("--end", required=True)
    freebusy.add_argument("--timezone", default=None)
    freebusy.set_defaults(func=cmd_freebusy)

    return parser


def map_http_error(error: HttpError) -> CliError:
    status = getattr(getattr(error, "resp", None), "status", None)
    reason = get_google_reason(error)
    message = str(error)
    details: dict[str, Any] = {}
    if status is not None:
        details["status"] = status
    if reason is not None:
        details["reason"] = reason
    if status == 404:
        return CliError("NOT_FOUND", message, EXIT_NOT_FOUND, details)
    return CliError("GOOGLE_API_ERROR", message, EXIT_GOOGLE_API, details)


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        payload = args.func(args)
    except CliError as exc:
        emit_json(json_error(exc.code, exc.message, **(exc.details or {})))
        return exc.exit_code
    except HttpError as exc:
        mapped = map_http_error(exc)
        emit_json(json_error(mapped.code, mapped.message, **(mapped.details or {})))
        return mapped.exit_code
    except Exception as exc:  # pragma: no cover - unexpected runtime failures are surfaced here
        emit_json(json_error("UNEXPECTED_ERROR", str(exc)))
        return EXIT_GOOGLE_API
    emit_json(payload)
    return EXIT_SUCCESS


if __name__ == "__main__":
    sys.exit(main())
