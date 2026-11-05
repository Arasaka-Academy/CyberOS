import json
import unittest
import httpx
from evaluate_api import collect_query, evaluate, summarize, validate_dataset


class EvaluationTests(unittest.TestCase):
    def test_reports_recall_beyond_first_ten_and_penalizes_empty_positives(self):
        rows = [
            {"relevant": ["0", "11"], "ids": [str(n) for n in range(12)], "firstPageMs": 10},
            {"relevant": ["x"], "ids": [], "firstPageMs": 20},
            {"relevant": [], "ids": ["wrong"], "firstPageMs": 30},
        ]
        metrics = summarize(rows)
        self.assertEqual(metrics["precisionAt10"], .05)
        self.assertEqual(metrics["recallAt10"], .25)
        self.assertEqual(metrics["recall"], .5)
        self.assertEqual(metrics["positiveZeroResultRate"], .5)
        self.assertEqual(metrics["negativeFalseMatchRate"], 1)
        self.assertEqual(metrics["firstPageP95Ms"], 30)

    def test_traverses_all_pages_with_consistent_filters_and_counts(self):
        calls = []
        def respond(request):
            body = json.loads(request.content)
            calls.append(body)
            return httpx.Response(200, json={"photos": [{"id": "b" if body.get("cursor") else "a"}], "total": 2,
                "nextCursor": None if body.get("cursor") else "page2", "facets": {"keywords": []},
                "search": {"mode": "hybrid", "embeddingSpaceId": "space"}})
        with httpx.Client(transport=httpx.MockTransport(respond), base_url="http://test/") as client:
            row = collect_query(client, {"text": "海边", "filters": {"rating": {"min": 4}}, "relevant": ["b"]}, {"a", "b"}, "space")
        self.assertEqual(row["ids"], ["a", "b"])
        self.assertEqual(calls[0]["filters"], calls[1]["filters"])
        self.assertEqual(summarize([row])["recall"], 1)

    def test_rejects_duplicated_pages_instead_of_reporting_false_recall(self):
        def respond(_request):
            return httpx.Response(200, json={"photos": [{"id": "a"}], "total": 2, "nextCursor": "same", "facets": {},
                "search": {"mode": "hybrid", "embeddingSpaceId": "space"}})
        with httpx.Client(transport=httpx.MockTransport(respond), base_url="http://test/") as client:
            with self.assertRaisesRegex(ValueError, "duplicated"):
                collect_query(client, {"text": "海边", "relevant": ["a"]}, {"a"}, "space")

    def test_rejects_unlabeled_corpus_and_cross_split_leakage(self):
        data = {"images": [{"id": "a"}], "queries": [{"text": "same", "split": "calibration", "relevant": []},
            {"text": "same", "split": "validation", "relevant": []}]}
        with self.assertRaises(ValueError):
            validate_dataset(data)
        data["queries"].pop()
        def respond(_request):
            return httpx.Response(200, json={"settings": {"enabled": True}, "status": {"total": 2, "indexed": 2}})
        with httpx.Client(transport=httpx.MockTransport(respond), base_url="http://test/") as client:
            with self.assertRaisesRegex(ValueError, "fully indexed test library"):
                evaluate(client, data, "calibration")


if __name__ == "__main__":
    unittest.main()
