---
name: plan
description: Make today's plan from my Plane tasks.
user-invocable: true
---

# /plan

Make a realistic plan for today.

## Tool use
- `exec`: `node {baseDir}/../plane-tools/plane.mjs list --limit 30`

## Output format
- 3 MITs (Most Important Tasks)
- 1 "easy win"
- A simple time-block suggestion (morning/afternoon/evening)
- End with: "Reply: 1/2/3 to commit" (no extra questions)
