import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { handleGitHubPullRequestRequest } from "../src/github-pr-route.ts";

const network = setupServer();
const token = "worker-pr-fixture-secret-token";
const env = { GITHUB_READ_TOKEN: token };
const origin = "https://control.test";
const headSha = "15512daae3e9c022abbb7b7a1fa4617f0cf4b529";
const baseUrl = "https://api.github.com";

class FakeCache {
  private readonly store = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.store.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.store.set(request.url, response.clone());
  }
}

let calls = 0;
let authorizations = new Set<string | null>();

before(() => network.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  calls = 0;
  authorizations = new Set();
  (globalThis as { caches?: unknown }).caches = { default: new FakeCache() };
});
afterEach(() => network.resetHandlers());
after(() => {
  network.close();
  delete (globalThis as { caches?: unknown }).caches;
});

function installHandlers() {
  network.use(
    http.get(`${baseUrl}/repos/uichat-mira/:repo/pulls/:number`, ({ params, request }) => {
      calls += 1;
      authorizations.add(request.headers.get("authorization"));
      return HttpResponse.json({
        number: Number(params.number),
        title: "Draft fixture",
        state: "open",
        draft: true,
        merged: false,
        mergeable: false,
        mergeable_state: "dirty",
        user: { login: "github-actions[bot]", type: "Bot" },
        author_association: "CONTRIBUTOR",
        base: { ref: "dev" },
        head: { ref: "feat/worker-404", sha: headSha },
        created_at: "2026-10-20T05:26:23Z",
        updated_at: "2026-10-20T05:43:55Z",
        html_url: `https://github.com/uichat-mira/${params.repo}/pull/${params.number}`,
      });
    }),
    http.get(
      `${baseUrl}/repos/uichat-mira/:repo/pulls/:number/reviews`,
      ({ request }) => {
        calls += 1;
        authorizations.add(request.headers.get("authorization"));
        return HttpResponse.json([
          {
            id: 5581190588,
            user: { login: "dangjingtao", type: "User" },
            state: "CHANGES_REQUESTED",
            commit_id: headSha,
            submitted_at: "2026-10-20T05:43:55Z",
            author_association: "MEMBER",
            html_url: "https://github.com/uichat-mira/mira-desktop/pull/404#pullrequestreview-5581190588",
          },
        ]);
      },
    ),
    http.get(
      `${baseUrl}/repos/uichat-mira/:repo/actions/runs`,
      ({ request }) => {
        calls += 1;
        authorizations.add(request.headers.get("authorization"));
        return HttpResponse.json({
          total_count: 1,
          workflow_runs: [
            {
              id: 44713164110,
              name: "Build Desktop Apps",
              path: ".github/workflows/build-desktop.yml",
              event: "pull_request",
              status: "completed",
              conclusion: "success",
              head_branch: "feat/worker-404",
              head_sha: headSha,
              run_attempt: 1,
              html_url:
                "https://github.com/uichat-mira/mira-desktop/actions/runs/44713164110",
              created_at: "2026-11-20T01:00:00Z",
              updated_at: "2026-11-20T01:05:00Z",
            },
          ],
        });
      },
    ),
  );
}

async function read(
  repository = "uichat-mira/mira-desktop",
  number = 404,
): Promise<{ response: Response; text: string; body: Record<string, unknown> }> {
  const response = await handleGitHubPullRequestRequest(
    new Request(
      `${origin}/api/v1/github/pull?repository=${encodeURIComponent(repository)}&number=${number}`,
    ),
    env,
  );
  const text = await response.text();
  return { response, text, body: JSON.parse(text) as Record<string, unknown> };
}

test("single-PR route is cached, bounded, public-safe and never emits a token", async () => {
  installHandlers();

  const first = await read();
  assert.equal(first.response.status, 200);
  assert.equal(first.response.headers.get("x-mira-api-version"), "v1");
  assert.equal(first.response.headers.get("x-mira-github-pr-cache"), "miss");
  assert.equal(first.response.headers.get("x-mira-github-pr-scope"), "pilot-6");
  assert.equal(first.response.headers.get("x-mira-github-pr-budget"), "3/5");
  assert.equal(first.response.headers.get("x-mira-github-pr-status"), "observed");
  assert.equal(
    first.response.headers.get("x-mira-github-pr-required-by-github"),
    "unknown",
  );
  assert.equal(first.body.source, "github-pr-derivation");
  assert.equal(first.body.id, "pr:uichat-mira/mira-desktop#404");
  assert.equal(first.body.status, "observed");
  assert.equal(first.body.draft, true);
  assert.equal(first.body.mergeable, false);
  assert.equal(calls, 3);

  const second = await read();
  assert.equal(second.response.headers.get("x-mira-github-pr-cache"), "hit");
  assert.equal(calls, 3, "a second visitor must reuse the shared PR projection");
  assert.equal(second.body.id, first.body.id);
  assert.doesNotMatch(first.text, new RegExp(token));
  assert.doesNotMatch(second.text, new RegExp(token));
  assert.deepEqual(authorizations, new Set([`Bearer ${token}`]));
});

test("simultaneous cold-cache visitors share one in-flight PR round", async () => {
  installHandlers();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => read("uichat-mira/mira-desktop", 405)),
  );
  assert.equal(calls, 3);
  assert.ok(results.every((result) => result.response.status === 200));
  assert.equal(
    new Set(results.map((result) => result.body.factsGeneratedAt)).size,
    1,
    "all visitors must share the same underlying facts snapshot",
  );
});

test("invalid and out-of-pilot requests fail before any GitHub read", async () => {
  installHandlers();
  const missing = await handleGitHubPullRequestRequest(
    new Request(`${origin}/api/v1/github/pull?repository=uichat-mira/mira-desktop`),
    env,
  );
  assert.equal(missing.status, 400);

  const unsupported = await read("uichat-mira/private-ops", 1);
  assert.equal(unsupported.response.status, 404);
  assert.equal(unsupported.body.status, "unsupported_repository");
  assert.equal(calls, 0);
});

test("cache API outage falls back to one isolate-local PR projection, not one scan per visitor", async () => {
  installHandlers();
  delete (globalThis as { caches?: unknown }).caches;

  const first = await read("uichat-mira/mira-desktop", 406);
  assert.equal(first.response.headers.get("x-mira-github-pr-cache"), "bypass");
  assert.equal(calls, 3);

  const second = await read("uichat-mira/mira-desktop", 406);
  assert.equal(second.response.headers.get("x-mira-github-pr-cache"), "bypass");
  assert.equal(calls, 3);
  assert.equal(second.body.id, first.body.id);
});

test("403/429 source gaps stay explicit unknown facts instead of a fabricated blocker count", async () => {
  installHandlers();
  network.use(
    http.get(
      `${baseUrl}/repos/uichat-mira/cloud-auth/pulls/163`,
      () =>
        HttpResponse.json({
          number: 163,
          title: "Non-draft fixture",
          state: "open",
          draft: false,
          merged: false,
          mergeable: null,
          mergeable_state: "unknown",
          user: { login: "dangjingtao", type: "User" },
          author_association: "MEMBER",
          base: { ref: "dev" },
          head: { ref: "fix/who-you", sha: headSha },
          created_at: "2026-11-20T09:43:39Z",
          updated_at: "2026-11-20T09:43:50Z",
          html_url: "https://github.com/uichat-mira/cloud-auth/pull/163",
        }),
    ),
    http.get(
      `${baseUrl}/repos/uichat-mira/:repo/pulls/:number/reviews`,
      () =>
        HttpResponse.json(
          { message: "Resource not accessible by integration" },
          { status: 403, headers: { "x-ratelimit-remaining": "100" } },
        ),
    ),
    http.get(
      `${baseUrl}/repos/uichat-mira/:repo/actions/runs`,
      () =>
        HttpResponse.json(
          { message: "API rate limit exceeded" },
          { status: 429, headers: { "retry-after": "60" } },
        ),
    ),
  );
  const result = await read("uichat-mira/cloud-auth", 163);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "unknown");
  assert.equal(result.response.headers.get("x-mira-github-pr-facts-status"), "partial");
  const warnings = result.body.warnings as string[];
  assert.ok(warnings.some((warning) => /rate limiting halted/i.test(warning)));
});
