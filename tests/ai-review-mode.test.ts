import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import {
  ReviewPackageError,
  buildReviewPackageData,
  type ReviewMode,
} from "../src/ai-review-package.ts";

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

function mockGitHub(headRef: string, baseRef: string) {
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
          ref: baseRef,
          sha: BASE_SHA,
          repo: { full_name: "uichat-mira/example" },
        },
        head: {
          ref: headRef,
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
      return contentResponse(".ai/review-profile.md", "6666666666666666666666666666666666666666", "profile");
    }
    if (url.includes(`/repos/uichat-mira/example/contents/AGENTS.md?ref=${BASE_SHA}`)) {
      return contentResponse("AGENTS.md", "7777777777777777777777777777777777777777", "root");
    }
    if (url.includes(`/repos/uichat-mira/example/compare/${BASE_SHA}...${HEAD_SHA}`)) {
      return new Response("diff --git a/a b/a\n+change\n");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

async function expectMode(headRef: string, baseRef: string, expected: ReviewMode, t: test.TestContext) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockGitHub(headRef, baseRef);
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const pkg = await buildReviewPackageData(
    { GITHUB_READ_TOKEN: "github-token" },
    "uichat-mira/example",
    7,
  );
  assert.equal(pkg.reviewMode, expected);
}

test("maps feat/* -> dev to CODE_REVIEW", async (t) => {
  await expectMode("feat/example", "dev", "CODE_REVIEW", t);
});

test("maps dev -> test to PROMOTION_REVIEW", async (t) => {
  await expectMode("dev", "test", "PROMOTION_REVIEW", t);
});

test("maps test -> prod to RELEASE_REVIEW", async (t) => {
  await expectMode("test", "prod", "RELEASE_REVIEW", t);
});

test("rejects unsupported branch transitions instead of guessing a review mode", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (input) => {
    requestCount += 1;
    return mockGitHub("main", "prod")(input);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => buildReviewPackageData(
      { GITHUB_READ_TOKEN: "github-token" },
      "uichat-mira/example",
      7,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ReviewPackageError);
      assert.equal(error.code, "unsupported_review_mode");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(requestCount, 1);
});
