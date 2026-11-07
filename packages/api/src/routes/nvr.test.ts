import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { loadCyberOsRuntime, NvrError } from "@cyberos/shared";
import { registerNvrRoutes } from "./nvr.js";

describe("NVR local service adapter", () => {
  it("forwards commands and authentication failures, preserving recording independence", async () => {
    const server = Fastify();
    const command = vi.fn().mockResolvedValue({ id: "stable-camera-uuid", credentialsConfigured: true });
    registerNvrRoutes(server, { config: loadCyberOsRuntime({}), nvr: { command } });
    try {
      const response = await server.inject({ method: "POST", url: "/api/nvr/devices", payload: { name: "Camera", onvifUrl: "http://camera/onvif/device_service", username: "viewer", password: "private-secret" } });
      expect(response.statusCode).toBe(201);
      expect(command).toHaveBeenCalledWith("POST", "/nvr/devices", expect.objectContaining({ password: "private-secret" }));
      expect(response.body).not.toContain("private-secret");
      command.mockRejectedValueOnce(new NvrError("Camera authentication failed", 401));
      expect((await server.inject({ method: "POST", url: "/api/nvr/devices", payload: {} })).statusCode).toBe(401);
      command.mockResolvedValueOnce(undefined);
      expect((await server.inject({ method: "POST", url: "/api/nvr/devices/camera/ptz", payload: { action: "stop" } })).statusCode).toBe(204);
      command.mockClear();
      await server.close();
      expect(command).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
  it("rejects oversized credential payloads and similarly named routes", async () => {
    const server = Fastify(); const command = vi.fn();
    registerNvrRoutes(server, { config: loadCyberOsRuntime({}), nvr: { command } });
    try {
      expect((await server.inject({ method: "POST", url: "/api/nvr/devices", payload: { password: "x".repeat(17000) } })).statusCode).toBe(413);
      expect((await server.inject({ method: "GET", url: "/api/nvr-other" })).statusCode).toBe(404);
      expect(command).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
});
