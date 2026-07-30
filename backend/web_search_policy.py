import json
import re
import unicodedata
from typing import Dict, Iterable, List, Optional, Tuple


PREDICTION_TERMS = {
    "apuesta", "apuestas", "betting", "cuota", "cuotas", "favorito", "favoritos",
    "forecast", "odds", "prediccion", "predicciones", "pronostico", "pronosticos",
    "probabilidad", "probabilidades", "cuando arranque", "antes del torneo",
}
HISTORICAL_TERMS = {
    "all time", "historia", "historico", "historicos", "record", "records",
    "todos los mundiales", "marcas mundiales",
}
OBSERVED_FACT_TERMS = {
    "anotaron", "cuantos", "estadistica", "estadisticas", "goleadores", "goals scored",
    "ganador", "ganadores", "marcaron", "metieron", "resultado", "resultados",
    "score", "scores", "standings", "tabla", "top scorers",
}


def normalize_search_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_accents).strip()


def extract_query_years(query: str) -> List[str]:
    return list(dict.fromkeys(re.findall(r"\b(?:19|20)\d{2}\b", query)))


def _contains_any(text: str, terms: Iterable[str]) -> bool:
    return any(term in text for term in terms)


def asks_for_observed_facts(query: str) -> bool:
    normalized = normalize_search_text(query)
    return _contains_any(normalized, OBSERVED_FACT_TERMS) and not _contains_any(normalized, PREDICTION_TERMS)


def preferred_site_query(query: str) -> Optional[str]:
    normalized = normalize_search_text(query)
    football_world_cup = (
        ("copa del mundo" in normalized or "mundial" in normalized or "world cup" in normalized)
        and _contains_any(normalized, {"fifa", "gol", "goleador", "scorer"})
    )
    return f"site:fifa.com {query.strip()}" if football_world_cup else None


def parse_generated_query_payload(raw_response: str) -> Tuple[List[str], bool]:
    """Parse structured query expansion and salvage complete strings if JSON was truncated."""
    text = raw_response.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        text = text[first_newline + 1:] if first_newline >= 0 else ""
    if text.rstrip().endswith("```"):
        text = text.rstrip()[:-3]
    text = text.strip()

    try:
        parsed = json.loads(text)
        generated = parsed.get("queries", []) if isinstance(parsed, dict) else parsed
        if isinstance(generated, list):
            queries = [item.strip() for item in generated if isinstance(item, str) and item.strip()]
            return queries, True
    except json.JSONDecodeError:
        pass

    queries_key = text.find('"queries"')
    array_start = text.find("[", queries_key if queries_key >= 0 else 0)
    if array_start < 0:
        return [], False

    recovered = []
    for token in re.findall(r'"(?:\\.|[^"\\])*"', text[array_start + 1:]):
        try:
            value = json.loads(token)
        except json.JSONDecodeError:
            continue
        if isinstance(value, str) and value.strip():
            recovered.append(value.strip())
    return recovered, False


def build_search_queries(original_query: str, generated_queries: Iterable[str], limit: int) -> List[str]:
    """Keep expansions aligned with the original event, year, and observed/predictive intent."""
    original = original_query.strip()[:240]
    normalized_original = normalize_search_text(original)
    years = extract_query_years(original)
    observed_facts = asks_for_observed_facts(original)
    historical_request = _contains_any(normalized_original, HISTORICAL_TERMS)

    candidates: List[str] = [original]
    official_query = preferred_site_query(original)
    if official_query:
        candidates.append(official_query)
    candidates.extend(query.strip()[:240] for query in generated_queries if isinstance(query, str) and query.strip())

    if observed_facts:
        candidates.extend((f"{original} resultados oficiales", f"{original} estadísticas finales"))

    accepted: List[str] = []
    seen = set()
    for candidate in candidates:
        normalized = normalize_search_text(candidate)
        if not normalized or normalized in seen:
            continue
        if years and not all(year in candidate for year in years):
            continue
        if observed_facts and _contains_any(normalized, PREDICTION_TERMS):
            continue
        if not historical_request and _contains_any(normalized, HISTORICAL_TERMS):
            continue
        seen.add(normalized)
        accepted.append(candidate)
        if len(accepted) >= limit:
            break

    return accepted or [original]


def result_matches_query_intent(query: str, result: Dict[str, str]) -> Tuple[bool, Optional[str]]:
    combined = normalize_search_text(
        " ".join((result.get("title", ""), result.get("snippet", ""), result.get("url", "")))
    )
    title_and_url = normalize_search_text(" ".join((result.get("title", ""), result.get("url", ""))))
    normalized_query = normalize_search_text(query)
    years = extract_query_years(query)

    if years and not all(year in combined for year in years):
        return False, "no menciona el año solicitado"

    if asks_for_observed_facts(query) and _contains_any(combined, PREDICTION_TERMS):
        return False, "es una fuente predictiva para una pregunta de resultados"

    if not _contains_any(normalized_query, HISTORICAL_TERMS) and _contains_any(title_and_url, HISTORICAL_TERMS):
        return False, "trata estadísticas históricas, no el evento solicitado"

    return True, None


def source_authority_bonus(query: str, domain: str) -> float:
    official_query = preferred_site_query(query)
    if official_query and (domain == "fifa.com" or domain.endswith(".fifa.com")):
        return 0.08
    return 0.0
