import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from web_search_policy import (
    build_search_queries,
    parse_generated_query_payload,
    result_matches_query_intent,
    source_authority_bonus,
)


QUERY = "¿Cuántos goles metieron los jugadores top de la copa del mundo 2026?"


class WebSearchPolicyTests(unittest.TestCase):
    def test_parses_complete_structured_query_payload(self):
        queries, complete = parse_generated_query_payload(
            '{"queries":["goleadores mundial 2026","estadísticas oficiales 2026"]}'
        )

        self.assertTrue(complete)
        self.assertEqual(queries, ["goleadores mundial 2026", "estadísticas oficiales 2026"])

    def test_recovers_complete_queries_from_truncated_json(self):
        raw = (
            '{"queries":["goleadores mundial 2026",'
            '"tabla oficial FIFA 2026","cadena sin terminar'
        )

        queries, complete = parse_generated_query_payload(raw)

        self.assertFalse(complete)
        self.assertEqual(queries, ["goleadores mundial 2026", "tabla oficial FIFA 2026"])

    def test_expansion_preserves_year_and_rejects_predictions_and_history(self):
        generated = [
            "goleadores principales copa del mundo 2026",
            "pronóstico goleadores mundial 2026",
            "récords goles mundiales históricos",
        ]

        queries = build_search_queries(QUERY, generated, 4)

        self.assertEqual(queries[0], QUERY)
        self.assertTrue(any(query.startswith("site:fifa.com") for query in queries))
        self.assertTrue(all("2026" in query for query in queries))
        self.assertFalse(any("pronóstico" in query for query in queries))
        self.assertFalse(any("histórico" in query for query in queries))

    def test_predictive_result_is_rejected_for_observed_score_question(self):
        accepted, reason = result_matches_query_intent(
            QUERY,
            {
                "title": "Pronóstico máximo goleador Mundial 2026",
                "snippet": "Apuestas y goles predichos antes del torneo",
                "url": "https://example.com/world-cup-2026-odds",
            },
        )

        self.assertFalse(accepted)
        self.assertIn("predictiva", reason or "")

    def test_recent_official_result_is_accepted_and_boosted(self):
        accepted, reason = result_matches_query_intent(
            QUERY,
            {
                "title": "Mbappé gana la Bota de Oro Mundial 2026",
                "snippet": "Terminó el torneo con diez goles.",
                "url": "https://www.fifa.com/es/articles/golden-boot-2026",
            },
        )

        self.assertTrue(accepted, reason)
        self.assertGreater(source_authority_bonus(QUERY, "fifa.com"), 0)

    def test_historical_page_without_requested_year_is_rejected(self):
        accepted, reason = result_matches_query_intent(
            QUERY,
            {
                "title": "Máximos goleadores de la historia de los Mundiales",
                "snippet": "Récords de 1958 a 2022.",
                "url": "https://example.com/historia-mundiales",
            },
        )

        self.assertFalse(accepted)
        self.assertIn("año", reason or "")


if __name__ == "__main__":
    unittest.main()
