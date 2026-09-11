import type { ReviewMode, ReviewPackage } from "./ai-review-package.ts";
import {
  PROVIDER_CATALOG,
  REVIEW_ROUTING,
  type ProviderModelConfig,
  type ProviderTransportConfig,
  type ReviewRouteRole,
  type ReviewRouteTarget,
} from "./ai-review-provider-config.ts";
import { OpenAICompatibleReviewProvider } from "./ai-review-provider-openai-compatible.ts";
import type { ReviewProvider } from "./ai-review-runtime.ts";

export interface AiReviewProviderEnv {
  [key: string]: string | undefined;
  AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY?: string;
  AI_PROVIDER_VOLCENGINE_CODING_PLAN_KEY?: string;
  AI_PROVIDER_OPENCODE_GO_KEY?: string;
}

export type ReviewProviderRouteState =
  | "unconfigured"
  | "configured"
  | "unsupported"
  | "invalid";

export interface ReviewRouteStatus {
  state: ReviewProviderRouteState;
  provider: string;
  model: string;
  driver: string;
}

export interface ReviewProviderRegistry {
  providers: ReviewProvider<ReviewPackage>[];
  route: {
    routine: ReviewRouteStatus;
    fallback?: ReviewRouteStatus;
    escalation?: ReviewRouteStatus;
  };
}

function targetConfig(target: ReviewRouteTarget) {
  const account = PROVIDER_CATALOG.providers[target.provider];
  const model = account?.models[target.model];
  const transport = model ? account?.transports[model.transport] : undefined;
  if (!account || !model || !transport) {
    throw new Error(`Invalid trusted provider target ${target.provider}/${target.model}.`);
  }
  return { account, model, transport };
}

function statusFor(
  target: ReviewRouteTarget,
  state: ReviewProviderRouteState,
  transport: ProviderTransportConfig,
): ReviewRouteStatus {
  return {
    state,
    provider: target.provider,
    model: target.model,
    driver: transport.driver,
  };
}

function openAiProvider(
  target: ReviewRouteTarget,
  role: ReviewRouteRole,
  transport: ProviderTransportConfig,
  model: ProviderModelConfig,
  apiKey: string,
) {
  return new OpenAICompatibleReviewProvider({
    id: `${target.provider}/${target.model}`,
    role,
    endpoint: transport.endpoint,
    apiKey,
    model: model.modelId,
    responseFormat: model.capabilities?.responseFormat ?? "none",
    ...(model.reviewDefaults?.timeoutMs !== undefined
      ? { timeoutMs: model.reviewDefaults.timeoutMs }
      : {}),
    ...(model.driverOptions?.openaiChat?.reasoningSplit === true
      ? { requestExtensions: { reasoningSplit: true } }
      : {}),
    ...(model.reviewDefaults?.maxPromptCharacters !== undefined
      ? {
          inputBudget: {
            maxPromptCharacters: model.reviewDefaults.maxPromptCharacters,
          },
        }
      : {}),
    ...(model.reviewDefaults?.maxOutputTokens !== undefined &&
    model.reviewDefaults.outputTokenParameter !== undefined
      ? {
          outputBudget: {
            parameter: model.reviewDefaults.outputTokenParameter,
            tokens: model.reviewDefaults.maxOutputTokens,
          },
        }
      : {}),
  });
}

function instantiateTarget(
  env: AiReviewProviderEnv,
  target: ReviewRouteTarget,
  role: ReviewRouteRole,
): { status: ReviewRouteStatus; provider?: ReviewProvider<ReviewPackage> } {
  const { account, model, transport } = targetConfig(target);
  const apiKey = env[account.credential.secretRef]?.trim();
  if (!apiKey) {
    return { status: statusFor(target, "unconfigured", transport) };
  }

  if (transport.driver !== "openai-chat") {
    return { status: statusFor(target, "unsupported", transport) };
  }

  try {
    return {
      status: statusFor(target, "configured", transport),
      provider: openAiProvider(target, role, transport, model, apiKey),
    };
  } catch {
    return { status: statusFor(target, "invalid", transport) };
  }
}

export function buildReviewProviderRegistry(
  env: AiReviewProviderEnv,
  mode: ReviewMode,
): ReviewProviderRegistry {
  const route = REVIEW_ROUTING.routes[mode];
  const routine = instantiateTarget(env, route.routine, "routine");
  const fallback = route.fallback
    ? instantiateTarget(env, route.fallback, "fallback")
    : undefined;
  const escalation = route.escalation
    ? instantiateTarget(env, route.escalation, "escalation")
    : undefined;

  return {
    providers: [routine.provider, fallback?.provider].filter(
      (provider): provider is ReviewProvider<ReviewPackage> => Boolean(provider),
    ),
    route: {
      routine: routine.status,
      ...(fallback ? { fallback: fallback.status } : {}),
      ...(escalation ? { escalation: escalation.status } : {}),
    },
  };
}

export function buildReviewRoutingHealth(env: AiReviewProviderEnv) {
  return {
    CODE_REVIEW: buildReviewProviderRegistry(env, "CODE_REVIEW").route,
    PROMOTION_REVIEW: buildReviewProviderRegistry(env, "PROMOTION_REVIEW").route,
    RELEASE_REVIEW: buildReviewProviderRegistry(env, "RELEASE_REVIEW").route,
  };
}
