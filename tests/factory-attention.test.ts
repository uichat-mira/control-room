import assert from "node:assert/strict";
import test from "node:test";

import {
  discoveryFromFeed,
  qualifyWorkerAttention,
  type FactoryAttentionRun,
  type WorkerIssueLink,
  type WorkerIssueLookup,
} from "../src/factory-attention.ts";
import type { FactoryFeed } from "../src/factory-feed.ts";
import type {
  FactoryEvent,
  FactoryRunProjection,
  FactoryState,
} from "../src/factory-read-model.ts";
import type { FactQueryMeta } from "../src/github-facts.ts";

const NOW = Date.parse("2026-11-21T02:00:00Z");
const REPO = "uichat-mira/mira-desktop";

function event(overrides: Partial<FactoryEvent> = {}): FactoryEvent {
  return {
    occurredAt: "2026-11-21T01:00:00Z",
    kind: "repair.outcome",
    stage: "repair",
    outcome: "returned",
    level: "warn",
    errorCode: null,
    issueNumber: 482,
    evidence: null,
    ...overrides,
  };
}

function projection(
  state: FactoryState,
  overrides: {
    runId?: number;
    attempt?: number;
    createdAt?: string;
    issueNumber?: number | null;
    events?: FactoryEvent[];
    reporterStatus?: FactoryRunProjection["reporter"]["status"];
    artifacts?: FactoryRunProjection["artifacts"];
    jobs?: FactoryRunProjection["jobs"];
    repairRound?: number | null;
  } = {},
): FactoryRunProjection {
  const runId = overrides.runId ?? 44547710817;
  const attempt = overrides.attempt ?? 1;
  const events = overrides.events ?? [];
  return {
    apiVersion: "v1",
    mode: "real",
    generatedAt: "2026-11-21T01:59:00Z",
    repository: REPO,
    issueNumber: overrides.issueNumber ?? null,
    run: {
      id: runId,
      attempt,
      name: "Mira External Worker",
      path: ".github/workflows/mira-external-worker.yml",
      status: state === "queued" || state === "working" ? "in_progress" : "completed",
      conclusion:
        state === "escalated" || state === "worker_failed" ? "failure" : state === "working" ? null : "success",
      event: "issue_comment",
      branch: "dev",
      headSha: "c8e944ef625a99e2ed103955fd9bbbf7c3e92f55",
      displayTitle: "[DSK-016] worker",
      htmlUrl: `https://github.com/${REPO}/actions/runs/${runId}`,
      createdAt: overrides.createdAt ?? "2026-11-21T00:30:00Z",
      updatedAt: "2026-11-21T01:30:00Z",
      runStartedAt: "2026-11-21T00:30:05Z",
      referencedExternalWorker: true,
    },
    state,
    repairRound: overrides.repairRound ?? null,
    freshness: "fresh",
    provenance: [],
    jobs: overrides.jobs ?? [],
    artifacts: overrides.artifacts ?? [],
    pullRequests: [],
    reporter: {
      status: overrides.reporterStatus ?? (events.length ? "available" : "not_requested"),
      freshness: "fresh",
      events,
      observedAt: events.at(-1)?.occurredAt ?? null,
    },
    warnings: [],
  };
}

function issueQuery(
  overrides: Partial<FactQueryMeta> = {},
): FactQueryMeta {
  return {
    source: "github-rest",
    path: `/repos/${REPO}/issues/482`,
    status: "ok",
    httpStatus: 200,
    fetchedAt: "2026-11-21T01:59:30Z",
    observedAt: "2026-11-21T01:59:30Z",
    cache: "upstream",
    etag: null,
    truncated: false,
    retryAfterSeconds: null,
    skipReason: null,
    error: null,
    ...overrides,
  };
}

function issueLookup(
  state: "open" | "closed",
  overrides: Partial<WorkerIssueLookup> = {},
): WorkerIssueLookup {
  return {
    issue: {
      number: 482,
      state,
      stateReason: state === "closed" ? "completed" : null,
      title: "[DSK-016] Unify ordinary Desktop Dev with secure Cloud Host runtime",
      htmlUrl: `https://github.com/${REPO}/issues/482`,
      updatedAt: "2026-11-19T16:06:32Z",
      closedAt: state === "closed" ? "2026-11-19T16:06:32Z" : null,
    },
    query: issueQuery(),
    ...overrides,
  };
}

function link(overrides: Partial<WorkerIssueLink> = {}): WorkerIssueLink {
  return {
    repository: REPO,
    issueNumber: 482,
    runId: 44547710817,
    attempt: 1,
    source: "trusted-reporter",
    observedAt: "2026-11-21T01:30:00Z",
    url: `https://github.com/${REPO}/issues/482`,
    ...overrides,
  };
}

function escalatedRun(overrides: {
  runId?: number;
  attempt?: number;
  createdAt?: string;
  issueNumber?: number;
  issue?: WorkerIssueLink | null;
  lookup?: WorkerIssueLookup | null;
  state?: "escalated" | "blocked";
} = {}): FactoryAttentionRun {
  const runId = overrides.runId ?? 44547710817;
  const attempt = overrides.attempt ?? 1;
  const state = overrides.state ?? "escalated";
  return {
    projection: projection(state, {
      runId,
      attempt,
      createdAt: overrides.createdAt,
      issueNumber: overrides.issueNumber ?? 482,
      repairRound: 2,
      events: [
        event({
          occurredAt: "2026-11-21T01:00:00Z",
          outcome: "returned",
          errorCode: "VALIDATION_REPAIR_ROUND_1",
        }),
        event({
          occurredAt: "2026-11-21T01:20:00Z",
          outcome: state,
          errorCode: "REPAIR_ROUND_LIMIT_EXHAUSTED",
        }),
      ],
      artifacts: [
        {
          id: 14543494564,
          name: "mira-external-worker-candidate-482-44547710817-1",
          expired: false,
          createdAt: "2026-11-21T00:40:00Z",
          expiresAt: "2026-12-05T00:40:00Z",
          url: "https://api.github.com/artifacts/14543494564",
          evidence: {
            source: "github-artifact",
            id: "14543494564",
            url: "https://api.github.com/artifacts/14543494564",
            observedAt: "2026-11-21T01:59:00Z",
          },
        },
      ],
      jobs: [
        {
          id: 135667680917,
          name: "worker / verify",
          status: "completed",
          conclusion: "failure",
          startedAt: "2026-11-21T00:50:00Z",
          completedAt: "2026-11-21T01:00:00Z",
          evidence: {
            source: "github-job",
            id: "135667680917",
            url: `https://github.com/${REPO}/actions/runs/${runId}/job/135667680917`,
            observedAt: "2026-11-21T01:59:00Z",
          },
        },
      ],
    }),
    issue: overrides.issue === undefined ? link({ runId, attempt, issueNumber: overrides.issueNumber ?? 482 }) : overrides.issue,
    issueLookup: overrides.lookup === undefined ? issueLookup("open") : overrides.lookup,
  };
}

function repairingRun(
  createdAt: string,
  overrides: { runId?: number; attempt?: number } = {},
): FactoryAttentionRun {
  const runId = overrides.runId ?? 44547710999;
  const attempt = overrides.attempt ?? 1;
  return {
    projection: projection("repairing", {
      runId,
      attempt,
      createdAt,
      issueNumber: 482,
      repairRound: 1,
      events: [
        event({
          occurredAt: "2026-11-21T01:40:00Z",
          outcome: "returned",
          errorCode: "VALIDATION_REPAIR_ROUND_1",
        }),
      ],
    }),
    issue: link({ runId, attempt }),
    issueLookup: issueLookup("open"),
  };
}

test("trusted escalated run for an open verified Issue is a P1 attention candidate", () => {
  const result = qualifyWorkerAttention([escalatedRun()], { now: NOW });
  const candidate = result.candidates[0];

  assert.equal(result.candidates.length, 1);
  assert.equal(candidate.status, "needs_attention");
  assert.equal(candidate.classification, "attention");
  assert.equal(candidate.priority, "P1");
  assert.equal(candidate.identity.issueNumber, 482);
  assert.equal(candidate.identity.runId, 44547710817);
  assert.equal(candidate.identity.attempt, 1);
  assert.equal(candidate.identity.issueLinkSource, "trusted-reporter");
  assert.equal(candidate.identity.candidateArtifact?.artifactId, 14543494564);
  assert.equal(candidate.issue.state, "open");
  assert.match(candidate.what, /Issue #482/);
  assert.match(candidate.whyNow, /escalated/);
  assert.match(candidate.whatSystemTried, /REPAIR_ROUND_LIMIT_EXHAUSTED/);
  assert.match(candidate.nextStep, /requeue/i);
  assert.match(candidate.exitCondition, /same verified Issue/);
  assert.ok(candidate.evidence.some((row) => row.label.includes("Issue #482 (open)")));
  assert.ok(candidate.evidence.some((row) => row.label.includes("Trusted Reporter repair/escalated")));
  assert.ok(candidate.signals.some((signal) => signal.kind === "escalated_terminal"));
  assert.equal(candidate.observedAt, "2026-11-21T01:59:00Z");
  assert.equal(result.counts.attention, 1);
  assert.match(result.scope.note, /not a complete discovery scan/);
});

test("trusted blocked run for an open verified Issue is also attention", () => {
  const result = qualifyWorkerAttention(
    [escalatedRun({ state: "blocked" })],
    { now: NOW },
  );
  const candidate = result.candidates[0];
  assert.equal(candidate.status, "needs_attention");
  assert.ok(candidate.signals.some((signal) => signal.kind === "blocked_terminal"));
});

test("first failure followed by an active repair is in_progress, not attention", () => {
  const run: FactoryAttentionRun = {
    projection: projection("repairing", {
      issueNumber: 482,
      repairRound: 1,
      events: [
        event({ kind: "verify.failed", stage: "verify", outcome: "failed", occurredAt: "2026-11-21T00:55:00Z" }),
        event({ occurredAt: "2026-11-21T01:00:00Z", outcome: "returned", errorCode: "VALIDATION_REPAIR_ROUND_1" }),
      ],
    }),
    issue: link(),
    issueLookup: issueLookup("open"),
  };
  const result = qualifyWorkerAttention([run], { now: NOW });
  const candidate = result.candidates[0];
  assert.equal(candidate.status, "in_progress");
  assert.equal(candidate.priority, null);
  assert.ok(candidate.signals.some((signal) => signal.kind === "repairing"));
  assert.equal(result.counts.attention, 0);
});

test("older escalation is superseded by a newer run for the same verified Issue", () => {
  const result = qualifyWorkerAttention(
    [escalatedRun(), repairingRun("2026-11-21T01:45:00Z")],
    { now: NOW },
  );

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.status, "in_progress");
  assert.equal(candidate.identity.runId, 44547710999);
  assert.ok(
    candidate.signals.some(
      (signal) =>
        signal.kind === "superseded_by_newer_run" &&
        signal.detail.includes("44547710817"),
    ),
  );
  assert.equal(result.counts.attention, 0);
  assert.equal(result.counts.in_progress, 1);
  assert.equal(candidate.coverage.sameIssueHistory, "supplied");
});

test("newer attempt of the same Run supersedes the older attempt", () => {
  const older = escalatedRun({ attempt: 1 });
  const newer: FactoryAttentionRun = {
    projection: projection("working", {
      runId: 44547710817,
      attempt: 2,
      createdAt: "2026-11-21T00:30:00Z",
      issueNumber: 482,
    }),
    issue: link({ attempt: 2 }),
    issueLookup: issueLookup("open"),
  };
  const result = qualifyWorkerAttention([older, newer], { now: NOW });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].identity.attempt, 2);
  assert.equal(result.candidates[0].status, "in_progress");
  assert.ok(
    result.candidates[0].signals.some(
      (signal) => signal.kind === "superseded_by_newer_run" && signal.detail.includes("attempt 1"),
    ),
  );
});

test("an unrelated successful Run cannot clear another Issue's escalation", () => {
  const unrelated: FactoryAttentionRun = {
    projection: projection("observation_gap", {
      runId: 44547000000,
      issueNumber: 999,
      events: [],
    }),
    issue: link({ runId: 44547000000, issueNumber: 999 }),
    issueLookup: issueLookup("open"),
  };
  const result = qualifyWorkerAttention([escalatedRun(), unrelated], { now: NOW });

  assert.equal(result.candidates.length, 2);
  const attention = result.candidates.find((candidate) => candidate.status === "needs_attention");
  assert.equal(attention?.identity.issueNumber, 482);
  const observation = result.candidates.find((candidate) => candidate.identity.issueNumber === 999);
  assert.equal(observation?.status, "observed");
  assert.ok(
    observation?.signals.some((signal) => signal.kind === "run_success_not_acceptance"),
  );
  assert.equal(result.counts.attention, 1);
  assert.equal(result.counts.observation, 1);
});

test("a newer same-Issue GitHub success supersedes old attention without faking verification", () => {
  const newer: FactoryAttentionRun = {
    projection: projection("observation_gap", {
      runId: 44547710999,
      issueNumber: 482,
      reporterStatus: "not_requested",
    }),
    issue: link({ runId: 44547710999 }),
    issueLookup: issueLookup("open"),
  };
  const result = qualifyWorkerAttention(
    [escalatedRun(), newer],
    { now: NOW },
  );

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.status, "observed");
  assert.equal(result.counts.attention, 0);
  assert.ok(candidate.signals.some((signal) => signal.kind === "superseded_by_newer_run"));
  assert.ok(
    candidate.signals.some((signal) => signal.kind === "run_success_not_acceptance"),
  );
  assert.ok(!candidate.signals.some((signal) => signal.kind === "delivered_observation"));
  assert.match(candidate.warnings.join(" "), /not product acceptance/);
});

test("a newer same-Issue Worker failure clears old attention but stays unknown", () => {
  const newer: FactoryAttentionRun = {
    projection: projection("worker_failed", {
      runId: 44547710999,
      issueNumber: 482,
      reporterStatus: "not_requested",
    }),
    issue: link({ runId: 44547710999 }),
    issueLookup: issueLookup("open"),
  };
  const result = qualifyWorkerAttention(
    [escalatedRun(), newer],
    { now: NOW },
  );
  const candidate = result.candidates[0];
  assert.equal(candidate.status, "unknown");
  assert.equal(result.counts.attention, 0);
  assert.ok(
    candidate.signals.some((signal) => signal.kind === "worker_failed_unproven_recovery"),
  );
});

test("an Issue-state read for a different Issue number is ignored", () => {
  const lookup = issueLookup("closed");
  if (lookup.issue) lookup.issue.number = 999;
  const result = qualifyWorkerAttention(
    [escalatedRun({ lookup })],
    { now: NOW },
  );
  const candidate = result.candidates[0];
  assert.equal(candidate.status, "unknown");
  assert.equal(candidate.issue.state, "unknown");
  assert.match(candidate.warnings.join(" "), /did not match the verified Issue #482/);
});

test("a legally closed Issue clears the old escalation without claiming Run success", () => {
  const result = qualifyWorkerAttention(
    [escalatedRun({ lookup: issueLookup("closed") })],
    { now: NOW },
  );
  const candidate = result.candidates[0];

  assert.equal(candidate.status, "observed");
  assert.equal(candidate.priority, null);
  assert.equal(candidate.issue.state, "closed");
  assert.ok(candidate.signals.some((signal) => signal.kind === "issue_closed_clears"));
  assert.match(candidate.whyNow, /closed at GitHub/);
  assert.match(candidate.nextStep, /No action/);
});

test("unreadable Issue state stays unknown and is not promoted to attention", () => {
  const lookup: WorkerIssueLookup = {
    issue: null,
    query: issueQuery({
      status: "inaccessible",
      httpStatus: 403,
      observedAt: null,
      error: "GitHub resource is not readable with the current public read scope",
    }),
  };
  const result = qualifyWorkerAttention(
    [escalatedRun({ lookup })],
    { now: NOW },
  );
  const candidate = result.candidates[0];

  assert.equal(candidate.status, "unknown");
  assert.equal(candidate.priority, null);
  assert.equal(candidate.issue.queryStatus, "inaccessible");
  assert.equal(candidate.coverage.status, "unknown");
  assert.ok(candidate.signals.some((signal) => signal.kind === "issue_state_unknown"));
  assert.match(candidate.warnings.join(" "), /coverage gap, not a human todo/);
});

test("rate-limited Issue read stays unknown with Retry-After evidence", () => {
  const lookup: WorkerIssueLookup = {
    issue: null,
    query: issueQuery({
      status: "rate_limited",
      httpStatus: 429,
      retryAfterSeconds: 30,
      observedAt: null,
      error: "GitHub rate limit reached",
    }),
  };
  const candidate = qualifyWorkerAttention([escalatedRun({ lookup })], { now: NOW }).candidates[0];
  assert.equal(candidate.status, "unknown");
  assert.equal(candidate.issue.queryStatus, "rate_limited");
  assert.equal(candidate.issue.error, "GitHub rate limit reached");
});

test("GitHub-only worker failure is unknown, never a fake escalation", () => {
  const run: FactoryAttentionRun = {
    projection: projection("worker_failed", {
      issueNumber: null,
      reporterStatus: "not_requested",
    }),
    issue: null,
    issueLookup: null,
  };
  const candidate = qualifyWorkerAttention([run], { now: NOW }).candidates[0];

  assert.equal(candidate.status, "unknown");
  assert.equal(candidate.priority, null);
  assert.ok(candidate.signals.some((signal) => signal.kind === "reporter_not_requested"));
  assert.ok(
    candidate.signals.some((signal) => signal.kind === "worker_failed_unproven_recovery"),
  );
  assert.ok(candidate.signals.some((signal) => signal.kind === "issue_identity_missing"));
  assert.match(candidate.whyNow, /insufficient/);
});

test("GitHub success without trusted evidence is an observation, not acceptance", () => {
  const run: FactoryAttentionRun = {
    projection: projection("observation_gap", {
      issueNumber: null,
      reporterStatus: "not_requested",
    }),
    issue: null,
    issueLookup: null,
  };
  const candidate = qualifyWorkerAttention([run], { now: NOW }).candidates[0];
  assert.equal(candidate.status, "observed");
  assert.ok(candidate.signals.some((signal) => signal.kind === "run_success_not_acceptance"));
  assert.match(candidate.warnings.join(" "), /not product acceptance/);
});

test("expired Reporter and expired Artifact are coverage gaps, not failures", () => {
  const run: FactoryAttentionRun = {
    projection: projection("logs_expired", {
      issueNumber: null,
      reporterStatus: "expired",
      artifacts: [
        {
          id: 1,
          name: "mira-external-worker-candidate-482",
          expired: true,
          createdAt: "2026-11-01T00:00:00Z",
          expiresAt: "2026-11-15T00:00:00Z",
          url: "https://api.github.com/artifacts/1",
          evidence: {
            source: "github-artifact",
            id: "1",
            url: "https://api.github.com/artifacts/1",
            observedAt: "2026-11-21T01:59:00Z",
          },
        },
      ],
    }),
    issue: null,
    issueLookup: null,
  };
  const candidate = qualifyWorkerAttention([run], { now: NOW }).candidates[0];
  assert.equal(candidate.status, "unknown");
  assert.ok(candidate.signals.some((signal) => signal.kind === "reporter_expired"));
  assert.ok(candidate.signals.some((signal) => signal.kind === "artifact_expired"));
  assert.equal(candidate.identity.candidateArtifact?.expired, true);
});

test("trusted escalation without a verified Issue link does not guess an Issue number", () => {
  const run = escalatedRun({ issue: null, lookup: null });
  run.projection.issueNumber = null;
  run.projection.run.displayTitle = "agent: #482 [DSK-016]";
  run.projection.artifacts[0].name = "candidate-482";

  const candidate = qualifyWorkerAttention([run], { now: NOW }).candidates[0];
  assert.equal(candidate.status, "unknown");
  assert.equal(candidate.identity.issueNumber, null);
  assert.equal(candidate.issue.number, null);
  assert.equal(candidate.identity.issueLinkSource, null);
  assert.equal(candidate.coverage.issueState, "not_attempted");
  assert.match(candidate.warnings.join(" "), /No verified Issue link/);
});

test("a mismatched Issue link is discarded and cannot clear another Run", () => {
  const run = escalatedRun({ issue: link({ runId: 999 }), lookup: null });
  const result = qualifyWorkerAttention([run], { now: NOW });
  const candidate = result.candidates[0];

  assert.equal(candidate.status, "unknown");
  assert.equal(candidate.identity.issueNumber, null);
  assert.match(candidate.warnings.join(" "), /did not match/);
  assert.ok(candidate.signals.some((signal) => signal.kind === "issue_identity_missing"));
});

test("escalated state without a matching trusted event is not a confirmed handoff", () => {
  const run: FactoryAttentionRun = {
    projection: projection("escalated", {
      issueNumber: 482,
      reporterStatus: "available",
      events: [
        event({
          stage: "verify",
          outcome: "failed",
          kind: "verify.failed",
        }),
      ],
    }),
    issue: link(),
    issueLookup: issueLookup("open"),
  };
  const candidate = qualifyWorkerAttention([run], { now: NOW }).candidates[0];
  assert.equal(candidate.status, "unknown");
  assert.ok(
    candidate.signals.some((signal) => signal.kind === "escalation_without_trusted_event"),
  );
});

test("delivered Draft PR is observed, not accepted and not a human todo", () => {
  const run: FactoryAttentionRun = {
    projection: projection("delivered", {
      issueNumber: 482,
      events: [
        event({
          kind: "delivery.draft_pr_created",
          stage: "delivery",
          outcome: "created",
          occurredAt: "2026-11-21T01:30:00Z",
        }),
      ],
    }),
    issue: link(),
    issueLookup: issueLookup("open"),
  };
  const candidate = qualifyWorkerAttention([run], { now: NOW }).candidates[0];
  assert.equal(candidate.status, "observed");
  assert.ok(candidate.signals.some((signal) => signal.kind === "delivered_observation"));
  assert.match(candidate.nextStep, /neither accepts nor closes/);
});

test("Factory Feed coverage is reported as bounded discovery, not an organization count", () => {
  const feed: FactoryFeed = {
    apiVersion: "v1",
    source: "github-actions",
    generatedAt: "2026-11-21T01:58:00Z",
    status: "partial",
    scannedRepositories: 21,
    eligibleRepositories: 23,
    failedRepositories: 1,
    coverageLimited: true,
    historyDays: 14,
    items: Array.from({ length: 12 }, (_, index) => ({
      id: 1000 + index,
      repository: REPO,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-11-21T00:00:00Z",
      updatedAt: "2026-11-21T00:10:00Z",
      attempt: 1,
      htmlUrl: `https://github.com/${REPO}/actions/runs/${1000 + index}`,
      title: "Mira External Worker",
      branch: "dev",
    })),
  };
  const discovery = discoveryFromFeed(feed);
  assert.equal(discovery.displayLimitReached, true);
  assert.equal(discovery.historyDays, 14);
  assert.equal(discovery.runsPerRepository, 20);
  assert.equal(discovery.maxDisplayedItems, 12);
  assert.equal(discovery.coverageLimited, true);
  assert.match(discovery.note, /not an organization-wide count/);

  const result = qualifyWorkerAttention(
    [escalatedRun()],
    { now: NOW, discovery },
  );
  assert.equal(result.discovery?.displayLimitReached, true);
  assert.ok(
    result.candidates[0].warnings.some((warning) => /not an organization-wide count/.test(warning)),
  );
});

test("empty supplied runs do not invent a healthy organization", () => {
  const result = qualifyWorkerAttention([], { now: NOW });
  assert.equal(result.status, "unknown");
  assert.equal(result.candidates.length, 0);
  assert.equal(result.counts.attention, 0);
  assert.match(result.scope.note, /cannot prove the absence/);
});
