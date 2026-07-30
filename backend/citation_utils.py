import re


EXPLICIT_WEB_PATTERN = re.compile(r"\[(?:fuente\s+)?web\s*#?\s*(\d+)\]", re.IGNORECASE)
EXPLICIT_LOCAL_PATTERN = re.compile(r"\[(?:fuente\s+)?(?:local|cita)\s*#?\s*(\d+)\]", re.IGNORECASE)
GROUPED_CITATION_PATTERN = re.compile(
    r"\[((?:[LW]\s*)?\d+(?:\s*[,;]\s*(?:[LW]\s*)?\d+)+)\](?!\s*\()",
    re.IGNORECASE,
)
SINGLE_NUMERIC_PATTERN = re.compile(r"\[(\d+)\](?!\s*\()")


def normalize_citation_groups(text: str, default_namespace: str | None = None) -> str:
    """Normalize local/web citation aliases and split grouped model citations."""
    if not text:
        return text

    normalized = EXPLICIT_WEB_PATTERN.sub(r"[W\1]", text)
    normalized = EXPLICIT_LOCAL_PATTERN.sub(r"[L\1]", normalized)

    def replace_group(match: re.Match[str]) -> str:
        tokens = re.findall(r"([LW]?)\s*(\d+)", match.group(1), re.IGNORECASE)
        inherited_namespace = next((prefix.upper() for prefix, _number in tokens if prefix), "")
        markers = []
        for prefix, number in tokens:
            namespace = prefix.upper() or inherited_namespace
            marker = f"{namespace}{number}"
            if marker not in markers:
                markers.append(marker)
        return "".join(f"[{marker}]" for marker in markers)

    normalized = GROUPED_CITATION_PATTERN.sub(replace_group, normalized)

    namespace = (default_namespace or "").upper()
    if namespace in {"L", "W"}:
        normalized = SINGLE_NUMERIC_PATTERN.sub(lambda match: f"[{namespace}{match.group(1)}]", normalized)

    return normalized
