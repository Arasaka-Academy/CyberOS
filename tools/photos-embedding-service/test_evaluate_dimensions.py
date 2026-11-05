import math
import unittest
from evaluate_dimensions import compare
from service import ServiceConfig


class DimensionEvaluationTests(unittest.TestCase):
    def setUp(self):
        a, b = [1., 0.] + [0.] * 2046, [0., 1.] + [0.] * 2046
        negative = [-1 / math.sqrt(2)] * 2 + [0.] * 2046
        self.data = {"images": [{"id": "a"}, {"id": "b"}], "queries": [
            {"text": "a", "split": "calibration", "relevant": ["a"]},
            {"text": "none", "split": "calibration", "relevant": []},
            {"text": "b", "split": "validation", "relevant": ["b"]}]}
        self.capture = {"model": ServiceConfig().manifest(), "images": {"a": a, "b": b}, "texts": {"a": a, "none": negative, "b": b}}

    def test_uses_a_distinct_space_and_calibration_for_each_dimension(self):
        report = compare(self.data, self.capture, [256, 512, 2048])
        self.assertEqual(len({row["candidateEmbeddingSpaceId"] for row in report["results"]}), 3)
        for row in report["results"]:
            self.assertEqual(row["splits"]["validation"]["recall"], 1)
        # Validation labels never affect the chosen threshold.
        self.data["queries"][-1]["relevant"] = []
        changed = compare(self.data, self.capture, [256, 512, 2048])
        self.assertEqual([row["suggestedMinSimilarity"] for row in report["results"]], [row["suggestedMinSimilarity"] for row in changed["results"]])

    def test_rejects_an_incompatible_source_space(self):
        self.capture["model"]["embeddingSpaceId"] = "another"
        with self.assertRaises(ValueError):
            compare(self.data, self.capture, [512])


if __name__ == "__main__":
    unittest.main()
