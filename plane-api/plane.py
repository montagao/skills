#!/usr/bin/env python3
"""
Plane.so API Client

Usage:
    export PLANE_BASE_URL="https://plane.example.com"
    # or: export PLANE_API_URL="https://plane.example.com"
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
import re
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError


UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-"
    r"[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{12}$"
)


def get_base_url() -> str:
    """Get the Plane instance base URL from environment variables."""
    return (os.environ.get("PLANE_BASE_URL") or os.environ.get("PLANE_API_URL") or "").rstrip("/")


def get_config():
    """Get API configuration from environment variables."""
    url = get_base_url()
    key = os.environ.get("PLANE_API_KEY")
    workspace = os.environ.get("PLANE_WORKSPACE_SLUG")

    if not url:
        print("Error: PLANE_BASE_URL or PLANE_API_URL environment variable not set", file=sys.stderr)
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


def looks_like_uuid(value: object) -> bool:
    """Return True when the value looks like a UUID string."""
    return isinstance(value, str) and bool(UUID_PATTERN.match(value))


def extract_project_identifier(work_item: dict, project_ref: str | None = None) -> str | None:
    """Extract the human-facing project identifier when available."""
    candidates = [
        project_ref,
        work_item.get("project_identifier"),
        work_item.get("project__identifier"),
    ]

    project_detail = work_item.get("project_detail")
    if isinstance(project_detail, dict):
        candidates.append(project_detail.get("identifier"))

    project_data = work_item.get("project")
    if isinstance(project_data, dict):
        candidates.append(project_data.get("identifier"))

    for candidate in candidates:
        if isinstance(candidate, str) and candidate and not looks_like_uuid(candidate):
            return candidate

    return None


def extract_sequence_id(work_item: dict) -> str | None:
    """Extract the issue sequence identifier as a string."""
    sequence_id = work_item.get("sequence_id")
    if sequence_id in (None, ""):
        return None
    return str(sequence_id)


def build_issue_key(project_identifier: str | None, sequence_id: str | None) -> str | None:
    """Build the human-facing issue key used in canonical Plane URLs."""
    if not project_identifier or not sequence_id:
        return None
    return f"{project_identifier}-{sequence_id}"


def build_issue_url(base_url: str, workspace_slug: str, issue_key: str | None) -> str | None:
    """Build the canonical browse URL for a Plane work item."""
    if not base_url or not workspace_slug or not issue_key:
        return None
    return f"{base_url.rstrip('/')}/{workspace_slug}/browse/{issue_key}"


def enrich_work_item_link(
    work_item: dict,
    workspace_slug: str,
    project_ref: str | None = None,
    base_url: str | None = None,
) -> dict:
    """
    Add canonical Plane link metadata when enough information is available.

    Never guesses legacy `/projects/<...>/issues/<...>` URLs. If the human-facing
    issue key cannot be resolved, the item is returned without a synthesized link.
    """
    enriched = dict(work_item)
    project_identifier = extract_project_identifier(enriched, project_ref)
    sequence_id = extract_sequence_id(enriched)
    issue_key = build_issue_key(project_identifier, sequence_id)

    if issue_key:
        enriched["issue_key"] = issue_key
        canonical_url = build_issue_url(base_url or get_base_url(), workspace_slug, issue_key)
        if canonical_url:
            enriched["url"] = canonical_url

    return enriched


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
    base_url, api_key, workspace = get_config()

    result = {
        "base_url": base_url,
        "v1_api_available": False,
        "api_key_auth_working": False,
        "message": "",
    }

    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    probe_endpoints = []
    if workspace:
        probe_endpoints.append(f"/api/v1/workspaces/{workspace}/projects/")
    probe_endpoints.append("/api/v1/workspaces/")

    probe_errors: list[tuple[str, int | None, str]] = []

    for endpoint in probe_endpoints:
        try:
            req = Request(
                f"{base_url}{endpoint}",
                headers=headers,
                method="GET",
            )
            with urlopen(req):
                result["v1_api_available"] = True
                result["api_key_auth_working"] = True
                result["message"] = f"v1 API is available and API key auth works (probe: {endpoint})"
                return result
        except HTTPError as e:
            probe_errors.append((endpoint, e.code, e.reason))
            if e.code == 401:
                result["v1_api_available"] = True
                result["message"] = f"v1 API exists at {endpoint} but API key auth failed - check your key"
                return result
        except Exception as e:
            probe_errors.append((endpoint, None, str(e)))

    http_errors = [(ep, code, reason) for ep, code, reason in probe_errors if code is not None]
    if http_errors and all(code == 404 for _, code, _ in http_errors):
        result["message"] = (
            "v1 API not found on probed endpoints. Ensure PLANE_BASE_URL or PLANE_API_URL points to your "
            "server root and Plane is v0.20+ for API key authentication."
        )
        return result

    if probe_errors:
        endpoint, code, reason = probe_errors[-1]
        if code is None:
            result["message"] = f"Connection error while probing {endpoint}: {reason}"
        else:
            result["message"] = f"Unexpected error while probing {endpoint}: {code} {reason}"
        return result

    result["message"] = "Unable to verify API availability"
    return result


def list_projects(workspace_slug: str):
    """List all projects in a workspace."""
    result = api_request("GET", f"/api/v1/workspaces/{workspace_slug}/projects/")
    return result.get("results", result)


def list_work_items(workspace_slug: str, project_id: str):
    """List all work items in a project."""
    base_url = get_base_url()
    result = api_request(
        "GET",
        f"/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/"
    )
    items = result.get("results", result)
    if isinstance(items, list):
        return [enrich_work_item_link(item, workspace_slug, project_id, base_url) for item in items]
    return items


def create_work_item(
    workspace_slug: str,
    project_id: str,
    name: str,
    priority: str = "none",
    state_id: str | None = None,
    description: str | None = None,
):
    """Create a new work item."""
    base_url = get_base_url()
    data = {
        "name": name,
        "priority": priority,
    }
    if state_id:
        data["state_id"] = state_id
    if description:
        data["description_html"] = f"<p>{description}</p>"

    created = api_request(
        "POST",
        f"/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/",
        data
    )
    return enrich_work_item_link(created, workspace_slug, project_id, base_url)


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
