import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPackage } from "../src/ai-review-package.ts";
import { executeTrustedReviewPackage } from "../src/ai-review-execution.ts";
import { buildReviewProviderRegistry } from "../src/ai-review-provider-registry.ts";

function pkg(): ReviewPackage {
  return {
    packageVersion: "mira-ai-review-package/v0",
    runtimeVersion: "control-room-ai-review/v0",
    generatedAt: "2026-09-11T00:00:00.000Z",
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
    gaps: ["Missing repository-specific review profile."],
  };
}

const primaryEnv = {
  AI_REVIEW_PRIMARY_ID: "primary-test",
  AI_REVIEW_PRIMARY_ENDPOINT: "https://primary.example/v1/chat/completions",
  AI_REVIEW_PRIMARY_API_KEY: "primary-secret",
  AI_REVIEW_PRIMARY_MODEL: "primary-model",
};

const fallbackEnv = {
  AI_REVIEW_FALLBACK_ID: "fallback-test",
  AI_REVIEW_FALLBACK_ENDPOINT: "https://fallback.example/v1/chat/completions",
  AI_REVIEW_FALLBACK_API_KEY: "fallback-secret",
  AI_REVIEW_FALLBACK_MODEL: "fallback-model",
};

function cleanResponse() {
  return Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            verdict: "HUMAN_CHECK_NEEDED",
            findings: [],
            validationGaps: ["Missing repository-specific review profile."],
          }),
        },
      },
    ],
  });
}

test("reports provider slots without exposing configuration values", () => {
  assert.deepEqual(buildReviewProviderRegistry({}), {
    providers: [],
    slots: { primary: "unconfigured", fallback: "unconfigured" },
  });

  const partial = buildReviewProviderRegistry({ AI_REVIEW_PRIMARY_MODEL: "model-only" });
  assert.equal(partial.providers.length, 0);
  assert.deepEqual(partial.slots, { primary: "partial", fallback: "unconfigured" });

  const invalid = buildReviewProviderRegistry({
    ...primaryEnv,
    AI_REVIEW_PRIMARY_ENDPOINT: "http://primary.example/v1/chat/completions",
  });
  assert.equal(invalid.providers.length, 0);
  assert.deepEqual(invalid.slots, { primary: "invalid", fallback: "unconfigured" });
});

test("keeps configured providers in primary then fallback order", () => {
  const registry = buildReviewProviderRegistry({ ...primaryEnv, ...fallbackEnv });
  assert.deepEqual(registry.slots, { primary: "configured", fallback: "configured" });
  assert.equal(registry.providers.length, 2);
  assert.equal(registry.providers[0].id, "primary-test");
  assert.equal(registry.providers[0].role, "primary");
  assert.equal(registry.providers[1].id, "fallback-test");
  assert.equal(registry.providers[1].role, "fallback");
});

test("returns REVIEW_UNAVAILABLE when production has no provider configured", async () => {
  const result = await executeTrustedReviewPackage({}, pkg());

  assert.equal(result.executionVersion, "mira-ai-review-execution/v0");
  assert.deepEqual(result.providerSlots, {
    primary: "unconfigured",
    fallback: "unconfigured",
  });
  assert.equal(result.identity.baseSha, "1111111111111111111111111111111111111111");
  assert.equal(result.identity.headSha, "2222222222222222222222222222222222222222");
  assert.deepEqual(result.execution, {
    state: "REVIEW_UNAVAILABLE",
    reason: "no_eligible_provider",
    attempts: [],
  });
});

test("executes a configured primary provider and returns only normalized review metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  let providerRequestBody = "";

  globalThis.fetch = async (_input, init) => {
    providerRequestBody = String(init?.body ?? "");
    return cleanResponse();
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(primaryEnv, pkg());

  assert.equal(result.execution.state, "COMPLETED");
  assert.equal(result.execution.provider.id, "primary-test");
  assert.equal(result.execution.provider.model, "primary-model");
  assert.equal(result.execution.provider.role, "primary");
  assert.equal(result.execution.review.verdict, "HUMAN_CHECK_NEEDED");
  assert.equal(result.execution.attempts.length, 1);
  assert.equal(result.execution.attempts[0].status, "success");
  assert.equal(providerRequestBody.includes("primary-secret"), false);
});

test("falls back after a technical primary failure without exposing either key", async (t) => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const bodies: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    requested.push(url);
    bodies.push(String(init?.body ?? ""));
    if (url.startsWith("https://primary.example/")) {
      return new Response("primary internal detail", { status: 503 });
    }
    return cleanResponse();
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeTrustedReviewPackage(
    { ...primaryEnv, ...fallbackEnv },
    pkg(),
  );

  assert.equal(result.execution.state, "COMPLETED");
  assert.equal(result.execution.provider.id, "fallback-test");
  assert.equal(result.execution.provider.role, "fallback");
  assert.equal(result.execution.attempts.length, 2);
  assert.equal(result.execution.attempts[0].failureClass, "provider_unavailable");
  assert.equal(result.execution.attempts[1].status, "success");
  assert.equal(requested.length, 2);
  assert.equal(bodies.some((body) => body.includes("primary-secret")), false);
  assert.equal(bodies.some((body) => body.includes("fallback-secret")), false);
});
