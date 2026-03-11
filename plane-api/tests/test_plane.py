import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "plane.py"
SPEC = importlib.util.spec_from_file_location("plane_api_plane", MODULE_PATH)
plane = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(plane)


class TestGetBaseUrl(unittest.TestCase):
    def test_prefers_plane_base_url(self):
        with patch.dict(
            os.environ,
            {"PLANE_BASE_URL": "https://todo.translate.mom/", "PLANE_API_URL": "https://ignored.example/"},
            clear=False,
        ):
            self.assertEqual(plane.get_base_url(), "https://todo.translate.mom")

    def test_falls_back_to_plane_api_url(self):
        with patch.dict(os.environ, {"PLANE_BASE_URL": "", "PLANE_API_URL": "https://plane.example/"}, clear=False):
            self.assertEqual(plane.get_base_url(), "https://plane.example")


class TestLinkHelpers(unittest.TestCase):
    def test_builds_canonical_browse_url_from_project_identifier(self):
        work_item = {"id": "uuid", "sequence_id": 461}

        enriched = plane.enrich_work_item_link(
            work_item,
            workspace_slug="translatemom",
            project_ref="TMOM",
            base_url="https://todo.translate.mom",
        )

        self.assertEqual(enriched["issue_key"], "TMOM-461")
        self.assertEqual(enriched["url"], "https://todo.translate.mom/translatemom/browse/TMOM-461")

    def test_uses_project_identifier_from_payload_when_project_ref_is_uuid(self):
        work_item = {
            "id": "uuid",
            "sequence_id": 17,
            "project__identifier": "OPS",
        }

        enriched = plane.enrich_work_item_link(
            work_item,
            workspace_slug="workspace",
            project_ref="e0cf18a0-0d78-4d12-924d-3a90aacdf7cb",
            base_url="https://plane.example",
        )

        self.assertEqual(enriched["issue_key"], "OPS-17")
        self.assertEqual(enriched["url"], "https://plane.example/workspace/browse/OPS-17")

    def test_does_not_guess_legacy_issue_url_when_identifier_missing(self):
        work_item = {"id": "uuid", "sequence_id": 17}

        enriched = plane.enrich_work_item_link(
            work_item,
            workspace_slug="workspace",
            project_ref="e0cf18a0-0d78-4d12-924d-3a90aacdf7cb",
            base_url="https://plane.example",
        )

        self.assertNotIn("issue_key", enriched)
        self.assertNotIn("url", enriched)


class TestApiIntegration(unittest.TestCase):
    def test_create_work_item_enriches_response_with_canonical_url(self):
        response = {"id": "uuid", "sequence_id": 99}

        with (
            patch.object(plane, "get_base_url", return_value="https://todo.translate.mom"),
            patch.object(plane, "api_request", return_value=response),
        ):
            result = plane.create_work_item("translatemom", "TMOM", "Fix pricing copy")

        self.assertEqual(result["issue_key"], "TMOM-99")
        self.assertEqual(result["url"], "https://todo.translate.mom/translatemom/browse/TMOM-99")

    def test_list_work_items_enriches_each_item(self):
        response = {"results": [{"id": "a", "sequence_id": 1}, {"id": "b", "sequence_id": 2}]}

        with (
            patch.object(plane, "get_base_url", return_value="https://plane.example"),
            patch.object(plane, "api_request", return_value=response),
        ):
            result = plane.list_work_items("workspace", "APP")

        self.assertEqual(
            result,
            [
                {
                    "id": "a",
                    "sequence_id": 1,
                    "issue_key": "APP-1",
                    "url": "https://plane.example/workspace/browse/APP-1",
                },
                {
                    "id": "b",
                    "sequence_id": 2,
                    "issue_key": "APP-2",
                    "url": "https://plane.example/workspace/browse/APP-2",
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
