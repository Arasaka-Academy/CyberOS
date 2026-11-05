"""Compare saved MLX output against Qwen's pinned official implementation.

Run each backend in a separate process to bound unified memory on a 16GB Mac.
The official file must be downloaded separately from QwenLM/Qwen3-VL-Embedding
commit 393e2978d27852b0d0230d6994f37f9c15bed73c into this directory.
"""
import argparse
import json
import math
from pathlib import Path
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("backend", choices=["mlx", "reference", "compare"])
    parser.add_argument("--model", default="model")
    args = parser.parse_args()
    if args.backend == "compare":
        mlx = json.loads(Path("mlx-reference-vectors.json").read_text())
        reference = json.loads(Path("official-reference-vectors.json").read_text())
        cosine = [sum(a*b for a,b in zip(left, right)) for left,right in zip(mlx, reference)]
        if len(cosine) != 3 or min(cosine) < .99:
            raise ValueError(f"Official reference mismatch: {cosine}")
        report = {"officialCommit": "393e2978d27852b0d0230d6994f37f9c15bed73c", "samples": ["Chinese scene", "Chinese description", "RGB image"], "cosine": cosine, "minimumCosine": .99}
        Path("reference-comparison.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2)); return
    inputs = [{"text": "海边的日落"}, {"text": "一只猫坐在窗户旁边"}, {"image": Image.new("RGB", (224, 224), "blue")}]
    if args.backend == "mlx":
        from service import MlxBackend, ServiceConfig, validated_vectors
        backend = MlxBackend(args.model, ServiceConfig())
        vectors = [validated_vectors(backend.embed([{**item, "instruction": ServiceConfig().instruction}]), 1, 2048)[0] for item in inputs]
        name = "mlx-reference-vectors.json"
    else:
        import torch
        from qwen3_vl_embedding_reference import Qwen3VLEmbedder
        torch.set_num_threads(4)
        backend = Qwen3VLEmbedder(args.model, dtype=torch.float32, attn_implementation="eager", min_pixels=4096, max_pixels=768*768)
        vectors = [backend.process([item])[0].float().tolist() for item in inputs]
        name = "official-reference-vectors.json"
    if any(len(vector) != 2048 or abs(math.hypot(*vector) - 1) > .01 for vector in vectors):
        raise ValueError("Invalid reference vectors")
    Path(name).write_text(json.dumps(vectors) + "\n")
    print(f"Saved {len(vectors)} normalized 2048D vectors from {args.backend}")


if __name__ == "__main__":
    main()
