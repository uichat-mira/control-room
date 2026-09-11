import type { ReviewPackage } from "./ai-review-package.ts";
import { buildReviewPrompt } from "./ai-review-prompt.ts";
import {
  ReviewProviderError,
  failureClassForHttpStatus,
  type ReviewFailureDetail,
  type ReviewProvider,
  type ReviewProviderResponse,
  type ReviewProviderRole,
  type ReviewProviderUsage,
} from "./ai-review-runtime.ts";

export type OpenAICompatibleOutputTokenParameter =
  | "max_tokens"
  | "max_completion_tokens";

export interface OpenAICompatibleReviewProviderConfig {
  id: string;
  role: ReviewProviderRole;
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  responseFormat?: "json_object" | "none";
  requestExtensions?: {
    reasoningSplit?: boolean;
  };
  inputBudget?: {
    maxPromptCharacters: number;
  };
  outputBudget?: {
    parameter: OpenAICompatibleOutputTokenParameter;
    tokens: number;
  };
}

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_details?: unknown;
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
const MAX_PROVIDER_RESPONSE_BYTES = 512_000;

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
  if (url.username || url.password) {
    throw new Error("Provider endpoint must not contain embedded credentials.");
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

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizeInputBudget(
  value: OpenAICompatibleReviewProviderConfig["inputBudget"],
) {
  if (!value) return undefined;
  return {
    maxPromptCharacters: positiveInteger(
      value.maxPromptCharacters,
      "Provider max prompt characters",
    ),
  };
}

function normalizeOutputBudget(
  value: OpenAICompatibleReviewProviderConfig["outputBudget"],
) {
  if (!value) return undefined;
  if (value.parameter !== "max_tokens" && value.parameter !== "max_completion_tokens") {
    throw new Error(
      "Provider output token parameter must be max_tokens or max_completion_tokens.",
    );
  }
  return {
    parameter: value.parameter,
    tokens: positiveInteger(value.tokens, "Provider max output tokens"),
  };
}

function normalizeRequestExtensions(
  value: OpenAICompatibleReviewProviderConfig["requestExtensions"],
): { reasoningSplit?: true } | undefined {
  if (!value) return undefined;
  if (value.reasoningSplit !== undefined && typeof value.reasoningSplit !== "boolean") {
    throw new Error("Provider reasoningSplit request extension must be boolean.");
  }
  return {
    ...(value.reasoningSplit === true ? { reasoningSplit: true as const } : {}),
  };
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

function malformed(
  message: string,
  failureDetail: ReviewFailureDetail,
  usage?: ReviewProviderUsage,
) {
  return new ReviewProviderError(message, "malformed_response", {
    failureDetail,
    ...(usage ? { usage } : {}),
  });
}

async function readBoundedResponseText(response: Response) {
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? undefined : Number(contentLength);
  if (
    declaredLength !== undefined &&
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw malformed(
      "Provider response exceeded the review output limit.",
      "response_too_large",
    );
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded-output failure remains authoritative even if cancellation fails.
        }
        throw malformed(
          "Provider response exceeded the review output limit.",
          "response_too_large",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof ReviewProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ReviewProviderError("Provider response stream timed out.", "timeout");
    }
    throw new ReviewProviderError(
      "Provider response stream failed.",
      "provider_unavailable",
    );
  } finally {
    reader.releaseLock();
  }
}

function reviewJsonFailureDetail(content: string): ReviewFailureDetail {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("```")) return "review_json_fenced";
  if (!trimmed.startsWith("{")) return "non_json_review_text";
  return "invalid_review_json";
}

function parseProviderJson(content: string, usage?: ReviewProviderUsage) {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw malformed(
      "Provider returned invalid JSON review output.",
      reviewJsonFailureDetail(content),
      usage,
    );
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
  readonly #requestExtensions: { reasoningSplit?: true } | undefined;
  readonly #inputBudget: { maxPromptCharacters: number } | undefined;
  readonly #outputBudget:
    | { parameter: OpenAICompatibleOutputTokenParameter; tokens: number }
    | undefined;

  constructor(config: OpenAICompatibleReviewProviderConfig) {
    this.id = requireNonEmpty(config.id, "Provider id");
    this.role = config.role;
    this.#endpoint = normalizeEndpoint(config.endpoint);
    this.#apiKey = requireNonEmpty(config.apiKey, "Provider API key");
    this.model = requireNonEmpty(config.model, "Provider model");
    this.#timeoutMs = normalizeTimeout(config.timeoutMs);
    this.#responseFormat = config.responseFormat ?? "json_object";
    this.#requestExtensions = normalizeRequestExtensions(config.requestExtensions);
    this.#inputBudget = normalizeInputBudget(config.inputBudget);
    this.#outputBudget = normalizeOutputBudget(config.outputBudget);
  }

  async review(input: ReviewPackage): Promise<ReviewProviderResponse> {
    const prompt = buildReviewPrompt(input);
    const promptCharacters = prompt.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );

    if (
      this.#inputBudget &&
      promptCharacters > this.#inputBudget.maxPromptCharacters
    ) {
      throw new ReviewProviderError(
        `Review prompt exceeds configured provider input capacity (${promptCharacters} > ${this.#inputBudget.maxPromptCharacters} characters).`,
        "input_limit",
      );
    }

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
            ...(this.#responseFormat === "json_object"
              ? { response_format: { type: "json_object" } }
              : {}),
            ...(this.#requestExtensions?.reasoningSplit === true
              ? { reasoning_split: true }
              : {}),
            ...(this.#outputBudget
              ? { [this.#outputBudget.parameter]: this.#outputBudget.tokens }
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
        payload = JSON.parse(await readBoundedResponseText(response)) as ChatCompletionsResponse;
      } catch (error) {
        if (error instanceof ReviewProviderError) throw error;
        throw malformed(
          "Provider returned a non-JSON Chat Completions response.",
          "invalid_chat_response",
        );
      }

      const usage = usageFromResponse(payload.usage);
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw malformed(
          "Provider response did not contain text review output.",
          "missing_message_content",
          usage,
        );
      }

      return {
        output: parseProviderJson(content, usage),
        ...(usage ? { usage } : {}),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
