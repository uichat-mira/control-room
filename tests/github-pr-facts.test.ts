import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import {
  collectPullRequestFacts,
  pilotRepositoryName,
} from "../src/github-pr-facts.ts";

const network = setupServer();
const token = "pr-fixture-secret-token";
const env = { GITHUB_READ_TOKEN: token };
const headSha = "15512daae3e9c022abbb7b7a1fa4617f0cf4b529";
const baseUrl = "https://api.github.com";
let calls = 0;
let authorizations = new Set<string | null>();

before(() => network.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  calls = 0;
  authorizations = new Set();
});
afterEach(() => network.resetHandlers());
after(() => network.close());

function detail(overrides: Record<string, unknown> = {}) {
  return {
    number: 404,
    title: "agent: #402 [DSK-003] Make shared NavigationCardTabs collapse",
    state: "open",
    draft: true,
    merged: false,
    mergeable: false,
    mergeable_state: "dirty",
    user: { login: "github-actions[bot]", type: "Bot" },
    author_association: "CONTRIBUTOR",
    base: { ref: "dev" },
    head: { ref: "feat/worker-402", sha: headSha },
    created_at: "2026-10-20T05:26:23Z",
    updated_at: "2026-10-20T05:43:55Z",
    html_url: "https://github.com/uichat-mira/mira-desktop/pull/404",
    ...overrides,
  };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: 5581190588,
    user: { login: "dangjingtao", type: "User" },
    state: "CHANGES_REQUESTED",
    commit_id: headSha,
    submitted_at: "2026-10-20T05:43:55Z",
    author_association: "MEMBER",
    html_url:
      "https://github.com/uichat-mira/mira-desktop/pull/404#pullrequestreview-5581190588",
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 44713164110,
    name: "Build Desktop Apps",
    path: ".github/workflows/build-desktop.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_branch: "feat/worker-402",
    head_sha: headSha,
    run_attempt: 1,
    html_url: "https://github.com/uichat-mira/mira-desktop/actions/runs/44713164110",
    created_at: "2026-11-20T01:00:00Z",
    updated_at: "2026-11-20T01:05:00Z",
    ...overrides,
  };
}

function installHandlers(
  options: {
    detailResponse?: () => Response;
    reviewsResponse?: () => Response;
    runsResponse?: () => Response;
  } = {},
) {
  network.use(
    http.get(`${baseUrl}/repos/uichat-mira/mira-desktop/pulls/404`, ({ request }) => {
      calls += 1;
      authorizations.add(request.headers.get("authorization"));
      return options.detailResponse ? options.detailResponse() : HttpResponse.json(detail());
    }),
    http.get(
      `${baseUrl}/repos/uichat-mira/mira-desktop/pulls/404/reviews`,
      ({ request }) => {
        calls += 1;
        authorizations.add(request.headers.get("authorization"));
        return options.reviewsResponse
          ? options.reviewsResponse()
          : HttpResponse.json([review()]);
      },
    ),
    http.get(
      `${baseUrl}/repos/uichat-mira/mira-desktop/actions/runs`,
      ({ request }) => {
        calls += 1;
        authorizations.add(request.headers.get("authorization"));
        return options.runsResponse
          ? options.runsResponse()
          : HttpResponse.json({ total_count: 1, workflow_runs: [run()] });
      },
    ),
  );
}

test("one PR projection uses exactly three bounded reads and keeps public-safe shapes", async () => {
  installHandlers();
  const snapshot = await collectPullRequestFacts(
    env,
    "uichat-mira/mira-desktop",
    404,
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  assert.equal(calls, 3);
  assert.equal(snapshot.status, "complete");
  assert.equal(snapshot.budget.usedRequests, 3);
  assert.equal(snapshot.budget.maxRequests, 5);
  assert.equal(snapshot.detail?.draft, true);
  assert.equal(snapshot.detail?.mergeable, false);
  assert.equal(snapshot.detail?.mergeableState, "dirty");
  assert.equal(snapshot.detail?.headSha, headSha);
  assert.equal(snapshot.detail?.authorLogin, "github-actions[bot]");
  assert.equal(snapshot.reviews.items.length, 1);
  assert.equal(snapshot.reviews.items[0].state, "CHANGES_REQUESTED");
  assert.equal(snapshot.reviews.items[0].commitId, headSha);
  assert.equal(snapshot.headWorkflowRuns.items.length, 1);
  assert.equal(snapshot.headWorkflowRuns.items[0].path, ".github/workflows/build-desktop.yml");

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, new RegExp(token));
  assert.deepEqual(authorizations, new Set([`Bearer ${token}`]));
  assert.ok(
    snapshot.warnings.some((warning) => /trusted caller/i.test(warning)),
    "hold authority is never parsed from PR text",
  );
});

test("mergeable=null is preserved as not computed rather than converted to a conflict", async () => {
  installHandlers({
    detailResponse: () =>
      HttpResponse.json(
        detail({ number: 279, mergeable: null, mergeable_state: "unknown", draft: false }),
      ),
  });
  const snapshot = await collectPullRequestFacts(env, "mira-desktop", 404);
  assert.equal(snapshot.detail?.mergeable, null);
  assert.equal(snapshot.detail?.mergeableState, "unknown");
});

test("bounded review and head-run pagination are reported as truncation, not completeness", async () => {
  installHandlers({
    reviewsResponse: () => HttpResponse.json(Array.from({ length: 30 }, (_, index) =>
      review({ id: 1000 + index, submitted_at: `2026-10-20T05:${String(index).padStart(2, "0")}:00Z` }),
    )),
    runsResponse: () =>
      HttpResponse.json({
        total_count: 31,
        workflow_runs: Array.from({ length: 30 }, (_, index) =>
          run({ id: 2000 + index, path: `.github/workflows/pr-${index}.yml` }),
        ),
      }),
  });
  const snapshot = await collectPullRequestFacts(env, "mira-desktop", 404);
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.reviews.truncated, true);
  assert.equal(snapshot.headWorkflowRuns.truncated, true);
  assert.ok(snapshot.coverage.truncatedSources.length >= 2);
});

test("403 without rate-limit headers is inaccessible, and 429 halts dependent reads honestly", async () => {
  installHandlers({
    reviewsResponse: () =>
      HttpResponse.json(
        { message: "Resource not accessible by integration" },
        { status: 403, headers: { "x-ratelimit-remaining": "100" } },
      ),
    runsResponse: () =>
      HttpResponse.json(
        { message: "API rate limit exceeded" },
        { status: 429, headers: { "retry-after": "60" } },
      ),
  });
  const snapshot = await collectPullRequestFacts(env, "mira-desktop", 404);
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.reviews.state, "inaccessible");
  // The reviews 403 does not halt the round, so the runs request is attempted
  // and then reports its own rate limit.
  assert.equal(snapshot.headWorkflowRuns.state, "rate_limited");
  assert.ok(snapshot.coverage.reasons.some((reason) => /inaccessible/.test(reason)));
  assert.ok(snapshot.coverage.reasons.some((reason) => /rate_limited/.test(reason)));
});

test("an unreadable PR detail stops before reviews/runs instead of inventing them", async () => {
  installHandlers({
    detailResponse: () =>
      HttpResponse.json({ message: "Not Found" }, { status: 404 }),
  });
  const snapshot = await collectPullRequestFacts(env, "mira-desktop", 404);
  assert.equal(calls, 1);
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.detail, null);
  assert.equal(snapshot.coverage.notAttemptedQueries, 2);
  assert.equal(snapshot.reviews.state, "unavailable");
  assert.equal(snapshot.headWorkflowRuns.state, "unavailable");
  assert.ok(snapshot.warnings.some((warning) => /not zero/i.test(warning)));
});

test("repository and PR-number validation reject everything outside the pilot scope", async () => {
  assert.equal(pilotRepositoryName("mira-desktop"), "mira-desktop");
  assert.equal(pilotRepositoryName("uichat-mira/mira-desktop"), "mira-desktop");
  assert.equal(pilotRepositoryName("uichat-mira/private-ops"), null);
  await assert.rejects(
    () => collectPullRequestFacts(env, "uichat-mira/private-ops", 1),
    /unsupported_repository/,
  );
  await assert.rejects(
    () => collectPullRequestFacts(env, "mira-desktop", 0),
    /invalid_pull_request_number/,
  );
});
