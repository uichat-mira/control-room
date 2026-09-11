import assert from "node:assert/strict";
import test from "node:test";

import { sharedAiReviewEnv } from "../src/ai-review-env.ts";
import type { AiReviewEnv } from "../src/ai-review.ts";

test("keeps caller authentication distinct from GitHub read credentials", () => {
  const source = {
    GITHUB_READ_TOKEN: "github-read-token",
    AI_REVIEW_GATEWAY_TOKEN: "purpose-specific-caller-token",
    AI_REVIEW_POLICY_REF: "main",
  } satisfies AiReviewEnv;

  const result = sharedAiReviewEnv(source);

  assert.equal(result.GITHUB_READ_TOKEN, "github-read-token");
  assert.equal(result.AI_REVIEW_GATEWAY_TOKEN, "purpose-specific-caller-token");
  assert.notEqual(result.AI_REVIEW_GATEWAY_TOKEN, result.GITHUB_READ_TOKEN);
});

test("does not fall back to the GitHub read token when caller auth is absent", () => {
  const result = sharedAiReviewEnv({
    GITHUB_READ_TOKEN: "github-read-token",
  });

  assert.equal(result.GITHUB_READ_TOKEN, "github-read-token");
  assert.equal(result.AI_REVIEW_GATEWAY_TOKEN, undefined);
});

test("forwards only modeled provider-account credentials into review runtime env", () => {
  const source = {
    AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY: "minimax-key",
    AI_PROVIDER_VOLCENGINE_CODING_PLAN_KEY: "volcano-key",
    AI_PROVIDER_OPENCODE_GO_KEY: "go-key",
    AI_REVIEW_PRIMARY_API_KEY: "legacy-primary-key",
    AI_REVIEW_FALLBACK_API_KEY: "legacy-fallback-key",
  } as AiReviewEnv & {
    AI_REVIEW_PRIMARY_API_KEY: string;
    AI_REVIEW_FALLBACK_API_KEY: string;
  };

  const result = sharedAiReviewEnv(source) as AiReviewEnv & {
    AI_REVIEW_PRIMARY_API_KEY?: string;
    AI_REVIEW_FALLBACK_API_KEY?: string;
  };

  assert.equal(result.AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY, "minimax-key");
  assert.equal(result.AI_PROVIDER_VOLCENGINE_CODING_PLAN_KEY, "volcano-key");
  assert.equal(result.AI_PROVIDER_OPENCODE_GO_KEY, "go-key");
  assert.equal("AI_REVIEW_PRIMARY_API_KEY" in result, false);
  assert.equal("AI_REVIEW_FALLBACK_API_KEY" in result, false);
});

test("does not pass unrelated future GitHub write credentials into review runtime env", () => {
  const source = {
    GITHUB_READ_TOKEN: "github-read-token",
    AI_REVIEW_GATEWAY_TOKEN: "caller-token",
    GITHUB_PUBLISH_TOKEN: "future-write-token",
  } as AiReviewEnv & { GITHUB_PUBLISH_TOKEN: string };

  const result = sharedAiReviewEnv(source) as AiReviewEnv & {
    GITHUB_PUBLISH_TOKEN?: string;
  };

  assert.equal(result.AI_REVIEW_GATEWAY_TOKEN, "caller-token");
  assert.equal("GITHUB_PUBLISH_TOKEN" in result, false);
  assert.equal(result.GITHUB_PUBLISH_TOKEN, undefined);
});
