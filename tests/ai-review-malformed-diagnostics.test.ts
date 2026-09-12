import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPackage } from "../src/ai-review-package.ts";
import { OpenAICompatibleReviewProvider } from "../src/ai-review-provider-openai-compatible.ts";
import {
  ReviewProviderError,
  executeReviewWithFallback,
  type ReviewProvider,
} from "../src/ai-review-runtime.ts";

function reviewPackage(): ReviewPackage {
  return {
    packageVersion: "mira-ai-review-package/v0",
    runtimeVersion: "control-room-ai-review/v0",
    generatedAt: "2026-09-11T00:00:00.000Z",
    reviewMode: "CODE_REVIEW",
    trust: {
      headIsUntrusted: true,
      executesPullRequestCode: false,
      organizationControlsSource: "uichat-mira/.github@3333333333333333333333333333333333333333",
      requestedOrganizationPolicyRef: "main",
      repositoryControlsSource: "uichat-mira/example@1111111111111111111111111111111111111111",
    },
    pullRequest: {
      repository: "uichat-mira/example",
      number: 12,
      title: "Malformed response diagnostics",
      body: null,
      author: "tester",
      draft: false,
      base: { ref: "dev", sha: "1111111111111111111111111111111111111111" },
      head: { ref: "feat/example", sha: "2222222222222222222222222222222222222222" },
    },
    controls: {
      policy: {
        source: "organization",
        repository: "uichat-mira/.github",
        path: "ai-review/POLICY.md",
        ref: "3333333333333333333333333333333333333333",
        blobSha: "4444444444444444444444444444444444444444",
        content: "POLICY",
      },
      outputContract: {
        source: "organization",
        repository: "uichat-mira/.github",
        path: "ai-review/OUTPUT-CONTRACT.md",
        ref: "3333333333333333333333333333333333333333",
        blobSha: "5555555555555555555555555555555555555555",
        content: "OUTPUT CONTRACT",
      },
      repositoryProfile: null,
      rootContract: null,
      taskContract: {
        state: "unavailable",
        reason: "trusted_lookup_not_configured",
      },
      identity: {
        policyCommitSha: "3333333333333333333333333333333333333333",
        policyBlobSha: "4444444444444444444444444444444444444444",
        outputContractBlobSha: "5555555555555555555555555555555555555555",
        profileBlobSha: null,
        rootContractBlobSha: null,
        taskContract: {
          state: "unavailable",
          reason: "trusted_lookup_not_configured",
        },
      },
    },
    diff: {
      source: "1111111111111111111111111111111111111111...2222222222222222222222222222222222222222",
      content: "diff --git a/a.ts b/a.ts\n+const answer = 42;\n",
      chars: 47,
      originalChars: 47,
      truncated: false,
      limitChars: 180000,
    },
    gaps: [],
  };
}

function provider() {
  return new OpenAICompatibleReviewProvider({
    id: "minimax-cn-codeplan/m3",
    role: "routine",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    model: "MiniMax-M3",
    responseFormat: "none",
  });
}

async function responseFor(content: unknown) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    });

  try {
    return await provider().review(reviewPackage());
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function failureFor(content: unknown) {
  try {
    await responseFor(content);
  } catch (error) {
    return error;
  }
  throw new Error("Expected provider review to fail");
}

async function contractFailureFor(output: unknown) {
  const invalidContract: ReviewProvider<null> = {
    id: "provider/m3",
    model: "MiniMax-M3",
    role: "routine",
    async review() {
      return {
        output,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      };
    },
  };

  const result = await executeReviewWithFallback(null, [invalidContract]);
  assert.equal(result.state, "REVIEW_UNAVAILABLE");
  return result.attempts[0];
}

const cleanReview = {
  verdict: "NO_BLOCKING_FINDINGS",
  findings: [],
  validationGaps: [],
};

const cleanReviewJson = JSON.stringify(cleanReview);

test("accepts exactly one whole-response JSON fence and preserves usage", async () => {
  const response = await responseFor(`\`\`\`json\n${cleanReviewJson}\n\`\`\``);

  assert.deepEqual(response.output, cleanReview);
  assert.deepEqual(response.usage, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
  });
});

test("accepts an unlabeled whole-response JSON fence", async () => {
  const response = await responseFor(`\`\`\`\n${cleanReviewJson}\n\`\`\``);
  assert.deepEqual(response.output, cleanReview);
});

test("does not unwrap fenced JSON when prose exists outside the fence", async () => {
  const leadingProse = await failureFor(
    `Here is the requested review.\n\`\`\`json\n${cleanReviewJson}\n\`\`\``,
  );
  assert.ok(leadingProse instanceof ReviewProviderError);
  assert.equal(leadingProse.failureClass, "malformed_response");
  assert.equal(leadingProse.failureDetail, "non_json_review_text");

  const trailingProse = await failureFor(
    `\`\`\`json\n${cleanReviewJson}\n\`\`\`\nDone.`,
  );
  assert.ok(trailingProse instanceof ReviewProviderError);
  assert.equal(trailingProse.failureClass, "malformed_response");
  assert.equal(trailingProse.failureDetail, "review_json_fenced");
});

test("keeps malformed or incomplete fences as explicit fenced-review failures", async () => {
  const error = await failureFor(`\`\`\`json\n${cleanReviewJson}`);
  assert.ok(error instanceof ReviewProviderError);
  assert.equal(error.failureClass, "malformed_response");
  assert.equal(error.failureDetail, "review_json_fenced");
  assert.deepEqual(error.usage, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
  });
  assert.equal(error.message.includes("NO_BLOCKING_FINDINGS"), false);
});

test("distinguishes non-JSON review text from syntactically invalid JSON", async () => {
  const prose = await failureFor("Here is the requested review.");
  assert.ok(prose instanceof ReviewProviderError);
  assert.equal(prose.failureDetail, "non_json_review_text");

  const invalidJson = await failureFor('{"verdict":');
  assert.ok(invalidJson instanceof ReviewProviderError);
  assert.equal(invalidJson.failureDetail, "invalid_review_json");
});

test("preserves provider usage and safe detail on failed attempts", async () => {
  const failing: ReviewProvider<null> = {
    id: "provider/m3",
    model: "MiniMax-M3",
    role: "routine",
    async review() {
      throw new ReviewProviderError("generic safe message", "malformed_response", {
        failureDetail: "review_json_fenced",
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      });
    },
  };

  const result = await executeReviewWithFallback(null, [failing]);
  assert.equal(result.state, "REVIEW_UNAVAILABLE");
  assert.deepEqual(result.attempts[0], {
    provider: "provider/m3",
    model: "MiniMax-M3",
    role: "routine",
    status: "failed",
    latencyMs: result.attempts[0].latencyMs,
    failureClass: "malformed_response",
    failureDetail: "review_json_fenced",
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
  });
});

test("reports safe normalization reason and path for an invalid verdict", async () => {
  const attempt = await contractFailureFor({
    verdict: "PASS",
    findings: [],
    validationGaps: [],
  });

  assert.equal(attempt.failureClass, "malformed_response");
  assert.equal(attempt.failureDetail, "invalid_review_contract");
  assert.equal(attempt.normalizationReason, "verdict_invalid");
  assert.equal(attempt.normalizationPath, "review.verdict");
  assert.deepEqual(attempt.usage, {
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
  });
});

test("reports the schema path for a missing finding field without exposing values", async () => {
  const attempt = await contractFailureFor({
    verdict: "CHANGES_NEEDED",
    findings: [
      {
        severity: "P1",
        observation: "observed",
        inference: "inferred",
        judgment: "judged",
        impact: "impact",
        location: "a.ts:1",
        suggestedFix: "fix",
      },
    ],
    validationGaps: [],
  });

  assert.equal(attempt.failureDetail, "invalid_review_contract");
  assert.equal(attempt.normalizationReason, "finding_field_invalid");
  assert.equal(attempt.normalizationPath, "review.findings[0].verification");
});

test("reports invalid validation-gap shape without serializing provider content", async () => {
  const attempt = await contractFailureFor({
    verdict: "HUMAN_CHECK_NEEDED",
    findings: [],
    validationGaps: [{ detail: "private provider text" }],
  });

  assert.equal(attempt.failureDetail, "invalid_review_contract");
  assert.equal(attempt.normalizationReason, "validation_gap_invalid");
  assert.equal(attempt.normalizationPath, "review.validationGaps[0]");
  assert.equal(JSON.stringify(attempt).includes("private provider text"), false);
});

test("classifies missing message content while retaining usage", async () => {
  const error = await failureFor(null);
  assert.ok(error instanceof ReviewProviderError);
  assert.equal(error.failureDetail, "missing_message_content");
  assert.deepEqual(error.usage, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
  });
});
