import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import { handleAiReviewRequest } from "../src/ai-review.ts";
import { MIRA_REVIEW_MARKER } from "../src/ai-review-publication.ts";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const NEXT_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const POLICY_COMMIT = "3333333333333333333333333333333333333333";
const POLICY_BLOB = "4444444444444444444444444444444444444444";
const OUTPUT_BLOB = "5555555555555555555555555555555555555555";

function contentResponse(path: string, sha: string, content: string) {
  return Response.json({
    type: "file",
    path,
    sha,
    encoding: "base64",
    content: Buffer.from(content, "utf8").toString("base64"),
  });
}

function requestBody(review: unknown = {
  verdict: "NO_BLOCKING_FINDINGS",
  findings: [],
  validationGaps: [],
}) {
  return {
    repository: "uichat-mira/mira-desktop",
    pullRequest: 7,
    identity: {
      repository: "uichat-mira/mira-desktop",
      pullRequest: 7,
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
      latencyMs: 250,
      review,
    },
  };
}

function reviewRequest(body: unknown, token = "caller-token") {
  return new Request("https://control.example/api/v1/ai-review/result", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function mockReviewGitHub(options: {
  heads?: string[];
  published: string[];
}) {
  let pullRead = 0;

  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init.method || "GET";

    if (url.endsWith("/repos/uichat-mira/mira-desktop/pulls/7")) {
      const heads = options.heads ?? [HEAD_SHA];
      const headSha = heads[Math.min(pullRead, heads.length - 1)];
      pullRead += 1;
      return Response.json({
        number: 7,
        title: "External review",
        body: null,
        draft: false,
        user: { login: "builder" },
        base: {
          ref: "dev",
          sha: BASE_SHA,
          repo: { full_name: "uichat-mira/mira-desktop" },
        },
        head: {
          ref: "feat/example",
          sha: headSha,
          repo: { full_name: "uichat-mira/mira-desktop" },
        },
      });
    }

    if (url.endsWith("/repos/uichat-mira/.github/commits/main")) {
      return Response.json({ sha: POLICY_COMMIT });
    }
    if (url.includes(`/repos/uichat-mira/.github/contents/ai-review/POLICY.md?ref=${POLICY_COMMIT}`)) {
      return contentResponse("ai-review/POLICY.md", POLICY_BLOB, "policy");
    }
    if (url.includes(`/repos/uichat-mira/.github/contents/ai-review/OUTPUT-CONTRACT.md?ref=${POLICY_COMMIT}`)) {
      return contentResponse("ai-review/OUTPUT-CONTRACT.md", OUTPUT_BLOB, "output");
    }
    if (url.includes(`/repos/uichat-mira/mira-desktop/contents/.ai/review-profile.md?ref=${BASE_SHA}`)) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes(`/repos/uichat-mira/mira-desktop/contents/AGENTS.md?ref=${BASE_SHA}`)) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes(`/repos/uichat-mira/mira-desktop/compare/${BASE_SHA}...${HEAD_SHA}`)) {
      return new Response("diff --git a/a b/a\n+change\n");
    }
    if (url.includes(`/repos/uichat-mira/mira-desktop/compare/${BASE_SHA}...${NEXT_HEAD_SHA}`)) {
      return new Response("diff --git a/a b/a\n+newer\n");
    }
    if (url === "https://api.github.com/graphql") {
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              closingIssuesReferences: { nodes: [] },
            },
          },
        },
      });
    }

    if (url.endsWith("/user")) {
      return Response.json({ login: "publisher" });
    }
    if (url.includes("/repos/uichat-mira/mira-desktop/issues/7/comments?per_page=100")) {
      return Response.json([]);
    }
    if (
      url.endsWith("/repos/uichat-mira/mira-desktop/issues/7/comments") &&
      method === "POST"
    ) {
      const body = JSON.parse(String(init.body)) as { body: string };
      options.published.push(body.body);
      return Response.json({
        id: 41,
        body: body.body,
        user: { login: "publisher" },
      });
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };
}

const env = {
  GITHUB_READ_TOKEN: "github-read",
  GITHUB_PUBLISH_TOKEN: "github-publish",
  AI_REVIEW_GATEWAY_TOKEN: "caller-token",
};

test("rejects unauthenticated external results before any GitHub request", async (t) => {
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
    reviewRequest(requestBody(), "wrong-token"),
    env,
  );

  assert.equal(response.status, 401);
  assert.equal(fetchCalled, false);
});

test("publishes a normalized external review with engine identity and deterministic gaps", async (t) => {
  const originalFetch = globalThis.fetch;
  const published: string[] = [];
  globalThis.fetch = mockReviewGitHub({ published });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await handleAiReviewRequest(reviewRequest(requestBody()), env);
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.equal(body.freshness.state, "CURRENT");
  assert.equal(body.execution.state, "COMPLETED");
  assert.equal(body.execution.provider.engine, "opencode");
  assert.equal(body.execution.provider.id, "opencode-go");
  assert.equal(body.execution.provider.model, "minimax-m3");
  assert.equal(body.execution.review.verdict, "HUMAN_CHECK_NEEDED");
  assert.equal(body.providerRoute.routine.driver, "external:opencode");
  assert.equal(published.length, 1);
  assert.match(published[0], new RegExp(MIRA_REVIEW_MARKER));
  assert.match(published[0], /HUMAN_CHECK_NEEDED/);
  assert.match(published[0], /\*\*Engine:\*\* opencode/);
  assert.match(published[0], /\*\*Provider:\*\* opencode-go/);
  assert.match(published[0], /\*\*Model:\*\* minimax-m3/);
});

test("publishes STALE_REVIEW when the trusted PR identity changes before publication", async (t) => {
  const originalFetch = globalThis.fetch;
  const published: string[] = [];
  globalThis.fetch = mockReviewGitHub({
    heads: [HEAD_SHA, NEXT_HEAD_SHA],
    published,
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await handleAiReviewRequest(reviewRequest(requestBody()), env);
  const body = (await response.json()) as any;

  assert.equal(response.status, 409);
  assert.deepEqual(body.freshness, {
    state: "STALE_REVIEW",
    reasons: ["head_sha"],
  });
  assert.equal(published.length, 1);
  assert.match(published[0], /STALE_REVIEW/);
  assert.match(published[0], new RegExp(NEXT_HEAD_SHA));
});

test("publishes REVIEW_UNAVAILABLE when external model output violates the Mira contract", async (t) => {
  const originalFetch = globalThis.fetch;
  const published: string[] = [];
  globalThis.fetch = mockReviewGitHub({ published });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await handleAiReviewRequest(
    reviewRequest(
      requestBody({
        verdict: "PASS",
        findings: [],
        validationGaps: [],
      }),
    ),
    env,
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 422);
  assert.equal(body.error, "invalid_external_review");
  assert.equal(body.publication.state, "CREATED");
  assert.equal(published.length, 1);
  assert.match(published[0], /REVIEW_UNAVAILABLE/);
  assert.match(published[0], /external\\_review\\_invalid/);
});

test("rejects exact control identity mismatch without treating it as a current review", async (t) => {
  const originalFetch = globalThis.fetch;
  const published: string[] = [];
  globalThis.fetch = mockReviewGitHub({ published });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const input = requestBody();
  input.identity.policyCommitSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const response = await handleAiReviewRequest(reviewRequest(input), env);
  const body = (await response.json()) as any;

  assert.equal(response.status, 409);
  assert.equal(body.error, "external_identity_mismatch");
  assert.deepEqual(body.mismatches, ["policy_commit_sha"]);
  assert.equal(published.length, 0);
});
