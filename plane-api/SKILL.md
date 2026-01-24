---
name: plane-api
description: Connect to a self-hosted Plane.so instance via API. Use this skill when the user wants to interact with Plane for project management tasks including managing workspaces, projects, work items (issues), cycles, modules, states, and labels.
---

# Plane API Integration

This skill enables interaction with a self-hosted Plane.so instance for project management operations.

## Configuration

The user must provide:
- **PLANE_API_URL**: Base URL of their self-hosted instance (e.g., `https://plane.example.com`)
- **PLANE_API_KEY**: Personal access token from Profile Settings > Personal Access Tokens
- **PLANE_WORKSPACE_SLUG**: Your workspace slug (visible in the URL when logged in, e.g., `my-team`)

## Version Requirements

The public API (`/api/v1/`) with API key authentication requires **Plane v0.20+** (late 2024 or newer).

To check if your instance supports the v1 API:
```bash
python plane.py check-version
```

If your instance doesn't have `/api/v1/` endpoints, you need to upgrade Plane to use API key authentication.

## Authentication

All requests require the API key in the header:

```bash
curl -H "X-API-Key: plane_api_<token>" \
     -H "Content-Type: application/json" \
     "$PLANE_API_URL/api/v1/..."
```

## Rate Limits

- 60 requests per minute per API key
- Check `X-RateLimit-Remaining` header to avoid throttling

## Core Endpoints

### Workspaces

```bash
# List workspaces
GET /api/v1/workspaces/

# Get workspace details
GET /api/v1/workspaces/{workspace_slug}/
```

### Projects

```bash
# List projects in workspace
GET /api/v1/workspaces/{workspace_slug}/projects/

# Create project
POST /api/v1/workspaces/{workspace_slug}/projects/
{
  "name": "Project Name",
  "identifier": "PROJ",
  "description": "Project description"
}

# Get project details
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/

# Update project
PATCH /api/v1/workspaces/{workspace_slug}/projects/{project_id}/

# Delete project
DELETE /api/v1/workspaces/{workspace_slug}/projects/{project_id}/
```

### Work Items (Issues)

**Note**: `/issues/` endpoints are deprecated. Use `/work-items/` instead (support for `/issues/` ends March 31, 2026).

```bash
# List work items
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/

# Create work item
POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/
{
  "name": "Issue title",
  "description_html": "<p>Description</p>",
  "priority": "medium",
  "state_id": "<state_uuid>",
  "assignees": ["<user_uuid>"]
}

# Get work item
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/{work_item_id}/

# Update work item
PATCH /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/{work_item_id}/

# Delete work item
DELETE /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/{work_item_id}/

# Search work items across workspace
GET /api/v1/workspaces/{workspace_slug}/work-items/?search=query
```

### States

```bash
# List states in project
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/states/

# Create state
POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/states/
{
  "name": "In Review",
  "color": "#FFA500",
  "group": "started"
}
```

State groups: `backlog`, `unstarted`, `started`, `completed`, `cancelled`

### Labels

```bash
# List labels
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/labels/

# Create label
POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/labels/
{
  "name": "bug",
  "color": "#FF0000"
}
```

### Cycles

```bash
# List cycles
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/cycles/

# Create cycle
POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/cycles/
{
  "name": "Sprint 1",
  "start_date": "2025-01-01",
  "end_date": "2025-01-14"
}

# Add work items to cycle
POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/cycles/{cycle_id}/work-items/
{
  "work_items": ["<work_item_id>"]
}

# Archive cycle
POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/cycles/{cycle_id}/archive/
```

### Modules

```bash
# List modules
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/modules/

# Create module
POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/modules/
{
  "name": "Authentication",
  "description": "User auth features"
}

# Add work items to module
POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/modules/{module_id}/work-items/
{
  "work_items": ["<work_item_id>"]
}
```

## Pagination

Responses use cursor-based pagination:

```bash
GET /api/v1/.../work-items/?per_page=50&cursor=<cursor_value>
```

Response includes:
- `next_cursor`: Next page cursor (null if last page)
- `prev_cursor`: Previous page cursor
- `total_results`: Total count
- `results`: Array of items

## Query Parameters

- `fields`: Comma-separated list of fields to return
- `expand`: Include related resource details
- `search`: Search query string
- `per_page`: Results per page (max 100)

## Priority Values

- `urgent`
- `high`
- `medium`
- `low`
- `none`

## Common Workflows

### Create a complete work item

1. Get project states: `GET /projects/{id}/states/`
2. Get project labels: `GET /projects/{id}/labels/`
3. Create work item with state_id and label_ids

### Move work item to cycle

1. List cycles: `GET /projects/{id}/cycles/`
2. Add work item: `POST /cycles/{id}/work-items/`

### Bulk operations

Use arrays in request body where supported (e.g., adding multiple work items to a cycle).
