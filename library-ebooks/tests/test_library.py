import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import scripts.library as library


class TestGetBaseUrl(unittest.TestCase):
    def test_prefers_library_base_url_env_var(self):
        with patch.dict(os.environ, {"LIBRARY_BASE_URL": "https://configured.example/"}):
            self.assertEqual(library.get_base_url(), "https://configured.example")

    def test_defaults_to_example_url_when_env_missing(self):
        with patch.dict(os.environ, {"LIBRARY_BASE_URL": ""}):
            self.assertEqual(library.get_base_url(), library.DEFAULT_BASE_URL)


class TestGetApiKey(unittest.TestCase):
    def test_returns_key_when_present(self):
        with patch.dict(os.environ, {"LIBRARY_KEY": "test-key"}):
            self.assertEqual(library.get_api_key(), "test-key")

    def test_returns_none_and_prints_message_when_missing(self):
        stderr = io.StringIO()
        with patch.dict(os.environ, {"LIBRARY_KEY": ""}), patch("sys.stderr", stderr):
            self.assertIsNone(library.get_api_key())

        output = stderr.getvalue()
        self.assertIn("LIBRARY_KEY not set", output)
        self.assertIn('export LIBRARY_KEY="your-key-here"', output)


class TestGetBookDetails(unittest.TestCase):
    def test_falls_back_to_page_title_when_data_content_missing(self):
        html = "<html><head><title>Example Book - Library</title></head><body></body></html>"

        with patch.object(library, "fetch_url", return_value=html):
            details = library.get_book_details("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

        self.assertEqual(details["title"], "Example Book")
        self.assertEqual(details["download_options"]["fast"], [])
        self.assertEqual(details["download_options"]["slow"], [])


class TestDownloadBookFilename(unittest.TestCase):
    def test_renames_to_short_md5_prefix_preserving_extension(self):
        md5 = "1065812d567369000ccc1e985e4cadc2"

        with tempfile.TemporaryDirectory() as tmpdir:
            with (
                patch.object(library, "get_api_key", return_value="key"),
                patch.object(
                    library,
                    "fetch_url",
                    return_value='{"download_url":"https://example.com/The%20Porn%20Trap%20--%20Some%20Provider.pdf"}',
                ),
                patch(
                    "urllib.request.urlretrieve",
                    side_effect=lambda _url, dst: Path(dst).write_bytes(b""),
                ),
            ):
                result = library.download_book(md5, output_dir=tmpdir)

        self.assertIsNotNone(result)
        self.assertTrue(result.endswith(f"{md5[:8]}.pdf"))
        self.assertNotIn("Provider", Path(result).name)

    def test_defaults_to_pdf_extension_when_missing(self):
        md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

        with tempfile.TemporaryDirectory() as tmpdir:
            with (
                patch.object(library, "get_api_key", return_value="key"),
                patch.object(
                    library,
                    "fetch_url",
                    return_value='{"download_url":"https://example.com/filename_without_ext"}',
                ),
                patch(
                    "urllib.request.urlretrieve",
                    side_effect=lambda _url, dst: Path(dst).write_bytes(b""),
                ),
            ):
                result = library.download_book(md5, output_dir=tmpdir)

        self.assertIsNotNone(result)
        self.assertTrue(result.endswith(f"{md5[:8]}.pdf"))
