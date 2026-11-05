"""Private, single-model embedding service for CyberOS Photos."""
import argparse
import asyncio
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
import hashlib
import hmac
import io
import itertools
import json
import logging
import math
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field

PROTOCOL = "cyberos-photos-embedding/v1"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_777_216


@dataclass(frozen=True)
class ServiceConfig:
    model: str = "Qwen/Qwen3-VL-Embedding-2B"
    revision: str = "9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda"
    dimensions: int = 2048
    max_pixels: int = 768 * 768
    instruction: str = "Represent the user's input."
    backend_version: str = "0.1.0"
    pipeline_version: int = 2
    min_pixels: int = 4096
    max_length: int = 8192
    runtime_fingerprint: str = "b2f316df3402ee63721dbb6149fb1f2e9c5c6a434a9ca64091049a900091a9ee"

    @property
    def embedding_space_id(self):
        payload = {**asdict(self), "pooling": "last_non_padding_token", "normalization": "l2",
                   "backend": "mlx-embeddings", "weight_quantization": None, "request_state": "fresh_rope_positions_v1"}
        if self.dimensions != 2048:
            payload["projection"] = "prefix_then_l2_v1"
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def manifest(self):
        return {"protocol": PROTOCOL, "model": self.model, "revision": self.revision,
                "dimensions": self.dimensions, "embeddingSpaceId": self.embedding_space_id,
                "normalized": True, "modalities": ["text", "image"]}


class InferenceQueue:
    def __init__(self, infer, capacity=32):
        self.infer = infer
        self.queue = asyncio.PriorityQueue(maxsize=capacity)
        self.sequence = itertools.count()
        self.task = None

    async def start(self):
        self.task = asyncio.create_task(self.run())

    async def close(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        while not self.queue.empty():
            _, _, _, future = self.queue.get_nowait()
            if not future.done():
                future.cancel()

    async def submit(self, value, priority, request=None):
        future = asyncio.get_running_loop().create_future()
        try:
            self.queue.put_nowait((priority, next(self.sequence), value, future))
        except asyncio.QueueFull as error:
            raise HTTPException(429, "Inference queue is full", headers={"Retry-After": "1"}) from error
        if request is None:
            return await future
        async def disconnected():
            while not await request.is_disconnected():
                await asyncio.sleep(.1)
        monitor = asyncio.create_task(disconnected())
        try:
            await asyncio.wait((future, monitor), return_when=asyncio.FIRST_COMPLETED)
            if future.done():
                return await future
            raise HTTPException(499, "Request cancelled")
        finally:
            monitor.cancel()
            if not future.done():
                future.cancel()

    async def run(self):
        while True:
            _, _, value, future = await self.queue.get()
            try:
                if future.cancelled():
                    continue
                result = await self.infer(value)
                if not future.done():
                    future.set_result(result)
            except Exception as error:
                if not future.done():
                    future.set_exception(error)
            finally:
                self.queue.task_done()


class TextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str
    texts: list[Annotated[str, Field(min_length=1, max_length=512)]] = Field(min_length=1, max_length=16)


class BodyLimitMiddleware:
    """Bound chunked multipart uploads before Starlette can spool them to disk."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = MAX_IMAGE_BYTES + 65536 if scope["path"] == "/v1/embeddings/image" else 65536
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise HTTPException(413, "Request body is too large")
            return message

        await self.app(scope, limited_receive, send)


def validated_vectors(vectors, count, dimensions):
    if len(vectors) != count:
        raise ValueError("Embedding response count is invalid")
    result = []
    for vector in vectors:
        if len(vector) != dimensions or any(not math.isfinite(value) for value in vector):
            raise ValueError("Embedding dimensions or values are invalid")
        norm = math.sqrt(sum(value * value for value in vector))
        if not math.isfinite(norm) or norm < 1e-8:
            raise ValueError("Embedding norm is invalid")
        result.append([value / norm for value in vector])
    return result


def create_app(config, token, backend):
    if not token:
        raise ValueError("A service API token is required")

    async def infer(inputs):
        try:
            vectors = await asyncio.to_thread(backend.embed, inputs)
            return {"embeddingSpaceId": config.embedding_space_id, "dimensions": config.dimensions,
                    "embeddings": validated_vectors(vectors, len(inputs), config.dimensions)}
        except Exception as error:
            logging.getLogger("photos-embedding").exception("Model inference failed")
            # Never echo model internals, paths, request contents or credentials.
            raise HTTPException(502, "Model inference failed") from error

    queue = InferenceQueue(infer)

    @asynccontextmanager
    async def lifespan(_app):
        await queue.start()
        try:
            yield
        finally:
            await queue.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimitMiddleware)

    def authenticate(authorization: Annotated[str | None, Header()] = None):
        supplied = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else ""
        if not hmac.compare_digest(supplied.encode(), token.encode()):
            raise HTTPException(401, "Invalid API token")

    def check_model(model):
        if model != config.model:
            raise HTTPException(409, "Requested model is not loaded")

    @app.get("/healthz")
    async def health():
        return {"ready": True}

    @app.get("/v1/model", dependencies=[Depends(authenticate)])
    async def model():
        return config.manifest()

    @app.post("/v1/embeddings/text", dependencies=[Depends(authenticate)])
    async def text(body: TextInput, request: Request):
        check_model(body.model)
        if any(not value.strip() for value in body.texts):
            raise HTTPException(400, "Text must not be blank")
        return await queue.submit([{"text": value, "instruction": config.instruction} for value in body.texts], priority=0, request=request)

    @app.post("/v1/embeddings/image", dependencies=[Depends(authenticate)])
    async def image(request: Request):
        length = request.headers.get("content-length")
        if length and (not length.isdecimal() or int(length) > MAX_IMAGE_BYTES + 65536):
            raise HTTPException(413, "Image upload is too large")
        async with request.form(max_files=1, max_fields=1, max_part_size=MAX_IMAGE_BYTES) as form:
            check_model(form.get("model"))
            upload = form.get("image")
            if upload is None or not hasattr(upload, "read"):
                raise HTTPException(400, "One image upload is required")
            content = await upload.read(MAX_IMAGE_BYTES + 1)
            if len(content) > MAX_IMAGE_BYTES:
                raise HTTPException(413, "Image upload is too large")
            try:
                with Image.open(io.BytesIO(content)) as source:
                    source.load()
                    picture = ImageOps.exif_transpose(source).convert("RGB")
                scale = min(1, math.sqrt(config.max_pixels / (picture.width * picture.height)))
                if scale < 1:
                    picture = picture.resize((max(1, int(picture.width * scale)), max(1, int(picture.height * scale))), Image.Resampling.LANCZOS)
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
                raise HTTPException(400, "Invalid image") from error
        return await queue.submit([{"image": picture, "instruction": config.instruction}], priority=1, request=request)

    return app


class MlxBackend:
    def __init__(self, model_path, config):
        if not 64 <= config.dimensions <= 2048:
            raise ValueError("Qwen3-VL-Embedding-2B dimensions must be 64..2048")
        self.dimensions = config.dimensions
        from importlib.metadata import version
        from mlx_embeddings import load
        if version("mlx-embeddings") != config.backend_version:
            raise ValueError("Installed MLX runtime does not match the embedding profile")
        lock = Path(__file__).with_name("requirements.lock")
        if hashlib.sha256(lock.read_bytes()).hexdigest() != config.runtime_fingerprint:
            raise ValueError("Runtime lock does not match the embedding profile")
        for line in lock.read_text().splitlines():
            name, expected = line.split("==")
            if version(name) != expected:
                raise ValueError(f"Installed runtime does not match the lock: {name}")
        self.model, self.processor = load(model_path)
        self.processor.max_pixels = config.max_pixels
        self.processor.min_pixels = config.min_pixels
        self.processor.embedding_max_length = config.max_length

    def embed(self, inputs):
        import mlx.core as mx
        # Independent embedding requests must not reuse autoregressive RoPE
        # state. mlx-embeddings 0.1.0 can reuse an earlier request's 2D position
        # IDs as a 3D array, or silently reuse image positions for later text.
        language_model = self.model.language_model
        language_model._position_ids = None
        language_model._rope_deltas = None
        try:
            embeddings = self.model.process(inputs, processor=self.processor)
            mx.eval(embeddings)
            return project_embeddings(embeddings.astype(mx.float32).tolist(), self.dimensions)
        finally:
            language_model._position_ids = None
            language_model._rope_deltas = None
            mx.clear_cache()


def project_embeddings(vectors, dimensions):
    """MRL prefix projection; images and text use the same dimension and norm."""
    result = []
    for vector in vectors:
        if dimensions < 1 or len(vector) < dimensions or not all(math.isfinite(value) for value in vector):
            raise ValueError("Invalid source embedding for projection")
        prefix = vector[:dimensions]
        norm = math.sqrt(sum(value * value for value in prefix))
        if norm == 0:
            raise ValueError("Embedding prefix has zero norm")
        result.append([value / norm for value in prefix])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    settings = json.loads(args.config.read_text())
    token = Path(settings["tokenFile"]).read_text().strip()
    config = ServiceConfig(**settings.get("profile", {}))
    backend = MlxBackend(settings["modelPath"], config)
    # Warm up before advertising readiness. One process owns the model.
    validated_vectors(backend.embed([{"text": "photo", "instruction": config.instruction}]), 1, config.dimensions)
    import uvicorn
    uvicorn.run(create_app(config, token, backend), host="127.0.0.1", port=8766, workers=1, access_log=False)


if __name__ == "__main__":
    main()
