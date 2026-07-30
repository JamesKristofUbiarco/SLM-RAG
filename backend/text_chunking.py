from typing import List


def chunk_text_by_characters(text: str, size: int, overlap: int) -> List[str]:
    """Create bounded, word-aware chunks with a real character overlap."""
    if not text or not text.strip():
        return []
    size = max(1, size)
    overlap = max(0, min(overlap, size - 1))

    words: list[str] = []
    for token in text.split():
        if len(token) <= size:
            words.append(token)
        else:
            words.extend(token[index:index + size] for index in range(0, len(token), size))

    chunks: list[str] = []
    start = 0
    while start < len(words):
        end = start
        length = 0
        while end < len(words):
            added = len(words[end]) + (1 if end > start else 0)
            if end > start and length + added > size:
                break
            length += added
            end += 1

        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break

        next_start = end
        overlap_length = 0
        while next_start > start + 1:
            candidate = len(words[next_start - 1]) + (1 if overlap_length else 0)
            if overlap_length + candidate > overlap:
                break
            overlap_length += candidate
            next_start -= 1
        start = next_start if next_start > start else start + 1

    return chunks
