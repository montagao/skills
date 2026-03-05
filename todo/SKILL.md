---
name: todo
description: Create a Plane work item quickly.
user-invocable: true
---

# /todo

Create a Plane work item from the user's input.

## Rules
- Treat the entire command args as the title unless the user clearly specifies a due date or priority.
- If user mentions a due date (e.g. "tomorrow", "next Monday"), convert to YYYY-MM-DD.
- If user mentions priority (urgent/high/medium/low), set it.

## Tool use
Run:
- `exec`:
  - command: `node {baseDir}/../plane-tools/plane.mjs create <title> [--due YYYY-MM-DD] [--priority <level>]`

Then reply with:
- ✅ Created: <title>
- ID: <id>
- If it failed: show the status + error summary and suggest next fix.
