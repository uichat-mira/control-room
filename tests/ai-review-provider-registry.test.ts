import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER_CATALOG,
  REVIEW_ROUTING,
  configuredProviderSecretRefs,
  validateProviderConfiguration,
} from "../src/ai-review-provider-config.ts";
import { buildReviewProviderRegistry } from "../src/ai-review-provider-registry.ts";

test("catalog models provider accounts independently from review roles", () => {
  assert.deepEqual(Object.keys(PROVIDER_CATALOG.providers).sort(), [
    "minimax-cn-codeplan",
    "opencode-go",
    "volcengine-coding-plan",
  ]);
  assert.equal(
    PROVIDER_CATALOG.providers["minimax-cn-codeplan"].credential.secretRef,
    "AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY",
  );
  assert.equal(
    PROVIDER_CATALOG.providers["minimax-cn-codeplan"].models.m3.reviewDefaults?.timeoutMs,
    300_000,
  );
  assert.equal(
    PROVIDER_CATALOG.providers["opencode-go"].models["deepseek-v4-flash"].modelId,
    "deepseek-v4-flash",
  );
  assert.equal(
    PROVIDER_CATALOG.providers["opencode-go"].models["minimax-m3"].transport,
    "anthropic-messages",
  );
});

test("provider secret references are the only runtime configuration values", () => {
  assert.deepEqual(configuredProviderSecretRefs().sort(), [
    "AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY",
    "AI_PROVIDER_OPENCODE_GO_KEY",
    "AI_PROVIDER_VOLCENGINE_CODING_PLAN_KEY",
  ]);
});

test("CODE_REVIEW uses MiniMax routine, cross-provider OpenCode fallback, and separate escalation", () => {
  assert.deepEqual(REVIEW_ROUTING.routes.CODE_REVIEW, {
    routine: { provider: "minimax-cn-codeplan", model: "m3" },
    fallback: { provider: "opencode-go", model: "deepseek-v4-flash" },
    escalation: { provider: "opencode-go", model: "deepseek-v4-pro" },
  });
});

test("configured routine and fallback accounts instantiate from their own credentials", () => {
  const registry = buildReviewProviderRegistry(
    {
      AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY: "minimax-secret",
      AI_PROVIDER_OPENCODE_GO_KEY: "go-secret",
    },
    "CODE_REVIEW",
  );

  assert.equal(registry.route.routine.state, "configured");
  assert.equal(registry.route.fallback?.state, "configured");
  assert.equal(registry.providers.length, 2);
  assert.equal(registry.providers[0].id, "minimax-cn-codeplan/m3");
  assert.equal(registry.providers[1].id, "opencode-go/deepseek-v4-flash");
});

test("provider review timeout is bounded by the adapter contract", () => {
  const catalog = structuredClone(PROVIDER_CATALOG);
  catalog.providers["minimax-cn-codeplan"].models.m3.reviewDefaults!.timeoutMs = 300_001;

  assert.throws(
    () => validateProviderConfiguration(catalog, REVIEW_ROUTING),
    /timeoutMs must be an integer between 1000 and 300000 ms/,
  );
});

test("fallback routing must provide real provider-account redundancy", () => {
  const routing = structuredClone(REVIEW_ROUTING);
  routing.routes.CODE_REVIEW.fallback = {
    provider: "minimax-cn-codeplan",
    model: "m3",
  };

  assert.throws(
    () => validateProviderConfiguration(PROVIDER_CATALOG, routing),
    /fallback must use a different provider account than routine/,
  );
});

test("rejects route targets that reference a model absent from the provider account", () => {
  const routing = structuredClone(REVIEW_ROUTING);
  routing.routes.CODE_REVIEW.routine = {
    provider: "minimax-cn-codeplan",
    model: "does-not-exist",
  };

  assert.throws(
    () => validateProviderConfiguration(PROVIDER_CATALOG, routing),
    /references unknown model/,
  );
});
