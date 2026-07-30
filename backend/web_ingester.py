import re
import urllib.parse
import logging
from pathlib import Path
from typing import Dict, Any

from docling.document_converter import DocumentConverter
from config import settings
from security import fetch_public_http, safe_filename, validate_public_http_url

logger = logging.getLogger("web_ingester")

# Regex patterns for Prompt Injection guardrails
PROMPT_INJECTION_PATTERNS = [
    (re.compile(r"(?i)\bignore\s+(all\s+|previous\s+|prior\s+)?instructions?\b"), "[Texto Ingerido: intento de ignorar instrucciones]"),
    (re.compile(r"(?i)\bsystem\s+(prompt|instruction|role)\s*:?"), "[Texto Ingerido: rol del sistema]"),
    (re.compile(r"(?i)\byou\s+are\s+now\b"), "[Texto Ingerido: suplantacion de rol]"),
    (re.compile(r"(?i)\b(jailbreak|DAN\s+mode|override\s+safety|forget\s+guidelines)\b"), "[Texto Ingerido: override de seguridad]"),
    (re.compile(r"(?i)<\s*script[^>]*>.*?<\s*/\s*script\s*>", re.DOTALL), ""),
    (re.compile(r"(?i)<\s*iframe[^>]*>.*?<\s*/\s*iframe\s*>", re.DOTALL), ""),
    (re.compile(r"(?i)<\s*style[^>]*>.*?<\s*/\s*style\s*>", re.DOTALL), ""),
    (re.compile(r"<!--.*?-->", re.DOTALL), "")
]

def sanitize_web_content(text: str) -> str:
    """
    Applies security guardrails against Prompt Injection on web-ingested content.
    Neutralizes jailbreak attempts and instruction overrides before indexing.
    """
    if not text:
        return ""

    sanitized = text
    # 1. Apply prompt injection guardrail patterns
    for pattern, replacement in PROMPT_INJECTION_PATTERNS:
        sanitized = pattern.sub(replacement, sanitized)

    # 2. Strip any raw HTML tags left
    sanitized = re.sub(r"<[^>]+>", "", sanitized)

    # 3. Clean up excessive empty lines
    sanitized = re.sub(r"\n{3,}", "\n\n", sanitized).strip()

    return sanitized

def extract_web_page(url: str) -> Dict[str, Any]:
    """
    Downloads and converts a web page URL into clean structured Markdown using Docling,
    applying anti-prompt-injection guardrails.
    """
    url = validate_public_http_url(url)

    parsed_url = urllib.parse.urlparse(url)
    domain = parsed_url.netloc.replace("www.", "")

    logger.info(f"Extracting web page via Docling: {url}")

    doc_markdown = ""
    title = ""

    # Fetch first with redirect and private-network validation, then give Docling
    # a local file. Direct URL conversion would bypass these SSRF checks.
    temp_html_file = None
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
        }
        resp = fetch_public_http(url, headers=headers, timeout=25)
        temp_dir = Path(settings.upload_dir) / ".temp_web"
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_html_file = temp_dir / f"web_{abs(hash(url))}.html"
        temp_html_file.write_text(resp.text, encoding="utf-8")

        doc_converter = DocumentConverter()
        result = doc_converter.convert(str(temp_html_file))
        doc_markdown = result.document.export_to_markdown()
    except Exception as err:
        # The caller decides whether an unavailable page is fatal. In agentic
        # search it is an expected per-source failure and is logged once there.
        logger.debug("Failed to fetch and parse web page %s: %s", url, err, exc_info=True)
        raise RuntimeError(f"No se pudo extraer el contenido de la web '{url}': {str(err)}") from err
    finally:
        if temp_html_file is not None:
            try:
                temp_html_file.unlink()
            except OSError:
                pass

    # 3. Extract title from Markdown h1 or URL path
    h1_match = re.search(r"^#\s+(.+)$", doc_markdown, re.MULTILINE)
    if h1_match:
        title = h1_match.group(1).strip()
    else:
        path_slug = parsed_url.path.strip("/").replace("/", " - ")
        title = path_slug if path_slug else domain

    # Format filename safely
    clean_title_slug = re.sub(r"[^\w\s-]", "", title).strip().replace(" ", "-")
    clean_filename = safe_filename(f"web_{domain}_{clean_title_slug[:50]}.md", "web_source.md")

    # 4. Apply Prompt Injection Guardrails
    clean_text = sanitize_web_content(doc_markdown)

    # Prepend source header metadata
    final_text = f"# {title}\n\n**Fuente Web**: [{url}]({url})\n**Dominio**: {domain}\n\n---\n\n{clean_text}"

    return {
        "title": title,
        "filename": clean_filename,
        "url": url,
        "domain": domain,
        "text": final_text,
        "char_count": len(final_text),
        "word_count": len(final_text.split())
    }
