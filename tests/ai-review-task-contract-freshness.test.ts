import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewExecutionEnvelope } from "../src/ai-review-execution.ts";
import type { ReviewPackage } from "../src/ai-review-package.ts";
import { compareReviewFreshness } from "../src/ai-review-publication.ts";

const taskIdentity = {
  state: "resolved" as const,
  repository: "uichat-mira/example",
  issue: 42,
  updatedAt: "2026-09-11T06:00:00.000Z",
  contentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function envelope(): ReviewExecutionEnvelope {
  return {
    executionVersion: "mira-ai-review-execution/v0",
    executedAt: "2026-09-11T06:05:00.000Z",
    identity: {
      repository: "uichat-mira/example",
      pullRequest: 7,
      reviewMode: "CODE_REVIEW",
      baseSha: "1111111111111111111111111111111111111111",
      headSha: "2222222222222222222222222222222222222222",
      policyCommitSha: "3333333333333333333333333333333333333333",
      policyBlobSha: "4444444444444444444444444444444444444444",
      outputContractBlobSha: "5555555555555555555555555555555555555555",
      profileBlobSha: "6666666666666666666666666666666666666666",
      rootContractBlobSha: "7777777777777777777777777777777777777777",
      taskContract: taskIdentity,
    },
    providerSlots: { primary: "configured", fallback: "unconfigured" },
    execution: {
      state: "COMPLETED",
      review: { verdict: "NO_BLOCKING_FINDINGS", findings: [], validationGaps: [] },
      provider: { id: "provider", model: "model", role: "primary" },
      attempts: [],
    },
  };
}

function currentPackage(): ReviewPackage {
  return {
    packageVersion: "mira-ai-review-package/v0",
    runtimeVersion: "control-room-ai-review/v0",
    generatedAt: "2026-09-11T06:06:00.000Z",
    reviewMode: "CODE_REVIEW",
    trust: {
      headIsUntrusted: true,
      executesPullRequestCode: false,
      organizationControlsSource: "uichat-mira/.github@9999999999999999999999999999999999999999",
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
      policy: { source: "organization", repository: "uichat-mira/.github", path: "ai-review/POLICY.md", ref: "9999999999999999999999999999999999999999", blobSha: "4444444444444444444444444444444444444444", content: "policy" },
      outputContract: { source: "organization", repository: "uichat-mira/.github", path: "ai-review/OUTPUT-CONTRACT.md", ref: "9999999999999999999999999999999999999999", blobSha: "5555555555555555555555555555555555555555", content: "output" },
      repositoryProfile: null,
      rootContract: null,
      identity: {
        policyCommitSha: "9999999999999999999999999999999999999999",
        policyBlobSha: "4444444444444444444444444444444444444444",
        outputContractBlobSha: "5555555555555555555555555555555555555555",
        profileBlobSha: "6666666666666666666666666666666666666666",
        rootContractBlobSha: "7777777777777777777777777777777777777777",
        taskContract: { ...taskIdentity, updatedAt: "2026-09-11T07:00:00.000Z" },
      },
    },
    diff: { source: "1111111111111111111111111111111111111111...2222222222222222222222222222222222222222", content: "", chars: 0, originalChars: 0, truncated: false, limitChars: 180000 },
    gaps: [],
  };
}

test("keeps review current when only task-contract source time and policy source commit change", () => {
  assert.deepEqual(compareReviewFreshness(envelope(), currentPackage()), {
    state: "CURRENT",
    reasons: [],
  });
});
