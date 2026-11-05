"""Compare MRL dimensions offline using the same captured full-width vectors.

Input: {model: manifest, profile: ServiceConfig fields, images: {id: vector},
        texts: {query: vector}}. Thresholds use calibration labels only. This is
an exploratory comparison; choose a candidate before an independent API test.
"""
import argparse
from dataclasses import replace
import json
import math
from pathlib import Path
from evaluate_api import summarize, validate_dataset
from service import ServiceConfig, project_embeddings


def compare(data, captured, dimensions):
    ids = validate_dataset(data)
    config = ServiceConfig(**captured.get("profile", {}))
    if config.dimensions != 2048 or captured["model"]["embeddingSpaceId"] != config.embedding_space_id:
        raise ValueError("Capture must use the declared full-width 2048D model profile")
    if set(captured["images"]) != ids or not {row["text"] for row in data["queries"]}.issubset(captured["texts"]):
        raise ValueError("Captured vectors do not cover the labeled dataset")
    for vector in [*captured["images"].values(), *captured["texts"].values()]:
        if len(vector) != 2048 or not all(math.isfinite(value) for value in vector) or abs(sum(value * value for value in vector) - 1) > .01:
            raise ValueError("Invalid full-width normalized source vector")
    reports = []
    for dimension in dimensions:
        if not 64 <= dimension <= 2048:
            raise ValueError("Dimensions must be 64..2048")
        images = {key: project_embeddings([value], dimension)[0] for key, value in captured["images"].items()}
        rows = []
        for query in data["queries"]:
            vector = project_embeddings([captured["texts"][query["text"]]], dimension)[0]
            ranked = sorted(({"id": key, "similarity": sum(a * b for a, b in zip(vector, image))} for key, image in images.items()), key=lambda row: (-row["similarity"], row["id"]))
            rows.append({**query, "ranked": ranked})
        calibration = [row for row in rows if row["split"] == "calibration"]
        negatives = [row["ranked"][0]["similarity"] for row in calibration if not row["relevant"]]
        if not negatives or not any(row["relevant"] for row in calibration):
            raise ValueError("Calibration requires positive and negative queries")
        thresholds = sorted({-1., 1., *(min(1., item["similarity"] + 1e-6) for row in calibration for item in row["ranked"])})
        def selected(row, threshold):
            return {**row, "ids": [item["id"] for item in row["ranked"] if item["similarity"] >= threshold], "firstPageMs": 0}
        def objective(threshold):
            quality = summarize([selected(row, threshold) for row in calibration])
            return quality["precisionAt10"], quality["recall"], -threshold
        feasible = [value for value in thresholds if sum(score >= value for score in negatives) / len(negatives) <= .1]
        if not feasible:
            raise ValueError("No threshold satisfies calibration negative false-match constraint")
        threshold = max(feasible, key=objective)
        reports.append({"dimensions": dimension, "candidateEmbeddingSpaceId": replace(config, dimensions=dimension).embedding_space_id,
            "suggestedMinSimilarity": threshold, "splits": {split: summarize([selected(row, threshold) for row in rows if row["split"] == split]) for split in ("calibration", "validation")}})
    return {"sourceEmbeddingSpaceId": config.embedding_space_id, "imageCount": len(ids),
            "comparison": "exploratory prefix projection; each dimension calibrated independently; no runtime settings changed", "results": reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("vectors", type=Path)
    parser.add_argument("--dimensions", nargs="+", type=int, default=[256, 512, 1024, 2048])
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = compare(json.loads(args.dataset.read_text()), json.loads(args.vectors.read_text()), args.dimensions)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
