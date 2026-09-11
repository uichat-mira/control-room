import type { ReviewPackage } from "./ai-review-package.ts";
import { buildReviewPrompt } from "./ai-review-prompt.ts";
import {
  ReviewProviderError,
  failureClassForHttpStatus,
  type ReviewProvider,
  type ReviewProviderResponse,
  type ReviewProviderRole,
  type ReviewProviderUsage,
} from "./ai-review-runtime.ts";

export interface OpenAICompatibleReviewProviderConfig {
  id: string;
  role: ReviewProviderRole;
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  responseFormat?: "json_object" | "none";
}

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;

function requireNonEmpty(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function normalizeEndpoint(value: string) {
  const endpoint = requireNonEmpty(value, "Provider endpoint");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Provider endpoint must be an absolute URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Provider endpoint must use HTTPS.");
  }
  return url.toString();
}

function normalizeTimeout(value: number | undefined) {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
    throw new Error(
      `Provider timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms.`,
    );
  }
  return timeout;
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function usageFromResponse(value: ChatCompletionsResponse["usage"]): ReviewProviderUsage | undefined {
  if (!value) return undefined;
  const inputTokens = tokenCount(value.prompt_tokens);
  const outputTokens = tokenCount(value.completion_tokens);
  const totalTokens = tokenCount(value.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function parseProviderJson(content: string) {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ReviewProviderError("Provider returned invalid JSON review output.", "malformed_response");
  }
}

export class OpenAICompatibleReviewProvider implements ReviewProvider<ReviewPackage> {
  readonly id: string;
  readonly model: string;
  readonly role: ReviewProviderRole;

  readonly #endpoint: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #responseFormat: "json_object" | "none";

  constructor(config: OpenAICompatibleReviewProviderConfig) {
    this.id = requireNonEmpty(config.id, "Provider id");
    this.role = config.role;
    this.#endpoint = normalizeEndpoint(config.endpoint);
    this.#apiKey = requireNonEmpty(config.apiKey, "Provider API key");
    this.model = requireNonEmpty(config.model, "Provider model");
    this.#timeoutMs = normalizeTimeout(config.timeoutMs);
    this.#responseFormat = config.responseFormat ?? "json_object";
  }

  async review(input: ReviewPackage): Promise<ReviewProviderResponse> {
    const prompt = buildReviewPrompt(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(this.#endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: prompt.messages,
            temperature: 0,
            ...(this.#responseFormat === "json_object"
              ? { response_format: { type: "json_object" } }
              : {}),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new ReviewProviderError("Provider request timed out.", "timeout");
        }
        throw new ReviewProviderError("Provider network request failed.", "provider_unavailable");
      }

      if (!response.ok) {
        throw new ReviewProviderError(
          `Provider request failed with HTTP ${response.status}.`,
          failureClassForHttpStatus(response.status),
        );
      }

      let payload: ChatCompletionsResponse;
      try {
        payload = (await response.json()) as ChatCompletionsResponse;
      } catch {
        throw new ReviewProviderError(
          "Provider returned a non-JSON Chat Completions response.",
          "malformed_response",
        );
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new ReviewProviderError(
          "Provider response did not contain text review output.",
          "malformed_response",
        );
      }

      return {
        output: parseProviderJson(content),
        ...(usageFromResponse(payload.usage)
          ? { usage: usageFromResponse(payload.usage) }
          : {}),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
