import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPackage } from "../src/ai-review-package.ts";
import {
  executeTrustedReviewPackage,
  type ReviewExecutionEnvelope,
} from "../src/ai-review-execution.ts";
import {
  MAX_REVIEW_COMMENT_BYTES,
  MIRA_REVIEW_MARKER,
  ReviewPublicationError,
  compareReviewFreshness,
  renderReviewComment,
} from "../src/ai-review-publication.ts";

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
      number: 7,
      title: "Example",
      body: null,
      author: "builder",
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
        content: "Policy",
      },
      outputContract: {
        source: "organization",
        repository: "uichat-mira/.github",
        path: "ai-review/OUTPUT-CONTRACT.md",
        ref: "3333333333333333333333333333333333333333",
        blobSha: "5555555555555555555555555555555555555555",
        content: "Output contract",
      },
      repositoryProfile: null,
      rootContract: null,
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
      content: "diff --git a/a b/a\n+change\n",
      chars: 28,
      originalChars: 28,
      truncated: false,
      limitChars: 180000,
    },
    gaps: [
      {
        code: "missing_repository_profile",
        message: "Deterministic package gap.",
        material: true,
      },
    ],
  };
}

function completedEnvelope(
  overrides: Partial<ReviewExecutionEnvelope> = {},
): ReviewExecutionEnvelope {
  return {
    executionVersion: "mira-ai-review-execution/v0",
    executedAt: "2026-09-11T06:00:00.000Z",
    identity: {
      repository: "uichat-mira/example",
      pullRequest: 7,
      reviewMode: "CODE_REVIEW",
      baseSha: "1111111111111111111111111111111111111111",
      headSha: "2222222222222222222222222222222222222222",
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
    providerSlots: { primary: "configured", fallback: "unconfigured" },
    execution: {
      state: "COMPLETED",
      review: {
        verdict: "NO_BLOCKING_FINDINGS",
        findings: [],
        validationGaps: [],
      },
      provider: {
        id: "primary-test",
        model: "review-model",
        role: "primary",
      },
      attempts: [
        {
          provider: "primary-test",
          model: "review-model",
          role: "primary",
          status: "success",
          latencyMs: 123,
        },
      ],
    },
    ...overrides,
  };
}

test("renders the Organization marker exactly once with every required logical section", () => {
  const body = renderReviewComment(completedEnvelope());

  assert.equal(body.split(MIRA_REVIEW_MARKER).length - 1, 1);
  assert.match(body, /### Verdict/);
  assert.match(body, /`NO_BLOCKING_FINDINGS`/);
  assert.match(body, /### Findings/);
  assert.match(body, /No high-confidence P0-P2 findings were established\./);
  assert.match(body, /### Validation gaps/);
  assert.match(body, /None identified\./);
  assert.match(body, /### Review metadata/);
  assert.match(body, /CODE_REVIEW/);
  assert.match(body, /Trusted Task \/ PR contract/);
  assert.match(body, /trusted_lookup_not_configured/);
  assert.match(body, /primary-test/);
  assert.match(body, /review-model/);
  assert.match(body, /mira-ai-review-output\/v1/);
  assert.match(body, /control-room-ai-review\/v0/);
  assert.match(body, /mira-ai-review-execution\/v0/);
  assert.match(body, /2026-09-11T06:00:00\.000Z/);
});

test("renders all required finding fields", () => {
  const envelope = completedEnvelope();
  if (envelope.execution.state !== "COMPLETED") throw new Error("fixture");
  envelope.execution.review = {
    verdict: "CHANGES_NEEDED",
    findings: [
      {
        severity: "P1",
        observation: "Changed code bypasses the guard.",
        inference: "The protected path can execute without validation.",
        judgment: "This violates the explicit task contract.",
        impact: "Invalid requests can reach production handling.",
        location: "src/example.ts:42",
        suggestedFix: "Restore the guard before dispatch.",
        verification: "Run the focused request-validation test.",
      },
    ],
    validationGaps: ["Device validation was not available."],
  };

  const body = renderReviewComment(envelope);
  for (const field of [
    "Observation",
    "Inference",
    "Judgment",
    "Impact",
    "Location",
    "Suggested Fix",
    "Verification",
  ]) {
    assert.match(body, new RegExp(`\\*\\*${field}:\\*\\*`));
  }
  assert.match(body, /Finding 1 — P1/);
  assert.match(body, /Device validation was not available/);
});

test("renders structured CONTRACT_CONFLICT evidence", () => {
  const envelope = completedEnvelope();
  if (envelope.execution.state !== "COMPLETED") throw new Error("fixture");
  envelope.execution.review = {
    verdict: "CONTRACT_CONFLICT",
    findings: [],
    validationGaps: [],
    contractConflict: {
      sources: ["Task contract", "base AGENTS.md"],
      conflictingRequirements: ["Use protocol A", "Protocol A is forbidden"],
      whyItChangesJudgment: "The intended behavior cannot be determined reliably.",
      maintainerDecisionRequired: "Choose the governing requirement.",
    },
  };

  const body = renderReviewComment(envelope);
  assert.match(body, /### Contract conflict/);
  assert.match(body, /Task contract; base AGENTS\.md/);
  assert.match(body, /Use protocol A/);
  assert.match(body, /Protocol A is forbidden/);
  assert.match(body, /Choose the governing requirement/);
});

test("neutralizes provider-controlled Markdown, mentions, and duplicate review markers", () => {
  const envelope = completedEnvelope();
  if (envelope.execution.state !== "COMPLETED") throw new Error("fixture");
  envelope.execution.review = {
    verdict: "HUMAN_CHECK_NEEDED",
    findings: [],
    validationGaps: [
      "<!-- mira-ai-review:v1 -->\n@octocat [click](https://evil.example) #123",
    ],
  };

  const body = renderReviewComment(envelope);
  assert.equal(body.split(MIRA_REVIEW_MARKER).length - 1, 1);
  assert.equal(body.includes("@octocat"), false);
  assert.equal(body.includes("[click](https://evil.example)"), false);
  assert.match(body, /&lt;!-- mira-ai-review:v1 --&gt;/);
  assert.match(body, /@\u200boctocat/);
});

test("refuses to render REVIEW_UNAVAILABLE as a current review comment", () => {
  const envelope = completedEnvelope({
    execution: {
      state: "REVIEW_UNAVAILABLE",
      reason: "no_eligible_provider",
      attempts: [],
    },
  });

  assert.throws(() => renderReviewComment(envelope), ReviewPublicationError);
});

test("fails closed instead of truncating an oversized normalized review comment", () => {
  const envelope = completedEnvelope();
  if (envelope.execution.state !== "COMPLETED") throw new Error("fixture");
  envelope.execution.review = {
    verdict: "HUMAN_CHECK_NEEDED",
    findings: [],
    validationGaps: ["x".repeat(MAX_REVIEW_COMMENT_BYTES)],
  };

  assert.throws(
    () => renderReviewComment(envelope),
    /exceeds the 60000-byte publication limit/,
  );
});

test("publication byte limit also protects multibyte Chinese output", () => {
  const envelope = completedEnvelope();
  if (envelope.execution.state !== "COMPLETED") throw new Error("fixture");
  envelope.execution.review = {
    verdict: "HUMAN_CHECK_NEEDED",
    findings: [],
    validationGaps: ["审".repeat(21_000)],
  };

  assert.ok(envelope.execution.review.validationGaps[0].length < MAX_REVIEW_COMMENT_BYTES);
  assert.throws(
    () => renderReviewComment(envelope),
    /exceeds the 60000-byte publication limit/,
  );
});

test("treats an unchanged package identity as CURRENT", () => {
  assert.deepEqual(compareReviewFreshness(completedEnvelope(), reviewPackage()), {
    state: "CURRENT",
    reasons: [],
  });
});

test("does not stale a review when only the source policy commit changes", () => {
  const current = reviewPackage();
  current.controls.identity.policyCommitSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  assert.deepEqual(compareReviewFreshness(completedEnvelope(), current), {
    state: "CURRENT",
    reasons: [],
  });
});

test("marks changed PR or actual trusted-control content as STALE_REVIEW", () => {
  const current = reviewPackage();
  current.pullRequest.head.sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  current.controls.identity.policyBlobSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  current.controls.identity.profileBlobSha = "cccccccccccccccccccccccccccccccccccccccc";

  assert.deepEqual(compareReviewFreshness(completedEnvelope(), current), {
    state: "STALE_REVIEW",
    reasons: ["head_sha", "policy_blob", "profile_blob"],
  });
});

test("marks review mode changes as STALE_REVIEW", () => {
  const current = reviewPackage();
  current.reviewMode = "PROMOTION_REVIEW";

  assert.deepEqual(compareReviewFreshness(completedEnvelope(), current), {
    state: "STALE_REVIEW",
    reasons: ["review_mode"],
  });
});

test("marks trusted Task / PR Contract identity changes as STALE_REVIEW", () => {
  const current = reviewPackage();
  current.controls.identity.taskContract = {
    state: "resolved",
    repository: "uichat-mira/example",
    issue: 42,
    updatedAt: "2026-09-11T06:10:00.000Z",
    contentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };

  assert.deepEqual(compareReviewFreshness(completedEnvelope(), current), {
    state: "STALE_REVIEW",
    reasons: ["task_contract"],
  });
});

test("runtime preserves deterministic gaps and promotes an invalid clean verdict", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "NO_BLOCKING_FINDINGS",
              findings: [],
              validationGaps: [],
            }),
          },
        },
      ],
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(
    {
      AI_REVIEW_PRIMARY_ID: "primary-test",
      AI_REVIEW_PRIMARY_ENDPOINT: "https://provider.example/v1/chat/completions",
      AI_REVIEW_PRIMARY_API_KEY: "provider-secret",
      AI_REVIEW_PRIMARY_MODEL: "review-model",
    },
    reviewPackage(),
  );

  assert.equal(result.execution.state, "COMPLETED");
  assert.equal(result.execution.review.verdict, "HUMAN_CHECK_NEEDED");
  assert.deepEqual(result.execution.review.validationGaps, ["Deterministic package gap."]);
  assert.equal(result.identity.reviewMode, "CODE_REVIEW");
  assert.deepEqual(result.identity.taskContract, {
    state: "unavailable",
    reason: "trusted_lookup_not_configured",
  });
  assert.match(result.executedAt, /^\d{4}-\d{2}-\d{2}T/);
});
