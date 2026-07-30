import pickle
import sys
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from vector_storage import deserialize_embedding, serialize_embedding


class VectorStorageTests(unittest.TestCase):
    def test_versioned_raw_vector_round_trip(self):
        source = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        blob, dimension = serialize_embedding(source)
        restored = deserialize_embedding({"embedding": blob, "index_version": 2})
        self.assertEqual(dimension, 3)
        np.testing.assert_allclose(restored, source)

    def test_legacy_pickle_vector_remains_readable(self):
        source = np.array([1.0, 2.0], dtype=np.float64)
        restored = deserialize_embedding({"embedding": pickle.dumps(source), "index_version": 1})
        np.testing.assert_allclose(restored, source.astype(np.float32))


if __name__ == "__main__":
    unittest.main()
