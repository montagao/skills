---
name: plane-api
description: Connect to a self-hosted Plane.so instance via API. Use this skill when the user wants to interact with Plane for project management tasks including managing workspaces, projects, work items (issues), cycles, modules, states, and labels.
---

# Plane API Integration

This skill enables interaction with a self-hosted Plane.so instance using the `plane.py` CLI tool.

## Setup

The user must set these environment variables:

```bash
export PLANE_API_URL="https://plane.example.com"
export PLANE_API_KEY="plane_api_..."
export PLANE_WORKSPACE_SLUG="my-team"  # Optional, can pass --workspace instead
```

`PLANE_API_URL` must be the Plane server root (for example, `https://todo.translate.mom`).
Do not include UI route segments such as `/translatemom/projects/...`.

## Using the CLI Tool

All operations use `plane.py` from this skill directory.
In this environment, the path is `~/.skills/plane-api/plane.py` (other setups may use `~/.agents/skills/plane-api/plane.py`).

### Check API Compatibility

First, verify the Plane instance supports the v1 API (requires Plane v0.20+):

```bash
python ~/.skills/plane-api/plane.py check-version
```

`check-version` probes `GET /api/v1/workspaces/<PLANE_WORKSPACE_SLUG>/projects/` first (when `PLANE_WORKSPACE_SLUG` is set), then falls back to `GET /api/v1/workspaces/`. This avoids false negatives on deployments behind proxies where the top-level workspaces route may behave differently.

### List Projects

```bash
python ~/.skills/plane-api/plane.py projects
python ~/.skills/plane-api/plane.py projects --workspace other-team
```

### List Work Items (Issues)

```bash
python ~/.skills/plane-api/plane.py work-items <project_id>
```

### Create Work Item

```bash
python ~/.skills/plane-api/plane.py create-work-item <project_id> "Issue title"
python ~/.skills/plane-api/plane.py create-work-item <project_id> "Bug fix" --priority high
python ~/.skills/plane-api/plane.py create-work-item <project_id> "Feature" --priority medium --state-id <uuid> --description "Details here"
```

Priority values: `urgent`, `high`, `medium`, `low`, `none`

### List States

Get available states to use when creating work items:

```bash
python ~/.skills/plane-api/plane.py states <project_id>
```

### List Cycles

```bash
python ~/.skills/plane-api/plane.py cycles <project_id>
```

### List Modules

```bash
python ~/.skills/plane-api/plane.py modules <project_id>
```

## Typical Workflow

1. Run `check-version` to verify API access
2. Run `projects` to get project IDs
3. Run `states <project_id>` to get state UUIDs
4. Run `create-work-item` with the appropriate state and priority

## API Reference

For operations not covered by the CLI (like adding items to cycles/modules, creating labels, bulk operations), use curl directly:

```bash
curl -H "X-API-Key: $PLANE_API_KEY" \
     -H "Content-Type: application/json" \
     "$PLANE_API_URL/api/v1/workspaces/$PLANE_WORKSPACE_SLUG/..."
```

Key endpoints:
- `GET /api/v1/workspaces/{slug}/projects/` - List projects
- `GET /api/v1/workspaces/{slug}/projects/{id}/work-items/` - List work items
- `POST /api/v1/workspaces/{slug}/projects/{id}/work-items/` - Create work item
- `GET /api/v1/workspaces/{slug}/projects/{id}/states/` - List states
- `GET /api/v1/workspaces/{slug}/projects/{id}/cycles/` - List cycles
- `POST /api/v1/workspaces/{slug}/projects/{id}/cycles/{id}/work-items/` - Add to cycle
- `GET /api/v1/workspaces/{slug}/projects/{id}/modules/` - List modules
- `GET /api/v1/workspaces/{slug}/projects/{id}/labels/` - List labels

Rate limit: 60 requests/minute per API key.
