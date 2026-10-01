import assert from "node:assert/strict";
import test from "node:test";

import {
  issueNumberHintFromHeadRef,
  resolveTrustedTaskContract,
} from "../src/ai-review-package.ts";

const REPOSITORY = "uichat-mira/uichat-mira-docs";

function closingIssue(number: number) {
  return {
    number,
    title: `Issue ${number}`,
    body: `Contract ${number}`,
    updatedAt: "2026-09-16T10:00:00Z",
    repository: { nameWithOwner: REPOSITORY },
  };
}

function graphqlQuery(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? "{}")) as {
    query?: string;
    variables?: Record<string, unknown>;
  };
}

test("extracts an Issue number only as a work-branch hint", () => {
  assert.equal(issueNumberHintFromHeadRef("feat/88-trusted-work-start"), 88);
  assert.equal(issueNumberHintFromHeadRef("docs/123/readme"), 123);
  assert.equal(issueNumberHintFromHeadRef("feat/no-issue"), null);
  assert.equal(issueNumberHintFromHeadRef("dev"), null);
});

test("trusts an Issue when GitHub linkedBranches proves the exact PR head relation", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = graphqlQuery(init);
    if (request.query?.includes("MiraReviewClosingIssues")) {
      return Response.json({
        data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } } },
      });
    }
    if (request.query?.includes("MiraReviewLinkedBranchIssue")) {
      assert.equal(request.variables?.issue, 88);
      return Response.json({
        data: {
          repository: {
            issue: {
              ...closingIssue(88),
              linkedBranches: {
                nodes: [{ ref: { name: "feat/88-trusted-work-start" } }],
              },
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
    REPOSITORY,
    90,
    "feat/88-trusted-work-start",
  );

  assert.equal(task.contract?.issue, 88);
  assert.equal(task.contract?.body, "Contract 88");
  assert.equal(task.identity.state, "resolved");
});

test("does not trust a numeric branch hint unless GitHub verifies the linked branch", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = graphqlQuery(init);
    if (request.query?.includes("MiraReviewClosingIssues")) {
      return Response.json({
        data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } } },
      });
    }
    if (request.query?.includes("MiraReviewLinkedBranchIssue")) {
      return Response.json({
        data: {
          repository: {
            issue: {
              ...closingIssue(88),
              linkedBranches: {
                nodes: [{ ref: { name: "feat/88-some-other-branch" } }],
              },
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
    REPOSITORY,
    90,
    "feat/88-trusted-work-start",
  );

  assert.deepEqual(task.identity, {
    state: "unavailable",
    reason: "no_linked_issue",
  });
});

test("keeps legacy closingIssuesReferences as a trusted compatibility path", async (t) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const request = graphqlQuery(init);
    assert.ok(request.query?.includes("MiraReviewClosingIssues"));
    return Response.json({
      data: {
        repository: {
          pullRequest: {
            closingIssuesReferences: { nodes: [closingIssue(109)] },
          },
        },
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const task = await resolveTrustedTaskContract(
    { GITHUB_READ_TOKEN: "test-token" },
    REPOSITORY,
    90,
    "feat/example",
  );

  assert.equal(task.contract?.issue, 109);
  assert.equal(requests, 1);
});

test("refuses to guess when linked-branch and closing relations point at different Issues", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = graphqlQuery(init);
    if (request.query?.includes("MiraReviewClosingIssues")) {
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              closingIssuesReferences: { nodes: [closingIssue(109)] },
            },
          },
        },
      });
    }
    if (request.query?.includes("MiraReviewLinkedBranchIssue")) {
      return Response.json({
        data: {
          repository: {
            issue: {
              ...closingIssue(88),
              linkedBranches: {
                nodes: [{ ref: { name: "feat/88-trusted-work-start" } }],
              },
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
    REPOSITORY,
    90,
    "feat/88-trusted-work-start",
  );

  assert.deepEqual(task.identity, {
    state: "unavailable",
    reason: "multiple_linked_issues",
  });
});
