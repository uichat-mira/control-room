import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPackage } from "../src/ai-review-package.ts";
import { OpenAICompatibleReviewProvider } from "../src/ai-review-provider-openai-compatible.ts";
import {
  ReviewProviderError,
  executeReviewWithFallback,
} from "../src/ai-review-runtime.ts";

function reviewPackage(): ReviewPackage {
  return {
    packageVersion: "mira-ai-review-package/v0",
    runtimeVersion: "control-room-ai-review/v0",
    generatedAt: "2026-09-12T00:00:00.000Z",
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
      title: "Example",
      body: null,
      author: "contributor",
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
      content: "diff --git a/a.ts b/a.ts\n+change\n",
      chars: 36,
      originalChars: 36,
      truncated: false,
      limitChars: 180000,
    },
    gaps: [],
  };
}

function provider() {
  return new OpenAICompatibleReviewProvider({
    id: "diagnostic-test",
    role: "routine",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "provider-secret-key",
    model: "review-model",
  });
}

test("records upstream HTTP status without reading provider error bodies", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("SENSITIVE UPSTREAM BODY", { status: 503 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => provider().review(reviewPackage()),
    (error: unknown) => {
      assert.ok(error instanceof ReviewProviderError);
      assert.equal(error.failureClass, "provider_unavailable");
      assert.equal(error.upstreamStatus, 503);
      assert.equal(error.failureDetail, undefined);
      assert.equal(error.message.includes("SENSITIVE UPSTREAM BODY"), false);
      return true;
    },
  );
});

test("distinguishes a provider network request failure from an upstream HTTP response", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("sensitive socket detail");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => provider().review(reviewPackage()),
    (error: unknown) => {
      assert.ok(error instanceof ReviewProviderError);
      assert.equal(error.failureClass, "provider_unavailable");
      assert.equal(error.failureDetail, "network_request_failed");
      assert.equal(error.upstreamStatus, undefined);
      assert.equal(error.message.includes("sensitive socket detail"), false);
      return true;
    },
  );
});

test("distinguishes a response-stream network failure after HTTP response headers arrive", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new TypeError("sensitive stream detail"));
        },
      }),
      { status: 200 },
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => provider().review(reviewPackage()),
    (error: unknown) => {
      assert.ok(error instanceof ReviewProviderError);
      assert.equal(error.failureClass, "provider_unavailable");
      assert.equal(error.failureDetail, "network_response_failed");
      assert.equal(error.upstreamStatus, 200);
      assert.equal(error.message.includes("sensitive stream detail"), false);
      return true;
    },
  );
});

test("safe upstream diagnostics propagate into execution attempts", async () => {
  const result = await executeReviewWithFallback(
    { example: true },
    [
      {
        id: "provider-a",
        model: "model-a",
        role: "routine",
        async review() {
          throw new ReviewProviderError(
            "Provider request failed with HTTP 503.",
            "provider_unavailable",
            { upstreamStatus: 503 },
          );
        },
      },
    ],
  );

  assert.equal(result.state, "REVIEW_UNAVAILABLE");
  assert.deepEqual(result.attempts[0], {
    provider: "provider-a",
    model: "model-a",
    role: "routine",
    status: "failed",
    latencyMs: result.attempts[0].latencyMs,
    failureClass: "provider_unavailable",
    upstreamStatus: 503,
  });
});
