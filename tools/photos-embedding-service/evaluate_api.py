"""Evaluate the final CyberOS hybrid API, including every page and recall.

Run against a dedicated, fully labeled test library with smart search enabled.
This tool is read-only: choose a threshold on calibration data first, then freeze
it before evaluating validation. Dataset IDs must be the actual Photos asset IDs.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import httpx


def validate_dataset(data):
    ids = {row["id"] for row in data["images"]}
    if not ids or len(ids) != len(data["images"]):
        raise ValueError("Image IDs must be nonempty and unique")
    seen = set()
    for row in data["queries"]:
        text = row["text"].strip()
        if not text or text in seen or row["split"] not in ("calibration", "validation") or not set(row["relevant"]).issubset(ids):
            raise ValueError("Queries must be distinct across splits with valid labels")
        seen.add(text)
    return ids


def collect_query(client, query, ids, space):
    request = {"filters": {**query.get("filters", {}), "text": query["text"]}, "limit": 100, "includeFacets": True}
    found, cursors, total, facets = [], set(), None, None
    started = time.monotonic()
    first_page_ms = None
    while True:
        response = client.post("api/photos/query", json=request)
        response.raise_for_status()
        page = response.json()
        if first_page_ms is None:
            first_page_ms = (time.monotonic() - started) * 1000
        search = page.get("search", {})
        if search.get("mode") != "hybrid" or search.get("embeddingSpaceId") != space:
            raise ValueError(f"API did not return the expected hybrid model space for {query['text']!r}: {search}")
        if total is None:
            total, facets = page["total"], page.get("facets")
        if page["total"] != total or page.get("facets") != facets:
            raise ValueError("Counts or facets changed within a search snapshot")
        batch = [row["id"] for row in page["photos"]]
        if not set(batch).issubset(ids):
            raise ValueError("Results contain unlabeled photos; use an isolated labeled library")
        found.extend(batch)
        if len(found) != len(set(found)) or len(found) > total:
            raise ValueError("Pagination duplicated photos or exceeded the total")
        cursor = page.get("nextCursor")
        if not cursor:
            break
        if not batch or cursor in cursors:
            raise ValueError("Pagination did not advance")
        cursors.add(cursor)
        request["cursor"] = cursor
    if len(found) != total:
        raise ValueError("Pagination did not expose the complete result set")
    return {**query, "ids": found, "total": total, "facets": facets,
            "firstPageMs": first_page_ms, "allPagesMs": (time.monotonic() - started) * 1000}


def summarize(rows):
    positive = [row for row in rows if row["relevant"]]
    negative = [row for row in rows if not row["relevant"]]
    def mean(values):
        return sum(values) / len(values) if values else None
    precision, recall10, recall = [], [], []
    for row in positive:
        relevant, first = set(row["relevant"]), row["ids"][:10]
        precision.append(sum(item in relevant for item in first) / len(first) if first else 0.)
        recall10.append(len(set(first) & relevant) / len(relevant))
        recall.append(len(set(row["ids"]) & relevant) / len(relevant))
    times = sorted(row["firstPageMs"] for row in rows)
    return {"positiveQueries": len(positive), "negativeQueries": len(negative),
            "precisionAt10": mean(precision), "recallAt10": mean(recall10), "recall": mean(recall),
            "positiveZeroResultRate": mean([not row["ids"] for row in positive]),
            "negativeFalseMatchRate": mean([bool(row["ids"]) for row in negative]),
            "firstPageP95Ms": times[math.ceil(len(times) * .95) - 1] if times else None}


def evaluate(client, data, split):
    ids = validate_dataset(data)
    response = client.get("api/settings/photos/semantic-search")
    response.raise_for_status()
    settings, status = response.json()["settings"], response.json()["status"]
    if not settings["enabled"] or status["indexed"] != len(ids) or status["total"] != len(ids):
        raise ValueError("Use a fully indexed test library matching the labeled image inventory")
    space = status["embeddingSpaceId"]
    rows = [collect_query(client, row, ids, space) for row in data["queries"] if split == "all" or row["split"] == split]
    if not rows:
        raise ValueError("No queries in the selected split")
    return {"model": {key: settings[key] for key in ("model", "embeddingSpaceId", "dimensions", "minSimilarity")},
            "imageCount": len(ids), "datasetSha256": hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
            "precisionDenominator": "returned results up to 10; an empty positive query scores zero",
            "splits": {name: summarize([row for row in rows if row["split"] == name]) for name in ("calibration", "validation")},
            "queries": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--base-url", required=True, help="CyberOS test API, usually a loopback URL or SSH forward")
    parser.add_argument("--split", choices=("calibration", "validation", "all"), default="validation")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    with httpx.Client(base_url=args.base_url.rstrip("/") + "/", timeout=30) as client:
        report = evaluate(client, json.loads(args.dataset.read_text()), args.split)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "queries"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
