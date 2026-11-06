import { Worker } from "node:worker_threads";
import { CapabilityError } from "@cyberos/capabilities";

export interface GrepMatchPage {
  skipped: number;
  matches: Array<{ line: number; column: number; length: number; text: string }>;
}

// Regex evaluation must be interruptible even when V8 is backtracking inside a line.
const REGEX_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const regex = new RegExp(workerData.pattern, workerData.flags);
parentPort.on("message", ({ content, skip, limit }) => {
  const lines = content.split(/\\r?\\n/u);
  const matches = [];
  let skipped = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = regex.exec(lines[index]);
    if (!match) continue;
    if (skipped < skip) { skipped += 1; continue; }
    matches.push({ line: index + 1, column: match.index + 1,
      length: Math.max(1, match[0].length), text: lines[index].slice(0, 1000) });
    if (matches.length >= limit) break;
  }
  parentPort.postMessage({ skipped, matches });
});
`;

export class BoundedRegexMatcher {
  private readonly worker: Worker;
  private failure: CapabilityError | null = null;

  constructor(pattern: string, flags: string) {
    this.worker = new Worker(REGEX_WORKER, { eval: true, workerData: { pattern, flags } });
    this.worker.on("error", () => { this.failure = new CapabilityError("INTERNAL", "Regex search worker failed"); });
    this.worker.on("exit", () => { this.failure ??= new CapabilityError("INTERNAL", "Regex search worker stopped"); });
  }

  match(content: string, skip: number, limit: number, timeoutMs: number): Promise<GrepMatchPage> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.worker.off("message", onMessage);
        this.worker.off("error", onError);
        this.worker.off("exit", onExit);
      };
      const onMessage = (page: GrepMatchPage) => { cleanup(); resolve(page); };
      const onError = () => { cleanup(); reject(new CapabilityError("INTERNAL", "Regex search worker failed")); };
      const onExit = () => { cleanup(); reject(new CapabilityError("INTERNAL", "Regex search worker stopped")); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new CapabilityError("RATE_LIMITED", "File scan exceeded its time budget", { retryable: true }));
      }, Math.max(1, timeoutMs));
      this.worker.once("message", onMessage);
      this.worker.once("error", onError);
      this.worker.once("exit", onExit);
      this.worker.postMessage({ content, skip, limit });
    });
  }

  async close(): Promise<void> {
    await this.worker.terminate();
  }
}
