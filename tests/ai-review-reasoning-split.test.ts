import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPackage } from "../src/ai-review-package.ts";
import {
  PROVIDER_CATALOG,
  REVIEW_ROUTING,
  validateProviderConfiguration,
} from "../src/ai-review-provider-config.ts";
import { OpenAICompatibleReviewProvider } from "../src/ai-review-provider-openai-compatible.ts";

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
      title: "Thinking mode test",
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

function cleanResponse() {
  return Response.json({
    choices: [
      {
        message: {
          content: '{"verdict":"NO_BLOCKING_FINDINGS","findings":[],"validationGaps":[]}',
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  });
}

test("MiniMax M3 keeps reasoning capability but disables thinking for routine review", () => {
  const model = PROVIDER_CATALOG.providers["minimax-cn-codeplan"].models.m3;
  assert.equal(model.capabilities?.reasoning, "separate");
  assert.equal(model.driverOptions?.openaiChat?.thinking, "disabled");
  assert.notEqual(model.driverOptions?.openaiChat?.reasoningSplit, true);
});

test("openai-chat sends thinking disabled explicitly for MiniMax M3", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";

  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return cleanResponse();
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new OpenAICompatibleReviewProvider({
    id: "minimax-cn-codeplan/m3",
    role: "routine",
    endpoint: "https://api.minimaxi.com/v1/chat/completions",
    apiKey: "secret",
    model: "MiniMax-M3",
    responseFormat: "none",
    requestExtensions: { thinking: "disabled" },
    outputBudget: { parameter: "max_completion_tokens", tokens: 16384 },
  });

  const response = await provider.review(reviewPackage());
  const body = JSON.parse(requestBody) as Record<string, unknown>;

  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal("reasoning_split" in body, false);
  assert.equal(body.max_completion_tokens, 16384);
  assert.deepEqual(response.output, {
    verdict: "NO_BLOCKING_FINDINGS",
    findings: [],
    validationGaps: [],
  });
  assert.deepEqual(response.usage, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
  });
});

test("reasoning split remains available when a model explicitly opts in", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";

  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return Response.json({
      choices: [
        {
          message: {
            reasoning_details: [{ type: "reasoning.text", text: "private reasoning" }],
            content: '{"verdict":"NO_BLOCKING_FINDINGS","findings":[],"validationGaps":[]}',
          },
        },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new OpenAICompatibleReviewProvider({
    id: "reasoning-test",
    role: "routine",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    model: "reasoning-model",
    responseFormat: "none",
    requestExtensions: { reasoningSplit: true },
  });

  await provider.review(reviewPackage());
  const body = JSON.parse(requestBody) as Record<string, unknown>;
  assert.equal(body.reasoning_split, true);
  assert.equal("thinking" in body, false);
});

test("generic openai-chat calls do not send thinking controls unless modeled", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";

  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return cleanResponse();
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new OpenAICompatibleReviewProvider({
    id: "generic",
    role: "routine",
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    model: "model",
    responseFormat: "none",
  });

  await provider.review(reviewPackage());
  const body = JSON.parse(requestBody) as Record<string, unknown>;
  assert.equal("thinking" in body, false);
  assert.equal("reasoning_split" in body, false);
});

test("rejects an unsupported openai-chat thinking mode", () => {
  const catalog = structuredClone(PROVIDER_CATALOG);
  const options = catalog.providers["minimax-cn-codeplan"].models.m3.driverOptions
    ?.openaiChat as { thinking?: string };
  options.thinking = "maximum";

  assert.throws(
    () => validateProviderConfiguration(catalog, REVIEW_ROUTING),
    /thinking must be disabled, adaptive, or enabled/,
  );
});

test("rejects reasoningSplit when semantic capability is not separate", () => {
  const catalog = structuredClone(PROVIDER_CATALOG);
  catalog.providers["minimax-cn-codeplan"].models.m3.driverOptions = {
    openaiChat: { reasoningSplit: true },
  };
  catalog.providers["minimax-cn-codeplan"].models.m3.capabilities = {
    reasoning: "inline",
    responseFormat: "none",
  };

  assert.throws(
    () => validateProviderConfiguration(catalog, REVIEW_ROUTING),
    /reasoningSplit=true requires capabilities\.reasoning=separate/,
  );
});

test("rejects reasoningSplit combined with thinking disabled", () => {
  const catalog = structuredClone(PROVIDER_CATALOG);
  catalog.providers["minimax-cn-codeplan"].models.m3.driverOptions = {
    openaiChat: { reasoningSplit: true, thinking: "disabled" },
  };

  assert.throws(
    () => validateProviderConfiguration(catalog, REVIEW_ROUTING),
    /reasoningSplit=true is incompatible with thinking=disabled/,
  );
});

test("rejects openai-chat driver options on a non-openai transport", () => {
  const catalog = structuredClone(PROVIDER_CATALOG);
  catalog.providers["opencode-go"].models["minimax-m3"].driverOptions = {
    openaiChat: { thinking: "disabled" },
  };

  assert.throws(
    () => validateProviderConfiguration(catalog, REVIEW_ROUTING),
    /driverOptions\.openaiChat requires the openai-chat driver/,
  );
});
