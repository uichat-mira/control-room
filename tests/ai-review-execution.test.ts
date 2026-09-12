import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPackage, ReviewPackageGap } from "../src/ai-review-package.ts";
import { executeTrustedReviewPackage } from "../src/ai-review-execution.ts";
import { buildReviewProviderRegistry } from "../src/ai-review-provider-registry.ts";

function pkg(gaps: ReviewPackageGap[] = [
  {
    code: "missing_repository_profile",
    message: "Missing repository-specific review profile.",
    material: true,
  },
]): ReviewPackage {
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
    gaps,
  };
}

const routineEnv = {
  AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY: "minimax-secret",
};

const fallbackEnv = {
  AI_PROVIDER_OPENCODE_GO_KEY: "opencode-go-secret",
};

function providerResponse(review: unknown) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(review) } }],
  });
}

function humanCheckResponse() {
  return providerResponse({
    verdict: "HUMAN_CHECK_NEEDED",
    findings: [],
    validationGaps: ["Missing repository-specific review profile."],
  });
}

test("reports modeled CODE_REVIEW routes without exposing provider configuration values", () => {
  const registry = buildReviewProviderRegistry({}, "CODE_REVIEW");

  assert.equal(registry.providers.length, 0);
  assert.deepEqual(registry.route.routine, {
    state: "unconfigured",
    enabled: true,
    provider: "minimax-cn-codeplan",
    model: "m3",
    driver: "openai-chat",
  });
  assert.deepEqual(registry.route.fallback, {
    state: "unconfigured",
    enabled: false,
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    driver: "openai-chat",
  });
  assert.deepEqual(registry.route.escalation, {
    state: "unconfigured",
    enabled: false,
    provider: "opencode-go",
    model: "deepseek-v4-pro",
    driver: "openai-chat",
  });
});

test("keeps configured but disabled fallback and escalation out of the execution queue", () => {
  const registry = buildReviewProviderRegistry(
    { ...routineEnv, ...fallbackEnv },
    "CODE_REVIEW",
  );

  assert.equal(registry.route.routine.state, "configured");
  assert.equal(registry.route.routine.enabled, true);
  assert.equal(registry.route.fallback?.state, "configured");
  assert.equal(registry.route.fallback?.enabled, false);
  assert.equal(registry.route.escalation?.state, "configured");
  assert.equal(registry.route.escalation?.enabled, false);
  assert.equal(registry.providers.length, 1);
  assert.equal(registry.providers[0].id, "minimax-cn-codeplan/m3");
  assert.equal(registry.providers[0].role, "routine");
});

test("returns REVIEW_UNAVAILABLE when no provider account credential is configured", async () => {
  const result = await executeTrustedReviewPackage({}, pkg());

  assert.equal(result.executionVersion, "mira-ai-review-execution/v0");
  assert.equal(result.providerRoute.routine.state, "unconfigured");
  assert.equal(result.providerRoute.routine.enabled, true);
  assert.equal(result.providerRoute.fallback?.state, "unconfigured");
  assert.equal(result.providerRoute.fallback?.enabled, false);
  assert.equal(result.providerRoute.escalation?.state, "unconfigured");
  assert.equal(result.providerRoute.escalation?.enabled, false);
  assert.equal(result.identity.reviewMode, "CODE_REVIEW");
  assert.deepEqual(result.identity.taskContract, {
    state: "unavailable",
    reason: "trusted_lookup_not_configured",
  });
  assert.deepEqual(result.execution, {
    state: "REVIEW_UNAVAILABLE",
    reason: "no_eligible_provider",
    attempts: [],
  });
});

test("executes the configured routine provider and returns normalized review metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  let providerRequestBody = "";
  let authorization = "";

  globalThis.fetch = async (_input, init) => {
    providerRequestBody = String(init?.body ?? "");
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return humanCheckResponse();
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(routineEnv, pkg());

  assert.equal(result.execution.state, "COMPLETED");
  if (result.execution.state !== "COMPLETED") return;
  assert.equal(result.execution.provider.id, "minimax-cn-codeplan/m3");
  assert.equal(result.execution.provider.model, "MiniMax-M3");
  assert.equal(result.execution.provider.role, "routine");
  assert.equal(result.execution.review.verdict, "HUMAN_CHECK_NEEDED");
  assert.equal(result.execution.attempts.length, 1);
  assert.equal(result.execution.attempts[0].status, "success");
  assert.equal(providerRequestBody.includes("minimax-secret"), false);
  assert.equal(authorization, "Bearer minimax-secret");
});

test("promotes a clean provider verdict when a deterministic gap is material", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => providerResponse({
    verdict: "NO_BLOCKING_FINDINGS",
    findings: [],
    validationGaps: [],
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(routineEnv, pkg());
  assert.equal(result.execution.state, "COMPLETED");
  assert.equal(result.execution.review.verdict, "HUMAN_CHECK_NEEDED");
  assert.deepEqual(result.execution.review.validationGaps, [
    "Missing repository-specific review profile.",
  ]);
});

test("keeps a clean verdict when deterministic gaps are explicitly non-material", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => providerResponse({
    verdict: "NO_BLOCKING_FINDINGS",
    findings: [],
    validationGaps: [],
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(routineEnv, pkg([
    { code: "missing_repository_profile", message: "Informational migration note.", material: false },
  ]));
  assert.equal(result.execution.state, "COMPLETED");
  assert.equal(result.execution.review.verdict, "NO_BLOCKING_FINDINGS");
  assert.deepEqual(result.execution.review.validationGaps, ["Informational migration note."]);
});

test("does not downgrade CHANGES_NEEDED when a deterministic gap is material", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => providerResponse({
    verdict: "CHANGES_NEEDED",
    findings: [{
      severity: "P1",
      observation: "Observed break.",
      inference: "Core flow fails.",
      judgment: "This is blocking.",
      impact: "Users cannot continue.",
      location: "src/a.ts:1",
      suggestedFix: "Restore the required behavior.",
      verification: "Run the focused regression test.",
    }],
    validationGaps: [],
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(routineEnv, pkg());
  assert.equal(result.execution.state, "COMPLETED");
  assert.equal(result.execution.review.verdict, "CHANGES_NEEDED");
  assert.equal(result.execution.review.findings.length, 1);
});

test("does not downgrade CONTRACT_CONFLICT when a deterministic gap is material", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => providerResponse({
    verdict: "CONTRACT_CONFLICT",
    findings: [],
    validationGaps: [],
    contractConflict: {
      sources: ["Task contract", "repository profile"],
      conflictingRequirements: ["Use A", "Do not use A"],
      whyItChangesJudgment: "Both requirements cannot be satisfied together.",
      maintainerDecisionRequired: "Choose the governing requirement.",
    },
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(routineEnv, pkg());
  assert.equal(result.execution.state, "COMPLETED");
  assert.equal(result.execution.review.verdict, "CONTRACT_CONFLICT");
});

test("does not invoke a configured fallback while the fallback route is disabled", async (t) => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const bodies: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    requested.push(url);
    bodies.push(String(init?.body ?? ""));
    if (url.startsWith("https://api.minimaxi.com/")) {
      return new Response("routine internal detail", { status: 503 });
    }
    return humanCheckResponse();
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(
    { ...routineEnv, ...fallbackEnv },
    pkg(),
  );

  assert.equal(result.providerRoute.fallback?.state, "configured");
  assert.equal(result.providerRoute.fallback?.enabled, false);
  assert.equal(result.execution.state, "REVIEW_UNAVAILABLE");
  if (result.execution.state !== "REVIEW_UNAVAILABLE") return;
  assert.equal(result.execution.reason, "all_eligible_providers_failed");
  assert.equal(result.execution.attempts.length, 1);
  assert.equal(result.execution.attempts[0].failureClass, "provider_unavailable");
  assert.equal(requested.length, 1);
  assert.equal(bodies.some((body) => body.includes("minimax-secret")), false);
  assert.equal(bodies.some((body) => body.includes("opencode-go-secret")), false);
});
