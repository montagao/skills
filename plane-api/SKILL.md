---
name: plane-api
description: Internal helper for creating/listing/updating Plane work items.
user-invocable: false
---

# plane-api (internal)

A single, consistent interface to Plane.

## Config
This skill reads Plane connection settings from secrets/environment (no prompting):
- PLANE_BASE_URL (preferred) or `PLANE_API_URL`
- PLANE_WORKSPACE_SLUG
- PLANE_PROJECT_ID
- PLANE_API_KEY

(Optional: support multiple profiles if configured, e.g. `profile: "personal"|"business"`.)

## Input contract
The caller provides a JSON object:

### Create
{
  "action": "create",
  "title": "...",
  "description": "... (optional)",
  "due": "YYYY-MM-DD (optional)",
  "priority": "urgent|high|medium|low|none (optional)",
  "labels": ["claw_inbox", "..."] (optional)
}

### List
{
  "action": "list",
  "limit": 20,
  "filters": {
    "labels": ["claw_inbox"] (optional),
    "dueFrom": "YYYY-MM-DD" (optional),
    "dueTo": "YYYY-MM-DD" (optional),
    "state": "..." (optional),
    "search": "..." (optional)
  }
}

### Update
{
  "action": "update",
  "id": "work_item_id",
  "patch": {
    "title": "... (optional)",
    "description": "... (optional)",
    "due": "YYYY-MM-DD (optional)",
    "priority": "urgent|high|medium|low|none (optional)",
    "state": "... (optional)",
    "labels": ["..."] (optional)
  }
}

## Behavior
- Never asks the user questions (callers handle that).
- Enforces idempotency if the platform provides an incoming message id (best effort).
- Returns structured JSON only.
- When returning a work item URL, use the canonical web route:
  - `https://<plane-domain>/<workspaceSlug>/browse/<PROJECT_IDENTIFIER>-<SEQUENCE_ID>`
- Never synthesize legacy links like `/projects/<project>/issues/<issue>` because they can be wrong or redirect poorly.
- If the human-facing issue key cannot be resolved safely, omit `url` instead of guessing.

## Output (always JSON)
Success example:
{
  "ok": true,
  "action": "create",
  "id": "...",
  "issue_key": "TMOM-461",
  "url": "https://todo.translate.mom/translatemom/browse/TMOM-461",
  "title": "..."
}

Failure example:
{
  "ok": false,
  "action": "create",
  "error": "...",
  "status": 401
}
