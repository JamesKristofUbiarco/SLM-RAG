import re
import pickle
import numpy as np
import urllib.parse
import logging
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from ddgs import DDGS
import web_ingester
from rag_service import rag_service

logger = logging.getLogger("web_search_service")

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
        raw_results = list(ddg.text(clean_query, timelimit=ddg_time, max_results=max_results * 2))
        
        seen_domains = set()
        for item in raw_results:
            url = item.get("href") or item.get("link") or ""
            title = item.get("title") or ""
            snippet = item.get("body") or item.get("snippet") or ""

            if not url or not url.startswith(("http://", "https://")):
                continue

            parsed_url = urllib.parse.urlparse(url)
            domain = parsed_url.netloc.replace("www.", "")

            # Diversity heuristic: Limit max 2 URLs per domain
            domain_count = sum(1 for d in seen_domains if d == domain)
            if domain_count >= 2:
                continue

            seen_domains.add(domain)
            results.append({
                "title": title,
                "url": url,
                "domain": domain,
                "snippet": snippet
            })

            if len(results) >= max_results:
                break
    except Exception as e:
        logger.error(f"Error querying DuckDuckGo search API: {e}")

    return results

def process_web_search_rag(
    query: str,
    search_depth: str = "quick",
    time_filter: Optional[str] = None,
    domain_filter: Optional[str] = None,
    similarity_threshold: float = 0.50
) -> Dict[str, Any]:
    """
    Executes an in-memory ephemeral Web Search RAG pipeline:
    1. Search web URLs.
    2. Extract clean Markdown with Docling + Guardrails in RAM.
    3. Filter chunks by vector similarity threshold.
    4. Cap context size to protect 32k window (~4,000 tokens / 16,000 chars max).
    5. Clean up RAM without touching SQLite or disk files.
    """
    max_urls = 6 if search_depth == "deep" else 3
    logs = [f"🔎 Buscando en la web ({search_depth.upper()}): '{query}'"]

    web_results = search_web_urls(query, max_results=max_urls, time_filter=time_filter, domain_filter=domain_filter)

    if not web_results:
        logs.append("⚠️ No se encontraron resultados web para la consulta.")
        return {
            "context_text": "",
            "web_sources": [],
            "logs": logs
        }

    logs.append(f"🌐 Encontradas {len(web_results)} páginas web. Extrayendo contenido con Docling...")

    # Parallel extraction using Docling & Prompt Injection Guardrails
    page_contents = []
    with ThreadPoolExecutor(max_workers=min(4, len(web_results))) as executor:
        future_to_url = {
            executor.submit(web_ingester.extract_web_page, item["url"]): item
            for item in web_results
        }
        for future in as_completed(future_to_url):
            item = future_to_url[future]
            try:
                extracted = future.result()
                page_contents.append({
                    "title": extracted["title"] or item["title"],
                    "url": item["url"],
                    "domain": item["domain"],
                    "snippet": item["snippet"],
                    "text": extracted["text"]
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

    logs.append(f"🛡️ {len(page_contents)} páginas sanitizadas con Guardrails anti-Prompt Injection.")

    # 3. Perform in-memory chunking and vector filtering
    all_chunks = []
    chunk_meta = []

    for page in page_contents:
        chunks = rag_service.chunk_text(page["text"], size=600, overlap=100)
        for c in chunks:
            all_chunks.append(c)
            chunk_meta.append(page)

    if not all_chunks:
        return {
            "context_text": "",
            "web_sources": page_contents,
            "logs": logs
        }

    # Vector similarity search against query in RAM
    try:
        query_emb = rag_service.generate_embeddings([query])[0]
        chunk_embs = rag_service.generate_embeddings(all_chunks)

        # Calculate Cosine Similarities
        scores = []
        for emb in chunk_embs:
            norm_q = np.linalg.norm(query_emb)
            norm_c = np.linalg.norm(emb)
            sim = np.dot(query_emb, emb) / (norm_q * norm_c) if norm_q > 0 and norm_c > 0 else 0.0
            scores.append(float(sim))

        # Filter by threshold and sort by score DESC
        indexed_chunks = [
            (scores[i], all_chunks[i], chunk_meta[i])
            for i in range(len(all_chunks))
            if scores[i] >= similarity_threshold
        ]
        indexed_chunks.sort(key=lambda x: x[0], reverse=True)

        # Unload embedding model from VRAM immediately
        rag_service.unload_embedding_model()

    except Exception as e:
        logger.error(f"Error computing in-memory embeddings: {e}")
        # Fallback: take first N chunks
        indexed_chunks = [(0.5, all_chunks[i], chunk_meta[i]) for i in range(min(6, len(all_chunks)))]

    # Cap RAG context size to ~16,000 characters (max ~4,000 tokens)
    MAX_CHAR_BUDGET = 16000
    current_chars = 0
    selected_context_snippets = []
    used_web_sources = []
    seen_urls = set()

    for score, chunk_text, page in indexed_chunks:
        if current_chars + len(chunk_text) > MAX_CHAR_BUDGET:
            break

        header_tag = f"[Fuente Web: {page['title']} | {page['url']}]"
        formatted_snippet = f"{header_tag}\n{chunk_text}"
        selected_context_snippets.append(formatted_snippet)
        current_chars += len(formatted_snippet)

        if page["url"] not in seen_urls:
            seen_urls.add(page["url"])
            used_web_sources.append({
                "title": page["title"],
                "url": page["url"],
                "domain": page["domain"],
                "snippet": page["snippet"]
            })

    estimated_tokens = int(current_chars / 4)
    logs.append(f"⚡ {len(selected_context_snippets)} fragmentos seleccionados (~{estimated_tokens} tokens / presupuesto máx. 4,000).")

    final_context = "\n\n---\n\n".join(selected_context_snippets)

    return {
        "context_text": final_context,
        "web_sources": used_web_sources if used_web_sources else page_contents,
        "logs": logs
    }
