---
name: google_calendar_local
description: Read and manage Google Calendar events on this Ubuntu host through a local Python CLI.
metadata: {"openclaw":{"emoji":"📅","os":["linux"],"requires":{"bins":["bash","python3"]}}}
---

# Google Calendar Local

Use this skill when the user asks about calendar events, availability, scheduling, reminders, conflicts, or creating, updating, or deleting events.

Use the built-in `exec` tool to call the local CLI at `{baseDir}/bin/gcal`.

Rules:
- Default calendar is `primary` unless the user explicitly names another calendar.
- Convert all relative times into explicit RFC3339 timestamps before calling the CLI.
- Default timezone is `Australia/Brisbane` unless the user explicitly says otherwise.
- Prefer read-only commands unless the user explicitly asks to change the calendar.
- Before update or delete operations, identify the exact event being modified.
- Never print credential or token file contents.
- If the CLI returns `AUTH_REQUIRED`, explain the one-time auth bootstrap steps.
- Return concise summaries after reading the CLI JSON output.

Command patterns:
- auth status:
  `{baseDir}/bin/gcal auth status`

- list calendars:
  `{baseDir}/bin/gcal calendars list`

- upcoming agenda:
  `{baseDir}/bin/gcal events upcoming --calendar primary --hours 24 --limit 20 --timezone Australia/Brisbane`

- events in range:
  `{baseDir}/bin/gcal events between --calendar primary --start <RFC3339> --end <RFC3339> --timezone Australia/Brisbane`

- free/busy:
  `{baseDir}/bin/gcal freebusy --calendar primary --start <RFC3339> --end <RFC3339> --timezone Australia/Brisbane`

- get event:
  `{baseDir}/bin/gcal events get --calendar <id> --event-id <id>`

- create timed event:
  `{baseDir}/bin/gcal events create --calendar <id> --summary <text> --start <RFC3339> --end <RFC3339> [--timezone <IANA>] [--location <text>] [--description <text>] [--attendee <email> ...]`

- create all-day event:
  `{baseDir}/bin/gcal events create --calendar <id> --summary <text> --all-day --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>`

- update event:
  `{baseDir}/bin/gcal events update --calendar <id> --event-id <id> [--summary <text>] [--start <RFC3339>] [--end <RFC3339>] [--location <text>] [--description <text>]`

- delete event:
  `{baseDir}/bin/gcal events delete --calendar <id> --event-id <id>`
