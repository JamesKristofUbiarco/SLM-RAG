import numpy as np
import urllib.parse
import logging
import datetime
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from ddgs import DDGS
import web_ingester
from rag_service import rag_service
from web_search_policy import (
    build_search_queries,
    parse_generated_query_payload,
    result_matches_query_intent,
    source_authority_bonus,
)

logger = logging.getLogger("web_search_service")

# Third-party request/conversion internals are extremely verbose at INFO. Our own
# high-level logs retain the searched queries, accepted pages, and extraction failures.
logging.getLogger("primp").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("docling").setLevel(logging.WARNING)
logging.getLogger("docling.backend.html_backend").setLevel(logging.ERROR)


def generate_search_queries(user_query: str, num_queries: int = 3) -> List[str]:
    """
    Uses the local LLM to expand a user's query into N short, focused
    web search queries covering different angles of the same topic.
    Falls back to deterministic intent-preserving queries on any failure.
    """
    prompt = f"""Eres un asistente especializado en búsqueda web. Tu tarea es transformar la siguiente consulta de usuario en variaciones cortas y precisas, optimizadas para un motor de búsqueda web.

Fecha actual del sistema: {datetime.date.today().isoformat()}

REGLAS ESTRICTAS:
- Conserva exactamente las entidades, el evento, el país y todos los años de la consulta original.
- Conserva la intención temporal: resultados ocurridos no deben convertirse en pronósticos, apuestas ni historia general.
- Una variación debe buscar resultados oficiales o estadísticas primarias cuando existan.
- Cada variación debe tener entre 3 y 12 palabras.
- Usa términos de búsqueda directos, sin frases completas ni puntos al final.
- Responde ÚNICAMENTE con un objeto JSON de la forma {{"queries": ["consulta 1", "consulta 2"]}}.

Consulta del usuario:
{user_query[:800]}

Responde con JSON estricto:"""

    try:
        query_schema = {
            "type": "object",
            "properties": {
                "queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "maxItems": num_queries,
                }
            },
            "required": ["queries"],
            "additionalProperties": False,
        }
        raw = rag_service.call_ollama_generate(prompt, temperature=0.2, response_format=query_schema)
        generated, complete_json = parse_generated_query_payload(raw)
        queries = build_search_queries(user_query, generated, num_queries)
        if complete_json:
            logger.info(f"Multi-Query expansion generated {len(queries)} intent-preserving queries: {queries}")
        else:
            logger.info(
                "Multi-Query response was incomplete; using %s recovered/deterministic queries: %s",
                len(queries),
                queries,
            )
        return queries
    except Exception as e:
        logger.warning("Multi-Query request failed; using deterministic intent-preserving queries. Error: %s", e)

    return build_search_queries(user_query, [], num_queries)


def rewrite_query_standalone(user_query: str, conversation_context: str) -> str:
    """
    Rewrites the user's current message as a standalone, self-contained search query
    by incorporating context from the recent conversation history.
    Handles follow-up messages like "dame más", "¿y los otros?", "dame una tabla" etc.
    Falls back to the original query if it is already self-contained or on any failure.
    """
    if not conversation_context.strip():
        return user_query

    prompt = f"""Eres un asistente especializado en búsqueda web.
Tu tarea es reescribir el Último mensaje del usuario como una consulta de búsqueda COMPLETA y AUTÓNOMA, sin referencias al contexto previo.

REGLAS:
- Si el último mensaje ya es una pregunta completa (no depende del historial), devúelvelo sin cambios.
- Si es un follow-up que depende del contexto anterior (ej: "dame más", "¿y los otros?", "dame una tabla con eso"), reescuíbelo incorporando el tema/entidad/período del contexto.
- La consulta resultante debe ser comprensible sin leer el historial.
- Longitud máxima: 20 palabras.
- Responde ÚNICAMENTE con la consulta reescrita. Sin explicaciones, sin comillas.

Historial reciente:
{conversation_context}

Último mensaje del usuario: {user_query}

Consulta reescrita:"""

    try:
        result = rag_service.call_ollama_generate(prompt, temperature=0.1)
        result = result.strip().strip('"').strip("'")
        if result and len(result) > 5:
            logger.info(f"Query reformulation: '{user_query}' → '{result}'")
            return result
    except Exception as e:
        logger.warning(f"Query reformulation failed, keeping original query. Error: {e}")

    return user_query


def search_web_urls(
    query: str,
    max_results: int = 4,
    time_filter: Optional[str] = None,
    domain_filter: Optional[str] = None
) -> List[Dict[str, str]]:
    """
    Queries DuckDuckGo Search API to retrieve live web result URLs, titles, and snippets.
    """
    clean_query = query.strip()
    if domain_filter and domain_filter.strip():
        domains = [d.strip() for d in domain_filter.split(",") if d.strip()]
        if domains:
            site_query = " OR ".join([f"site:{d}" for d in domains])
            clean_query = f"{clean_query} ({site_query})"

    timelimit_map = {
        "day": "d",
        "week": "w",
        "month": "m",
        "year": "y"
    }
    ddg_time = timelimit_map.get(time_filter, None) if time_filter else None

    results = []
    try:
        ddg = DDGS()
        raw_results = list(ddg.text(clean_query, timelimit=ddg_time, max_results=max_results * 3))

        domain_counts: Dict[str, int] = {}
        filtered_count = 0
        for item in raw_results:
            url = item.get("href") or item.get("link") or ""
            title = item.get("title") or ""
            snippet = item.get("body") or item.get("snippet") or ""

            if not url or not url.startswith(("http://", "https://")):
                continue

            parsed_url = urllib.parse.urlparse(url)
            domain = parsed_url.netloc.replace("www.", "")

            candidate = {
                "title": title,
                "url": url,
                "domain": domain,
                "snippet": snippet,
            }
            matches, reason = result_matches_query_intent(query, candidate)
            if not matches:
                filtered_count += 1
                logger.debug("Discarded search result %s: %s", url, reason)
                continue

            # Diversity heuristic: limit each search to two pages per domain.
            if domain_counts.get(domain, 0) >= 2:
                continue

            domain_counts[domain] = domain_counts.get(domain, 0) + 1
            results.append(candidate)

            if len(results) >= max_results:
                break
        if filtered_count:
            logger.info("Filtered %s search results that did not match the query intent.", filtered_count)
    except Exception as e:
        logger.error(f"Error querying DuckDuckGo search API: {e}")

    return results


def process_web_search_rag(
    query: str,
    search_depth: str = "quick",
    time_filter: Optional[str] = None,
    domain_filter: Optional[str] = None,
    similarity_threshold: float = 0.40,
    history: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]:
    """
    Executes an in-memory ephemeral Web Search RAG pipeline with Multi-Query Expansion:
    0. Reformulate the query using conversation history (resolves follow-ups).
    1. Expand the reformulated query into 3-4 focused sub-queries using the LLM.
    2. Search web URLs for each sub-query in parallel (3 or 6 URLs each).
    3. Deduplicate URLs across all sub-queries.
    4. Extract clean Markdown with Docling + Guardrails in RAM.
    5. Score chunks by vector similarity; select best chunk per source + fill budget.
    6. Cap context size to protect 32k window.
    7. Clean up RAM without touching SQLite or disk files.
    """
    urls_per_query = 6 if search_depth == "deep" else 3
    num_sub_queries = 4 if search_depth == "deep" else 3

    logs = []

    # --- Step 0: Query reformulation (resolve follow-ups using conversation context) ---
    effective_query = query
    if history and len(history) >= 2:
        # Build conversation context from the last 4 turns (8 messages max, truncated for prompt)
        context_turns = history[-8:]
        conversation_context = "\n".join([
            f"{'Usuario' if m['role'] == 'user' else 'Asistente'}: {m['content'][:400]}"
            for m in context_turns
        ])
        effective_query = rewrite_query_standalone(query, conversation_context)
        if effective_query != query:
            logs.append(f"🔄 Consulta reformulada (follow-up detectado): '{query[:70]}' → '{effective_query[:70]}'")

    logs.append(f"🔎 Búsqueda web Multi-Query ({search_depth.upper()}): '{effective_query[:100]}...' → generando {num_sub_queries} variaciones de búsqueda")

    # --- Step 1: Multi-Query Expansion ---
    sub_queries = generate_search_queries(effective_query, num_queries=num_sub_queries)
    logs.append(f"🧠 Variaciones generadas: {' | '.join(sub_queries)}")

    # --- Step 2: Search each sub-query in parallel, collect unique URLs ---
    all_search_results: List[Dict[str, str]] = []
    seen_urls_set: set = set()
    global_domain_counts: Dict[str, int] = {}

    def _search_single(sq: str) -> List[Dict[str, str]]:
        return search_web_urls(sq, max_results=urls_per_query, time_filter=time_filter, domain_filter=domain_filter)

    with ThreadPoolExecutor(max_workers=num_sub_queries) as executor:
        futures = {executor.submit(_search_single, sq): sq for sq in sub_queries}
        for future in as_completed(futures):
            try:
                results = future.result()
                for r in results:
                    normalized_url = r["url"].split("#", 1)[0]
                    if normalized_url in seen_urls_set or global_domain_counts.get(r["domain"], 0) >= 2:
                        continue
                    seen_urls_set.add(normalized_url)
                    global_domain_counts[r["domain"]] = global_domain_counts.get(r["domain"], 0) + 1
                    all_search_results.append(r)
            except Exception as e:
                logger.warning(f"Sub-query search failed: {e}")

    total_found = len(all_search_results)
    logs.append(f"🌐 {total_found} URLs únicas encontradas en total. Extrayendo contenido con Docling...")

    if not all_search_results:
        logs.append("⚠️ No se encontraron resultados web para ninguna de las variaciones de búsqueda.")
        return {
            "context_text": "",
            "web_sources": [],
            "logs": logs
        }

    # --- Step 3: Parallel content extraction with Docling & Guardrails ---
    page_contents = []
    with ThreadPoolExecutor(max_workers=min(6, len(all_search_results))) as executor:
        future_to_item = {
            executor.submit(web_ingester.extract_web_page, item["url"]): item
            for item in all_search_results
        }
        for future in as_completed(future_to_item):
            item = future_to_item[future]
            try:
                extracted = future.result()
                raw_text = (extracted.get("text") or "").strip()
                if raw_text:  # Only add pages with actual extractable content
                    page_contents.append({
                        "title": extracted.get("title") or item["title"],
                        "url": item["url"],
                        "domain": item["domain"],
                        "snippet": item["snippet"],
                        "text": raw_text
                    })
            except Exception as err:
                logger.warning(f"Docling extraction failed for {item['url']}: {err}")

    if not page_contents:
        logs.append("❌ No se pudo extraer el contenido de las páginas web encontradas.")
        return {
            "context_text": "",
            "web_sources": [],
            "logs": logs
        }

    logs.append(f"🛡️ {len(page_contents)} páginas sanitizadas con Guardrails anti-Prompt Injection ({len(all_search_results) - len(page_contents)} sin contenido extraíble).")

    # --- Step 4: In-memory chunking ---
    all_chunks = []
    chunk_meta = []

    for page in page_contents:
        text = page["text"].strip()
        if not text:
            continue
        chunks = rag_service.chunk_text(text, size=600, overlap=100)
        for c in chunks:
            all_chunks.append(c)
            chunk_meta.append(page)

    if not all_chunks:
        return {
            "context_text": "",
            "web_sources": page_contents,
            "logs": logs
        }

    # --- Step 5: Score all chunks by max similarity across all query variants ---
    try:
        all_query_variants = list(dict.fromkeys([effective_query[:500]] + sub_queries))
        all_embeddings = rag_service.generate_embeddings(all_query_variants + all_chunks)
        query_embs = all_embeddings[:len(all_query_variants)]
        chunk_embs = all_embeddings[len(all_query_variants):]

        def cosine(a: np.ndarray, b: np.ndarray) -> float:
            na, nb = np.linalg.norm(a), np.linalg.norm(b)
            return float(np.dot(a, b) / (na * nb)) if na > 0 and nb > 0 else 0.0

        scores = []
        for emb in chunk_embs:
            direct_score = cosine(query_embs[0], emb)
            expansion_score = max((cosine(q_emb, emb) for q_emb in query_embs[1:]), default=direct_score)
            scores.append((0.75 * direct_score) + (0.25 * max(direct_score, expansion_score)))

        # Build scored tuples list — use min to guard against partial embedding results
        n_scored = min(len(scores), len(all_chunks))
        all_scored = sorted(
            [
                (
                    min(1.0, scores[i] + source_authority_bonus(effective_query, chunk_meta[i]["domain"])),
                    all_chunks[i],
                    chunk_meta[i],
                )
                for i in range(n_scored)
            ],
            key=lambda x: x[0],
            reverse=True
        )

        # Best-of-N per source: pick the highest-scoring chunk per URL (guaranteed slot)
        # all_scored is already sorted desc, so the first occurrence per URL is the best
        best_per_source: Dict[str, tuple] = {}
        for item in all_scored:
            url = item[2]["url"]
            if url not in best_per_source:
                best_per_source[url] = item

        # For pages that had NO chunks in all_scored (e.g. embedding failed partway),
        # add them with a neutral score so Phase 1 still covers them
        for page in page_contents:
            url = page["url"]
            if url not in best_per_source:
                # Find the first chunk belonging to this page in the original all_chunks list
                for ci, meta in enumerate(chunk_meta):
                    if meta["url"] == url:
                        best_per_source[url] = (0.0, all_chunks[ci], meta)
                        break

        # Remaining chunks (not the per-source champion) sorted by score
        best_per_source_ids = set(id(v[1]) for v in best_per_source.values())
        extra_chunks = [item for item in all_scored if id(item[1]) not in best_per_source_ids]

    except Exception as e:
        logger.error(f"Error computing in-memory embeddings: {e}")
        # Fallback: guarantee one chunk per unique URL across ALL pages (not just first 8 chunks)
        best_per_source = {}
        for i, meta in enumerate(chunk_meta):
            url = meta["url"]
            if url not in best_per_source:
                best_per_source[url] = (0.5, all_chunks[i], meta)
        extra_chunks = []

    # --- Step 6: Two-phase context building ---
    # Phase 1: Add one relevant chunk per source.
    # Phase 2: Fill the remaining budget only with chunks above the threshold.
    MAX_CHAR_BUDGET = 32000 if search_depth == "deep" else 16000
    MAX_RELEVANT_SOURCES = 8 if search_depth == "deep" else 5
    MAX_CHUNKS_PER_SOURCE = 8 if search_depth == "deep" else 5
    current_chars = 0
    selected_context_snippets = []
    used_web_sources = []
    url_to_num: Dict[str, int] = {}
    included_chunk_ids: set = set()
    chunks_per_source: Dict[str, int] = {}

    def _add_chunk(score: float, chunk_text: str, page: dict) -> bool:
        nonlocal current_chars
        if score < similarity_threshold:
            return False
        if chunks_per_source.get(page["url"], 0) >= MAX_CHUNKS_PER_SOURCE:
            return False
        if page["url"] not in url_to_num:
            if len(url_to_num) >= MAX_RELEVANT_SOURCES:
                return False
            url_to_num[page["url"]] = len(url_to_num) + 1
            used_web_sources.append({
                "num": url_to_num[page["url"]],
                "title": page["title"],
                "url": page["url"],
                "domain": page["domain"],
                "snippet": page["snippet"]
            })
        src_num = url_to_num[page["url"]]
        header_tag = f"[Fuente Web [W{src_num}]: {page['title']} | {page['url']}]"
        formatted = f"{header_tag}\n{chunk_text}"
        if current_chars + len(formatted) > MAX_CHAR_BUDGET:
            return False
        selected_context_snippets.append(formatted)
        included_chunk_ids.add(id(chunk_text))
        chunks_per_source[page["url"]] = chunks_per_source.get(page["url"], 0) + 1
        current_chars += len(formatted)
        return True

    # Phase 1: Best chunk per source (sorted by score desc so best sources first)
    phase1_sources = [
        item for item in sorted(best_per_source.values(), key=lambda x: x[0], reverse=True)
        if item[0] >= similarity_threshold
    ]
    for score, chunk_text, page in phase1_sources:
        _add_chunk(score, chunk_text, page)

    # Phase 2: Fill with remaining high-score chunks
    for score, chunk_text, page in extra_chunks:
        if current_chars >= MAX_CHAR_BUDGET:
            break
        if score < similarity_threshold:
            break
        if id(chunk_text) not in included_chunk_ids:
            _add_chunk(score, chunk_text, page)

    estimated_tokens = int(current_chars / 4)
    logs.append(
        f"⚡ {len(selected_context_snippets)} fragmentos relevantes de {len(url_to_num)} fuentes "
        f"(umbral {similarity_threshold:.2f}, ~{estimated_tokens} tokens)."
    )

    final_context = "\n\n---\n\n".join(selected_context_snippets)

    # --- Step 7: Build full source list with numbered relevant/non-relevant tags ---
    unseen_idx = len(used_web_sources) + 1
    non_relevant_sources = []
    for p in page_contents:
        if p["url"] not in url_to_num:
            non_relevant_sources.append({
                "num": unseen_idx,
                "title": p["title"],
                "url": p["url"],
                "domain": p["domain"],
                "snippet": p["snippet"],
                "relevant": False
            })
            unseen_idx += 1

    all_web_sources = [
        {**s, "relevant": True}
        for s in (used_web_sources if used_web_sources else [])
    ] + non_relevant_sources

    return {
        "context_text": final_context,
        "web_sources": all_web_sources if all_web_sources else [{**p, "num": i + 1, "relevant": False} for i, p in enumerate(page_contents)],
        "logs": logs
    }
