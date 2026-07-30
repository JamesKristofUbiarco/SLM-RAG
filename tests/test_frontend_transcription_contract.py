import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FrontendTranscriptionContractTests(unittest.TestCase):
    def test_single_and_batch_requests_send_the_backend_model_field(self):
        source = (ROOT / "frontend" / "src" / "components" / "TranscribeTab.tsx").read_text(encoding="utf-8")

        self.assertEqual(source.count("formData.append('model_name', model)"), 2)
        self.assertNotIn("formData.append('model', model)", source)

    def test_single_and_batch_requests_normalize_the_language(self):
        source = (ROOT / "frontend" / "src" / "components" / "TranscribeTab.tsx").read_text(encoding="utf-8")

        normalized_append = "formData.append('language', language.trim().toLowerCase())"
        self.assertEqual(source.count(normalized_append), 2)


if __name__ == "__main__":
    unittest.main()
