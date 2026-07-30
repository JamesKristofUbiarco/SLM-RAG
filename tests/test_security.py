import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from config import settings  # noqa: E402
from security import copy_upload_limited, safe_filename, validate_public_http_url  # noqa: E402


class SecurityTests(unittest.TestCase):
    def test_filename_discards_paths_and_control_characters(self):
        self.assertEqual(safe_filename("../../.env"), "env")
        self.assertEqual(safe_filename("folder/meeting?.mp3"), "meeting_.mp3")

    @patch("security.socket.getaddrinfo")
    def test_private_network_url_is_rejected(self, getaddrinfo):
        getaddrinfo.return_value = [(2, 1, 6, "", ("127.0.0.1", 80))]
        with self.assertRaises(ValueError):
            validate_public_http_url("http://example.test/resource")

    @patch("security.socket.getaddrinfo")
    def test_public_url_is_accepted(self, getaddrinfo):
        getaddrinfo.return_value = [(2, 1, 6, "", ("93.184.216.34", 443))]
        self.assertEqual(
            validate_public_http_url("https://example.test/resource"),
            "https://example.test/resource",
        )

    def test_upload_limit_removes_partial_file(self):
        upload = UploadFile(filename="large.bin", file=io.BytesIO(b"x" * 2048))
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "upload.bin"
            with patch.object(settings, "max_upload_size_mb", 0):
                # The helper enforces at least one MB; use a zero-byte setting to
                # verify configuration normalization without creating huge data.
                copy_upload_limited(upload, destination)
            self.assertEqual(destination.stat().st_size, 2048)

        upload = UploadFile(filename="too-large.bin", file=io.BytesIO(b"x" * (1024 * 1024 + 1)))
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "upload.bin"
            with patch.object(settings, "max_upload_size_mb", 1):
                with self.assertRaises(HTTPException) as raised:
                    copy_upload_limited(upload, destination)
            self.assertEqual(raised.exception.status_code, 413)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
