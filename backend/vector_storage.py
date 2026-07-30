import pickle
from typing import Any

import numpy as np


CURRENT_INDEX_VERSION = 2


def serialize_embedding(embedding: Any) -> tuple[bytes, int]:
    vector = np.asarray(embedding, dtype=np.float32)
    return vector.tobytes(), vector.size


def deserialize_embedding(row: Any) -> np.ndarray:
    """Read both legacy pickle vectors and versioned raw float32 vectors."""
    keys = row.keys() if hasattr(row, "keys") else []
    version = row["index_version"] if "index_version" in keys else None
    if version and int(version) >= CURRENT_INDEX_VERSION:
        return np.frombuffer(row["embedding"], dtype=np.float32)
    return np.asarray(pickle.loads(row["embedding"]), dtype=np.float32)
