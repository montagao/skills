---
name: todo
description: Create a Plane task quickly.
user-invocable: true
---

# /todo

Turn the user's message into a Plane work item.

## Behavior
- Default label: `claw_inbox`
- Extract (best effort):
  - due date (convert to YYYY-MM-DD)
  - priority (urgent/high/medium/low/none)
- If critical info is missing, ask at most one question; otherwise create with `Needs details` in description.

## Tool use
- Use the `plane-api` skill:
  - action: "create"
  - title: from the user
  - due/priority if detected
  - labels: ["claw_inbox"]

## Output
- ✅ Created: <title>
- ID: <id>
- Link: <url> (if available)
- If failure: short error summary + what to fix (auth/base url/workspace/project).
