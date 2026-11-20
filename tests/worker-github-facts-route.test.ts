import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { handleGitHubFactsRequest } from "../src/github-facts-route.ts";
import { PILOT_REPOSITORIES } from "../src/github-facts.ts";

const network = setupServer();
const token = "worker-fixture-secret-token";
const env = { GITHUB_READ_TOKEN: token };
const origin = "https://control.test";

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

function shaFor(repository: string, branch: string): string {
  let hash = 0;
  for (const character of repository + branch) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(5);
}

const observedDefaultBranches: Record<string, string> = {
  "mira-desktop": "prod",
  "mira-mobile": "prod",
  "cloud-auth": "dev",
  "mira-cloud": "dev",
  "cloud-pi": "dev",
  "control-room": "prod",
};

function installHandlers(): void {
  network.use(
    http.get("https://api.github.com/orgs/uichat-mira/repos", ({ request }) => {
      calls += 1;
      authorizations.add(request.headers.get("authorization"));
      return HttpResponse.json([
        ...PILOT_REPOSITORIES.map((target) => ({
          name: target.name,
          full_name: `uichat-mira/${target.name}`,
          visibility: "public",
          default_branch: observedDefaultBranches[target.name],
          archived: false,
          fork: false,
        })),
        {
          name: "private-ops",
          full_name: "uichat-mira/private-ops",
          visibility: "private",
          default_branch: "main",
          archived: false,
          fork: false,
        },
      ]);
    }),
    http.get("https://api.github.com/repos/uichat-mira/:repo/branches/:branch", ({ params, request }) => {
      calls += 1;
      authorizations.add(request.headers.get("authorization"));
      return HttpResponse.json({
        name: String(params.branch),
        commit: { sha: shaFor(String(params.repo), String(params.branch)) },
        protected: String(params.branch) === "prod",
      });
    }),
    http.get(
      "https://api.github.com/repos/uichat-mira/:repo/actions/workflows/:file/runs",
      ({ params, request }) => {
        calls += 1;
        authorizations.add(request.headers.get("authorization"));
        return HttpResponse.json({
          total_count: 1,
          workflow_runs: [{
            id: 1,
            name: String(params.file),
            path: `.github/workflows/${params.file}`,
            event: "push",
            status: "completed",
            conclusion: "success",
            head_branch: "dev",
            head_sha: shaFor(String(params.repo), "dev"),
            run_attempt: 1,
            html_url: `https://github.com/uichat-mira/${params.repo}/actions/runs/1`,
            created_at: "2026-11-20T01:00:00Z",
            updated_at: "2026-11-20T01:05:00Z",
          }],
        });
      },
    ),
    http.get("https://api.github.com/repos/uichat-mira/:repo/pulls", ({ request }) => {
      calls += 1;
      authorizations.add(request.headers.get("authorization"));
      return HttpResponse.json([]);
    }),
  );
}

async function readFacts(headers: Record<string, string> = {}) {
  const response = await handleGitHubFactsRequest(
    new Request(`${origin}/api/v1/github/facts`, { headers }),
    env,
  );
  const text = await response.text();
  return { response, text, body: JSON.parse(text) as Record<string, unknown> };
}

test("one shared Worker snapshot serves many visitors with bounded fan-out and no credential leakage", async () => {
  installHandlers();

  const first = await readFacts({ "cf-connecting-ip": "203.0.113.10" });
  assert.equal(first.response.status, 200);
  assert.equal(first.response.headers.get("x-mira-api-version"), "v1");
  assert.equal(first.response.headers.get("x-mira-github-facts-cache"), "miss");
  assert.equal(first.response.headers.get("x-mira-github-facts-scope"), "pilot-6");
  assert.equal(first.response.headers.get("x-mira-github-facts-budget"), "36/40");
  assert.equal(first.body.status, "complete");
  assert.equal(calls, 36);

  const second = await readFacts({ "cf-connecting-ip": "198.51.100.24" });
  assert.equal(second.response.status, 200);
  assert.equal(second.response.headers.get("x-mira-github-facts-cache"), "hit");
  assert.equal(calls, 36, "a second visitor must reuse the shared snapshot");
  assert.equal(second.body.generatedAt, first.body.generatedAt);

  assert.deepEqual(authorizations, new Set([`Bearer ${token}`]));
  assert.doesNotMatch(first.text, new RegExp(token));
  assert.doesNotMatch(second.text, new RegExp(token));
  assert.ok(
    first.text.indexOf("private-ops") === -1,
    "private repositories are never projected or queried",
  );
});

test("simultaneous cold-cache visitors share one in-flight GitHub round", async () => {
  installHandlers();
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      readFacts({ "cf-connecting-ip": `198.51.100.${i + 10}` }),
    ),
  );

  assert.equal(calls, 36, "four simultaneous visitors must not make four 36-call scans");
  assert.ok(results.every((result) => result.response.status === 200));
  assert.ok(results.every((result) => result.body.status === "complete"));
  assert.equal(new Set(results.map((result) => result.body.generatedAt)).size, 1);
  assert.ok(results.every((result) => !result.text.includes(token)));

  // The singleflight lock must be released after resolution.
  const next = await readFacts();
  assert.equal(next.response.headers.get("x-mira-github-facts-cache"), "hit");
  assert.equal(calls, 36);
});

test("a partial source stays partial in the cached public projection", async () => {
  installHandlers();
  network.use(
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-desktop/branches/dev",
      ({ request }) => {
        calls += 1;
        authorizations.add(request.headers.get("authorization"));
        return HttpResponse.json(
          { message: "Resource not accessible by integration" },
          { status: 403, headers: { "x-ratelimit-remaining": "100" } },
        );
      },
    ),
  );

  const first = await readFacts();
  assert.equal(first.response.status, 200);
  assert.equal(first.body.status, "partial");
  const repositories = first.body.repositories as Array<Record<string, unknown>>;
  const desktop = repositories.find((repository) => repository.name === "mira-desktop") as {
    branches: Array<Record<string, unknown>>;
    coverage: { status: string };
  };
  assert.equal(desktop.branches[0].state, "inaccessible");
  assert.equal(desktop.coverage.status, "partial");
  const warnings = first.body.warnings as string[];
  assert.ok(warnings.some((warning) => /inaccessible/.test(warning)));

  const second = await readFacts();
  assert.equal(second.response.headers.get("x-mira-github-facts-cache"), "hit");
  assert.equal(second.body.status, "partial");
  assert.equal(calls, 36);
});

test("cache API outage falls back to one isolate-local snapshot, not one scan per visitor", async () => {
  installHandlers();
  delete (globalThis as { caches?: unknown }).caches;

  const first = await readFacts();
  assert.equal(first.response.headers.get("x-mira-github-facts-cache"), "bypass");
  assert.equal(calls, 36);

  const second = await readFacts();
  assert.equal(second.response.headers.get("x-mira-github-facts-cache"), "bypass");
  assert.equal(calls, 36);
  assert.equal(second.body.generatedAt, first.body.generatedAt);
});
