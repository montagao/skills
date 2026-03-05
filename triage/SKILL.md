---
name: triage
description: Show recent Plane work items and pick next actions.
user-invocable: true
---

# /triage

Fetch the most recent work items and help me triage quickly.

## Tool use
1) Run:
- `exec`: `node {baseDir}/../plane-tools/plane.mjs list --limit 20`

2) Output a short triage:
- "Top 5 to do next" (with 1-line why)
- "Delete / defer / split candidates"
- Ask ONE question only if needed (e.g. "Is this work or personal?")
