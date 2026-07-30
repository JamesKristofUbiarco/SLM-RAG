import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from citation_utils import normalize_citation_groups


class CitationUtilsTests(unittest.TestCase):
    def test_normalizes_grouped_citations(self):
        text = "Mbappé marcó diez [2, 3, 5] y Messi ocho [2; 5]."

        self.assertEqual(
            normalize_citation_groups(text),
            "Mbappé marcó diez [2][3][5] y Messi ocho [2][5].",
        )

    def test_removes_duplicate_numbers_and_preserves_single_citations(self):
        self.assertEqual(normalize_citation_groups("Dato [4, 4, 2] y otro [1]."), "Dato [4][2] y otro [1].")

    def test_does_not_rewrite_markdown_link_labels(self):
        text = "Consulta [2, 3](https://example.com) para detalles."

        self.assertEqual(normalize_citation_groups(text), text)

    def test_normalizes_explicit_local_and_web_labels(self):
        text = "Dato interno [Local 2] y dato externo [Web 1]."

        self.assertEqual(normalize_citation_groups(text), "Dato interno [L2] y dato externo [W1].")

    def test_inherits_namespace_in_group_and_applies_unambiguous_default(self):
        self.assertEqual(normalize_citation_groups("Dato [W2, 3, 5]."), "Dato [W2][W3][W5].")
        self.assertEqual(normalize_citation_groups("Dato [1].", default_namespace="L"), "Dato [L1].")


if __name__ == "__main__":
    unittest.main()
