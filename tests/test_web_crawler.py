import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import web_search_service


def _evidence(url: str, text: str, score: float) -> dict:
    return {
        "score": score,
        "text": text,
        "page": {
            "title": f"Fuente {url[-1]}",
            "url": url,
            "domain": "example.com",
            "snippet": text[:40],
        },
    }


class WebCrawlerTests(unittest.TestCase):
    def test_accumulated_context_deduplicates_and_renumbers_sources(self):
        first = _evidence("https://example.com/a", "Dato A", 0.8)
        duplicate = _evidence("https://example.com/a", "Dato A", 0.7)
        second = _evidence("https://example.com/b", "Dato B", 0.9)

        context, sources = web_search_service._build_accumulated_context(
            [first, duplicate, second],
            [first["page"], second["page"]],
        )

        self.assertEqual(context.count("Dato A"), 1)
        self.assertEqual(context.count("Dato B"), 1)
        self.assertIn("[W1]", context)
        self.assertIn("[W2]", context)
        self.assertEqual(len([source for source in sources if source["relevant"]]), 2)

    def test_crawler_refines_query_and_stops_when_evidence_is_sufficient(self):
        first_url = "https://example.com/a"
        second_url = "https://example.com/b"
        cycles = [
            {
                "context_text": "",
                "web_sources": [{**_evidence(first_url, "Dato parcial", 0.7)["page"], "relevant": True}],
                "logs": ["ciclo uno"],
                "_evidence": [_evidence(first_url, "Dato parcial", 0.7)],
                "_effective_query": "pregunta autónoma",
                "_searched_urls": [first_url],
            },
            {
                "context_text": "",
                "web_sources": [{**_evidence(second_url, "Dato definitivo", 0.9)["page"], "relevant": True}],
                "logs": ["ciclo dos"],
                "_evidence": [_evidence(second_url, "Dato definitivo", 0.9)],
                "_effective_query": "pregunta autónoma datos exactos",
                "_searched_urls": [second_url],
            },
        ]
        assessments = [
            {
                "sufficient": False,
                "reason": "Falta el dato exacto.",
                "missing_information": ["dato exacto"],
                "next_queries": ["pregunta autónoma dato exacto"],
            },
            {
                "sufficient": True,
                "reason": "La cifra aparece literalmente.",
                "missing_information": [],
                "next_queries": [],
            },
        ]

        with (
            patch("web_search_service._process_web_search_cycle", side_effect=cycles) as run_cycle,
            patch("web_search_service.evaluate_research_sufficiency", side_effect=assessments) as evaluate,
        ):
            result = web_search_service.process_crawler_search_rag(
                "pregunta",
                max_cycles=4,
                supplemental_context="Evidencia de fuente local",
            )

        self.assertEqual(run_cycle.call_count, 2)
        self.assertEqual(evaluate.call_count, 2)
        self.assertIn("Evidencia de fuente local", evaluate.call_args_list[0].args[1])
        self.assertIn(first_url, run_cycle.call_args_list[1].kwargs["excluded_urls"])
        self.assertIn("dato exacto", run_cycle.call_args_list[1].kwargs["query"])
        self.assertIn("Dato parcial", result["context_text"])
        self.assertIn("Dato definitivo", result["context_text"])
        self.assertTrue(any("finalizado anticipadamente" in log for log in result["logs"]))


if __name__ == "__main__":
    unittest.main()
