import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import { handleAiReviewRequest } from "../src/ai-review.ts";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const POLICY_COMMIT = "3333333333333333333333333333333333333333";

function contentResponse(path: string, sha: string, content: string) {
  return Response.json({
    type: "file",
    path,
    sha,
    encoding: "base64",
    content: Buffer.from(content, "utf8").toString("base64"),
  });
}

function mockPackageGitHub() {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/repos/uichat-mira/example/pulls/7")) {
      return Response.json({
        number: 7,
        title: "Example",
        body: null,
        draft: false,
        user: { login: "builder" },
        base: {
          ref: "dev",
          sha: BASE_SHA,
          repo: { full_name: "uichat-mira/example" },
        },
        head: {
          ref: "feat/example",
          sha: HEAD_SHA,
          repo: { full_name: "uichat-mira/example" },
        },
      });
    }
    if (url.endsWith("/repos/uichat-mira/.github/commits/main")) {
      return Response.json({ sha: POLICY_COMMIT });
    }
    if (url.includes(`/repos/uichat-mira/.github/contents/ai-review/POLICY.md?ref=${POLICY_COMMIT}`)) {
      return contentResponse("ai-review/POLICY.md", "4444444444444444444444444444444444444444", "policy");
    }
    if (url.includes(`/repos/uichat-mira/.github/contents/ai-review/OUTPUT-CONTRACT.md?ref=${POLICY_COMMIT}`)) {
      return contentResponse("ai-review/OUTPUT-CONTRACT.md", "5555555555555555555555555555555555555555", "output");
    }
    if (url.includes(`/repos/uichat-mira/example/contents/.ai/review-profile.md?ref=${BASE_SHA}`)) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes(`/repos/uichat-mira/example/contents/AGENTS.md?ref=${BASE_SHA}`)) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes(`/repos/uichat-mira/example/compare/${BASE_SHA}...${HEAD_SHA}`)) {
      return new Response("diff --git a/a b/a\n+change\n");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("rejects unauthenticated review execution before any GitHub or provider request", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("network must not be reached");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await handleAiReviewRequest(
    new Request("https://control.example/api/v1/ai-review/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: "uichat-mira/example", pullRequest: 7 }),
    }),
    {
      GITHUB_READ_TOKEN: "github-token",
      AI_REVIEW_GATEWAY_TOKEN: "caller-token",
    },
  );

  assert.equal(response.status, 401);
  assert.equal(fetchCalled, false);
});

test("returns explicit REVIEW_UNAVAILABLE after building the trusted package when no provider account is configured", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockPackageGitHub();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await handleAiReviewRequest(
    new Request("https://control.example/api/v1/ai-review/review", {
      method: "POST",
      headers: {
        authorization: "Bearer caller-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ repository: "uichat-mira/example", pullRequest: 7 }),
    }),
    {
      GITHUB_READ_TOKEN: "github-token",
      AI_REVIEW_GATEWAY_TOKEN: "caller-token",
    },
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 503);
  assert.equal(body.executionVersion, "mira-ai-review-execution/v0");
  assert.equal(body.identity.repository, "uichat-mira/example");
  assert.equal(body.identity.baseSha, BASE_SHA);
  assert.equal(body.identity.headSha, HEAD_SHA);
  assert.deepEqual(body.providerRoute.routine, {
    state: "unconfigured",
    enabled: true,
    provider: "minimax-cn-codeplan",
    model: "m3",
    driver: "openai-chat",
  });
  assert.equal(body.providerRoute.fallback.state, "unconfigured");
  assert.equal(body.providerRoute.fallback.enabled, false);
  assert.equal(body.providerRoute.escalation.state, "unconfigured");
  assert.equal(body.providerRoute.escalation.enabled, false);
  assert.deepEqual(body.execution, {
    state: "REVIEW_UNAVAILABLE",
    reason: "no_eligible_provider",
    attempts: [],
  });
});

test("health exposes credential state and route activation separately without provider secrets or endpoints", async () => {
  const response = await handleAiReviewRequest(
    new Request("https://control.example/api/v1/ai-review/health"),
    {
      GITHUB_READ_TOKEN: "github-token",
      AI_REVIEW_GATEWAY_TOKEN: "caller-token",
      AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY: "provider-secret-key",
      AI_PROVIDER_OPENCODE_GO_KEY: "fallback-secret-key",
    },
  );
  const text = await response.text();
  const body = JSON.parse(text) as any;

  assert.equal(response.status, 200);
  assert.equal(body.mode, "review-execution-unpublished");
  assert.equal(body.executionVersion, "mira-ai-review-execution/v0");
  assert.deepEqual(body.providerRoutes.CODE_REVIEW.routine, {
    state: "configured",
    enabled: true,
    provider: "minimax-cn-codeplan",
    model: "m3",
    driver: "openai-chat",
  });
  assert.deepEqual(body.providerRoutes.CODE_REVIEW.fallback, {
    state: "configured",
    enabled: false,
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    driver: "openai-chat",
  });
  assert.deepEqual(body.providerRoutes.CODE_REVIEW.escalation, {
    state: "configured",
    enabled: false,
    provider: "opencode-go",
    model: "deepseek-v4-pro",
    driver: "openai-chat",
  });
  assert.equal(text.includes("provider-secret-key"), false);
  assert.equal(text.includes("fallback-secret-key"), false);
  assert.equal(text.includes("https://api.minimaxi.com"), false);
});
