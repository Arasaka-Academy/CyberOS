"""Calibrate on labeled queries; report quality on a separate validation split.

Dataset: {images: [{id,path}], queries: [{text,split,relevant:[imageId,...]}]}.
An empty relevant list is an explicitly labeled negative query. No settings are saved.
"""
import argparse
import json
import math
from pathlib import Path
import time
import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--scores", type=Path, help="Reuse scores from a previous report without inference")
    args = parser.parse_args()
    data = json.loads(args.dataset.read_text())
    ids = {row["id"] for row in data["images"]}
    if len(ids) != len(data["images"]):
        raise ValueError("Duplicate image IDs")
    for row in data["queries"]:
        if row["split"] not in ("calibration", "validation") or not set(row["relevant"]).issubset(ids):
            raise ValueError("Invalid split or relevance labels")
    # Identical queries across splits leak calibration into validation.
    calibration_queries = {row["text"].strip() for row in data["queries"] if row["split"] == "calibration"}
    if any(row["text"].strip() in calibration_queries for row in data["queries"] if row["split"] == "validation"):
        raise ValueError("Calibration and validation queries must be distinct")
    if args.scores:
        previous = json.loads(args.scores.read_text())
        manifest, timings, scored = previous["model"], previous["imageSeconds"], previous["queries"]
        if [{key: row[key] for key in ("text", "split", "relevant")} for row in scored] != data["queries"]:
            raise ValueError("Saved scores do not match this labeled dataset")
        images = {row["id"]: None for row in data["images"]}
    else:
        headers = {"Authorization": "Bearer " + args.token_file.read_text().strip()}
        timings = []
        with httpx.Client(base_url=args.base_url.rstrip("/") + "/", headers=headers, timeout=120) as client:
            manifest_response = client.get("v1/model"); manifest_response.raise_for_status()
            manifest = manifest_response.json()
            def vector(response):
                response.raise_for_status()
                body = response.json()
                if body["embeddingSpaceId"] != manifest["embeddingSpaceId"] or body["dimensions"] != manifest["dimensions"]:
                    raise ValueError("Model version changed during evaluation")
                values = body["embeddings"][0]
                if len(values) != manifest["dimensions"] or not all(math.isfinite(value) for value in values) or abs(sum(value * value for value in values) - 1) > .01:
                    raise ValueError("Invalid normalized embedding")
                return values
            images = {}
            for image in data["images"]:
                started = time.monotonic()
                image_path = args.dataset.parent / image["path"]
                with image_path.open("rb") as source:
                    images[image["id"]] = vector(client.post("v1/embeddings/image", data={"model": manifest["model"]}, files={"image": (image_path.name, source)}))
                timings.append(time.monotonic() - started)
            scored = []
            for query in data["queries"]:
                query_vector = vector(client.post("v1/embeddings/text", json={"model": manifest["model"], "texts": [query["text"]]}))
                ranked = sorted(({"id": key, "similarity": sum(a*b for a,b in zip(query_vector, value))} for key, value in images.items()), key=lambda row: row["similarity"], reverse=True)
                scored.append({**query, "ranked": ranked})
    negatives = [row["ranked"][0]["similarity"] for row in scored if row["split"] == "calibration" and not row["relevant"]]
    if not negatives:
        raise ValueError("Calibration requires explicitly labeled negative queries")
    calibration = [row for row in scored if row["split"] == "calibration"]
    positives = [row for row in calibration if row["relevant"]]
    if not positives:
        raise ValueError("Calibration requires labeled positive queries")
    thresholds = sorted({-1., 1., *(min(1., item["similarity"] + 1e-6) for row in calibration for item in row["ranked"])})
    def quality(value):
        precision = []
        for row in positives:
            found = [item for item in row["ranked"] if item["similarity"] >= value][:10]
            precision.append(sum(item["id"] in row["relevant"] for item in found)/len(found) if found else 0.)
        return (sum(precision)/len(precision), sum(score > 0 for score in precision), -value)
    feasible = [value for value in thresholds if sum(score >= value for score in negatives)/len(negatives) <= .1]
    threshold = max(feasible, key=quality)
    report = {"model": manifest, "suggestedMinSimilarity": threshold, "imageCount": len(images), "imageSeconds": timings,
              "imagesPerSecond": len(timings) / sum(timings), "calibrationObjective": "maximize mean positive-query precision@10 with empty positives scored zero; negative false-match rate <= 0.1", "splits": {}, "queries": scored}
    for split in ("calibration", "validation"):
        positive_precision, negative_hits = [], []
        for row in scored:
            if row["split"] != split:
                continue
            found = [item for item in row["ranked"] if item["similarity"] >= threshold][:10]
            if row["relevant"]:
                positive_precision.append(sum(item["id"] in row["relevant"] for item in found) / len(found) if found else 0.)
            else:
                negative_hits.append(bool(found))
        report["splits"][split] = {"positiveQueries": len(positive_precision), "negativeQueries": len(negative_hits),
            "precisionAt10": sum(positive_precision)/len(positive_precision) if positive_precision else None,
            "negativeFalseMatchRate": sum(negative_hits)/len(negative_hits) if negative_hits else None}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key not in ("queries", "imageSeconds")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
