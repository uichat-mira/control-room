import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewProviderRegistry } from "../src/ai-review-provider-registry.ts";

function basePrimaryEnv() {
  return {
    AI_REVIEW_PRIMARY_ID: "primary-test",
    AI_REVIEW_PRIMARY_ENDPOINT: "https://provider.example/v1/chat/completions",
    AI_REVIEW_PRIMARY_API_KEY: "secret",
    AI_REVIEW_PRIMARY_MODEL: "review-model",
  };
}

test("accepts explicit per-instance input and output budgets", () => {
  const registry = buildReviewProviderRegistry({
    ...basePrimaryEnv(),
    AI_REVIEW_PRIMARY_MAX_PROMPT_CHARACTERS: "120000",
    AI_REVIEW_PRIMARY_MAX_OUTPUT_TOKENS: "4096",
    AI_REVIEW_PRIMARY_OUTPUT_TOKEN_PARAMETER: "max_completion_tokens",
  });

  assert.equal(registry.slots.primary, "configured");
  assert.equal(registry.providers.length, 1);
  assert.equal(registry.providers[0]?.id, "primary-test");
});

test("rejects an output token budget without an explicit compatible parameter", () => {
  const registry = buildReviewProviderRegistry({
    ...basePrimaryEnv(),
    AI_REVIEW_PRIMARY_MAX_OUTPUT_TOKENS: "4096",
  });

  assert.equal(registry.slots.primary, "invalid");
  assert.equal(registry.providers.length, 0);
});

test("rejects an output token parameter without a token budget", () => {
  const registry = buildReviewProviderRegistry({
    ...basePrimaryEnv(),
    AI_REVIEW_PRIMARY_OUTPUT_TOKEN_PARAMETER: "max_tokens",
  });

  assert.equal(registry.slots.primary, "invalid");
  assert.equal(registry.providers.length, 0);
});

test("rejects invalid provider input budget configuration", () => {
  const registry = buildReviewProviderRegistry({
    ...basePrimaryEnv(),
    AI_REVIEW_PRIMARY_MAX_PROMPT_CHARACTERS: "not-a-number",
  });

  assert.equal(registry.slots.primary, "invalid");
  assert.equal(registry.providers.length, 0);
});
