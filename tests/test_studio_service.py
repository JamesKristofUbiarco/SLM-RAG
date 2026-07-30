import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from studio_service import StudioService


class StudioServiceTests(unittest.TestCase):
    def test_completes_a_truncated_quiz_without_returning_raw_json(self):
        first_response = '''{"data":[
          {"id":1,"question":"Pregunta uno","options":["A","B"],"correct_index":0,"explanation":"A."},
          {"id":2,"question":"Pregunta dos","options":["C","D"],"correct_index":1,"explanation":"D."},
          {"id":3,"question":"Pregunta truncada","options":["E"'''
        retry_response = '''{"data":[
          {"id":1,"question":"Pregunta tres","options":["E","F"],"correct_index":0,"explanation":"E."}
        ]}'''
        service = StudioService()

        with (
            patch.object(service, "_get_combined_source_text", return_value="Contenido fuente"),
            patch(
                "studio_service.rag_service.call_ollama_generate",
                side_effect=[first_response, retry_response],
            ) as generate,
        ):
            result = service.generate_artifact(
                "quiz",
                [1],
                {"count": 3, "difficulty": "Avanzado"},
            )

        self.assertEqual(result["type"], "quiz")
        self.assertEqual(len(result["data"]), 3)
        self.assertNotIn("warning", result)
        self.assertEqual([item["id"] for item in result["data"]], [1, 2, 3])
        self.assertEqual(generate.call_count, 2)
        self.assertEqual(generate.call_args_list[0].kwargs["num_predict"], 2100)
        self.assertEqual(generate.call_args_list[1].kwargs["num_predict"], 2048)


if __name__ == "__main__":
    unittest.main()
