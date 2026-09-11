import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPackage } from "../src/ai-review-package.ts";
import { OpenAICompatibleReviewProvider } from "../src/ai-review-provider-openai-compatible.ts";
import {
  executeReviewWithFallback,
  ReviewProviderError,
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
      title: "Budget test",
      body: "Untrusted body",
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
        content: "TRUSTED ORGANIZATION POLICY",
      },
      outputContract: {
        source: "organization",
        repository: "uichat-mira/.github",
        path: "ai-review/OUTPUT-CONTRACT.md",
        ref: "3333333333333333333333333333333333333333",
        blobSha: "5555555555555555555555555555555555555555",
        content: "TRUSTED OUTPUT CONTRACT",
      },
      repositoryProfile: {
        source: "base",
        repository: "uichat-mira/example",
        path: ".ai/review-profile.md",
        ref: "1111111111111111111111111111111111111111",
        blobSha: "6666666666666666666666666666666666666666",
        content: "TRUSTED BASE PROFILE",
      },
      rootContract: {
        source: "base",
        repository: "uichat-mira/example",
        path: "AGENTS.md",
        ref: "1111111111111111111111111111111111111111",
        blobSha: "7777777777777777777777777777777777777777",
        content: "TRUSTED ROOT CONTRACT",
      },
      taskContract: {
        state: "unavailable",
        reason: "trusted_lookup_not_configured",
      },
      identity: {
        policyCommitSha: "3333333333333333333333333333333333333333",
        policyBlobSha: "4444444444444444444444444444444444444444",
        outputContractBlobSha: "5555555555555555555555555555555555555555",
        profileBlobSha: "6666666666666666666666666666666666666666",
        rootContractBlobSha: "7777777777777777777777777777777777777777",
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
    gaps: [
      {
        code: "trusted_task_contract_unavailable",
        message: "Trusted Task / PR Contract lookup is not configured.",
        material: true,
      },
    ],
  };
}

function provider(
  overrides: Partial<ConstructorParameters<typeof OpenAICompatibleReviewProvider>[0]> = {},
) {
  return new OpenAICompatibleReviewProvider({
    id: "budget-test",
    role: "routine",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "provider-secret-key",
    model: "review-model",
    ...overrides,
  });
}

function cleanProvider(id: string): ReviewProvider<ReviewPackage> {
  return {
    id,
    model: "fallback-model",
    role: "fallback",
    async review() {
      return {
        output: {
          verdict: "NO_BLOCKING_FINDINGS",
          findings: [],
          validationGaps: [],
        },
      };
    },
  };
}

test("sends an explicit provider-side output token budget using the configured parameter", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";

  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return Response.json({
      choices: [
        {
          message: {
            content: '{"verdict":"NO_BLOCKING_FINDINGS","findings":[],"validationGaps":[]}',
          },
        },
      ],
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await provider({
    outputBudget: {
      parameter: "max_completion_tokens",
      tokens: 2048,
    },
  }).review(reviewPackage());

  const body = JSON.parse(requestBody) as Record<string, unknown>;
  assert.equal(body.max_completion_tokens, 2048);
  assert.equal("max_tokens" in body, false);
});

test("rejects a known oversized review prompt before issuing a paid provider request", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called");
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () =>
      provider({
        inputBudget: { maxPromptCharacters: 1 },
      }).review(reviewPackage()),
    (error: unknown) => {
      assert.ok(error instanceof ReviewProviderError);
      assert.equal(error.failureClass, "input_limit");
      return true;
    },
  );

  assert.equal(fetchCalls, 0);
});

test("records input capacity failure and continues to an eligible fallback", async () => {
  const limited = provider({ inputBudget: { maxPromptCharacters: 1 } });
  const result = await executeReviewWithFallback(reviewPackage(), [
    limited,
    cleanProvider("fallback-test"),
  ]);

  assert.equal(result.state, "COMPLETED");
  if (result.state !== "COMPLETED") return;

  assert.equal(result.provider.id, "fallback-test");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.status, "failed");
  assert.equal(result.attempts[0]?.failureClass, "input_limit");
  assert.equal(result.attempts[1]?.status, "success");
});

test("rejects invalid budget values at trusted provider configuration time", () => {
  assert.throws(
    () => provider({ inputBudget: { maxPromptCharacters: 0 } }),
    /positive safe integer/,
  );
  assert.throws(
    () => provider({ outputBudget: { parameter: "max_tokens", tokens: 0 } }),
    /positive safe integer/,
  );
});
