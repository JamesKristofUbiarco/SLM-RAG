import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from studio_artifacts import parse_studio_items, studio_output_schema


class StudioArtifactTests(unittest.TestCase):
    def test_repairs_unescaped_latex_in_flashcards(self):
        raw = r'''[
          {"id": 1, "front": "¿Por qué $1/\sqrt{d_k}$?", "back": "Evita gradientes pequeños."},
          {"id": 2, "front": "¿Qué hace \frac{a}{b}?", "back": "Representa una fracción."}
        ]'''

        cards = parse_studio_items(raw, "flashcards")

        self.assertEqual(len(cards), 2)
        self.assertIn(r"\sqrt", cards[0]["front"])
        self.assertIn(r"\frac", cards[1]["front"])

    def test_accepts_structured_output_wrapper_and_normalizes_ids(self):
        raw = '{"data":[{"id":99,"front":"Anverso","back":"Reverso"}]}'

        cards = parse_studio_items(raw, "flashcards")

        self.assertEqual(cards, [{"id": 1, "front": "Anverso", "back": "Reverso"}])

    def test_schema_requires_the_requested_card_count(self):
        schema = studio_output_schema("flashcards", 10)

        data_schema = schema["properties"]["data"]
        self.assertEqual(data_schema["minItems"], 10)
        self.assertEqual(data_schema["maxItems"], 10)

    def test_recovers_complete_quiz_questions_from_truncated_json(self):
        raw = '''{"data":[
          {"id":1,"question":"Pregunta uno","options":["A","B"],"correct_index":0,"explanation":"Porque A."},
          {"id":2,"question":"Pregunta dos","options":["C","D"],"correct_index":1,"explanation":"Porque D."},
          {"id":3,"question":"Pregunta truncada","options":["E"'''

        questions = parse_studio_items(raw, "quiz")

        self.assertEqual(len(questions), 2)
        self.assertEqual(questions[0]["question"], "Pregunta uno")
        self.assertEqual(questions[1]["correct_index"], 1)


if __name__ == "__main__":
    unittest.main()
