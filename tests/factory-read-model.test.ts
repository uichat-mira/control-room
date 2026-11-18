import assert from "node:assert/strict";
import test, { after, before, afterEach } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { getFactoryRunProjection } from "../src/factory-read-model.ts";

const network = setupServer();
const githubEnv = { GITHUB_READ_TOKEN: "github-read" };
const cloudflareEnv = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_READ_TOKEN: "cloudflare-read",
};

before(() => network.listen({ onUnhandledRequest: "error" }));
afterEach(() => network.resetHandlers());
after(() => network.close());

const run = {
  id: 123,
  name: "Mira External Worker",
  path: ".github/workflows/mira-external-worker.yml",
  status: "completed",
  conclusion: "success",
  event: "issue_comment",
  html_url: "https://github.com/uichat-mira/mira-mobile/actions/runs/123",
  created_at: "2026-11-18T06:00:00Z",
  updated_at: "2026-11-18T06:12:00Z",
  run_attempt: 2,
  head_branch: "prod",
  head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  display_title: "[MOB-084] Worker",
  run_started_at: "2026-11-18T06:00:05Z",
  referenced_workflows: [
    { path: "uichat-mira/.github/.github/workflows/mira-external-worker.yml", sha: "worker-sha" },
  ],
  pull_requests: [{ number: 77, html_url: "https://github.com/uichat-mira/mira-mobile/pull/77" }],
};

function githubHandlers(options: {
  visibility?: string;
  artifacts?: unknown[];
  jobs?: unknown[];
}) {
  return [
    http.get("https://api.github.com/repos/uichat-mira/mira-mobile", () =>
      HttpResponse.json({ visibility: options.visibility ?? "public" }),
    ),
    http.get("https://api.github.com/repos/uichat-mira/mira-mobile/actions/runs/123", () =>
      HttpResponse.json(run),
    ),
    http.get("https://api.github.com/repos/uichat-mira/mira-mobile/actions/runs/123/jobs", () =>
      HttpResponse.json({ jobs: options.jobs ?? [{ id: 1, name: "worker_capture", status: "completed", conclusion: "success", started_at: "2026-11-18T06:00:05Z", completed_at: "2026-11-18T06:05:00Z" }] }),
    ),
    http.get("https://api.github.com/repos/uichat-mira/mira-mobile/actions/runs/123/artifacts", () =>
      HttpResponse.json({ artifacts: options.artifacts ?? [{ id: 11, name: "candidate", expired: false, created_at: "2026-11-18T06:05:00Z", expires_at: "2026-12-18T06:05:00Z", updated_at: "2026-11-18T06:05:00Z", url: "https://api.github.com/artifacts/11", archive_download_url: "https://api.github.com/artifacts/11/zip" }] }),
    ),
    http.get("https://api.github.com/repos/uichat-mira/mira-mobile/pulls/77", () =>
      HttpResponse.json({ number: 77, html_url: "https://github.com/uichat-mira/mira-mobile/pull/77", draft: true, title: "Worker Candidate" }),
    ),
  ];
}

function reporterHandler(source: Record<string, unknown>) {
  return http.post(
    "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
    async () =>
      HttpResponse.json({
        success: true,
        result: { events: { count: 1, events: [{ source }] } },
      }),
  );
}

test("projects trusted Reporter Verify PASS as verified without exposing raw telemetry", async () => {
  network.use(
    ...githubHandlers({}),
    reporterHandler({
      schema: "haomai.telemetry.v1",
      app_id: "mira-worker-reporter",
      trust_class: "trusted_pipeline",
      repository: "uichat-mira/mira-mobile",
      issue_number: 84,
      run_id: "123",
      run_attempt: 2,
      occurred_at: "2026-11-18T06:11:00Z",
      kind: "verify.passed",
      stage: "verify",
      outcome: "passed",
      level: "info",
      event_id: "evt-1",
      error_code: null,
      sensitive_secret: "must-not-leak",
    }),
  );

  const projection = await getFactoryRunProjection(githubEnv, cloudflareEnv, "uichat-mira/mira-mobile", 123, Date.parse("2026-11-18T06:12:30Z"));

  assert.equal(projection.state, "verified");
  assert.equal(projection.issueNumber, 84);
  assert.equal(projection.reporter.status, "available");
  assert.equal(projection.reporter.events[0]?.kind, "verify.passed");
  assert.doesNotMatch(JSON.stringify(projection), /sensitive_secret|must-not-leak/);
  assert.equal(projection.provenance.some((item) => item.id === "evt-1"), true);
});

test("Reporter evidence from a previous run attempt is ignored", async () => {
  network.use(
    ...githubHandlers({}),
    reporterHandler({
      schema: "haomai.telemetry.v1",
      app_id: "mira-worker-reporter",
      trust_class: "trusted_pipeline",
      repository: "uichat-mira/mira-mobile",
      issue_number: 84,
      run_id: "123",
      run_attempt: 1,
      occurred_at: "2026-11-18T06:11:00Z",
      kind: "verify.passed",
      stage: "verify",
      outcome: "passed",
      level: "info",
      event_id: "old-attempt",
      error_code: null,
    }),
  );

  const projection = await getFactoryRunProjection(githubEnv, cloudflareEnv, "uichat-mira/mira-mobile", 123, Date.parse("2026-11-18T06:12:30Z"));

  assert.equal(projection.reporter.status, "not_expected");
  assert.equal(projection.reporter.events.length, 0);
  assert.equal(projection.state, "observation_gap");
});

test("Reporter query is bounded to the lifecycle tail instead of the whole run", async () => {
  let observedBody: any = null;
  network.use(
    ...githubHandlers({}),
    http.post(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
      async ({ request }) => {
        observedBody = await request.json();
        return HttpResponse.json({ success: true, result: { events: { count: 0, events: [] } } });
      },
    ),
  );

  await getFactoryRunProjection(
    githubEnv,
    cloudflareEnv,
    "uichat-mira/mira-mobile",
    123,
    Date.parse("2026-11-18T06:12:30Z"),
  );

  assert.equal(observedBody.timeframe.from, Date.parse("2026-11-18T06:09:00Z"));
  assert.equal(observedBody.timeframe.to, Date.parse("2026-11-18T06:12:30Z"));
  assert.deepEqual(observedBody.parameters.datasets, ["workers"]);
});

test("Skipped Worker runs do not trigger an Observability scan", async () => {
  network.use(
    ...githubHandlers({}),
    http.get("https://api.github.com/repos/uichat-mira/mira-mobile/actions/runs/123", () =>
      HttpResponse.json({ ...run, conclusion: "skipped" }),
    ),
  );

  const projection = await getFactoryRunProjection(
    githubEnv,
    cloudflareEnv,
    "uichat-mira/mira-mobile",
    123,
    Date.parse("2026-11-18T06:12:30Z"),
  );

  assert.equal(projection.reporter.events.length, 0);
  assert.equal(projection.state, "observation_gap");
});

test("Reporter Verify PASS cannot override a later GitHub Verify failure", async () => {
  network.use(
    ...githubHandlers({
      jobs: [
        {
          id: 1,
          name: "verify",
          status: "completed",
          conclusion: "failure",
          started_at: "2026-11-18T06:10:30Z",
          completed_at: "2026-11-18T06:11:30Z",
        },
      ],
    }),
    reporterHandler({
      schema: "haomai.telemetry.v1",
      app_id: "mira-worker-reporter",
      trust_class: "trusted_pipeline",
      repository: "uichat-mira/mira-mobile",
      issue_number: 84,
      run_id: "123",
      run_attempt: 2,
      occurred_at: "2026-11-18T06:11:00Z",
      kind: "verify.passed",
      stage: "verify",
      outcome: "passed",
      level: "info",
      event_id: "evt-conflict",
      error_code: null,
    }),
  );

  const projection = await getFactoryRunProjection(
    githubEnv,
    cloudflareEnv,
    "uichat-mira/mira-mobile",
    123,
    Date.parse("2026-11-18T06:12:30Z"),
  );

  assert.equal(projection.state, "validation_gap");
});

test("Reporter outage becomes observation gap, never Worker failure or Verify PASS", async () => {
  network.use(
    ...githubHandlers({}),
    http.post(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
      () => new HttpResponse("unavailable", { status: 503 }),
    ),
  );

  const projection = await getFactoryRunProjection(githubEnv, cloudflareEnv, "uichat-mira/mira-mobile", 123, Date.parse("2026-11-18T06:12:30Z"));

  assert.equal(projection.state, "observation_gap");
  assert.equal(projection.reporter.status, "unavailable");
  assert.equal(projection.run.conclusion, "success");
  assert.ok(projection.warnings.some((warning) => /Reporter unavailable/.test(warning)));
});

test("A successful empty Reporter query is available observation, not an outage", async () => {
  network.use(
    ...githubHandlers({}),
    http.post(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
      () => HttpResponse.json({ success: true, result: { events: { count: 0, events: [] } } }),
    ),
  );

  const projection = await getFactoryRunProjection(githubEnv, cloudflareEnv, "uichat-mira/mira-mobile", 123, Date.parse("2026-11-18T06:12:30Z"));

  assert.equal(projection.reporter.status, "available");
  assert.equal(projection.reporter.events.length, 0);
  assert.equal(projection.state, "observation_gap");
  assert.ok(projection.warnings.some((warning) => /no trusted event/i.test(warning)));
});

test("Expired Reporter retention remains separate from GitHub evidence", async () => {
  network.use(
    ...githubHandlers({}),
    http.post(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
      () => new HttpResponse("should not query expired logs", { status: 500 }),
    ),
  );

  const projection = await getFactoryRunProjection(
    githubEnv,
    cloudflareEnv,
    "uichat-mira/mira-mobile",
    123,
    Date.parse("2026-11-26T06:12:30Z"),
  );

  assert.equal(projection.reporter.status, "expired");
  assert.equal(projection.state, "logs_expired");
  assert.equal(projection.freshness, "stale");
  assert.equal(projection.provenance.some((item) => item.source === "github-run"), true);
});

test("Expired artifacts are explicit evidence loss, not success", async () => {
  network.use(
    ...githubHandlers({
      artifacts: [{
        id: 11,
        name: "candidate",
        expired: true,
        created_at: "2026-11-18T06:05:00Z",
        expires_at: "2026-11-18T06:10:00Z",
        updated_at: "2026-11-18T06:10:00Z",
        url: "https://api.github.com/artifacts/11",
        archive_download_url: "https://api.github.com/artifacts/11/zip",
      }],
      jobs: [{
        id: 1,
        name: "candidate",
        status: "completed",
        conclusion: "success",
        started_at: "2026-11-18T06:00:05Z",
        completed_at: "2026-11-18T06:05:00Z",
      }],
    }),
    http.post(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
      () => new HttpResponse("unavailable", { status: 503 }),
    ),
  );

  const projection = await getFactoryRunProjection(githubEnv, cloudflareEnv, "uichat-mira/mira-mobile", 123, Date.parse("2026-11-18T06:12:30Z"));

  assert.equal(projection.state, "artifact_unavailable");
  assert.equal(projection.artifacts[0]?.expired, true);
});

test("Executed Worker run with no durable artifacts is explicit evidence loss", async () => {
  network.use(
    ...githubHandlers({ artifacts: [] }),
    http.post(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
      () => new HttpResponse("unavailable", { status: 503 }),
    ),
  );

  const projection = await getFactoryRunProjection(
    githubEnv,
    cloudflareEnv,
    "uichat-mira/mira-mobile",
    123,
    Date.parse("2026-11-18T06:12:30Z"),
  );

  assert.equal(projection.state, "artifact_unavailable");
});

test("Private repositories are rejected before exposing Actions data", async () => {
  network.use(...githubHandlers({ visibility: "private" }));

  await assert.rejects(
    getFactoryRunProjection(githubEnv, cloudflareEnv, "uichat-mira/mira-mobile", 123, Date.parse("2026-11-18T06:12:30Z")),
    /repository_not_public/,
  );
});

test("Skipped reusable Worker runs remain an observation gap, not a Worker failure", async () => {
  network.use(
    ...githubHandlers({}),
    http.get("https://api.github.com/repos/uichat-mira/mira-mobile/actions/runs/123", () =>
      HttpResponse.json({ ...run, conclusion: "skipped" }),
    ),
    http.post(
      "https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query",
      () => new HttpResponse("unavailable", { status: 503 }),
    ),
  );

  const projection = await getFactoryRunProjection(githubEnv, cloudflareEnv, "uichat-mira/mira-mobile", 123, Date.parse("2026-11-18T06:12:30Z"));

  assert.equal(projection.state, "observation_gap");
  assert.equal(projection.run.conclusion, "skipped");
});

test("Non-Worker GitHub runs are rejected", async () => {
  network.use(
    ...githubHandlers({}),
    http.get("https://api.github.com/repos/uichat-mira/mira-mobile/actions/runs/123", () =>
      HttpResponse.json({ ...run, name: "CI", referenced_workflows: [] }),
    ),
  );

  await assert.rejects(
    getFactoryRunProjection(githubEnv, cloudflareEnv, "uichat-mira/mira-mobile", 123, Date.parse("2026-11-18T06:12:30Z")),
    /not_external_worker_run/,
  );
});
