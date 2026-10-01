import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import {
  ReviewPackageError,
  buildReviewPackageData,
  resolveTrustedTaskContract,
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

    if (url === "https://api.github.com/graphql") {
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              closingIssuesReferences: {
                nodes: [
                  {
                    number: 109,
                    title: "Pilot Mira Organization AI Review on Mobile",
                    body: "Trusted issue contract",
                    updatedAt: "2026-09-11T05:21:02Z",
                    repository: { nameWithOwner: "uichat-mira/mira-mobile" },
                  },
                ],
              },
            },
          },
        },
      });
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
  assert.equal(pkg.controls.taskContract?.repository, "uichat-mira/mira-mobile");
  assert.equal(pkg.controls.taskContract?.issue, 109);
  assert.equal(pkg.controls.taskContract?.body, "Trusted issue contract");
  assert.equal(pkg.controls.identity.taskContract.state, "resolved");
  if (pkg.controls.identity.taskContract.state !== "resolved") throw new Error("fixture");
  assert.equal(pkg.controls.identity.taskContract.issue, 109);
  assert.match(pkg.controls.identity.taskContract.contentSha256, /^[a-f0-9]{64}$/);
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
  ]);
  assert.equal(requested.length, 8);
});

test("keeps an explicit material gap when no trusted linked work item exists", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/repos/uichat-mira/mira-mobile/pulls/108")) {
      return Response.json({
        number: 108,
        title: "Example PR",
        body: "Closes #999 from untrusted text only",
        draft: false,
        user: { login: "builder" },
        base: { ref: "dev", sha: BASE_SHA, repo: { full_name: "uichat-mira/mira-mobile" } },
        head: { ref: "feat/example", sha: HEAD_SHA, repo: { full_name: "uichat-mira/mira-mobile" } },
      });
    }
    if (url.endsWith("/repos/uichat-mira/.github/commits/main")) return Response.json({ sha: POLICY_COMMIT });
    if (url.includes("/contents/ai-review/POLICY.md")) return contentResponse("ai-review/POLICY.md", POLICY_BLOB, "policy");
    if (url.includes("/contents/ai-review/OUTPUT-CONTRACT.md")) return contentResponse("ai-review/OUTPUT-CONTRACT.md", OUTPUT_BLOB, "output");
    if (url.includes("/contents/.ai/review-profile.md")) return new Response("not found", { status: 404 });
    if (url.includes("/contents/AGENTS.md")) return contentResponse("AGENTS.md", ROOT_BLOB, "root");
    if (url.includes("/compare/")) return new Response("diff");
    if (url === "https://api.github.com/graphql") {
      return Response.json({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } } } });
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
  assert.deepEqual(pkg.controls.identity.taskContract, {
    state: "unavailable",
    reason: "no_linked_issue",
  });
  assert.ok(pkg.gaps.some((gap) => gap.code === "trusted_task_contract_unavailable"));
});

test("resolves a trusted task contract from a same-repository issue-number work branch without GitHub linked-branch metadata", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url.endsWith("/repos/uichat-mira/mira-desktop/pulls/201")) {
      return Response.json({
        number: 201,
        title: "Default Agent entry",
        body: "Plain PR body without a closing keyword",
        draft: false,
        user: { login: "builder" },
        base: {
          ref: "dev",
          sha: BASE_SHA,
          repo: { full_name: "uichat-mira/mira-desktop" },
        },
        head: {
          ref: "feat/198-default-agent-entry",
          sha: HEAD_SHA,
          repo: { full_name: "uichat-mira/mira-desktop" },
        },
      });
    }

    if (url.endsWith("/repos/uichat-mira/.github/commits/main")) {
      return Response.json({ sha: POLICY_COMMIT });
    }
    if (url.includes("/contents/ai-review/POLICY.md")) {
      return contentResponse("ai-review/POLICY.md", POLICY_BLOB, "policy");
    }
    if (url.includes("/contents/ai-review/OUTPUT-CONTRACT.md")) {
      return contentResponse("ai-review/OUTPUT-CONTRACT.md", OUTPUT_BLOB, "output");
    }
    if (url.includes("/contents/.ai/review-profile.md")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("/contents/AGENTS.md")) {
      return contentResponse("AGENTS.md", ROOT_BLOB, "root");
    }
    if (url.includes("/compare/")) return new Response("diff");

    if (url === "https://api.github.com/graphql") {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      if (String(payload.query).includes("MiraReviewClosingIssues")) {
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
      if (String(payload.query).includes("MiraReviewHeadRefIssue")) {
        assert.equal(payload.variables.issue, 198);
        return Response.json({
          data: {
            repository: {
              issue: {
                number: 198,
                title: "chat: default new conversations into the existing Agent Runtime (E05A-1)",
                body: "Trusted #198 task contract",
                updatedAt: "2026-10-01T14:13:10Z",
                repository: { nameWithOwner: "uichat-mira/mira-desktop" },
              },
            },
          },
        });
      }
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const pkg = await buildReviewPackageData(
    { GITHUB_READ_TOKEN: "test-token" },
    "uichat-mira/mira-desktop",
    201,
  );

  assert.equal(pkg.controls.taskContract?.issue, 198);
  assert.equal(pkg.controls.taskContract?.body, "Trusted #198 task contract");
  assert.equal(pkg.controls.identity.taskContract.state, "resolved");
  assert.equal(
    pkg.gaps.some((gap) => gap.code === "trusted_task_contract_unavailable"),
    false,
  );
});

test("fails closed when a branch-name issue binding conflicts with a different native closing issue", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url !== "https://api.github.com/graphql") {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    const payload = JSON.parse(String(init?.body ?? "{}"));
    if (String(payload.query).includes("MiraReviewClosingIssues")) {
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              closingIssuesReferences: {
                nodes: [
                  {
                    number: 199,
                    title: "Different task",
                    body: "Different task contract",
                    updatedAt: "2026-10-01T14:00:00Z",
                    repository: { nameWithOwner: "uichat-mira/mira-desktop" },
                  },
                ],
              },
            },
          },
        },
      });
    }

    if (String(payload.query).includes("MiraReviewHeadRefIssue")) {
      return Response.json({
        data: {
          repository: {
            issue: {
              number: 198,
              title: "Expected branch task",
              body: "Expected task contract",
              updatedAt: "2026-10-01T14:13:10Z",
              repository: { nameWithOwner: "uichat-mira/mira-desktop" },
            },
          },
        },
      });
    }

    throw new Error("Unexpected GraphQL query");
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const task = await resolveTrustedTaskContract(
    { GITHUB_READ_TOKEN: "test-token" },
    "uichat-mira/mira-desktop",
    201,
    "feat/198-default-agent-entry",
  );

  assert.equal(task.contract, null);
  assert.deepEqual(task.identity, {
    state: "unavailable",
    reason: "multiple_linked_issues",
  });
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
