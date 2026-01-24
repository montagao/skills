import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import scripts.library as library


class TestDownloadBookFilename(unittest.TestCase):
    def test_renames_to_short_md5_prefix_preserving_extension(self):
        md5 = "1065812d567369000ccc1e985e4cadc2"

        with tempfile.TemporaryDirectory() as tmpdir:
            with (
                patch.object(library, "get_api_key", return_value="key"),
                patch.object(
                    library,
                    "fetch_url",
                    return_value='{"download_url":"https://example.com/The%20Porn%20Trap%20--%20Anna%27s%20Archive.pdf"}',
                ),
                patch(
                    "urllib.request.urlretrieve",
                    side_effect=lambda _url, dst: Path(dst).write_bytes(b""),
                ),
            ):
                result = library.download_book(md5, output_dir=tmpdir)

        self.assertIsNotNone(result)
        self.assertTrue(result.endswith(f"{md5[:8]}.pdf"))
        self.assertNotIn("Anna", Path(result).name)

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
