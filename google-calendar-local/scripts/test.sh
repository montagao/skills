#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${BASE_DIR}/.venv/bin/python"
GCAL_BIN="${BASE_DIR}/bin/gcal"
LIVE_READS="${ENABLE_GCAL_LIVE_READ_TESTS:-0}"
LIVE_WRITES="${ENABLE_GCAL_LIVE_WRITE_TESTS:-0}"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "missing virtualenv: run ./scripts/install.sh" >&2
  exit 1
fi

if ! "${PYTHON_BIN}" -m coverage --version >/dev/null 2>&1; then
  "${PYTHON_BIN}" -m pip install coverage
fi

"${PYTHON_BIN}" -m coverage run --branch --source "${BASE_DIR}/bin" -m unittest discover -s "${BASE_DIR}/tests" -p 'test_*.py'
"${PYTHON_BIN}" -m coverage report --include "${BASE_DIR}/bin/gcal_cli.py" --fail-under 100

AUTH_STATUS="$("${GCAL_BIN}" auth status)"
printf '%s\n' "${AUTH_STATUS}"

TOKEN_PRESENT="$(
  printf '%s' "${AUTH_STATUS}" | "${PYTHON_BIN}" -c 'import json,sys; print("1" if json.load(sys.stdin).get("token_exists") else "0")'
)"

if [[ "${LIVE_READS}" != "1" || "${TOKEN_PRESENT}" != "1" ]]; then
  echo "skipping live Calendar API reads; set ENABLE_GCAL_LIVE_READ_TESTS=1 and authorize first"
  exit 0
fi

"${GCAL_BIN}" calendars list
"${GCAL_BIN}" events upcoming --calendar primary --hours 24 --limit 20 --timezone Australia/Brisbane
"${GCAL_BIN}" freebusy --calendar primary --start 2026-03-30T09:00:00+10:00 --end 2026-03-30T17:00:00+10:00 --timezone Australia/Brisbane

if [[ "${LIVE_WRITES}" != "1" ]]; then
  echo "skipping live Calendar API writes; set ENABLE_GCAL_LIVE_WRITE_TESTS=1 to enable event mutation round-trip"
  exit 0
fi

START_TS="$("${PYTHON_BIN}" -c 'from datetime import UTC, datetime, timedelta; start = datetime.now(UTC).replace(microsecond=0) + timedelta(hours=2); print(start.isoformat())')"
END_TS="$("${PYTHON_BIN}" -c 'from datetime import UTC, datetime, timedelta; end = datetime.now(UTC).replace(microsecond=0) + timedelta(hours=3); print(end.isoformat())')"

CREATE_JSON="$("${GCAL_BIN}" events create --calendar primary --summary "OpenClaw Temp Event" --start "${START_TS}" --end "${END_TS}" --timezone Australia/Brisbane)"
printf '%s\n' "${CREATE_JSON}"
EVENT_ID="$(
  printf '%s' "${CREATE_JSON}" | "${PYTHON_BIN}" -c 'import json,sys; print(json.load(sys.stdin)["item"]["id"])'
)"

"${GCAL_BIN}" events get --calendar primary --event-id "${EVENT_ID}"
"${GCAL_BIN}" events update --calendar primary --event-id "${EVENT_ID}" --summary "OpenClaw Temp Event Updated"
"${GCAL_BIN}" events delete --calendar primary --event-id "${EVENT_ID}"

DELETE_CHECK_JSON="$("${GCAL_BIN}" events get --calendar primary --event-id "${EVENT_ID}" || true)"
printf '%s\n' "${DELETE_CHECK_JSON}"
printf '%s' "${DELETE_CHECK_JSON}" | "${PYTHON_BIN}" -c 'import json,sys; payload = json.load(sys.stdin); raise SystemExit(0 if (not payload.get("ok") and payload.get("error", {}).get("code") == "NOT_FOUND") else 1)'
