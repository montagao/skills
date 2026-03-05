---
name: review
description: Weekly review from Plane tasks.
user-invocable: true
---

# /review

Weekly review based on current work items.

## Tool use
- `exec`: `node {baseDir}/../plane-tools/plane.mjs list --limit 50`

## Output
- Wins (3 bullets)
- Stuck items (3 bullets + suggested next action)
- Next week focus (3 bullets)
