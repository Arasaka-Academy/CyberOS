import asyncio
import io
import unittest

import httpx
from PIL import Image

from service import ServiceConfig, create_app, InferenceQueue, MAX_IMAGE_BYTES


class Backend:
    def embed(self, inputs):
        return [[1.0, 0.0] for _ in inputs]


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.config = ServiceConfig(model="test/model", revision="test-revision", dimensions=2)
        self.app = create_app(self.config, "test-secret", Backend())
        self.lifespan = self.app.router.lifespan_context(self.app)
        await self.lifespan.__aenter__()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.headers = {"Authorization": "Bearer test-secret"}

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.lifespan.__aexit__(None, None, None)

    async def test_authentication_and_shared_vector_space(self):
        self.assertEqual((await self.client.get("/v1/model")).status_code, 401)
        manifest = (await self.client.get("/v1/model", headers=self.headers)).json()
        text = await self.client.post("/v1/embeddings/text", headers=self.headers,
                                      json={"model": "test/model", "texts": ["海边的狗"]})
        image = io.BytesIO()
        Image.new("RGB", (64, 64), "red").save(image, format="JPEG")
        photo = await self.client.post("/v1/embeddings/image", headers=self.headers,
                                       data={"model": "test/model"}, files={"image": ("image.jpg", image.getvalue(), "image/jpeg")})
        self.assertEqual(text.status_code, 200, text.text)
        self.assertEqual(photo.status_code, 200, photo.text)
        for response in (text, photo):
            self.assertEqual(response.json()["embeddingSpaceId"], manifest["embeddingSpaceId"])
            self.assertEqual(response.json()["embeddings"], [[1.0, 0.0]])
        self.assertNotIn("test-secret", str(manifest))

    async def test_rejects_wrong_model_and_invalid_images(self):
        response = await self.client.post("/v1/embeddings/text", headers=self.headers,
                                          json={"model": "another", "texts": ["dog"]})
        self.assertEqual(response.status_code, 409)
        response = await self.client.post("/v1/embeddings/image", headers=self.headers,
                                          data={"model": "test/model"}, files={"image": ("bad.jpg", b"invalid", "image/jpeg")})
        self.assertEqual(response.status_code, 400)

    async def test_invalid_model_vectors_do_not_escape_as_success(self):
        class InvalidBackend:
            def embed(self, inputs):
                return [[float("nan"), 0.0]]
        app = create_app(self.config, "test-secret", InvalidBackend())
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/v1/embeddings/text", headers=self.headers,
                                             json={"model": "test/model", "texts": ["dog"]})
                self.assertEqual(response.status_code, 502)

    async def test_chunked_upload_is_bounded_before_spooling(self):
        async def chunks():
            yield b'--boundary\r\nContent-Disposition: form-data; name="image"; filename="large.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'
            for _ in range(MAX_IMAGE_BYTES // 65536 + 2):
                yield b"x" * 65536
            yield b"\r\n--boundary--\r\n"
        response = await self.client.post("/v1/embeddings/image", headers={**self.headers,
                                          "Content-Type": "multipart/form-data; boundary=boundary"}, content=chunks())
        self.assertEqual(response.status_code, 413)

    async def test_text_is_scheduled_before_waiting_images(self):
        started = asyncio.Event()
        release = asyncio.Event()
        seen = []
        async def infer(value):
            seen.append(value)
            if value == "running-image":
                started.set()
                await release.wait()
            return value
        queue = InferenceQueue(infer)
        await queue.start()
        try:
            first = asyncio.create_task(queue.submit("running-image", priority=1))
            await started.wait()
            second = asyncio.create_task(queue.submit("waiting-image", priority=1))
            text = asyncio.create_task(queue.submit("text", priority=0))
            await asyncio.sleep(0)
            release.set()
            await asyncio.gather(first, second, text)
            self.assertEqual(seen, ["running-image", "text", "waiting-image"])
        finally:
            await queue.close()

    def test_embedding_identity_changes_with_preprocessing(self):
        changed = ServiceConfig(model="test/model", revision="test-revision", dimensions=2, max_pixels=262144)
        self.assertNotEqual(changed.embedding_space_id, self.config.embedding_space_id)


if __name__ == "__main__":
    unittest.main()
