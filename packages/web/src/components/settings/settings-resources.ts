import type { SettingsSectionId } from "../../config/settings.js";

const sectionResources = {
  overview: ["systemInfo"],
  version: ["buildInfo"],
  "model-providers": ["providers"],
  "pi-agent": ["policy"],
  docker: ["docker"],
  "virtual-machines": ["vm"],
  downloads: ["downloads"],
  indexer: ["indexerSettings", "indexerStatus"],
  photos: ["photoLibrary", "photoProcessing", "photoStatus"],
  wireless: ["network"],
  bluetooth: ["bluetooth"]
} as const satisfies Partial<Record<SettingsSectionId, readonly string[]>>;

export type SettingsResourceKey = (typeof sectionResources)[keyof typeof sectionResources][number];
export interface SettingsResourceState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}
export type SettingsResourceSnapshot = Record<SettingsResourceKey, SettingsResourceState>;

export function settingsSectionResources(section: SettingsSectionId | null): readonly SettingsResourceKey[] {
  return section && section in sectionResources ? sectionResources[section as keyof typeof sectionResources] : [];
}

function emptySnapshot(): SettingsResourceSnapshot {
  return Object.fromEntries(Object.values(sectionResources).flat().map(key => [key, { status: "idle", error: null }])) as SettingsResourceSnapshot;
}

export class SettingsResourceStore {
  private round = 0;
  private active = false;
  private snapshot = emptySnapshot();
  private attempts = new Map<SettingsResourceKey, symbol>();
  private listeners = new Set<() => void>();

  constructor(private readonly errorMessage: (error: unknown) => string) {}

  getSnapshot = (): SettingsResourceSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  begin(): void {
    this.round += 1;
    this.active = true;
    this.attempts.clear();
    this.snapshot = emptySnapshot();
    this.emit();
  }

  close(): void {
    this.active = false;
    this.round += 1;
    this.attempts.clear();
  }

  getRound(): number {
    return this.round;
  }

  isCurrent(round: number): boolean {
    return this.active && round === this.round;
  }

  invalidate(key: SettingsResourceKey): void {
    this.attempts.delete(key);
    this.update(key, { status: "idle", error: null });
  }

  async load<Value>(key: SettingsResourceKey, request: () => Promise<Value>, apply: (value: Value) => void): Promise<void> {
    if (!this.active || this.snapshot[key].status !== "idle") return;
    const round = this.round;
    const attempt = Symbol(key);
    this.attempts.set(key, attempt);
    this.update(key, { status: "loading", error: null });
    const current = () => this.isCurrent(round) && this.attempts.get(key) === attempt;
    try {
      const value = await request();
      if (!current()) return;
      apply(value);
      this.update(key, { status: "ready", error: null });
    } catch (error) {
      if (current()) this.update(key, { status: "error", error: this.errorMessage(error) });
    }
  }

  private update(key: SettingsResourceKey, state: SettingsResourceState): void {
    this.snapshot = { ...this.snapshot, [key]: state };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function shareInFlight<Value>(request: () => Promise<Value>): () => Promise<Value> {
  let pending: Promise<Value> | null = null;
  return () => {
    pending ??= request().finally(() => { pending = null; });
    return pending;
  };
}
