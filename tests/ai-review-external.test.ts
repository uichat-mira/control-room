import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPackage } from "../src/ai-review-package.ts";
import {
  ExternalReviewSubmissionError,
  buildExternalReviewEnvelope,
  externalIdentityMismatches,
  parseExternalReviewSubmission,
} from "../src/ai-review-external.ts";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const POLICY_COMMIT = "3333333333333333333333333333333333333333";
const POLICY_BLOB = "4444444444444444444444444444444444444444";
const OUTPUT_BLOB = "5555555555555555555555555555555555555555";

function pkg(): ReviewPackage {
  return {
    packageVersion: "mira-ai-review-package/v0",
    runtimeVersion: "control-room-ai-review/v0",
    generatedAt: "2026-10-01T00:00:00.000Z",
    reviewMode: "CODE_REVIEW",
    trust: {
      headIsUntrusted: true,
      executesPullRequestCode: false,
      organizationControlsSource: `uichat-mira/.github@${POLICY_COMMIT}`,
      requestedOrganizationPolicyRef: "main",
      repositoryControlsSource: `uichat-mira/mira-desktop@${BASE_SHA}`,
    },
    pullRequest: {
      repository: "uichat-mira/mira-desktop",
      number: 177,
      title: "OpenCode runner",
      body: null,
      author: "builder",
      draft: false,
      base: { ref: "dev", sha: BASE_SHA },
      head: { ref: "feat/example", sha: HEAD_SHA },
    },
    controls: {
      policy: {
        source: "organization",
        repository: "uichat-mira/.github",
        path: "ai-review/POLICY.md",
        ref: POLICY_COMMIT,
        blobSha: POLICY_BLOB,
        content: "policy",
      },
      outputContract: {
        source: "organization",
        repository: "uichat-mira/.github",
        path: "ai-review/OUTPUT-CONTRACT.md",
        ref: POLICY_COMMIT,
        blobSha: OUTPUT_BLOB,
        content: "output",
      },
      repositoryProfile: null,
      rootContract: null,
      taskContract: null,
      identity: {
        policyCommitSha: POLICY_COMMIT,
        policyBlobSha: POLICY_BLOB,
        outputContractBlobSha: OUTPUT_BLOB,
        profileBlobSha: null,
        rootContractBlobSha: null,
        taskContract: {
          state: "unavailable",
          reason: "no_linked_issue",
        },
      },
    },
    diff: {
      source: `${BASE_SHA}...${HEAD_SHA}`,
      content: "diff",
      chars: 4,
      originalChars: 4,
      truncated: false,
      limitChars: 180000,
    },
    gaps: [
      {
        code: "missing_repository_profile",
        message: "Missing repository-specific review profile.",
        material: true,
      },
    ],
  };
}

function rawSubmission(review: unknown = {
  verdict: "NO_BLOCKING_FINDINGS",
  findings: [],
  validationGaps: [],
}) {
  return {
    repository: "uichat-mira/mira-desktop",
    pullRequest: 177,
    identity: {
      repository: "uichat-mira/mira-desktop",
      pullRequest: 177,
      reviewMode: "CODE_REVIEW",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      policyCommitSha: POLICY_COMMIT,
      policyBlobSha: POLICY_BLOB,
      outputContractBlobSha: OUTPUT_BLOB,
      profileBlobSha: null,
      rootContractBlobSha: null,
      taskContract: {
        state: "unavailable",
        reason: "no_linked_issue",
      },
    },
    execution: {
      engine: "opencode",
      provider: "opencode-go",
      model: "minimax-m3",
      role: "routine",
      latencyMs: 321,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
      review,
    },
  };
}

test("parses a bounded external review submission without accepting control material", () => {
  const submission = parseExternalReviewSubmission(rawSubmission());

  assert.equal(submission.execution.engine, "opencode");
  assert.equal(submission.execution.provider, "opencode-go");
  assert.equal(submission.execution.model, "minimax-m3");
  assert.equal(submission.execution.role, "routine");
  assert.deepEqual(submission.execution.usage, {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
  });
});

test("requires the top-level target to match the submitted identity", () => {
  const input = rawSubmission();
  input.identity.pullRequest = 178;

  assert.throws(
    () => parseExternalReviewSubmission(input),
    (error: unknown) => {
      assert.ok(error instanceof ExternalReviewSubmissionError);
      assert.equal(error.code, "invalid_external_submission");
      return true;
    },
  );
});

test("detects exact trusted-package identity changes including policy commit identity", () => {
  const submission = parseExternalReviewSubmission(rawSubmission());
  submission.identity.policyCommitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  assert.deepEqual(externalIdentityMismatches(pkg(), submission.identity), [
    "policy_commit_sha",
  ]);
});

test("normalizes external review output and reconciles deterministic material gaps", () => {
  const submission = parseExternalReviewSubmission(rawSubmission());
  const envelope = buildExternalReviewEnvelope(pkg(), submission);

  assert.equal(envelope.execution.state, "COMPLETED");
  if (envelope.execution.state !== "COMPLETED") return;

  assert.equal(envelope.execution.review.verdict, "HUMAN_CHECK_NEEDED");
  assert.deepEqual(envelope.execution.review.validationGaps, [
    "Missing repository-specific review profile.",
  ]);
  assert.equal(envelope.execution.provider.engine, "opencode");
  assert.equal(envelope.execution.provider.id, "opencode-go");
  assert.equal(envelope.execution.provider.model, "minimax-m3");
  assert.deepEqual(envelope.identity, {
    repository: "uichat-mira/mira-desktop",
    pullRequest: 177,
    reviewMode: "CODE_REVIEW",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    policyCommitSha: POLICY_COMMIT,
    policyBlobSha: POLICY_BLOB,
    outputContractBlobSha: OUTPUT_BLOB,
    profileBlobSha: null,
    rootContractBlobSha: null,
    taskContract: {
      state: "unavailable",
      reason: "no_linked_issue",
    },
  });
});

test("rejects malformed external model output before it can become a completed review", () => {
  const submission = parseExternalReviewSubmission(rawSubmission({
    verdict: "PASS",
    findings: [],
    validationGaps: [],
  }));

  assert.throws(
    () => buildExternalReviewEnvelope(pkg(), submission),
    (error: unknown) => {
      assert.ok(error instanceof ExternalReviewSubmissionError);
      assert.equal(error.code, "invalid_external_review");
      assert.equal(error.status, 422);
      return true;
    },
  );
});
