import assert from "node:assert/strict";
import test, { before, after, afterEach } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { getFactoryFeed } from "../src/factory-feed.ts";

const server = setupServer();
const env = { GITHUB_READ_TOKEN: "fixture-github-token" };
const now = Date.parse("2026-11-19T12:00:00Z");

before(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
after(() => server.close());

const repo = (name: string) => ({
  name, visibility: "public", archived: false, fork: false,
});
const run = (id: number, repository: string, overrides: Record<string, unknown> = {}) => ({
  id, name: "Mira External Worker",
  path: ".github/workflows/mira-external-worker.yml",
  status: "completed", conclusion: "failure",
  created_at: "2026-11-18T08:00:00Z",
  updated_at: "2026-11-18T08:10:00Z",
  run_attempt: 1,
  html_url: "https://github.com/uichat-mira/" + repository + "/actions/runs/" + id,
  display_title: "Worker issue #42", head_branch: "dev",
  referenced_workflows: [{ path: "uichat-mira/.github/.github/workflows/mira-external-worker.yml@fixed-sha" }],
  ...overrides,
});

test("auto-discovery shows only genuine executed Worker Runs, never skipped callers", async () => {
  server.use(
    http.get("https://api.github.com/orgs/uichat-mira/repos", () =>
      HttpResponse.json([repo("alpha"), repo("beta"), { ...repo("hidden"), visibility: "private" }])),
    http.get("https://api.github.com/repos/uichat-mira/alpha/actions/workflows/mira-external-worker.yml/runs",
      () => HttpResponse.json({ workflow_runs: [
        run(1001, "alpha"),
        run(1002, "alpha", { conclusion: "skipped" }),
        run(1003, "alpha", { referenced_workflows: [{ path: "another-org/worker.yml@sha" }] }),
        run(1004, "alpha", { created_at: "2026-10-01T00:00:00Z" }),
      ] })),
    http.get("https://api.github.com/repos/uichat-mira/beta/actions/workflows/mira-external-worker.yml/runs",
      () => new HttpResponse(null, { status: 404 })),
  );
  const feed = await getFactoryFeed(env, now);
  assert.equal(feed.status, "connected");
  assert.equal(feed.scannedRepositories, 2);
  assert.deepEqual(feed.items.map((item) => item.id), [1001]);
  assert.equal(feed.items[0].repository, "uichat-mira/alpha");
});

test("active Runs outrank completed Runs without guessing a model heartbeat", async () => {
  server.use(
    http.get("https://api.github.com/orgs/uichat-mira/repos", () => HttpResponse.json([repo("alpha")])),
    http.get("https://api.github.com/repos/uichat-mira/alpha/actions/workflows/mira-external-worker.yml/runs",
      () => HttpResponse.json({ workflow_runs: [
        run(1011, "alpha"),
        run(1012, "alpha", { status: "in_progress", conclusion: null, created_at: "2026-11-18T07:00:00Z" }),
      ] })),
  );
  const feed = await getFactoryFeed(env, now);
  assert.deepEqual(feed.items.map((item) => item.id), [1012, 1011]);
  assert.equal(feed.items[0].status, "in_progress");
});

test("partial upstream failure is explicit, not a fabricated empty/healthy organization", async () => {
  server.use(
    http.get("https://api.github.com/orgs/uichat-mira/repos", () => HttpResponse.json([repo("alpha"), repo("beta")])),
    http.get("https://api.github.com/repos/uichat-mira/alpha/actions/workflows/mira-external-worker.yml/runs",
      () => new HttpResponse(null, { status: 503 })),
    http.get("https://api.github.com/repos/uichat-mira/beta/actions/workflows/mira-external-worker.yml/runs",
      () => new HttpResponse(null, { status: 404 })),
  );
  const feed = await getFactoryFeed(env, now);
  assert.equal(feed.status, "partial");
  assert.equal(feed.failedRepositories, 1);
  assert.deepEqual(feed.items, []);
});

test("when every repository fails, discovery throws instead of showing idle", async () => {
  server.use(
    http.get("https://api.github.com/orgs/uichat-mira/repos", () => HttpResponse.json([repo("alpha")])),
    http.get("https://api.github.com/repos/uichat-mira/alpha/actions/workflows/mira-external-worker.yml/runs",
      () => new HttpResponse(null, { status: 429 })),
  );
  await assert.rejects(() => getFactoryFeed(env, now), /All GitHub Actions sources unavailable/);
});

test("GraphQL checks default-branch caller files before expensive per-repository reads", async () => {
  server.use(
    http.get("https://api.github.com/orgs/uichat-mira/repos", () =>
      HttpResponse.json([
        { ...repo("alpha"), default_branch: "dev" },
        { ...repo("beta"), default_branch: "prod" },
      ])),
    http.post("https://api.github.com/graphql", async ({ request }) => {
      const body = await request.json() as { query: string };
      assert.match(body.query, /alpha/);
      assert.match(body.query, /beta/);
      return HttpResponse.json({ data: { r0: { object: { oid: "sha" } }, r1: { object: null } } });
    }),
    http.get("https://api.github.com/repos/uichat-mira/alpha/actions/workflows/mira-external-worker.yml/runs",
      () => HttpResponse.json({ workflow_runs: [run(1013, "alpha")] })),
  );
  const feed = await getFactoryFeed(env, now);
  assert.equal(feed.status, "connected");
  assert.equal(feed.scannedRepositories, 1);
  assert.equal(feed.eligibleRepositories, 2);
  assert.deepEqual(feed.items.map((item) => item.id), [1013]);
});
