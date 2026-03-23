---
name: triage
description: Review recent tasks and decide next actions.
user-invocable: true
---

# /triage

Triage quickly with this priority order: `in_progress` > `todo` > `claw_inbox`.

Within each bucket, rank by consequence and leverage before convenience:
- items with real deadlines, downstream impact, or unblock value come first
- items that are vague should be clarified before they crowd out concrete work
- do not recommend low-value easy tasks ahead of a harder important task just because they look finishable

## Tool use
1) Use `plane-api` to fetch active work first:
  - action: "list"
  - limit: 20
  - filters.state: "in_progress"

2) Use `plane-api` to fetch queued work next:
  - action: "list"
  - limit: 20
  - filters.state: "todo"

3) Use `plane-api` to fetch inbox candidates:
  - action: "list"
  - limit: 20
  - filters.labels: ["claw_inbox"]

4) Build recommendations with priority ordering:
  - in_progress items first
  - then todo items
  - then claw_inbox items
  - inside each group, sort by:
    - consequence if delayed
    - unblock value for other work
    - deadline pressure
    - clarity of next step
  - surface one recommended frog first: the highest-value hard task to move now

5) If user chooses actions (e.g. "mark #2 high priority", "set due tomorrow", "archive #5"),
   use `plane-api` action: "update" with the relevant patch.

6) If you include links to specific items, use the canonical `url` returned by `plane-api`;
   never construct Plane issue URLs manually.

## Output
- Frog first (1 line: why it matters + next step)
- Top 5 next actions (1 line each, why + next step)
- Split/clarify candidates
- Tasks to defer, drop, or leave parked
- One question max if needed (e.g. "Is this work or personal?")
