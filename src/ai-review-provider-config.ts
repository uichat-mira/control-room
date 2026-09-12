import providerCatalogJson from "../config/ai-review/providers.json" with { type: "json" };
import reviewRoutingJson from "../config/ai-review/routing.json" with { type: "json" };
import type { ReviewMode } from "./ai-review-package.ts";
import type { OpenAICompatibleOutputTokenParameter } from "./ai-review-provider-openai-compatible.ts";

export const PROVIDER_CONFIG_VERSION = 1 as const;

export type ProviderTransportDriver =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages";

export type ProviderReasoningMode =
  | "none"
  | "inline"
  | "separate"
  | "provider-default";

export type ProviderResponseFormat = "json_object" | "none";
export type ReviewRouteRole = "routine" | "fallback" | "escalation";

export interface ProviderCredentialConfig {
  type: "bearer";
  secretRef: string;
}

export interface ProviderTransportConfig {
  driver: ProviderTransportDriver;
  endpoint: string;
}

export interface OpenAIChatDriverOptions {
  reasoningSplit?: boolean;
}

export interface ProviderModelConfig {
  modelId: string;
  transport: string;
  capabilities?: {
    reasoning?: ProviderReasoningMode;
    responseFormat?: ProviderResponseFormat;
  };
  driverOptions?: {
    openaiChat?: OpenAIChatDriverOptions;
  };
  reviewDefaults?: {
    timeoutMs?: number;
    maxPromptCharacters?: number;
    maxOutputTokens?: number;
    outputTokenParameter?: OpenAICompatibleOutputTokenParameter;
  };
}

export interface ProviderAccountConfig {
  vendor: string;
  plan: string;
  region: string;
  credential: ProviderCredentialConfig;
  transports: Record<string, ProviderTransportConfig>;
  models: Record<string, ProviderModelConfig>;
}

export interface ProviderCatalogConfig {
  version: number;
  providers: Record<string, ProviderAccountConfig>;
}

export interface ReviewRouteTarget {
  provider: string;
  model: string;
  enabled: boolean;
}

export interface ReviewRouteConfig {
  routine: ReviewRouteTarget;
  fallback?: ReviewRouteTarget;
  escalation?: ReviewRouteTarget;
}

export interface ReviewRoutingConfig {
  version: number;
  routes: Record<ReviewMode, ReviewRouteConfig>;
}

function nonEmpty(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} must be non-empty.`);
}

function positiveInteger(value: number | undefined, label: string) {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function validateTimeout(value: number | undefined, label: string) {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error(`${label} must be an integer between 1000 and 300000 ms.`);
  }
}

function validateEndpoint(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  if (url.username || url.password) {
    throw new Error(`${label} must not contain embedded credentials.`);
  }
}

function validateOpenAIChatOptions(
  providerId: string,
  modelKey: string,
  model: ProviderModelConfig,
  transport: ProviderTransportConfig,
) {
  const options = model.driverOptions?.openaiChat;
  if (!options) return;

  if (transport.driver !== "openai-chat") {
    throw new Error(
      `${providerId}/${modelKey}.driverOptions.openaiChat requires the openai-chat driver.`,
    );
  }

  if (
    options.reasoningSplit !== undefined &&
    typeof options.reasoningSplit !== "boolean"
  ) {
    throw new Error(
      `${providerId}/${modelKey}.driverOptions.openaiChat.reasoningSplit must be boolean.`,
    );
  }

  if (options.reasoningSplit === true && model.capabilities?.reasoning !== "separate") {
    throw new Error(
      `${providerId}/${modelKey} reasoningSplit=true requires capabilities.reasoning=separate.`,
    );
  }
}

function validateTarget(
  target: ReviewRouteTarget,
  label: string,
  catalog: ProviderCatalogConfig,
) {
  const provider = catalog.providers[target.provider];
  if (!provider) throw new Error(`${label} references unknown provider ${target.provider}.`);
  const model = provider.models[target.model];
  if (!model) {
    throw new Error(`${label} references unknown model ${target.provider}/${target.model}.`);
  }
  if (typeof target.enabled !== "boolean") {
    throw new Error(`${label}.enabled must be boolean.`);
  }
}

export function validateProviderConfiguration(
  catalog: ProviderCatalogConfig,
  routing: ReviewRoutingConfig,
) {
  if (catalog.version !== PROVIDER_CONFIG_VERSION) {
    throw new Error(`Unsupported provider catalog version: ${catalog.version}.`);
  }
  if (routing.version !== PROVIDER_CONFIG_VERSION) {
    throw new Error(`Unsupported review routing version: ${routing.version}.`);
  }

  const secretRefs = new Set<string>();
  for (const [providerId, provider] of Object.entries(catalog.providers)) {
    nonEmpty(providerId, "Provider id");
    nonEmpty(provider.vendor, `${providerId}.vendor`);
    nonEmpty(provider.plan, `${providerId}.plan`);
    nonEmpty(provider.region, `${providerId}.region`);

    if (provider.credential.type !== "bearer") {
      throw new Error(`${providerId}.credential.type is unsupported.`);
    }
    if (!/^AI_PROVIDER_[A-Z0-9_]+_KEY$/.test(provider.credential.secretRef)) {
      throw new Error(`${providerId}.credential.secretRef must use AI_PROVIDER_*_KEY naming.`);
    }
    if (secretRefs.has(provider.credential.secretRef)) {
      throw new Error(`Duplicate provider secretRef: ${provider.credential.secretRef}.`);
    }
    secretRefs.add(provider.credential.secretRef);

    for (const [transportId, transport] of Object.entries(provider.transports)) {
      nonEmpty(transportId, `${providerId}.transport id`);
      if (
        transport.driver !== "openai-chat" &&
        transport.driver !== "openai-responses" &&
        transport.driver !== "anthropic-messages"
      ) {
        throw new Error(`${providerId}/${transportId} uses an unsupported transport driver.`);
      }
      validateEndpoint(transport.endpoint, `${providerId}/${transportId}.endpoint`);
    }

    for (const [modelKey, model] of Object.entries(provider.models)) {
      nonEmpty(modelKey, `${providerId}.model key`);
      nonEmpty(model.modelId, `${providerId}/${modelKey}.modelId`);
      const transport = provider.transports[model.transport];
      if (!transport) {
        throw new Error(`${providerId}/${modelKey} references unknown transport ${model.transport}.`);
      }
      validateOpenAIChatOptions(providerId, modelKey, model, transport);
      validateTimeout(
        model.reviewDefaults?.timeoutMs,
        `${providerId}/${modelKey}.timeoutMs`,
      );
      positiveInteger(
        model.reviewDefaults?.maxPromptCharacters,
        `${providerId}/${modelKey}.maxPromptCharacters`,
      );
      positiveInteger(
        model.reviewDefaults?.maxOutputTokens,
        `${providerId}/${modelKey}.maxOutputTokens`,
      );
      const hasOutputTokens = model.reviewDefaults?.maxOutputTokens !== undefined;
      const hasOutputParameter = model.reviewDefaults?.outputTokenParameter !== undefined;
      if (hasOutputTokens !== hasOutputParameter) {
        throw new Error(
          `${providerId}/${modelKey} must configure maxOutputTokens and outputTokenParameter together.`,
        );
      }
    }
  }

  for (const mode of ["CODE_REVIEW", "PROMOTION_REVIEW", "RELEASE_REVIEW"] as const) {
    const route = routing.routes[mode];
    if (!route) throw new Error(`Missing review route for ${mode}.`);
    validateTarget(route.routine, `${mode}.routine`, catalog);
    if (route.fallback) {
      validateTarget(route.fallback, `${mode}.fallback`, catalog);
      if (route.fallback.provider === route.routine.provider) {
        throw new Error(`${mode}.fallback must use a different provider account than routine.`);
      }
    }
    if (route.escalation) validateTarget(route.escalation, `${mode}.escalation`, catalog);
  }

  return { catalog, routing };
}

const validated = validateProviderConfiguration(
  providerCatalogJson as ProviderCatalogConfig,
  reviewRoutingJson as ReviewRoutingConfig,
);

export const PROVIDER_CATALOG = validated.catalog;
export const REVIEW_ROUTING = validated.routing;

export function configuredProviderSecretRefs() {
  return Object.values(PROVIDER_CATALOG.providers).map(
    (provider) => provider.credential.secretRef,
  );
}
