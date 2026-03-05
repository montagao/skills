---
name: triage
description: Review recent tasks and decide next actions.
user-invocable: true
---

# /triage

Fetch recent `claw_inbox` tasks and triage them fast.

## Tool use
1) Use `plane-api`:
  - action: "list"
  - limit: 20
  - filters.labels: ["claw_inbox"]

2) If user chooses actions (e.g. "mark #2 high priority", "set due tomorrow", "archive #5"),
   use `plane-api` action: "update" with the relevant patch.

## Output
- Top 5 next actions (1 line each, why + next step)
- Split/clarify candidates
- One question max if needed (e.g. "Is this work or personal?")
