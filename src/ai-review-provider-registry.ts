import type { ReviewPackage } from "./ai-review-package.ts";
import { OpenAICompatibleReviewProvider } from "./ai-review-provider-openai-compatible.ts";
import type { ReviewProvider, ReviewProviderRole } from "./ai-review-runtime.ts";

export type ReviewProviderSlotState = "unconfigured" | "configured" | "partial" | "invalid";

export interface AiReviewProviderEnv {
  AI_REVIEW_PRIMARY_ID?: string;
  AI_REVIEW_PRIMARY_ENDPOINT?: string;
  AI_REVIEW_PRIMARY_API_KEY?: string;
  AI_REVIEW_PRIMARY_MODEL?: string;
  AI_REVIEW_PRIMARY_RESPONSE_FORMAT?: string;
  AI_REVIEW_FALLBACK_ID?: string;
  AI_REVIEW_FALLBACK_ENDPOINT?: string;
  AI_REVIEW_FALLBACK_API_KEY?: string;
  AI_REVIEW_FALLBACK_MODEL?: string;
  AI_REVIEW_FALLBACK_RESPONSE_FORMAT?: string;
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
  };
  const anyConfigured = Object.values(normalized).some(Boolean);
  if (!anyConfigured) return { state: "unconfigured" };

  if (!normalized.id || !normalized.endpoint || !normalized.apiKey || !normalized.model) {
    return { state: "partial" };
  }

  const format = responseFormat(normalized.responseFormat);
  if (!format) return { state: "invalid" };

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
