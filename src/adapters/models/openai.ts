/**
 * adapters/models/openai.ts — OpenAI model adapter.
 *
 * Only instantiated when:
 * 1. policy.permittedModelIds includes an "openai/*" model
 * 2. policy.externalTransmissionAllowed = true
 * 3. OPENAI_API_KEY is set in environment
 *
 * If any condition fails, falls back to UnavailableModelAdapter — never silently.
 * Uses the REST API directly (no SDK dependency) with bounded requests.
 */
import type { ModelPort, ModelRequest, ModelResult } from "../../ports/index.js";

interface OpenAIConfig {
  modelId: string;
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
}

export class OpenAIModelAdapter implements ModelPort {
  private readonly config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = config;
  }

  getModelId(): string { return this.config.modelId; }
  getProvider(): string { return "openai"; }
  isAvailable(): boolean { return true; }

  async complete(request: ModelRequest): Promise<ModelResult> {
    const startMs = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

    const body = JSON.stringify({
      model: this.config.modelId,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userContent },
      ],
      max_tokens: request.maxResponseTokens,
      temperature: (request.parameters["temperature"] as number | undefined) ?? 0,
    });

    let attempt = 0;
    while (attempt <= this.config.maxRetries) {
      try {
        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.status === 429) {
          // Rate limit — retry if within budget
          if (attempt < this.config.maxRetries) {
            attempt++;
            await sleep(1000 * attempt);
            continue;
          }
          return { ok: false, failure: { provider: "openai", modelId: this.config.modelId, errorKind: "rate_limit", message: "Rate limit exceeded", retryable: false } };
        }

        if (!response.ok) {
          return { ok: false, failure: { provider: "openai", modelId: this.config.modelId, errorKind: "provider_error", message: `HTTP ${response.status}`, retryable: false } };
        }

        // Raw response — returned as unknown for validation by callers
        const raw: unknown = await response.json();

        const content = extractContent(raw);
        if (content === null) {
          return { ok: false, failure: { provider: "openai", modelId: this.config.modelId, errorKind: "provider_error", message: "Could not extract content from response", retryable: false } };
        }

        const usage = extractUsage(raw);

        return {
          ok: true,
          response: {
            provider: "openai",
            modelId: this.config.modelId,
            promptVersion: request.promptVersion,
            parameters: request.parameters,
            rawOutput: content,
            ...(usage !== undefined ? { usageTokens: usage } : {}),
            latencyMs: Date.now() - startMs,
          },
        };
      } catch (err) {
        clearTimeout(timeout);
        if ((err as { name?: string }).name === "AbortError") {
          return { ok: false, failure: { provider: "openai", modelId: this.config.modelId, errorKind: "timeout", message: `Timed out after ${request.timeoutMs}ms`, retryable: false } };
        }
        if (attempt < this.config.maxRetries) {
          attempt++;
          await sleep(500 * attempt);
          continue;
        }
        return { ok: false, failure: { provider: "openai", modelId: this.config.modelId, errorKind: "provider_error", message: String(err), retryable: false } };
      }
    }

    return { ok: false, failure: { provider: "openai", modelId: this.config.modelId, errorKind: "provider_error", message: "Retries exhausted", retryable: false } };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractContent(raw: unknown): string | null {
  if (
    typeof raw === "object" && raw !== null &&
    "choices" in raw &&
    Array.isArray((raw as { choices: unknown[] }).choices)
  ) {
    const first = (raw as { choices: Array<{ message?: { content?: string } }> }).choices[0];
    return first?.message?.content ?? null;
  }
  return null;
}

function extractUsage(raw: unknown): { prompt: number; completion: number } | undefined {
  if (
    typeof raw === "object" && raw !== null &&
    "usage" in raw
  ) {
    const usage = (raw as { usage: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    const prompt = usage.prompt_tokens;
    const completion = usage.completion_tokens;
    if (prompt !== undefined && completion !== undefined) {
      return { prompt, completion };
    }
  }
  return undefined;
}

/** Factory: create the appropriate model adapter based on policy */
export function createModelAdapter(
  permittedModelIds: string[],
  externalTransmissionAllowed: boolean,
  unavailableFactory?: (reason: string) => ModelPort,
): ModelPort {
  const makeUnavailable = unavailableFactory ?? ((r: string) => {
    // Inline fallback — avoids require() in ESM
    return {
      getModelId: () => "unavailable",
      getProvider: () => "none",
      isAvailable: () => false,
      complete: async () => ({
        ok: false as const,
        failure: { provider: "none", modelId: "unavailable", errorKind: "policy_denied" as const, message: r, retryable: false },
      }),
    };
  });

  if (!externalTransmissionAllowed) {
    return makeUnavailable("External transmission prohibited by policy");
  }

  const openaiModel = permittedModelIds.find((id) => id.startsWith("openai/"));
  if (!openaiModel) {
    return makeUnavailable(`No permitted model found in: ${permittedModelIds.join(", ")}`);
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return makeUnavailable("OPENAI_API_KEY not set in environment");
  }

  const modelId = openaiModel.replace("openai/", "");
  return new OpenAIModelAdapter({
    modelId,
    apiKey,
    baseUrl: process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1",
    maxRetries: 2,
  });
}
