import json
import logging
from typing import List, Dict, Any, Optional
from config import settings
from rag_service import rag_service

logger = logging.getLogger("studio_service")

class StudioService:
    """
    Studio Hub Multi-Source Content & Interactive Study Generator.
    Processes N selected sources to create Briefing Documents, FAQs, Timelines, Quizzes, and Flashcards.
    """

    def _get_combined_source_text(self, source_ids: List[int], max_chars: int = 25000) -> str:
        """Gather and combine full text from selected source IDs up to max_chars limit."""
        if not source_ids:
            return ""

        from database import get_db
        placeholders = ",".join(["?"] * len(source_ids))
        sql = f"SELECT id, filename, text FROM transcriptions WHERE id IN ({placeholders})"
        
        with get_db() as conn:
            rows = conn.execute(sql, source_ids).fetchall()

        if not rows:
            return ""

        parts = []
        for r in rows:
            text_snippet = r["text"][:max_chars // len(rows)]
            parts.append(f"=== FUENTE: {r['filename']} (ID #{r['id']}) ===\n{text_snippet}")

        return "\n\n---\n\n".join(parts)

    def generate_artifact(self, artifact_type: str, source_ids: List[int], options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Generate Studio content (briefing, faq, timeline, quiz, flashcards) with custom configuration.
        """
        combined_text = self._get_combined_source_text(source_ids)
        if not combined_text:
            return {"status": "error", "message": "No se encontraron fuentes seleccionadas válidas."}

        opts = options or {}
        count = opts.get("count", 5)
        difficulty = opts.get("difficulty", "Intermedio")
        length = opts.get("length", "Estándar")
        custom_instructions = opts.get("custom_instructions", "").strip()

        custom_prompt_part = ""
        if custom_instructions:
            custom_prompt_part = f"\nENFOQUE E INSTRUCCIONES ESPECÍFICAS DEL USUARIO:\n{custom_instructions}\n"

        if artifact_type == "briefing":
            prompt = f"""Genera un **Documento de Briefing Ejecutivo Multifuente** con extensión '{length}' basado en las siguientes fuentes.
{custom_prompt_part}
Formato Markdown requerido:

# 📄 Documento de Briefing Ejecutivo ({length})
## 🎯 Visión General y Contexto
## 📌 Temas Clave y Hallazgos Principales
## 💡 Análisis de Impacto y Conclusiones

Fuentes:
{combined_text}"""
            content = rag_service.call_ollama_generate(prompt)
            return {"type": "markdown", "content": content}

        elif artifact_type == "faq":
            prompt = f"""Genera una lista de **Preguntas Frecuentes (FAQ)** con extensión '{length}' basadas en las siguientes fuentes.
{custom_prompt_part}
Formato Markdown requerido:
# ❓ Preguntas Frecuentes (FAQ)
### 1. ¿Pregunta?
**Respuesta:** Explicación detallada.

Fuentes:
{combined_text}"""
            content = rag_service.call_ollama_generate(prompt)
            return {"type": "markdown", "content": content}

        elif artifact_type == "timeline":
            prompt = f"""Genera una **Línea de Tiempo y Cronología Unificada** con extensión '{length}' basada en las siguientes fuentes.
{custom_prompt_part}
Formato Markdown requerido:
# ⏱️ Cronología y Línea de Tiempo de Hitos
- **[Hito / Fecha / Paso 1]**: Explicación del evento.
- **[Hito / Fecha / Paso 2]**: Explicación del evento.

Fuentes:
{combined_text}"""
            content = rag_service.call_ollama_generate(prompt)
            return {"type": "markdown", "content": content}

        elif artifact_type == "quiz":
            prompt = f"""Basándote en las siguientes fuentes, crea un **Examen de Opción Múltiple (Quiz)** de exactamente {count} preguntas con nivel de dificultad '{difficulty}'.
{custom_prompt_part}
DEBES responder EXCLUSIVAMENTE con una estructura JSON estricta (sin markdown, sin bloques ```json, únicamente el JSON puro) con este formato exacto:

[
  {{
    "id": 1,
    "question": "Pregunta detallada aquí",
    "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
    "correct_index": 0,
    "explanation": "Explicación de por qué la opción A es correcta basada en el texto."
  }}
]

Fuentes:
{combined_text}"""
            raw_res = rag_service.call_ollama_generate(prompt, temperature=0.2)
            try:
                # Clean stray markdown wrapper if present
                clean_json = raw_res.strip()
                if clean_json.startswith("```"):
                    clean_json = clean_json.split("\n", 1)[1]
                if clean_json.endswith("```"):
                    clean_json = clean_json.rsplit("\n", 1)[0]
                if clean_json.startswith("json"):
                    clean_json = clean_json[4:].strip()
                quiz_data = json.loads(clean_json)
                return {"type": "quiz", "data": quiz_data}
            except Exception as e:
                logger.error(f"Failed to parse quiz JSON: {e}. Raw response: {raw_res}")
                return {"type": "markdown", "content": f"# 🧠 Examen Generado ({count} preguntas, Nivel {difficulty})\n\n{raw_res}"}

        elif artifact_type == "flashcards":
            prompt = f"""Basándote en las siguientes fuentes, crea un conjunto de exactamente {count} **Tarjetas de Estudio (Flashcards)** para memorización rápida de conceptos con nivel de dificultad '{difficulty}'.
{custom_prompt_part}
DEBES responder EXCLUSIVAMENTE con una estructura JSON estricta (sin markdown, sin bloques ```json, únicamente el JSON puro) con este formato exacto:

[
  {{
    "id": 1,
    "front": "Pregunta o Concepto Clave",
    "back": "Respuesta precisa y explicación corta"
  }}
]

Fuentes:
{combined_text}"""
            raw_res = rag_service.call_ollama_generate(prompt, temperature=0.2)
            try:
                clean_json = raw_res.strip()
                if clean_json.startswith("```"):
                    clean_json = clean_json.split("\n", 1)[1]
                if clean_json.endswith("```"):
                    clean_json = clean_json.rsplit("\n", 1)[0]
                if clean_json.startswith("json"):
                    clean_json = clean_json[4:].strip()
                cards_data = json.loads(clean_json)
                return {"type": "flashcards", "data": cards_data}
            except Exception as e:
                logger.error(f"Failed to parse flashcards JSON: {e}. Raw response: {raw_res}")
                return {"type": "markdown", "content": f"# 🎴 Flashcards Generadas\n\n{raw_res}"}

        else:
            return {"status": "error", "message": f"Tipo de artefacto desconocido: {artifact_type}"}

studio_service = StudioService()
