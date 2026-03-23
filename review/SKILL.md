---
name: review
description: Weekly review from Plane tasks.
user-invocable: true
---

# /review

Weekly review based on current tasks.

Bias toward signal, not activity. Surface the work that mattered, the important work that kept slipping, and the constraint that caused it.

## Tool use
- Use `plane-api`:
  - action: "list"
  - limit: 50
- If you include links to specific items, use the canonical `url` returned by `plane-api`; never construct Plane issue URLs manually.

## Output
- Wins (3 bullets)
- Stuck or avoided frogs (3 bullets + next action)
- Recurring bottleneck to fix next week
- Next week focus (3 bullets, with the first one being the likely frog)

## Notifications
- If `{workspace}/.notifications_configured` does not exist, prompt the user for notifications
  and route them to `/notifications`.
