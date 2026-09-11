import type { ReviewPackage } from "./ai-review-package.ts";
import {
  OpenAICompatibleReviewProvider,
  type OpenAICompatibleOutputTokenParameter,
} from "./ai-review-provider-openai-compatible.ts";
import type { ReviewProvider, ReviewProviderRole } from "./ai-review-runtime.ts";

export type ReviewProviderSlotState = "unconfigured" | "configured" | "partial" | "invalid";

export interface AiReviewProviderEnv {
  AI_REVIEW_PRIMARY_ID?: string;
  AI_REVIEW_PRIMARY_ENDPOINT?: string;
  AI_REVIEW_PRIMARY_API_KEY?: string;
  AI_REVIEW_PRIMARY_MODEL?: string;
  AI_REVIEW_PRIMARY_RESPONSE_FORMAT?: string;
  AI_REVIEW_PRIMARY_MAX_PROMPT_CHARACTERS?: string;
  AI_REVIEW_PRIMARY_MAX_OUTPUT_TOKENS?: string;
  AI_REVIEW_PRIMARY_OUTPUT_TOKEN_PARAMETER?: string;
  AI_REVIEW_FALLBACK_ID?: string;
  AI_REVIEW_FALLBACK_ENDPOINT?: string;
  AI_REVIEW_FALLBACK_API_KEY?: string;
  AI_REVIEW_FALLBACK_MODEL?: string;
  AI_REVIEW_FALLBACK_RESPONSE_FORMAT?: string;
  AI_REVIEW_FALLBACK_MAX_PROMPT_CHARACTERS?: string;
  AI_REVIEW_FALLBACK_MAX_OUTPUT_TOKENS?: string;
  AI_REVIEW_FALLBACK_OUTPUT_TOKEN_PARAMETER?: string;
}

export interface ReviewProviderRegistry {
  providers: ReviewProvider<ReviewPackage>[];
  slots: {
    primary: ReviewProviderSlotState;
    fallback: ReviewProviderSlotState;
  };
}

interface SlotValues {
  id?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  responseFormat?: string;
  maxPromptCharacters?: string;
  maxOutputTokens?: string;
  outputTokenParameter?: string;
}

function trimmed(value: string | undefined) {
  const result = value?.trim();
  return result || undefined;
}

function responseFormat(value: string | undefined) {
  const normalized = trimmed(value) ?? "json_object";
  if (normalized === "json_object" || normalized === "none") return normalized;
  return null;
}

function positiveIntegerSetting(value: string | undefined) {
  const normalized = trimmed(value);
  if (!normalized) return undefined;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function outputTokenParameter(value: string | undefined) {
  const normalized = trimmed(value);
  if (!normalized) return undefined;
  if (normalized === "max_tokens" || normalized === "max_completion_tokens") {
    return normalized as OpenAICompatibleOutputTokenParameter;
  }
  return null;
}

function slot(
  values: SlotValues,
  role: Extract<ReviewProviderRole, "primary" | "fallback">,
): { state: ReviewProviderSlotState; provider?: ReviewProvider<ReviewPackage> } {
  const normalized = {
    id: trimmed(values.id),
    endpoint: trimmed(values.endpoint),
    apiKey: trimmed(values.apiKey),
    model: trimmed(values.model),
    responseFormat: trimmed(values.responseFormat),
    maxPromptCharacters: trimmed(values.maxPromptCharacters),
    maxOutputTokens: trimmed(values.maxOutputTokens),
    outputTokenParameter: trimmed(values.outputTokenParameter),
  };
  const anyConfigured = Object.values(normalized).some(Boolean);
  if (!anyConfigured) return { state: "unconfigured" };

  if (!normalized.id || !normalized.endpoint || !normalized.apiKey || !normalized.model) {
    return { state: "partial" };
  }

  const format = responseFormat(normalized.responseFormat);
  const maxPromptCharacters = positiveIntegerSetting(normalized.maxPromptCharacters);
  const maxOutputTokens = positiveIntegerSetting(normalized.maxOutputTokens);
  const tokenParameter = outputTokenParameter(normalized.outputTokenParameter);

  if (format === null || maxPromptCharacters === null || maxOutputTokens === null || tokenParameter === null) {
    return { state: "invalid" };
  }

  if ((maxOutputTokens === undefined) !== (tokenParameter === undefined)) {
    return { state: "invalid" };
  }

  try {
    return {
      state: "configured",
      provider: new OpenAICompatibleReviewProvider({
        id: normalized.id,
        endpoint: normalized.endpoint,
        apiKey: normalized.apiKey,
        model: normalized.model,
        role,
        responseFormat: format,
        ...(maxPromptCharacters !== undefined
          ? { inputBudget: { maxPromptCharacters } }
          : {}),
        ...(maxOutputTokens !== undefined && tokenParameter !== undefined
          ? { outputBudget: { parameter: tokenParameter, tokens: maxOutputTokens } }
          : {}),
      }),
    };
  } catch {
    return { state: "invalid" };
  }
}

export function buildReviewProviderRegistry(env: AiReviewProviderEnv): ReviewProviderRegistry {
  const primary = slot(
    {
      id: env.AI_REVIEW_PRIMARY_ID,
      endpoint: env.AI_REVIEW_PRIMARY_ENDPOINT,
      apiKey: env.AI_REVIEW_PRIMARY_API_KEY,
      model: env.AI_REVIEW_PRIMARY_MODEL,
      responseFormat: env.AI_REVIEW_PRIMARY_RESPONSE_FORMAT,
      maxPromptCharacters: env.AI_REVIEW_PRIMARY_MAX_PROMPT_CHARACTERS,
      maxOutputTokens: env.AI_REVIEW_PRIMARY_MAX_OUTPUT_TOKENS,
      outputTokenParameter: env.AI_REVIEW_PRIMARY_OUTPUT_TOKEN_PARAMETER,
    },
    "primary",
  );
  const fallback = slot(
    {
      id: env.AI_REVIEW_FALLBACK_ID,
      endpoint: env.AI_REVIEW_FALLBACK_ENDPOINT,
      apiKey: env.AI_REVIEW_FALLBACK_API_KEY,
      model: env.AI_REVIEW_FALLBACK_MODEL,
      responseFormat: env.AI_REVIEW_FALLBACK_RESPONSE_FORMAT,
      maxPromptCharacters: env.AI_REVIEW_FALLBACK_MAX_PROMPT_CHARACTERS,
      maxOutputTokens: env.AI_REVIEW_FALLBACK_MAX_OUTPUT_TOKENS,
      outputTokenParameter: env.AI_REVIEW_FALLBACK_OUTPUT_TOKEN_PARAMETER,
    },
    "fallback",
  );

  return {
    providers: [primary.provider, fallback.provider].filter(
      (provider): provider is ReviewProvider<ReviewPackage> => Boolean(provider),
    ),
    slots: {
      primary: primary.state,
      fallback: fallback.state,
    },
  };
}
