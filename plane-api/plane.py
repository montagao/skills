#!/usr/bin/env python3
"""
Plane.so API Client

Usage:
    export PLANE_API_URL="https://plane.example.com"
    export PLANE_API_KEY="plane_api_..."

    python plane.py check-version
    python plane.py workspaces
    python plane.py projects <workspace_slug>
    python plane.py work-items <workspace_slug> <project_id>
    python plane.py create-work-item <workspace_slug> <project_id> <title> [--priority medium] [--state-id <id>]
    python plane.py states <workspace_slug> <project_id>
    python plane.py cycles <workspace_slug> <project_id>
    python plane.py modules <workspace_slug> <project_id>
"""

import argparse
import json
import os
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def get_config():
    """Get API configuration from environment variables."""
    url = os.environ.get("PLANE_API_URL")
    key = os.environ.get("PLANE_API_KEY")
    workspace = os.environ.get("PLANE_WORKSPACE_SLUG")

    if not url:
        print("Error: PLANE_API_URL environment variable not set", file=sys.stderr)
        sys.exit(1)
    if not key:
        print("Error: PLANE_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    return url.rstrip("/"), key, workspace


def get_workspace(args_workspace: str | None = None) -> str:
    """Get workspace slug from args or environment."""
    _, _, env_workspace = get_config()
    workspace = args_workspace or env_workspace
    if not workspace:
        print("Error: Workspace slug required. Set PLANE_WORKSPACE_SLUG or pass --workspace", file=sys.stderr)
        sys.exit(1)
    return workspace


def api_request(method: str, endpoint: str, data: dict | None = None) -> dict:
    """Make an API request to Plane."""
    base_url, api_key, _ = get_config()
    url = f"{base_url}{endpoint}"

    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }

    body = json.dumps(data).encode() if data else None
    req = Request(url, data=body, headers=headers, method=method)

    try:
        with urlopen(req) as response:
            if response.status == 204:
                return {}
            return json.loads(response.read().decode())
    except HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        print(f"Error {e.code}: {e.reason}", file=sys.stderr)
        if error_body:
            print(error_body, file=sys.stderr)
        sys.exit(1)


def check_version() -> dict:
    """Check if the Plane instance supports the v1 API."""
    base_url, api_key, _ = get_config()

    result = {
        "base_url": base_url,
        "v1_api_available": False,
        "api_key_auth_working": False,
        "message": "",
    }

    # Test v1 endpoint exists
    try:
        req = Request(
            f"{base_url}/api/v1/workspaces/",
            headers={"X-API-Key": api_key, "Content-Type": "application/json"},
            method="GET",
        )
        with urlopen(req) as response:
            result["v1_api_available"] = True
            result["api_key_auth_working"] = True
            result["message"] = "v1 API is available and API key auth works"
            return result
    except HTTPError as e:
        if e.code == 401:
            result["v1_api_available"] = True
            result["message"] = "v1 API exists but API key auth failed - check your key"
        elif e.code == 404:
            result["message"] = (
                "v1 API not found - your Plane instance needs to be upgraded "
                "to v0.20+ to use API key authentication"
            )
        else:
            result["message"] = f"Unexpected error: {e.code} {e.reason}"
        return result
    except Exception as e:
        result["message"] = f"Connection error: {e}"
        return result


def list_projects(workspace_slug: str):
    """List all projects in a workspace."""
    result = api_request("GET", f"/api/v1/workspaces/{workspace_slug}/projects/")
    return result.get("results", result)


def list_work_items(workspace_slug: str, project_id: str):
    """List all work items in a project."""
    result = api_request(
        "GET",
        f"/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/"
    )
    return result.get("results", result)


def create_work_item(
    workspace_slug: str,
    project_id: str,
    name: str,
    priority: str = "none",
    state_id: str | None = None,
    description: str | None = None,
):
    """Create a new work item."""
    data = {
        "name": name,
        "priority": priority,
    }
    if state_id:
        data["state_id"] = state_id
    if description:
        data["description_html"] = f"<p>{description}</p>"

    return api_request(
        "POST",
        f"/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/",
        data
    )


def list_states(workspace_slug: str, project_id: str):
    """List all states in a project."""
    result = api_request(
        "GET",
        f"/api/v1/workspaces/{workspace_slug}/projects/{project_id}/states/"
    )
    return result.get("results", result)


def list_cycles(workspace_slug: str, project_id: str):
    """List all cycles in a project."""
    result = api_request(
        "GET",
        f"/api/v1/workspaces/{workspace_slug}/projects/{project_id}/cycles/"
    )
    return result.get("results", result)


def list_modules(workspace_slug: str, project_id: str):
    """List all modules in a project."""
    result = api_request(
        "GET",
        f"/api/v1/workspaces/{workspace_slug}/projects/{project_id}/modules/"
    )
    return result.get("results", result)


def main():
    parser = argparse.ArgumentParser(description="Plane.so API Client")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Check version
    subparsers.add_parser("check-version", help="Check if v1 API is available")

    # Projects
    projects_parser = subparsers.add_parser("projects", help="List projects")
    projects_parser.add_argument("--workspace", "-w", help="Workspace slug (or set PLANE_WORKSPACE_SLUG)")

    # Work items
    items_parser = subparsers.add_parser("work-items", help="List work items")
    items_parser.add_argument("project_id", help="Project ID or identifier")
    items_parser.add_argument("--workspace", "-w", help="Workspace slug (or set PLANE_WORKSPACE_SLUG)")

    # Create work item
    create_parser = subparsers.add_parser("create-work-item", help="Create work item")
    create_parser.add_argument("project_id", help="Project ID or identifier")
    create_parser.add_argument("title", help="Work item title")
    create_parser.add_argument("--workspace", "-w", help="Workspace slug (or set PLANE_WORKSPACE_SLUG)")
    create_parser.add_argument("--priority", default="none",
                               choices=["urgent", "high", "medium", "low", "none"])
    create_parser.add_argument("--state-id", help="State UUID")
    create_parser.add_argument("--description", help="Description text")

    # States
    states_parser = subparsers.add_parser("states", help="List states")
    states_parser.add_argument("project_id", help="Project ID or identifier")
    states_parser.add_argument("--workspace", "-w", help="Workspace slug (or set PLANE_WORKSPACE_SLUG)")

    # Cycles
    cycles_parser = subparsers.add_parser("cycles", help="List cycles")
    cycles_parser.add_argument("project_id", help="Project ID or identifier")
    cycles_parser.add_argument("--workspace", "-w", help="Workspace slug (or set PLANE_WORKSPACE_SLUG)")

    # Modules
    modules_parser = subparsers.add_parser("modules", help="List modules")
    modules_parser.add_argument("project_id", help="Project ID or identifier")
    modules_parser.add_argument("--workspace", "-w", help="Workspace slug (or set PLANE_WORKSPACE_SLUG)")

    args = parser.parse_args()

    if args.command == "check-version":
        result = check_version()
    elif args.command == "projects":
        workspace = get_workspace(getattr(args, "workspace", None))
        result = list_projects(workspace)
    elif args.command == "work-items":
        workspace = get_workspace(getattr(args, "workspace", None))
        result = list_work_items(workspace, args.project_id)
    elif args.command == "create-work-item":
        workspace = get_workspace(getattr(args, "workspace", None))
        result = create_work_item(
            workspace,
            args.project_id,
            args.title,
            args.priority,
            getattr(args, "state_id", None),
            getattr(args, "description", None),
        )
    elif args.command == "states":
        workspace = get_workspace(getattr(args, "workspace", None))
        result = list_states(workspace, args.project_id)
    elif args.command == "cycles":
        workspace = get_workspace(getattr(args, "workspace", None))
        result = list_cycles(workspace, args.project_id)
    elif args.command == "modules":
        workspace = get_workspace(getattr(args, "workspace", None))
        result = list_modules(workspace, args.project_id)
    else:
        parser.print_help()
        sys.exit(1)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
