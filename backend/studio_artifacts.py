import json
import re
from typing import Any, Dict, List


def _strip_code_fence(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        text = text[first_newline + 1:] if first_newline >= 0 else ""
    if text.rstrip().endswith("```"):
        text = text.rstrip()[:-3]
    return text.strip()


def _repair_json_backslashes(value: str) -> str:
    """Escape model-generated LaTeX commands and otherwise invalid JSON escapes."""
    repaired = re.sub(r"(?<!\\)\\(?=[A-Za-z]{2,})", r"\\\\", value)
    return re.sub(r'(?<!\\)\\(?!["\\/bfnrtu])', r"\\\\", repaired)


def _json_candidates(raw_response: str) -> List[str]:
    text = _strip_code_fence(raw_response)
    candidates = [text]
    # Prefer the complete item array over an individual object nested inside it.
    for opening, closing in (("[", "]"), ("{", "}")):
        start = text.find(opening)
        end = text.rfind(closing)
        if start >= 0 and end > start:
            candidates.append(text[start:end + 1])
    return list(dict.fromkeys(candidate for candidate in candidates if candidate))


def _load_model_json(raw_response: str) -> Any:
    last_error: Exception | None = None
    for candidate in _json_candidates(raw_response):
        for attempted in (candidate, _repair_json_backslashes(candidate)):
            try:
                return json.loads(attempted)
            except (json.JSONDecodeError, TypeError) as exc:
                last_error = exc
    raise ValueError("La respuesta no contiene JSON estructurado válido.") from last_error


def _recover_complete_objects(raw_response: str) -> List[Dict[str, Any]]:
    """Recover fully closed item objects from an otherwise truncated JSON response."""
    text = _strip_code_fence(raw_response)
    decoder = json.JSONDecoder()
    recovered: List[Dict[str, Any]] = []
    for position, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[position:])
        except json.JSONDecodeError:
            try:
                value, _ = decoder.raw_decode(_repair_json_backslashes(text[position:]))
            except json.JSONDecodeError:
                continue
        if isinstance(value, dict) and not any(
            key in value for key in ("data", "quiz", "flashcards", "items")
        ):
            recovered.append(value)
    return recovered


def _unwrap_items(value: Any, artifact_type: str) -> Any:
    if not isinstance(value, dict):
        return value
    for key in ("data", artifact_type, "items"):
        if key in value:
            return value[key]
    return value


def parse_studio_items(raw_response: str, artifact_type: str) -> List[Dict[str, Any]]:
    """Parse and validate quiz or flashcard items from an LLM response."""
    try:
        parsed = _unwrap_items(_load_model_json(raw_response), artifact_type)
    except ValueError:
        parsed = _recover_complete_objects(raw_response)
    if not isinstance(parsed, list) or not parsed:
        raise ValueError(f"La respuesta de {artifact_type} no contiene una lista de elementos.")

    normalized: List[Dict[str, Any]] = []
    for position, item in enumerate(parsed, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"El elemento {position} de {artifact_type} no es un objeto.")

        if artifact_type == "flashcards":
            front = str(item.get("front", "")).strip()
            back = str(item.get("back", "")).strip()
            if not front or not back:
                raise ValueError(f"La tarjeta {position} no tiene anverso o reverso.")
            normalized.append({"id": position, "front": front, "back": back})
            continue

        if artifact_type == "quiz":
            question = str(item.get("question", "")).strip()
            options = item.get("options")
            explanation = str(item.get("explanation", "")).strip()
            correct_index = item.get("correct_index")
            if (
                not question
                or not isinstance(options, list)
                or len(options) < 2
                or not all(str(option).strip() for option in options)
                or not isinstance(correct_index, int)
                or not 0 <= correct_index < len(options)
            ):
                raise ValueError(f"La pregunta {position} tiene una estructura inválida.")
            normalized.append(
                {
                    "id": position,
                    "question": question,
                    "options": [str(option).strip() for option in options],
                    "correct_index": correct_index,
                    "explanation": explanation,
                }
            )
            continue

        raise ValueError(f"Tipo de artefacto estructurado desconocido: {artifact_type}")

    return normalized


def studio_output_schema(artifact_type: str, count: int) -> Dict[str, Any]:
    """Build the JSON schema sent to Ollama for constrained Studio output."""
    if artifact_type == "flashcards":
        item_schema: Dict[str, Any] = {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "front": {"type": "string"},
                "back": {"type": "string"},
            },
            "required": ["id", "front", "back"],
            "additionalProperties": False,
        }
    elif artifact_type == "quiz":
        item_schema = {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "question": {"type": "string"},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 2,
                },
                "correct_index": {"type": "integer"},
                "explanation": {"type": "string"},
            },
            "required": ["id", "question", "options", "correct_index", "explanation"],
            "additionalProperties": False,
        }
    else:
        raise ValueError(f"No existe un esquema estructurado para {artifact_type}.")

    return {
        "type": "object",
        "properties": {
            "data": {
                "type": "array",
                "items": item_schema,
                "minItems": count,
                "maxItems": count,
            }
        },
        "required": ["data"],
        "additionalProperties": False,
    }
