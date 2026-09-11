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
