import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import {
  PILOT_REPOSITORIES,
  collectGitHubFacts,
  decorateFactFreshness,
  type GitHubFactsSnapshot,
} from "../src/github-facts.ts";

const network = setupServer();
const token = "fixture-github-token";

interface ObservedCall {
  url: string;
  authorization: string | null;
  ifNoneMatch: string | null;
}

let calls: ObservedCall[] = [];
let fetchBeforeTest: typeof fetch;

before(() => network.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  fetchBeforeTest = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = fetchBeforeTest;
  network.resetHandlers();
  calls = [];
});
after(() => network.close());

function record(request: Request): void {
  calls.push({
    url: request.url,
    authorization: request.headers.get("authorization"),
    ifNoneMatch: request.headers.get("if-none-match"),
  });
}

function shaFor(repository: string, branch: string): string {
  let hash = 0;
  for (const character of repository + branch) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(5);
}

function run(repository: string, file: string, id: number, branch = "dev") {
  return {
    id,
    name: file.replace(".yml", ""),
    path: `.github/workflows/${file}`,
    event: "push",
    status: "completed",
    conclusion: "success",
    head_branch: branch,
    head_sha: shaFor(repository, branch),
    run_attempt: 1,
    html_url: `https://github.com/uichat-mira/${repository}/actions/runs/${id}`,
    created_at: "2026-11-20T01:00:00Z",
    updated_at: "2026-11-20T01:05:00Z",
  };
}

function pullRequest(repository: string, number: number) {
  return {
    number,
    title: `Candidate ${number}`,
    draft: false,
    base: { ref: "dev" },
    head: { sha: shaFor(repository, `pr-${number}`) },
    updated_at: "2026-11-20T02:00:00Z",
    html_url: `https://github.com/uichat-mira/${repository}/pull/${number}`,
  };
}

const observedDefaultBranches: Record<string, string> = {
  "mira-desktop": "prod",
  "mira-mobile": "prod",
  "cloud-auth": "dev",
  "mira-cloud": "dev",
  "cloud-pi": "dev",
  "control-room": "prod",
};

function listing(omit?: string) {
  const pilot = PILOT_REPOSITORIES.filter((target) => target.name !== omit).map((target) => ({
    name: target.name,
    full_name: `uichat-mira/${target.name}`,
    visibility: "public",
    default_branch: observedDefaultBranches[target.name],
    archived: false,
    fork: false,
  }));
  return [
    ...pilot,
    {
      name: "mira-website",
      full_name: "uichat-mira/mira-website",
      visibility: "public",
      default_branch: "main",
      archived: false,
      fork: false,
    },
    {
      name: "mira-docs",
      full_name: "uichat-mira/mira-docs",
      visibility: "public",
      default_branch: "main",
      archived: false,
      fork: false,
    },
    {
      name: "private-ops",
      full_name: "uichat-mira/private-ops",
      visibility: "private",
      default_branch: "main",
      archived: false,
      fork: false,
    },
  ];
}

function installDefaultHandlers(options: { omitRepository?: string } = {}): void {
  network.use(
    http.get("https://api.github.com/orgs/uichat-mira/repos", ({ request }) => {
      record(request);
      return HttpResponse.json(listing(options.omitRepository), {
        headers: { etag: '"listing-etag"' },
      });
    }),
    http.get("https://api.github.com/repos/uichat-mira/:repo/branches/:branch", ({ params, request }) => {
      record(request);
      const repository = String(params.repo);
      const branch = String(params.branch);
      return HttpResponse.json(
        {
          name: branch,
          commit: { sha: shaFor(repository, branch) },
          protected: branch === "prod",
        },
        { headers: { etag: `"branch-${repository}-${branch}"` } },
      );
    }),
    http.get(
      "https://api.github.com/repos/uichat-mira/:repo/actions/workflows/:file/runs",
      ({ params, request }) => {
        record(request);
        const repository = String(params.repo);
        const file = String(params.file);
        const idBase = Number.parseInt(shaFor(repository, file).slice(0, 6), 16);
        return HttpResponse.json(
          {
            total_count: 2,
            workflow_runs: [
              run(repository, file, idBase, "dev"),
              run(repository, file, idBase + 1, "prod"),
            ],
          },
          { headers: { etag: `"runs-${repository}-${file}"` } },
        );
      },
    ),
    http.get("https://api.github.com/repos/uichat-mira/:repo/pulls", ({ params, request }) => {
      record(request);
      const repository = String(params.repo);
      return HttpResponse.json([], {
        headers: { etag: `"pulls-${repository}"` },
      });
    }),
  );
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(payload, { status, headers });
}

test("reads the six-repository allowlist with measured per-round budget and zero-vs-unknown semantics", async () => {
  installDefaultHandlers();

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  assert.equal(PILOT_REPOSITORIES.length, 6);
  assert.equal(new Set(PILOT_REPOSITORIES.map((target) => target.name)).size, 6);
  assert.equal(snapshot.status, "complete");
  assert.equal(snapshot.authentication.mode, "authenticated");
  assert.equal(snapshot.authentication.credentialPresent, true);
  assert.equal(snapshot.coverage.repositoriesPlanned, 6);
  assert.equal(snapshot.coverage.repositoriesComplete, 6);
  assert.equal(snapshot.coverage.branchesPlanned, 18);
  assert.equal(snapshot.coverage.branchesObserved, 18);
  assert.equal(snapshot.coverage.workflowsPlanned, 11);
  assert.equal(snapshot.coverage.workflowsObserved, 11);
  assert.equal(snapshot.coverage.pullRequestListsObserved, 6);
  assert.equal(snapshot.budget.plannedRequests, 36);
  assert.equal(snapshot.budget.maxRequests, 40);
  assert.equal(snapshot.budget.usedRequests, 36);
  assert.equal(snapshot.budget.remainingRequests, 4);
  assert.equal(snapshot.budget.retries, 0);
  assert.equal(snapshot.budget.notModifiedResponses, 0);
  assert.equal(snapshot.budget.designTargetRestPerHour, 60);
  assert.equal(snapshot.budget.designTargetStatus, "unproven");
  assert.equal(snapshot.budget.globalBoundProven, false);
  assert.equal(calls.length, 36);

  assert.equal(snapshot.scope.listing.publicRepositories, 8);
  assert.equal(snapshot.scope.listing.outsidePilotRepositories, 2);
  assert.equal(snapshot.repositories[0].presence, "observed");
  assert.equal(snapshot.repositories[0].defaultBranch, "prod");
  assert.equal(
    snapshot.repositories.find((repository) => repository.name === "cloud-auth")?.defaultBranch,
    "dev",
  );
  assert.equal(snapshot.repositories[0].branches[2].name, "prod");
  assert.equal(snapshot.repositories[0].branches[2].protected, true);
  assert.equal(snapshot.repositories[0].pullRequests.state, "observed");
  assert.deepEqual(snapshot.repositories[0].pullRequests.items, []);
  assert.equal(snapshot.repositories[0].workflows[0].runs.length, 2);
  assert.equal(snapshot.repositories[0].workflows[0].query.truncated, false);

  assert.equal(snapshot.freshness.state, "fresh");
  assert.equal(snapshot.freshness.ageSeconds, 0);
  const stale = decorateFactFreshness(
    snapshot,
    Date.parse("2026-11-20T10:00:00Z") + 3_601_000,
  );
  assert.equal(stale.freshness.state, "stale");
  assert.equal(stale.freshness.ageSeconds, 3601);

  // The token is used server-side but never projected into public-safe facts.
  assert.ok(calls.every((call) => call.authorization === `Bearer ${token}`));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(token));
  assert.ok(calls.every((call) => !call.url.includes("private-ops")));
  assert.ok(calls.every((call) => !call.url.includes("mira-website")));
  assert.ok(calls.every((call) => !call.url.includes("mira-docs")));
});

test("oversized or non-finite budget overrides cannot widen the collection envelope", async () => {
  installDefaultHandlers();
  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { limits: { maxRequests: 500, concurrency: 100, timeoutMs: 500_000, maxRetries: 100, maxRetryDelayMs: 300_000 } },
  );
  assert.equal(snapshot.budget.maxRequests, 40);
  assert.equal(snapshot.budget.concurrency, 4);
  assert.equal(snapshot.budget.timeoutMs, 8_000);
  assert.equal(snapshot.budget.usedRequests, 36);

  const fallback = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { limits: { maxRequests: Number.NaN, concurrency: Number.POSITIVE_INFINITY }, now: Date.parse("2026-11-20T10:00:00Z") },
  );
  assert.equal(fallback.budget.maxRequests, 40);
  assert.equal(fallback.budget.concurrency, 4);
});

test("missing credential is explicit and never fabricates authenticated access", async () => {
  installDefaultHandlers();

  const snapshot = await collectGitHubFacts(
    {},
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  assert.equal(snapshot.authentication.mode, "anonymous");
  assert.equal(snapshot.authentication.credentialPresent, false);
  assert.ok(snapshot.warnings.some((warning) => /credential is missing/i.test(warning)));
  assert.ok(calls.every((call) => call.authorization === null));
});

test("conditional 304 responses reuse prior observations without pretending they are new", async () => {
  installDefaultHandlers();
  const firstNow = Date.parse("2026-11-20T10:00:00Z");
  const first = await collectGitHubFacts({ GITHUB_READ_TOKEN: token }, { now: firstNow });
  const firstBranch = first.repositories[0].branches[0];
  const firstCalls = calls.length;

  network.use(
    http.get("https://api.github.com/repos/uichat-mira/:repo/branches/:branch", ({ request }) => {
      record(request);
      assert.ok(request.headers.get("if-none-match"));
      return new HttpResponse(null, { status: 304 });
    }),
    http.get(
      "https://api.github.com/repos/uichat-mira/:repo/actions/workflows/:file/runs",
      ({ request }) => {
        record(request);
        assert.ok(request.headers.get("if-none-match"));
        return new HttpResponse(null, { status: 304 });
      },
    ),
    http.get("https://api.github.com/repos/uichat-mira/:repo/pulls", ({ request }) => {
      record(request);
      assert.ok(request.headers.get("if-none-match"));
      return new HttpResponse(null, { status: 304 });
    }),
  );

  const second = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: firstNow + 60_000, previous: first },
  );

  assert.equal(calls.length - firstCalls, 36);
  assert.equal(second.budget.notModifiedResponses, 35);
  assert.equal(second.budget.usedRequests, 36);
  assert.equal(second.status, "complete");

  const secondBranch = second.repositories[0].branches[0];
  assert.equal(secondBranch.query.status, "not_modified");
  assert.equal(secondBranch.query.cache, "not_modified");
  assert.equal(secondBranch.state, "observed");
  assert.equal(secondBranch.sha, firstBranch.sha);
  assert.equal(secondBranch.observedAt, firstBranch.observedAt);
  assert.notEqual(second.generatedAt, first.generatedAt);
});

test("429 Retry-After inside the bounded window retries once", async () => {
  installDefaultHandlers();
  let attempts = 0;
  network.use(
    http.get(
      "https://api.github.com/repos/uichat-mira/cloud-auth/branches/test",
      ({ request }) => {
        record(request);
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse({ message: "rate limited" }, 429, {
            "retry-after": "0",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1893456000",
          });
        }
        return jsonResponse({ commit: { sha: shaFor("cloud-auth", "test") }, protected: false });
      },
    ),
  );

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  const branch = snapshot.repositories
    .find((repository) => repository.name === "cloud-auth")
    ?.branches.find((item) => item.name === "test");
  assert.equal(attempts, 2);
  assert.equal(snapshot.budget.retries, 1);
  assert.equal(snapshot.budget.usedRequests, 37);
  assert.equal(branch?.state, "observed");
  assert.equal(branch?.query.status, "ok");
  assert.equal(snapshot.rateLimit.remaining, 0);
  assert.equal(snapshot.rateLimit.retryAfterSeconds, 0);
});

test("429 outside the bounded Retry-After window halts the round and preserves unknown targets", async () => {
  installDefaultHandlers();
  network.use(
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-desktop/branches/dev",
      ({ request }) => {
        record(request);
        return jsonResponse({ message: "rate limited" }, 429, {
          "retry-after": "120",
          "x-ratelimit-remaining": "0",
        });
      },
    ),
  );

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  const branch = snapshot.repositories[0].branches[0];
  assert.equal(branch.state, "rate_limited");
  assert.equal(branch.query.status, "rate_limited");
  assert.equal(branch.sha, null);
  assert.equal(snapshot.budget.retries, 0);
  assert.equal(snapshot.budget.usedRequests, 5);
  assert.equal(snapshot.coverage.budgetSkippedQueries, 31);
  assert.equal(snapshot.rateLimit.retryAfterSeconds, 120);
  assert.equal(snapshot.status, "partial");
  assert.ok(snapshot.warnings.some((warning) => /rate limiting halted/i.test(warning)));
  assert.ok(snapshot.warnings.some((warning) => /not zero/i.test(warning)));
});

test("403 permission denial is inaccessible and does not halt; exhausted quota is rate_limited", async () => {
  installDefaultHandlers();
  network.use(
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-mobile/branches/dev",
      ({ request }) => {
        record(request);
        return jsonResponse({ message: "Resource not accessible by integration" }, 403, {
          "x-ratelimit-remaining": "100",
        });
      },
    ),
  );

  const permissionDenied = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );
  const deniedBranch = permissionDenied.repositories
    .find((repository) => repository.name === "mira-mobile")
    ?.branches.find((branch) => branch.name === "dev");
  assert.equal(deniedBranch?.state, "inaccessible");
  assert.equal(permissionDenied.budget.usedRequests, 36);
  assert.equal(permissionDenied.status, "partial");

  network.resetHandlers();
  installDefaultHandlers();
  network.use(
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-mobile/branches/dev",
      ({ request }) => {
        record(request);
        return jsonResponse({ message: "API rate limit exceeded" }, 403, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1893456000",
        });
      },
    ),
  );

  const quotaExhausted = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );
  const exhaustedBranch = quotaExhausted.repositories
    .find((repository) => repository.name === "mira-mobile")
    ?.branches.find((branch) => branch.name === "dev");
  assert.equal(exhaustedBranch?.state, "rate_limited");
  assert.ok(quotaExhausted.coverage.budgetSkippedQueries > 0);
  assert.equal(quotaExhausted.budget.retries, 0);
});

test("403 secondary rate limit with Retry-After is not mistaken for permission denial", async () => {
  installDefaultHandlers();
  network.use(
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-desktop/branches/dev",
      ({ request }) => {
        record(request);
        return new HttpResponse(null, {
          status: 403,
          headers: {
            "retry-after": "120",
            "x-ratelimit-remaining": "100",
          },
        });
      },
    ),
  );

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  const branch = snapshot.repositories[0].branches[0];
  assert.equal(branch.state, "rate_limited");
  assert.equal(branch.query.retryAfterSeconds, 120);
  assert.equal(snapshot.budget.retries, 0);
  assert.ok(snapshot.coverage.budgetSkippedQueries > 0);
});

test("timeouts stay timed out and never become an empty healthy result", async () => {
  const observedSignals: AbortSignal[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal instanceof AbortSignal) observedSignals.push(init.signal);
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z"), limits: { timeoutMs: 50 } },
  );

  assert.ok(observedSignals.length >= 36);
  assert.equal(snapshot.budget.usedRequests, 36);
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.scope.listing.status, "timeout");
  assert.equal(snapshot.coverage.branchesObserved, 0);
  assert.equal(snapshot.coverage.workflowsObserved, 0);
  assert.equal(snapshot.coverage.pullRequestListsObserved, 0);
  assert.ok(
    snapshot.repositories.every((repository) =>
      repository.branches.every((branch) => branch.state === "timeout"),
    ),
  );
  assert.ok(
    snapshot.repositories.every(
      (repository) =>
        repository.pullRequests.state === "timeout" &&
        repository.pullRequests.items.length === 0,
    ),
  );
  assert.ok(snapshot.warnings.some((warning) => /timeout/.test(warning)));
});

test("round budget exhaustion stops fan-out and reports the remaining targets as unknown", async () => {
  installDefaultHandlers();
  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z"), limits: { maxRequests: 5 } },
  );

  assert.equal(calls.length, 5);
  assert.equal(snapshot.budget.maxRequests, 5);
  assert.equal(snapshot.budget.usedRequests, 5);
  assert.equal(snapshot.budget.remainingRequests, 0);
  assert.equal(snapshot.coverage.budgetSkippedQueries, 31);
  assert.equal(snapshot.status, "partial");
  assert.ok(snapshot.warnings.some((warning) => /request budget/i.test(warning)));
  const skipped = snapshot.repositories
    .flatMap((repository) => repository.branches)
    .filter((branch) => branch.state === "skipped");
  assert.ok(skipped.length > 0);
  assert.ok(skipped.every((branch) => branch.query.skipReason === "budget_exhausted"));
});

test("pagination and candidate truncation are explicit", async () => {
  installDefaultHandlers();
  network.use(
    http.get(
      "https://api.github.com/repos/uichat-mira/:repo/actions/workflows/:file/runs",
      ({ params, request }) => {
        record(request);
        const repository = String(params.repo);
        const file = String(params.file);
        return HttpResponse.json({
          total_count: 17,
          workflow_runs: [1, 2, 3, 4, 5].map((number) =>
            run(repository, file, number, number % 2 === 0 ? "prod" : "dev"),
          ),
        });
      },
    ),
    http.get("https://api.github.com/repos/uichat-mira/:repo/pulls", ({ params, request }) => {
      record(request);
      const repository = String(params.repo);
      return HttpResponse.json([1, 2, 3, 4, 5].map((number) => pullRequest(repository, number)));
    }),
  );

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  assert.equal(snapshot.repositories[0].workflows[0].runs.length, 5);
  assert.equal(snapshot.repositories[0].workflows[0].totalCount, 17);
  assert.equal(snapshot.repositories[0].workflows[0].query.truncated, true);
  assert.equal(snapshot.repositories[0].pullRequests.items.length, 5);
  assert.equal(snapshot.repositories[0].pullRequests.truncated, true);
  assert.ok(snapshot.coverage.truncatedSources.length > 0);
  assert.equal(snapshot.status, "partial");
  assert.ok(snapshot.warnings.some((warning) => /truncated/i.test(warning)));
});

test("missing branch, unavailable PR source and missing repository stay distinct from real zero", async () => {
  installDefaultHandlers();
  network.use(
    http.get(
      "https://api.github.com/repos/uichat-mira/cloud-auth/branches/test",
      ({ request }) => {
        record(request);
        return new HttpResponse(null, { status: 404 });
      },
    ),
    http.get("https://api.github.com/repos/uichat-mira/mira-desktop/pulls", ({ request }) => {
      record(request);
      return new HttpResponse(null, { status: 503 });
    }),
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-mobile/actions/workflows/mobile-ci.yml/runs",
      ({ request }) => {
        record(request);
        return new HttpResponse(null, { status: 503 });
      },
    ),
  );

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  const cloudAuth = snapshot.repositories.find((repository) => repository.name === "cloud-auth");
  const missingBranch = cloudAuth?.branches.find((branch) => branch.name === "test");
  assert.equal(missingBranch?.state, "missing");
  assert.equal(missingBranch?.sha, null);
  assert.ok(cloudAuth?.coverage.missingBranches.includes("test"));

  const desktopFacts = snapshot.repositories.find((repository) => repository.name === "mira-desktop");
  assert.equal(desktopFacts?.pullRequests.state, "unavailable");
  assert.deepEqual(desktopFacts?.pullRequests.items, []);
  assert.equal(desktopFacts?.pullRequests.query.httpStatus, 503);

  const mobile = snapshot.repositories.find((repository) => repository.name === "mira-mobile");
  const unavailableWorkflow = mobile?.workflows.find((workflow) => workflow.file === "mobile-ci.yml");
  assert.equal(unavailableWorkflow?.state, "unavailable");
  assert.deepEqual(unavailableWorkflow?.runs, []);

  const stillObserved = snapshot.repositories.find((repository) => repository.name === "mira-cloud");
  assert.equal(stillObserved?.pullRequests.state, "observed");
  assert.deepEqual(stillObserved?.pullRequests.items, []);
  assert.equal(snapshot.coverage.pullRequestListsObserved, 5);
  assert.equal(snapshot.status, "partial");
});

test("a pilot repository missing from the public listing is unavailable, not a healthy zero", async () => {
  installDefaultHandlers({ omitRepository: "control-room" });

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );

  const controlRoom = snapshot.repositories.find((repository) => repository.name === "control-room");
  assert.equal(controlRoom?.presence, "missing");
  assert.equal(controlRoom?.coverage.status, "unavailable");
  assert.equal(snapshot.status, "partial");
  assert.ok(
    snapshot.warnings.some(
      (warning) => /control-room.*not present/i.test(warning),
    ),
  );
});
