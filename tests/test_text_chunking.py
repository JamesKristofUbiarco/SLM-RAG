import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from text_chunking import chunk_text_by_characters  # noqa: E402


class TextChunkingTests(unittest.TestCase):
    def test_empty_and_short_text(self):
        self.assertEqual(chunk_text_by_characters("", 100, 10), [])
        self.assertEqual(chunk_text_by_characters("texto corto", 100, 10), ["texto corto"])

    def test_chunks_respect_character_limit_and_overlap(self):
        chunks = chunk_text_by_characters(
            "uno dos tres cuatro cinco seis siete ocho nueve diez once doce",
            size=24,
            overlap=8,
        )
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 24 for chunk in chunks))
        self.assertTrue(set(chunks[0].split()) & set(chunks[1].split()))

    def test_long_tokens_are_split(self):
        chunks = chunk_text_by_characters("x" * 25, size=10, overlap=2)
        self.assertEqual("".join(chunks), "x" * 25)
        self.assertTrue(all(len(chunk) <= 10 for chunk in chunks))


if __name__ == "__main__":
    unittest.main()
