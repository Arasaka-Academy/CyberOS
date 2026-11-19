/**
 * [INPUT]: 依赖受限 hostd TV 命令与已校验的输出选择。
 * [OUTPUT]: 提供模式启停和独立输出重配运行时。
 * [POS]: HTTP 设置到宿主 TV 脚本的固定协议适配器。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { HostdClient } from "./hostd-client.js";

const TV_MODE_TIMEOUT_MS = 165_000;

export interface TvModeRuntime {
  apply(enabled: boolean, drmConnector?: string | null): Promise<void>;
  reconfigure?(drmConnector: string | null): Promise<void>;
}

export class HostdTvModeRuntime implements TvModeRuntime {
  private readonly client: HostdClient;

  constructor(socketPath: string) {
    this.client = new HostdClient(socketPath);
  }

  async apply(enabled: boolean, drmConnector?: string | null): Promise<void> {
    await this.client.request(
      "system.tv",
      { enabled, confirmed: true, ...(drmConnector !== null && drmConnector !== undefined ? { drmConnector } : {}) },
      TV_MODE_TIMEOUT_MS
    );
  }

  async reconfigure(drmConnector: string | null): Promise<void> {
    await this.client.request("system.tv", { enabled: true, confirmed: true, reconfigure: true, ...(drmConnector !== null ? { drmConnector } : {}) }, TV_MODE_TIMEOUT_MS * 2);
  }
}
