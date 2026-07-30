import os
import base64
import logging
import requests
from pathlib import Path
from typing import Dict, Any

from config import settings

logger = logging.getLogger("document_parser")

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
TEXT_EXTENSIONS = {
    ".txt", ".csv", ".json", ".jsonl", ".ndjson",
    ".py", ".js", ".ts", ".jsx", ".tsx",
    ".html", ".htm", ".xml", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".env",
    ".md", ".markdown", ".rst",
    ".log", ".sh", ".bash", ".zsh", ".fish",
    ".sql", ".r", ".rb", ".go", ".rs", ".java", ".cpp", ".c", ".h", ".cs",
    ".php", ".swift", ".kt", ".scala", ".lua", ".pl", ".ex", ".exs",
}
DOCLING_EXTENSIONS = {".pdf", ".docx", ".pptx", ".html", ".htm"}

def describe_image_with_gemma4(image_path: str) -> str:
    """
    Send an image to Ollama Gemma 4 Multimodal to extract OCR text and describe visual content.
    """
    if not os.path.exists(image_path):
        return ""

    try:
        with open(image_path, "rb") as f:
            img_bytes = f.read()
        b64_img = base64.b64encode(img_bytes).decode("utf-8")

        prompt = (
            "Analiza esta imagen con precisión. Extrae todo el texto visible (OCR) "
            "y describe detalladamente los datos, diagramas, esquemas o información relevante "
            "que contiene para su indexación en un sistema RAG."
        )

        payload = {
            "model": settings.llm_model,
            "prompt": prompt,
            "images": [b64_img],
            "stream": False
        }

        from gpu_lock import gpu_lock
        with gpu_lock.acquire("Análisis Multimodal de Imagen (Gemma 4)"):
            res = requests.post(f"{settings.ollama_url}/api/generate", json=payload, timeout=120)
            if res.status_code == 200:
                data = res.json()
                return data.get("response", "").strip()
            else:
                logger.warning(f"Ollama image analysis failed with status {res.status_code}: {res.text}")
                return ""
    except Exception as e:
        logger.error(f"Error executing Gemma 4 image analysis on {image_path}: {str(e)}")
        return ""

def is_noisy_ocr(text: str) -> bool:
    """
    Detect if extracted text contains OCR noise, HTML entities (&#124;),
    image tags, or looks like a failed OCR output from a scanned/handwritten PDF.
    """
    if not text or not text.strip():
        return True

    # 1. HTML entities produced by bad OCR tables
    if "&#" in text or "&amp;" in text or "&#124;" in text:
        return True

    # 2. Presence of image tags with sparse text (typical of scanned page OCR)
    if "<!-- image -->" in text and len(text.strip()) < 2500:
        return True

    # 3. Garbage / broken OCR patterns
    noise_patterns = [
        "Arul2", "onpeA", "Guvitutu", "eC eS oACon",
        "Correspondlentea", "RodruGZ", "InesLqauon",
        "Jekrstof", "baro", "Aitirano"
    ]
    for pattern in noise_patterns:
        if pattern.lower() in text.lower():
            return True

    # 4. Symbol-to-letter ratio check
    bad_chars = sum(1 for c in text if c in "&#|{}`~\\")
    if bad_chars > 3:
        return True

    return False

def transcribe_scanned_pdf_with_gemma4(filepath: str) -> str:
    """
    Render PDF pages to PNG using pypdfium2 and transcribe each page
    using Gemma 4 Multimodal for clean handwriting/scanned form extraction.
    """
    import pypdfium2 as pdfium
    path = Path(filepath)
    pdf = pdfium.PdfDocument(str(path))
    num_pages = len(pdf)

    logger.info(f"Rendering and transcribing {num_pages} page(s) of scanned PDF '{path.name}' using Gemma 4 Vision...")

    temp_dir = path.parent / ".temp_pages"
    temp_dir.mkdir(exist_ok=True)

    pages_markdown = []

    for idx in range(num_pages):
        page_num = idx + 1
        page = pdf[idx]
        image = page.render(scale=1.5).to_pil()
        if max(image.size) > 1280:
            image.thumbnail((1280, 1280))
        temp_img_path = temp_dir / f"page_{page_num}.png"
        image.save(temp_img_path)

        prompt = "Transcribe todo el texto visible, escrito a mano y en formularios de esta página de documento escaneado en formato Markdown estructurado en español. Reconstruye títulos, listas y tablas."

        try:
            with open(temp_img_path, "rb") as f:
                img_bytes = f.read()
            b64_img = base64.b64encode(img_bytes).decode("utf-8")

            payload = {
                "model": settings.llm_model,
                "prompt": prompt,
                "images": [b64_img],
                "stream": False
            }

            from gpu_lock import gpu_lock
            with gpu_lock.acquire(f"Transcripción Visión Gemma 4 (Pág. {page_num}/{num_pages})"):
                res = requests.post(f"{settings.ollama_url}/api/generate", json=payload, timeout=180)
                logger.info(f"Ollama Vision Response Status: {res.status_code}")
                if res.status_code == 200:
                    data = res.json()
                    page_text = data.get("response", "").strip()
                    logger.info(f"Ollama Vision page {page_num} extracted {len(page_text)} chars")
                    if page_text:
                        pages_markdown.append(f"## Página {page_num}\n\n{page_text}")
                else:
                    logger.error(f"Ollama Vision failed with status {res.status_code}: {res.text}")
        except Exception as err:
            logger.error(f"Error transcribing page {page_num} of {path.name} with Gemma 4: {str(err)}", exc_info=True)
        finally:
            try:
                temp_img_path.unlink()
            except Exception:
                pass

    pdf.close()
    return "\n\n---\n\n".join(pages_markdown)

def parse_document(filepath: str, mode: str = "fast") -> Dict[str, Any]:
    """
    Parse a document (PDF, Word, PowerPoint, Text, Code, or Image) into structured Markdown.
    mode: 'fast' (pure Docling/text, ~1-2s) or 'llm' (Docling + Gemma 4 vision picture analysis).
    Returns dict with keys: 'markdown', 'title', 'file_type', 'image_descriptions'.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {filepath}")

    ext = path.suffix.lower()
    filename = path.name

    # 1. Plain text / Code files
    if ext in TEXT_EXTENSIONS or (ext not in IMAGE_EXTENSIONS and ext not in DOCLING_EXTENSIONS):
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except UnicodeDecodeError:
            with open(path, "r", encoding="latin-1") as f:
                content = f.read()
        return {
            "markdown": content,
            "title": filename,
            "file_type": "text",
            "image_descriptions": []
        }

    # 2. Standalone Image Files
    if ext in IMAGE_EXTENSIONS:
        if mode == "fast":
            return {
                "markdown": f"# Imagen: {filename}\n\n_Análisis de imagen rápido omitido en modo Docling. Usa el modo LLM para describir esta imagen._",
                "title": filename,
                "file_type": "image",
                "image_descriptions": []
            }
        logger.info(f"Analyzing standalone image '{filename}' with Gemma 4...")
        description = describe_image_with_gemma4(str(path))
        markdown = f"# Análisis de Imagen: {filename}\n\n"
        if description:
            markdown += f"### OCR y Descripción Visual\n\n{description}\n"
        else:
            markdown += "_No se pudo extraer descripción de la imagen._\n"
        return {
            "markdown": markdown,
            "title": filename,
            "file_type": "image",
            "image_descriptions": [description] if description else []
        }

    # 3. Binary Documents via Docling (PDF, DOCX, PPTX, HTML)
    logger.info(f"Parsing binary document '{filename}' with Docling (mode='{mode}')...")
    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat

        pipeline_options = PdfPipelineOptions()
        if mode == "llm":
            pipeline_options.generate_page_images = True
            pipeline_options.generate_picture_images = True
        else:
            pipeline_options.generate_page_images = False
            pipeline_options.generate_picture_images = False

        doc_converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
            }
        )

        result = doc_converter.convert(str(path))
        doc_markdown = result.document.export_to_markdown()

        image_descriptions = []

        # Only invoke Gemma 4 vision if explicitly requested in 'llm' mode
        if mode == "llm":
            # Check if Docling OCR produced garbage / scanned handwriting noise for PDF
            if ext == ".pdf" and is_noisy_ocr(doc_markdown):
                logger.warning(f"Detected low quality / handwritten OCR in '{filename}'. Invoking Gemma 4 Vision transcription...")
                vision_markdown = transcribe_scanned_pdf_with_gemma4(str(path))
                if vision_markdown.strip():
                    doc_markdown = vision_markdown

            # Process pictures extracted by Docling if any
            if hasattr(result.document, "pictures") and result.document.pictures:
                temp_dir = path.parent / ".temp_images"
                temp_dir.mkdir(exist_ok=True)
                for idx, pic in enumerate(result.document.pictures):
                    try:
                        if hasattr(pic, "get_image"):
                            pil_img = pic.get_image(result.document)
                            if pil_img and pil_img.width >= 100 and pil_img.height >= 100:
                                temp_img_path = temp_dir / f"pic_{idx}.png"
                                pil_img.save(temp_img_path)
                                img_desc = describe_image_with_gemma4(str(temp_img_path))
                                if img_desc:
                                    image_descriptions.append(img_desc)
                                    doc_markdown += f"\n\n---\n### [Análisis Visual - Imagen #{idx+1}]\n\n{img_desc}\n"
                                try:
                                    temp_img_path.unlink()
                                except Exception:
                                    pass
                    except Exception as img_err:
                        logger.warning(f"Failed to process embedded picture #{idx}: {str(img_err)}")

        return {
            "markdown": doc_markdown,
            "title": filename,
            "file_type": ext.lstrip("."),
            "image_descriptions": image_descriptions
        }
    except Exception as e:
        logger.error(f"Docling failed for '{filename}', falling back to plain reading: {str(e)}")
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        return {
            "markdown": content,
            "title": filename,
            "file_type": "fallback_text",
            "image_descriptions": []
        }

