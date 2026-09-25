/**
 * adapters/models/unavailable.ts — Stub model adapter for when no model is configured.
 * Returns explicit unavailability — never silently falls back.
 */
import type { ModelPort, ModelRequest, ModelResult } from "../../ports/index.js";

export class UnavailableModelAdapter implements ModelPort {
  private readonly reason: string;

  constructor(reason: string = "No permitted model configured") {
    this.reason = reason;
  }

  getModelId(): string { return "unavailable"; }
  getProvider(): string { return "none"; }
  isAvailable(): boolean { return false; }

  async complete(_request: ModelRequest): Promise<ModelResult> {
    return {
      ok: false,
      failure: {
        provider: "none",
        modelId: "unavailable",
        errorKind: "policy_denied",
        message: this.reason,
        retryable: false,
      },
    };
  }
}
