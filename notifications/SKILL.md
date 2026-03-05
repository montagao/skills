---
name: notifications
description: Set up message notifications (reminders) for plan/triage/review.
user-invocable: true
---

# /notifications

Set up reminder notifications for productivity skills.

## Behavior
- Prompt the user for notifications (keep it minimal).
- Do NOT create reminders unless the user explicitly says "apply now".
- Default timezone: Australia/Melbourne.
- After successful setup, write `{workspace}/.notifications_configured` to avoid repeated prompting.

## Ask only what you need
1) Where to deliver notifications? (default: Telegram DM)
   - Ask for destination id/handle needed for delivery.
2) Which reminders?
   - Daily plan time (default 07:30)
   - Weekly review day/time (default Sunday 18:00)
   - Optional: evening wrap (default 20:30)
3) Quiet hours (default 22:00-07:00) + max notifs/day (default 6)

## Tool use (when user says "apply now")
Use the `reminders` skill to create recurring reminders:

- Daily plan reminder:
  - name: "Daily plan"
  - schedule: "Every day at 07:30"
  - message: "/plan"

- Weekly review reminder:
  - name: "Weekly review"
  - schedule: "Every Sunday at 18:00"
  - message: "/review"

- Optional evening wrap:
  - name: "Evening wrap"
  - schedule: "Every day at 20:30"
  - message: "Summarize today. If nothing useful, output HEARTBEAT_OK."
  - suppressIf: "HEARTBEAT_OK"

## Output
- Summarize what reminders will be created.
- If applied: confirm created reminder ids.
- If not applied: confirm "no changes made" and show the chosen schedule in plain English.
