/**
 * ports/model.ts — Provider-neutral interface for LLM calls.
 * A prompt goes in; unknown comes out and must be validated.
 */
export interface ModelRequest {
  promptVersion: string;
  systemPrompt: string;
  userContent: string;
  maxResponseTokens: number;
  timeoutMs: number;
  /** Arbitrary model parameters for reproducibility recording */
  parameters: Record<string, unknown>;
}

export interface ModelResponse {
  provider: string;
  modelId: string;
  promptVersion: string;
  parameters: Record<string, unknown>;
  /** Raw, unparsed model output — must be validated before use */
  rawOutput: unknown;
  usageTokens?: {
    prompt?: number;
    completion?: number;
  };
  latencyMs: number;
}

export interface ModelFailure {
  provider: string;
  modelId: string;
  errorKind: "timeout" | "rate_limit" | "context_exceeded" | "policy_denied" | "provider_error" | "validation_failed";
  message: string;
  retryable: boolean;
}

export type ModelResult = { ok: true; response: ModelResponse } | { ok: false; failure: ModelFailure };

export interface ModelPort {
  /** Returns the provider/model identity */
  getModelId(): string;
  getProvider(): string;

  /** True when this model is available and policy permits external transmission */
  isAvailable(): boolean;

  /** Execute a bounded model request */
  complete(request: ModelRequest): Promise<ModelResult>;
}
