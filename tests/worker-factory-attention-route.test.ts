import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { handleFactoryAttentionRequest } from "../src/factory-attention-route.ts";
import type { FactoryEvent, FactoryRunProjection } from "../src/factory-read-model.ts";

const network = setupServer();
const token = "worker-attention-route-secret";
const env = { GITHUB_READ_TOKEN: token };
const origin = "https://control.test";
const base = "https://api.github.com";
const repo = "uichat-mira/mira-desktop";

class FakeCache {
  private readonly store = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.store.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.store.set(request.url, response.clone());
  }
}

let issueCalls = 0;
let issueAuthorizations = new Set<string | null>();

before(() => network.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  issueCalls = 0;
  issueAuthorizations = new Set();
  (globalThis as { caches?: unknown }).caches = { default: new FakeCache() };
});
afterEach(() => network.resetHandlers());
after(() => {
  network.close();
  delete (globalThis as { caches?: unknown }).caches;
});

function event(overrides: Partial<FactoryEvent> = {}): FactoryEvent {
  return {
    occurredAt: "2026-11-21T01:20:00Z",
    kind: "repair.outcome",
    stage: "repair",
    outcome: "escalated",
    level: "error",
    errorCode: "REPAIR_ROUND_LIMIT_EXHAUSTED",
    issueNumber: 482,
    evidence: null,
    ...overrides,
  };
}

function projection(
  state: FactoryRunProjection["state"],
  options: {
    issueNumber?: number | null;
    reporterStatus?: FactoryRunProjection["reporter"]["status"];
    events?: FactoryEvent[];
  } = {},
): FactoryRunProjection {
  const events = options.events ?? [];
  return {
    apiVersion: "v1",
    mode: "real",
    generatedAt: "2026-11-21T01:59:00Z",
    repository: repo,
    issueNumber: options.issueNumber ?? null,
    run: {
      id: 44547710817,
      attempt: 1,
      name: "Mira External Worker",
      path: ".github/workflows/mira-external-worker.yml",
      status: "completed",
      conclusion: state === "escalated" ? "failure" : "success",
      event: "issue_comment",
      branch: "dev",
      headSha: "c8e944ef625a99e2ed103955fd9bbbf7c3e92f55",
      displayTitle: "agent: #482 [DSK-016]",
      htmlUrl: `https://github.com/${repo}/actions/runs/44547710817`,
      createdAt: "2026-11-21T00:30:00Z",
      updatedAt: "2026-11-21T01:30:00Z",
      runStartedAt: "2026-11-21T00:30:05Z",
      referencedExternalWorker: true,
    },
    state,
    repairRound: state === "escalated" ? 2 : null,
    freshness: "fresh",
    provenance: [],
    jobs: [],
    artifacts: [],
    pullRequests: [],
    reporter: {
      status: options.reporterStatus ?? (events.length ? "available" : "not_requested"),
      freshness: "fresh",
      events,
      observedAt: events.at(-1)?.occurredAt ?? null,
    },
    warnings: [],
  };
}

function trustedPointer(overrides: Record<string, unknown> = {}) {
  const value = {
    schema_version: 1,
    repository: repo,
    issue_number: 482,
    run_id: 44547710817,
    run_attempt: 1,
    lifecycle_state: "ESCALATED",
    base_sha: "c8e944ef625a99e2ed103955fd9bbbf7c3e92f55",
    candidate_artifact_id: "14543494564",
    ...overrides,
  };
  return {
    id: 7055556740,
    user: { id: 41898282, login: "github-actions[bot]", type: "Bot" },
    created_at: "2026-11-21T01:20:10Z",
    html_url: `https://github.com/${repo}/issues/482#issuecomment-7055556740`,
    body: `<!-- mira-recovery-candidate:v1\n${JSON.stringify(value)}\n-->\nMira Recovery pointer`,
  };
}

function openIssue() {
  return {
    number: 482,
    state: "open",
    state_reason: null,
    title: "[DSK-016] Unify ordinary Desktop Dev with secure Cloud Host runtime",
    html_url: `https://github.com/${repo}/issues/482`,
    updated_at: "2026-11-19T16:06:32Z",
    closed_at: null,
  };
}

async function read(
  query: string,
  loader: (repository: string, runId: number, includeReporter: boolean) => Promise<FactoryRunProjection>,
): Promise<{ response: Response; text: string; body: Record<string, unknown> }> {
  const response = await handleFactoryAttentionRequest(
    new Request(`${origin}/api/v1/factory/attention?${query}`),
    env,
    loader,
  );
  const text = await response.text();
  return { response, text, body: JSON.parse(text) as Record<string, unknown> };
}

test("default GitHub-only attention read never queries the Reporter or the Issue API", async () => {
  let reporterRequested = false;
  const run = projection("observation_gap", { reporterStatus: "not_requested" });

  const { response, text, body } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817`,
    async (_repository, _runId, includeReporter) => {
      reporterRequested = includeReporter;
      return run;
    },
  );

  assert.equal(response.status, 200);
  assert.equal(reporterRequested, false);
  assert.equal(response.headers.get("x-mira-factory-attention-source"), "github-only");
  assert.equal(response.headers.get("x-mira-factory-attention-issue-read"), "0");
  assert.equal(response.headers.get("x-mira-factory-attention-status"), "observed");
  assert.equal(response.headers.get("x-mira-factory-attention-reporter"), "not_requested");
  assert.equal(issueCalls, 0);
  assert.equal(body.status, "observed");
  assert.equal((body.identity as Record<string, unknown>).issueNumber, null);
  assert.equal((body.budget as Record<string, unknown>).additionalGithubRequests, 0);
  assert.match((body.scope as Record<string, unknown>).note as string, /Factory Feed was not scanned/);
  assert.doesNotMatch(text, new RegExp(token));
});

test("includeReporter=true reuses a trusted escalated event and reads the verified Issue", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, ({ request }) => {
      issueCalls += 1;
      issueAuthorizations.add(request.headers.get("authorization"));
      return HttpResponse.json(openIssue());
    }),
  );
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482/comments`, () =>
      HttpResponse.json([trustedPointer()]),
    ),
  );
  const run = projection("escalated", {
    issueNumber: 482,
    events: [event()],
  });

  const { response, text, body } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817&includeReporter=true`,
    async () => run,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-mira-factory-attention-source"), "github+trusted-reporter");
  assert.equal(response.headers.get("x-mira-factory-attention-issue-read"), "1");
  assert.equal(response.headers.get("x-mira-factory-attention-issue-cache"), "miss");
  assert.equal(response.headers.get("x-mira-factory-attention-status"), "needs_attention");
  assert.equal(response.headers.get("x-mira-factory-attention-classification"), "attention");
  assert.equal(issueCalls, 1);
  assert.deepEqual([...issueAuthorizations], [`Bearer ${token}`]);
  assert.equal(body.status, "needs_attention");
  assert.equal(body.priority, "P1");
  const identity = body.identity as Record<string, unknown>;
  assert.equal(identity.issueNumber, 482);
  assert.equal(identity.runId, 44547710817);
  assert.equal(identity.attempt, 1);
  assert.equal(identity.issueLinkSource, "trusted-reporter");
  assert.equal(issueCalls, 1);
  assert.doesNotMatch(text, new RegExp(token));
  assert.match(text, /Issue #482/);
});

test("the bounded Issue read is edge-cached across repeated attention reads", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () => {
      issueCalls += 1;
      return HttpResponse.json(openIssue());
    }),
  );
  const run = projection("escalated", { issueNumber: 482, events: [event()] });
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482/comments`, () =>
      HttpResponse.json([trustedPointer()]),
    ),
  );
  const loader = async () => run;
  const query = `repository=${encodeURIComponent(repo)}&runId=44547710817&includeReporter=true`;

  const first = await read(query, loader);
  const second = await read(query, loader);

  assert.equal(issueCalls, 1);
  assert.equal(first.response.headers.get("x-mira-factory-attention-issue-cache"), "miss");
  assert.equal(second.response.headers.get("x-mira-factory-attention-issue-cache"), "hit");
  assert.equal(second.body.status, "needs_attention");
});

test("an unreadable Issue state is an unknown coverage gap, never attention", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () =>
      new HttpResponse("forbidden", { status: 403 }),
    ),
  );
  const run = projection("escalated", { issueNumber: 482, events: [event()] });

  const { response, body } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817&includeReporter=true`,
    async () => run,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-mira-factory-attention-status"), "unknown");
  assert.equal(response.headers.get("x-mira-factory-attention-issue-read"), "1");
  assert.equal(body.status, "unknown");
  assert.equal(body.priority, null);
  assert.equal((body.issue as Record<string, unknown>).queryStatus, "inaccessible");
  assert.equal((body.coverage as Record<string, unknown>).status, "unknown");
});

test("includeReporter=false ignores a projection Issue number instead of trusting it", async () => {
  const run = projection("escalated", {
    issueNumber: 482,
    events: [event()],
  });

  const { response, body } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817`,
    async () => run,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-mira-factory-attention-issue-read"), "0");
  assert.equal(response.headers.get("x-mira-factory-attention-status"), "unknown");
  assert.equal((body.identity as Record<string, unknown>).issueNumber, null);
  assert.equal(issueCalls, 0);
});

test("trusted escalation without a verified Issue number does not guess from the title", async () => {
  const run = projection("escalated", {
    issueNumber: null,
    events: [event({ issueNumber: null })],
  });
  run.run.displayTitle = "agent: #482 [DSK-016]";

  const { body } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817&includeReporter=true`,
    async () => run,
  );

  assert.equal(body.status, "unknown");
  assert.equal((body.identity as Record<string, unknown>).issueNumber, null);
  assert.equal(issueCalls, 0);
});

test("invalid repository and run id are rejected before any projection read", async () => {
  let loaded = 0;
  const loader = async () => {
    loaded += 1;
    return projection("working");
  };

  const invalidRepository = await read("repository=uichat-mira/../secret&runId=1", loader);
  assert.equal(invalidRepository.response.status, 400);
  assert.equal(invalidRepository.body.error, "repository_must_be_a_public_uichat-mira_repository");

  const missingRun = await read(`repository=${encodeURIComponent(repo)}`, loader);
  assert.equal(missingRun.response.status, 400);
  assert.equal(missingRun.body.error, "positive_runId_required");

  const negativeRun = await read(`repository=${encodeURIComponent(repo)}&runId=-3`, loader);
  assert.equal(negativeRun.response.status, 400);
  assert.equal(loaded, 0);
});

test("projection errors keep the upstream 404/503 mapping", async () => {
  const notWorker = await read(
    `repository=${encodeURIComponent(repo)}&runId=1`,
    async () => {
      throw new Error("not_external_worker_run");
    },
  );
  assert.equal(notWorker.response.status, 404);
  assert.equal(notWorker.body.error, "not_external_worker_run");

  const unavailable = await read(
    `repository=${encodeURIComponent(repo)}&runId=1`,
    async () => {
      throw new Error("GitHub API 500");
    },
  );
  assert.equal(unavailable.response.status, 503);
  assert.equal(unavailable.body.error, "GitHub API 500");
});

test("GitHub-only worker failure remains unknown in the route output", async () => {
  const run = projection("worker_failed", { reporterStatus: "not_requested" });
  const { response, body } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817`,
    async () => run,
  );
  assert.equal(response.status, 200);
  assert.equal(body.status, "unknown");
  assert.equal(body.priority, null);
  const signals = body.signals as Array<{ kind: string }>;
  assert.ok(signals.some((signal) => signal.kind === "reporter_not_requested"));
  assert.ok(signals.some((signal) => signal.kind === "worker_failed_unproven_recovery"));
});

test("single-run API clears old escalation when a newer same-Issue Recovery pointer exists", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () => HttpResponse.json(openIssue())),
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482/comments`, () =>
      HttpResponse.json([
        trustedPointer(),
        { ...trustedPointer({ run_id: 44547710999, lifecycle_state: "VERIFIED" }),
          id: 7055556900,
          created_at: "2026-11-21T01:40:00Z" },
      ]),
    ),
  );
  const { body, response } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817&includeReporter=true`,
    async () => projection("escalated", { issueNumber: 482, events: [event()] }),
  );
  assert.equal(body.status, "unknown");
  assert.equal(body.priority, null);
  assert.equal((body.currentness as Record<string, unknown>).status, "superseded");
  assert.equal(response.headers.get("x-mira-factory-attention-status"), "unknown");
});

test("missing Recovery pointer means a terminal Run is unknown even if Issue is open", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () => HttpResponse.json(openIssue())),
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482/comments`, () => HttpResponse.json([])),
  );
  const { body } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817&includeReporter=true`,
    async () => projection("escalated", { issueNumber: 482, events: [event()] }),
  );
  assert.equal(body.status, "unknown");
  assert.equal((body.currentness as Record<string, unknown>).status, "unknown");
  assert.equal(body.priority, null);
});

test("human-forged Recovery comment cannot authorize an escalated P1", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () => HttpResponse.json(openIssue())),
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482/comments`, () =>
      HttpResponse.json([{ ...trustedPointer(), user: { id: 12, login: "someone", type: "User" } }]),
    ),
  );
  const { body } = await read(
    `repository=${encodeURIComponent(repo)}&runId=44547710817&includeReporter=true`,
    async () => projection("escalated", { issueNumber: 482, events: [event()] }),
  );
  assert.equal(body.status, "unknown");
  assert.equal(body.priority, null);
});
