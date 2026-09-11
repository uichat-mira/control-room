import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewNormalizationError,
  ReviewProviderError,
  executeReviewWithFallback,
  failureClassForHttpStatus,
  normalizeProviderReview,
  type ReviewProvider,
} from "../src/ai-review-runtime.ts";

const cleanReview = {
  verdict: "NO_BLOCKING_FINDINGS",
  findings: [],
  validationGaps: [],
};

test("normalizes a clean Mira review", () => {
  assert.deepEqual(normalizeProviderReview(cleanReview), cleanReview);
});

test("rejects P3 findings", () => {
  assert.throws(
    () =>
      normalizeProviderReview({
        verdict: "CHANGES_NEEDED",
        findings: [
          {
            severity: "P3",
            observation: "Observed",
            inference: "Inferred",
            judgment: "Judged",
            impact: "Impact",
            location: "src/example.ts:1",
            suggestedFix: "Fix",
            verification: "Verify",
          },
        ],
        validationGaps: [],
      }),
    ReviewNormalizationError,
  );
});

test("requires a blocking finding for CHANGES_NEEDED", () => {
  assert.throws(
    () =>
      normalizeProviderReview({
        verdict: "CHANGES_NEEDED",
        findings: [],
        validationGaps: [],
      }),
    /requires at least one P0-P2 finding/,
  );
});

test("requires a material validation gap for HUMAN_CHECK_NEEDED", () => {
  assert.throws(
    () =>
      normalizeProviderReview({
        verdict: "HUMAN_CHECK_NEEDED",
        findings: [],
        validationGaps: [],
      }),
    /requires at least one material validation gap/,
  );
});

test("requires structured conflict detail for CONTRACT_CONFLICT", () => {
  const normalized = normalizeProviderReview({
    verdict: "CONTRACT_CONFLICT",
    findings: [],
    validationGaps: [],
    contractConflict: {
      sources: ["Issue #1", "base AGENTS.md"],
      conflictingRequirements: ["Use A", "Do not use A"],
      whyItChangesJudgment: "The reviewer cannot determine the intended behavior.",
      maintainerDecisionRequired: "Choose which explicit contract governs this change.",
    },
  });

  assert.equal(normalized.verdict, "CONTRACT_CONFLICT");
  assert.equal(normalized.contractConflict?.sources.length, 2);
});

test("maps provider HTTP failures into stable technical classes", () => {
  assert.equal(failureClassForHttpStatus(401), "provider_auth");
  assert.equal(failureClassForHttpStatus(402), "quota");
  assert.equal(failureClassForHttpStatus(429), "rate_limit");
  assert.equal(failureClassForHttpStatus(504), "timeout");
  assert.equal(failureClassForHttpStatus(503), "provider_unavailable");
  assert.equal(failureClassForHttpStatus(400), "unknown");
});

test("returns the first normalized routine result", async () => {
  let fallbackCalled = false;
  const providers: ReviewProvider<{ task: string }>[] = [
    {
      id: "routine-example",
      model: "model-a",
      role: "routine",
      async review() {
        return { output: cleanReview, usage: { totalTokens: 123 } };
      },
    },
    {
      id: "fallback-example",
      model: "model-b",
      role: "fallback",
      async review() {
        fallbackCalled = true;
        return { output: cleanReview };
      },
    },
  ];

  const result = await executeReviewWithFallback({ task: "review" }, providers);

  assert.equal(result.state, "COMPLETED");
  if (result.state !== "COMPLETED") return;
  assert.equal(result.provider.id, "routine-example");
  assert.equal(result.provider.role, "routine");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].usage?.totalTokens, 123);
  assert.equal(fallbackCalled, false);
});

test("falls back only after a provider execution failure", async () => {
  const providers: ReviewProvider<null>[] = [
    {
      id: "routine-example",
      model: "model-a",
      role: "routine",
      async review() {
        throw new ReviewProviderError("rate limited", "rate_limit");
      },
    },
    {
      id: "fallback-example",
      model: "model-b",
      role: "fallback",
      async review() {
        return {
          output: {
            verdict: "HUMAN_CHECK_NEEDED",
            findings: [],
            validationGaps: ["Device validation was unavailable."],
          },
        };
      },
    },
  ];

  const result = await executeReviewWithFallback(null, providers);

  assert.equal(result.state, "COMPLETED");
  if (result.state !== "COMPLETED") return;
  assert.equal(result.provider.id, "fallback-example");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].failureClass, "rate_limit");
  assert.equal(result.attempts[1].status, "success");
});

test("treats malformed provider output as a technical failure eligible for fallback", async () => {
  const providers: ReviewProvider<null>[] = [
    {
      id: "routine-example",
      model: "model-a",
      role: "routine",
      async review() {
        return { output: { verdict: "PASS" } };
      },
    },
    {
      id: "fallback-example",
      model: "model-b",
      role: "fallback",
      async review() {
        return { output: cleanReview };
      },
    },
  ];

  const result = await executeReviewWithFallback(null, providers);

  assert.equal(result.state, "COMPLETED");
  if (result.state !== "COMPLETED") return;
  assert.equal(result.attempts[0].failureClass, "malformed_response");
  assert.equal(result.provider.id, "fallback-example");
});

test("returns REVIEW_UNAVAILABLE instead of a false clean verdict when every provider fails", async () => {
  const providers: ReviewProvider<null>[] = [
    {
      id: "routine-example",
      model: "model-a",
      role: "routine",
      async review() {
        throw new ReviewProviderError("provider down", "provider_unavailable");
      },
    },
    {
      id: "fallback-example",
      model: "model-b",
      role: "fallback",
      async review() {
        throw new ReviewProviderError("quota exhausted", "quota");
      },
    },
  ];

  const result = await executeReviewWithFallback(null, providers);

  assert.deepEqual(
    { state: result.state, reason: result.state === "REVIEW_UNAVAILABLE" ? result.reason : null },
    { state: "REVIEW_UNAVAILABLE", reason: "all_eligible_providers_failed" },
  );
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].failureClass, "provider_unavailable");
  assert.equal(result.attempts[1].failureClass, "quota");
});

test("returns REVIEW_UNAVAILABLE when no provider is configured", async () => {
  const result = await executeReviewWithFallback(null, []);
  assert.deepEqual(result, {
    state: "REVIEW_UNAVAILABLE",
    reason: "no_eligible_provider",
    attempts: [],
  });
});
