import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import {
  ReviewPackageError,
  buildReviewPackageData,
} from "../src/ai-review-package.ts";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const POLICY_COMMIT = "3333333333333333333333333333333333333333";
const POLICY_BLOB = "4444444444444444444444444444444444444444";
const OUTPUT_BLOB = "5555555555555555555555555555555555555555";
const ROOT_BLOB = "6666666666666666666666666666666666666666";

function contentResponse(path: string, sha: string, content: string) {
  return Response.json({
    type: "file",
    path,
    sha,
    encoding: "base64",
    content: Buffer.from(content, "utf8").toString("base64"),
  });
}

test("builds one immutable typed CODE_REVIEW package from trusted GitHub sources", async (t) => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    requested.push(url);

    if (url.endsWith("/repos/uichat-mira/mira-mobile/pulls/108")) {
      return Response.json({
        number: 108,
        title: "Example PR",
        body: "Body",
        draft: false,
        user: { login: "builder" },
        base: {
          ref: "dev",
          sha: BASE_SHA,
          repo: { full_name: "uichat-mira/mira-mobile" },
        },
        head: {
          ref: "feat/example",
          sha: HEAD_SHA,
          repo: { full_name: "uichat-mira/mira-mobile" },
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
      return contentResponse("ai-review/OUTPUT-CONTRACT.md", OUTPUT_BLOB, "output contract");
    }

    if (url.includes(`/repos/uichat-mira/mira-mobile/contents/.ai/review-profile.md?ref=${BASE_SHA}`)) {
      return new Response("not found", { status: 404 });
    }

    if (url.includes(`/repos/uichat-mira/mira-mobile/contents/AGENTS.md?ref=${BASE_SHA}`)) {
      return contentResponse("AGENTS.md", ROOT_BLOB, "root contract");
    }

    if (url.includes(`/repos/uichat-mira/mira-mobile/compare/${BASE_SHA}...${HEAD_SHA}`)) {
      return new Response("diff --git a/a.ts b/a.ts\n+changed\n");
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const pkg = await buildReviewPackageData(
    { GITHUB_READ_TOKEN: "test-token" },
    "uichat-mira/mira-mobile",
    108,
  );

  assert.equal(pkg.reviewMode, "CODE_REVIEW");
  assert.equal(pkg.pullRequest.base.sha, BASE_SHA);
  assert.equal(pkg.pullRequest.head.sha, HEAD_SHA);
  assert.equal(pkg.controls.identity.policyCommitSha, POLICY_COMMIT);
  assert.equal(pkg.controls.identity.policyBlobSha, POLICY_BLOB);
  assert.equal(pkg.controls.identity.outputContractBlobSha, OUTPUT_BLOB);
  assert.equal(pkg.controls.identity.profileBlobSha, null);
  assert.equal(pkg.controls.identity.rootContractBlobSha, ROOT_BLOB);
  assert.deepEqual(pkg.controls.identity.taskContract, {
    state: "unavailable",
    reason: "trusted_lookup_not_configured",
  });
  assert.equal(pkg.trust.organizationControlsSource, `uichat-mira/.github@${POLICY_COMMIT}`);
  assert.equal(pkg.trust.repositoryControlsSource, `uichat-mira/mira-mobile@${BASE_SHA}`);
  assert.equal(pkg.diff.source, `${BASE_SHA}...${HEAD_SHA}`);
  assert.equal(pkg.diff.truncated, false);
  assert.deepEqual(pkg.gaps, [
    {
      code: "missing_repository_profile",
      message: "Missing .ai/review-profile.md at base SHA; repository-specific review rules are not yet migrated.",
      material: true,
    },
    {
      code: "trusted_task_contract_unavailable",
      message: "Trusted Task / PR Contract lookup is not configured; highest-priority task instructions may be unavailable to the reviewer.",
      material: true,
    },
  ]);
  assert.equal(requested.length, 7);
});

test("rejects an out-of-organization repository before any GitHub request", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => buildReviewPackageData({ GITHUB_READ_TOKEN: "test-token" }, "someone/other", 1),
    (error: unknown) => {
      assert.ok(error instanceof ReviewPackageError);
      assert.equal(error.code, "invalid_repository");
      assert.equal(error.status, 400);
      return true;
    },
  );

  assert.equal(fetchCalled, false);
});

test("rejects same-request fork PRs before loading trusted controls", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    requestCount += 1;

    if (url.endsWith("/repos/uichat-mira/mira-mobile/pulls/108")) {
      return Response.json({
        number: 108,
        title: "Fork PR",
        body: null,
        draft: false,
        user: { login: "external" },
        base: {
          ref: "dev",
          sha: BASE_SHA,
          repo: { full_name: "uichat-mira/mira-mobile" },
        },
        head: {
          ref: "feat/example",
          sha: HEAD_SHA,
          repo: { full_name: "external/mira-mobile" },
        },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => buildReviewPackageData({ GITHUB_READ_TOKEN: "test-token" }, "uichat-mira/mira-mobile", 108),
    (error: unknown) => {
      assert.ok(error instanceof ReviewPackageError);
      assert.equal(error.code, "fork_pull_request_not_supported");
      assert.equal(error.status, 409);
      return true;
    },
  );

  assert.equal(requestCount, 1);
});
