import assert from "node:assert/strict";
import test from "node:test";

import type { FactQueryMeta, PilotWorkflowRunFact } from "../src/github-facts.ts";
import type {
  PullRequestDetailFact,
  PullRequestFactsSnapshot,
  PullRequestReviewFact,
} from "../src/github-pr-facts.ts";
import type { RequiredCheckEvidence } from "../src/github-gate-facts.ts";
import { qualifyPullRequest } from "../src/github-pr-qualification.ts";

const headA = "a".repeat(40);
const headB = "b".repeat(40);
const repository = "uichat-mira/mira-desktop";

function meta(
  path: string,
  status: FactQueryMeta["status"] = "ok",
  overrides: Partial<FactQueryMeta> = {},
): FactQueryMeta {
  return {
    source: "github-rest",
    path,
    status,
    httpStatus: status === "ok" ? 200 : status === "inaccessible" ? 403 : null,
    fetchedAt: "2026-11-20T10:00:00Z",
    observedAt: status === "ok" ? "2026-11-20T10:00:00Z" : null,
    cache: status === "ok" ? "upstream" : "none",
    etag: null,
    truncated: false,
    retryAfterSeconds: null,
    skipReason: null,
    error: status === "ok" ? null : `${status} fixture`,
    ...overrides,
  };
}

function detail(overrides: Partial<PullRequestDetailFact> = {}): PullRequestDetailFact {
  return {
    number: 404,
    title: "PR fixture",
    state: "open",
    draft: false,
    merged: false,
    authorLogin: "github-actions[bot]",
    authorAssociation: "CONTRIBUTOR",
    mergeable: true,
    mergeableState: "clean",
    baseRef: "dev",
    headRef: "feat/worker-404",
    headSha: headA,
    createdAt: "2026-11-20T08:00:00Z",
    updatedAt: "2026-11-20T09:00:00Z",
    htmlUrl: "https://github.com/uichat-mira/mira-desktop/pull/404",
    ...overrides,
  };
}

function review(overrides: Partial<PullRequestReviewFact> = {}): PullRequestReviewFact {
  return {
    id: 1,
    login: "dangjingtao",
    userType: "User",
    state: "CHANGES_REQUESTED",
    commitId: headA,
    submittedAt: "2026-11-20T09:00:00Z",
    authorAssociation: "MEMBER",
    htmlUrl:
      "https://github.com/uichat-mira/mira-desktop/pull/404#pullrequestreview-1",
    ...overrides,
  };
}

function run(overrides: Partial<PilotWorkflowRunFact> = {}): PilotWorkflowRunFact {
  return {
    id: 500,
    name: "Build Desktop Apps",
    path: ".github/workflows/build-desktop.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    headBranch: "feat/worker-404",
    headSha: headA,
    attempt: 1,
    htmlUrl: "https://github.com/uichat-mira/mira-desktop/actions/runs/500",
    createdAt: "2026-11-20T08:01:00Z",
    updatedAt: "2026-11-20T08:05:00Z",
    ...overrides,
  };
}

function facts(
  overrides: Partial<{
    detail: PullRequestDetailFact | null;
    reviews: PullRequestReviewFact[];
    reviewStatus: FactQueryMeta["status"];
    reviewTruncated: boolean;
    runs: PilotWorkflowRunFact[];
    runStatus: FactQueryMeta["status"];
    runTruncated: boolean;
    status: PullRequestFactsSnapshot["status"];
    warnings: string[];
  }> = {},
): PullRequestFactsSnapshot {
  const reviewQuery = meta(
    "/repos/uichat-mira/mira-desktop/pulls/404/reviews",
    overrides.reviewStatus ?? "ok",
    { truncated: overrides.reviewTruncated ?? false },
  );
  const runQuery = meta(
    "/repos/uichat-mira/mira-desktop/actions/runs?head_sha=...",
    overrides.runStatus ?? "ok",
    { truncated: overrides.runTruncated ?? false },
  );
  return {
    apiVersion: "v1",
    source: "github-rest",
    generatedAt: "2026-11-20T10:00:00Z",
    repository,
    number: 404,
    status: overrides.status ?? "complete",
    authentication: {
      mode: "authenticated",
      credentialPresent: true,
      note: "fixture",
    },
    detail: overrides.detail === undefined ? detail() : overrides.detail,
    reviews: {
      state: reviewQuery.status === "ok" ? "observed" : "inaccessible",
      items: overrides.reviews ?? [],
      truncated: overrides.reviewTruncated ?? false,
      observedAt: reviewQuery.observedAt,
      query: reviewQuery,
    },
    headWorkflowRuns: {
      state: runQuery.status === "ok" ? "observed" : "rate_limited",
      items: overrides.runs ?? [],
      truncated: overrides.runTruncated ?? false,
      observedAt: runQuery.observedAt,
      query: runQuery,
    },
    budget: {
      scope: "per-pull-request",
      plannedRequests: 3,
      maxRequests: 5,
      usedRequests: 3,
      remainingRequests: 2,
      retries: 0,
      notModifiedResponses: 0,
      concurrency: 2,
      timeoutMs: 8000,
      refreshSeconds: 60,
      note: "fixture",
    },
    coverage: {
      status: overrides.status ?? "complete",
      plannedQueries: 3,
      completedQueries: 3,
      failedQueries: 0,
      notAttemptedQueries: 0,
      truncatedSources: [],
      reasons: [],
    },
    warnings: overrides.warnings ?? [],
  };
}

function requiredChecks(files: string[] = ["build-desktop.yml"]): RequiredCheckEvidence[] {
  return [
    {
      repository,
      branch: "dev",
      workflowFiles: files,
      source: "fixture-protection",
      observedAt: "2026-11-20T10:00:00Z",
    },
  ];
}

test("Draft suppresses a real conflict and current change request instead of creating a todo", () => {
  const projected = qualifyPullRequest(
    facts({
      detail: detail({ draft: true, mergeable: false, mergeableState: "dirty" }),
      reviews: [review()],
    }),
  );

  assert.equal(projected.status, "observed");
  assert.equal(projected.classification, "observation");
  assert.equal(projected.priority, null);
  assert.match(projected.whyNow, /Draft/i);
  assert.ok(projected.signals.some((signal) => signal.kind === "draft"));
  const conflict = projected.signals.find((signal) => signal.kind === "merge_conflict");
  assert.equal(conflict?.status, "needs_attention");
  assert.equal(conflict?.suppressedBy, "draft");
  assert.equal(
    projected.signals.some(
      (signal) => signal.status === "needs_attention" && !signal.suppressedBy,
    ),
    false,
  );
});

test("a confirmed merge conflict on an open non-draft PR is P1 attention", () => {
  const projected = qualifyPullRequest(
    facts({ detail: detail({ mergeable: false, mergeableState: "dirty" }) }),
  );
  assert.equal(projected.status, "needs_attention");
  assert.equal(projected.classification, "attention");
  assert.equal(projected.priority, "P1");
  assert.match(projected.what, /mergeable=false/i);
  assert.ok(projected.evidence.some((row) => row.label.includes("real conflict")));
});

test("mergeable=null stays unknown and never becomes a conflict candidate", () => {
  const projected = qualifyPullRequest(
    facts({ detail: detail({ mergeable: null, mergeableState: "unknown" }) }),
  );
  assert.equal(projected.status, "unknown");
  assert.equal(projected.priority, null);
  assert.ok(projected.signals.some((signal) => signal.kind === "mergeable_unknown"));
  assert.equal(
    projected.signals.some((signal) => signal.kind === "merge_conflict"),
    false,
  );
  assert.match(projected.what, /not computed/i);
});

test("CHANGES_REQUESTED is attention only on the current head by maintainer authority", () => {
  const projected = qualifyPullRequest(
    facts({ reviews: [review({ commitId: headA })] }),
  );
  assert.equal(projected.status, "needs_attention");
  assert.equal(projected.priority, "P1");
  assert.equal(projected.review.decision, "changes_requested");
  assert.equal(projected.review.decisionAppliesToCurrentHead, true);
  assert.equal(projected.review.maintainerAuthority, true);
  assert.ok(projected.signals.some((signal) => signal.kind === "review_changes_requested"));
});

test("an old-head CHANGES_REQUESTED is unknown, a later approval clears it, and dismissal clears it", () => {
  const stale = qualifyPullRequest(
    facts({
      detail: detail({ headSha: headB }),
      reviews: [review({ commitId: headA })],
    }),
  );
  assert.equal(stale.status, "unknown");
  assert.equal(stale.review.decision, "changes_requested");
  assert.equal(stale.review.decisionAppliesToCurrentHead, false);
  assert.ok(
    stale.signals.some((signal) => signal.kind === "review_changes_requested_stale"),
  );

  const approved = qualifyPullRequest(
    facts({
      detail: detail({ headSha: headB }),
      reviews: [
        review({ id: 1, commitId: headA, submittedAt: "2026-11-20T09:00:00Z" }),
        review({
          id: 2,
          state: "APPROVED",
          commitId: headB,
          submittedAt: "2026-11-20T09:10:00Z",
        }),
      ],
    }),
  );
  assert.equal(approved.status, "observed");
  assert.equal(approved.review.decision, "approved");
  assert.equal(approved.review.decisionAppliesToCurrentHead, true);

  const dismissed = qualifyPullRequest(
    facts({
      reviews: [
        review({ id: 1, state: "CHANGES_REQUESTED" }),
        review({
          id: 2,
          state: "DISMISSED",
          submittedAt: "2026-11-20T09:10:00Z",
        }),
      ],
    }),
  );
  assert.equal(dismissed.status, "observed");
  assert.equal(dismissed.review.decision, "none");
  assert.equal(dismissed.review.dismissedReviews, 1);
});

test("a truncated review window does not promote a change request it cannot prove is latest", () => {
  const projected = qualifyPullRequest(
    facts({ reviews: [review()], reviewTruncated: true }),
  );
  assert.equal(projected.status, "unknown");
  assert.equal(projected.priority, null);
  assert.equal(projected.review.truncated, true);
  assert.equal(projected.review.decision, "unknown");
  assert.ok(projected.signals.some((signal) => signal.kind === "review_coverage"));
  assert.equal(
    projected.signals.some((signal) => signal.kind === "review_changes_requested"),
    false,
  );
});

test("bot and non-maintainer change requests are not promoted to maintainer attention", () => {
  const bot = qualifyPullRequest(
    facts({
      reviews: [
        review({
          userType: "Bot",
          login: "chatgpt-codex-connector[bot]",
          authorAssociation: "NONE",
        }),
      ],
    }),
  );
  assert.equal(bot.status, "observed");
  assert.equal(bot.review.botReviewsIgnored, 1);
  assert.equal(bot.priority, null);

  const contributor = qualifyPullRequest(
    facts({ reviews: [review({ authorAssociation: "CONTRIBUTOR" })] }),
  );
  assert.equal(contributor.status, "observed");
  assert.ok(
    contributor.signals.some(
      (signal) => signal.kind === "review_changes_requested_without_authority",
    ),
  );
  assert.equal(contributor.priority, null);
});

test("required-check failures use OPS-035 evidence; without it they stay unknown", () => {
  const failedRun = run({ conclusion: "failure", path: ".github/workflows/build-desktop.yml" });

  const unknown = qualifyPullRequest(facts({ runs: [failedRun] }));
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.checks.requiredByGithub, "unknown");
  assert.ok(
    unknown.signals.some((signal) => signal.kind === "check_failed_not_proven_required"),
  );

  const attention = qualifyPullRequest(facts({ runs: [failedRun] }), {
    requiredChecks: requiredChecks(),
  });
  assert.equal(attention.status, "needs_attention");
  assert.equal(attention.priority, "P1");
  assert.equal(attention.checks.requiredByGithub, "observed");
  assert.deepEqual(attention.checks.failingRequired, ["build-desktop.yml"]);
  assert.ok(attention.signals.some((signal) => signal.kind === "required_check_failed"));
});

test("same-SHA required-check recovery clears attention and leaves recovery evidence", () => {
  const projected = qualifyPullRequest(
    facts({
      runs: [
        run({
          id: 500,
          attempt: 1,
          conclusion: "failure",
          updatedAt: "2026-11-20T08:05:00Z",
        }),
        run({
          id: 500,
          attempt: 2,
          conclusion: "success",
          updatedAt: "2026-11-20T08:10:00Z",
        }),
      ],
    }),
    { requiredChecks: requiredChecks() },
  );
  assert.equal(projected.status, "observed");
  assert.equal(projected.checks.failingRequired.length, 0);
  assert.ok(projected.checks.workflows[0].recovered);
  assert.ok(projected.signals.some((signal) => signal.kind === "gate_recovered"));
  assert.equal(
    projected.signals.some((signal) => signal.status === "needs_attention"),
    false,
  );
});

test("running required checks are in progress, not human attention", () => {
  const projected = qualifyPullRequest(
    facts({
      runs: [
        run({
          status: "in_progress",
          conclusion: null,
          path: ".github/workflows/build-desktop.yml",
        }),
      ],
    }),
    { requiredChecks: requiredChecks() },
  );
  assert.equal(projected.status, "in_progress");
  assert.equal(projected.priority, null);
  assert.deepEqual(projected.checks.pendingRequired, ["build-desktop.yml"]);
});

test("a required workflow that skipped is unknown, not a decisive pass", () => {
  const projected = qualifyPullRequest(
    facts({
      runs: [
        run({
          conclusion: "skipped",
          path: ".github/workflows/build-desktop.yml",
        }),
      ],
    }),
    { requiredChecks: requiredChecks() },
  );
  assert.equal(projected.status, "unknown");
  assert.deepEqual(projected.checks.unknownRequired, ["build-desktop.yml"]);
  assert.ok(
    projected.signals.some(
      (signal) => signal.kind === "required_check_unknown" && signal.priority === "P3",
    ),
  );
});

test("an explicit sourced hold suppresses attention, while stale head-scoped hold evidence is unknown", () => {
  const active = qualifyPullRequest(
    facts({ detail: detail({ mergeable: false, mergeableState: "dirty" }) }),
    {
      hold: {
        repository,
        number: 404,
        kind: "hold",
        headSha: headA,
        reason: "batch hold until the paired Mobile PR is ready",
        source: "fixture-maintainer-contract",
        observedAt: "2026-11-20T09:30:00Z",
      },
    },
  );
  assert.equal(active.status, "observed");
  assert.equal(active.hold.active, true);
  assert.equal(active.hold.kind, "hold");
  const conflict = active.signals.find((signal) => signal.kind === "merge_conflict");
  assert.equal(conflict?.suppressedBy, "hold");
  assert.match(active.whyNow, /intentionally waiting/i);

  const dependency = qualifyPullRequest(facts(), {
    hold: {
      repository: "mira-desktop",
      number: 404,
      kind: "dependency",
      reason: "waiting for the consumer PR",
      source: "fixture-maintainer-contract",
      observedAt: "2026-11-20T09:30:00Z",
    },
  });
  assert.equal(dependency.status, "in_progress");
  assert.equal(dependency.hold.active, true);

  const stale = qualifyPullRequest(
    facts({ detail: detail({ headSha: headB }) }),
    {
      hold: {
        repository,
        number: 404,
        kind: "hold",
        headSha: headA,
        reason: "old hold",
        source: "fixture-maintainer-contract",
        observedAt: "2026-11-20T09:30:00Z",
      },
    },
  );
  assert.equal(stale.status, "unknown");
  assert.equal(stale.hold.active, false);
  assert.equal(stale.hold.stale, true);
  assert.ok(stale.signals.some((signal) => signal.kind === "hold_stale"));
});

test("merged and closed PRs are observed with no merge-blocking attention", () => {
  const merged = qualifyPullRequest(
    facts({
      detail: detail({ merged: true, mergeable: false, mergeableState: "dirty" }),
    }),
  );
  assert.equal(merged.status, "observed");
  assert.equal(merged.priority, null);
  assert.ok(merged.signals.some((signal) => signal.kind === "pr_merged"));

  const closed = qualifyPullRequest(
    facts({ detail: detail({ state: "closed", mergeable: false }) }),
  );
  assert.equal(closed.status, "observed");
  assert.ok(closed.signals.some((signal) => signal.kind === "pr_closed"));
});

test("403/429 and unreadable PR detail stay explicit unknown, never zero or attention", () => {
  const projected = qualifyPullRequest(
    facts({
      detail: null,
      status: "unavailable",
      reviewStatus: "inaccessible",
      runStatus: "rate_limited",
    }),
  );
  assert.equal(projected.status, "unknown");
  assert.equal(projected.priority, null);
  assert.match(projected.what, /unreadable or not computed/i);
  assert.match(projected.nextStep, /do not infer/i);

  const partial = qualifyPullRequest(
    facts({
      reviewStatus: "inaccessible",
      runStatus: "rate_limited",
      status: "partial",
    }),
  );
  assert.equal(partial.status, "unknown");
  assert.ok(partial.signals.some((signal) => signal.kind === "review_coverage"));
  assert.ok(partial.signals.some((signal) => signal.kind === "checks_coverage"));
});

test("a clean non-draft PR is observed, with required-check uncertainty explicitly disclosed", () => {
  const projected = qualifyPullRequest(facts());
  assert.equal(projected.status, "observed");
  assert.equal(projected.priority, null);
  assert.equal(projected.checks.requiredByGithub, "unknown");
  assert.ok(
    projected.warnings.some((warning) => /required-check configuration is unreadable/i.test(warning)),
  );
  assert.ok(
    projected.warnings.some((warning) => /absence of hold evidence/i.test(warning)),
  );
});

test("newer unrelated prod dispatch cannot clear a failing required PR-head run", () => {
  const result = qualifyPullRequest(
    facts({ runs: [
      run({
        id: 100,
        conclusion: "failure",
        event: "pull_request",
        headBranch: "feat/worker-404",
        updatedAt: "2026-11-20T09:00:00Z",
      }),
      run({
        id: 200,
        conclusion: "success",
        event: "workflow_dispatch",
        headBranch: "prod",
        updatedAt: "2026-11-20T09:10:00Z",
      }),
    ] }),
    { requiredChecks: requiredChecks() },
  );
  assert.equal(result.status, "needs_attention");
  assert.equal(result.checks.workflows[0].applicableRun?.id, 100);
  assert.deepEqual(result.checks.failingRequired, ["build-desktop.yml"]);
  assert.equal(result.checks.workflows[0].recovered, false);
});

test("unrelated dispatch failure on identical SHA does not create PR-required-check attention", () => {
  const result = qualifyPullRequest(
    facts({ runs: [
      run({
        id: 200,
        conclusion: "failure",
        event: "workflow_dispatch",
        headBranch: "prod",
        updatedAt: "2026-11-20T09:10:00Z",
      }),
    ] }),
    { requiredChecks: requiredChecks() },
  );
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.checks.failingRequired, []);
  assert.deepEqual(result.checks.unknownRequired, ["build-desktop.yml"]);
  assert.equal(result.checks.workflows[0].applicableRun, null);
  assert.ok(result.signals.some((signal) => signal.kind === "checks_coverage"));
});

test("known mandatory workflow absent from head runs is unknown, not observed", () => {
  const result = qualifyPullRequest(
    facts({ runs: [] }),
    { requiredChecks: requiredChecks() },
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.checks.requiredByGithub, "observed");
  assert.deepEqual(result.checks.unknownRequired, ["build-desktop.yml"]);
  assert.ok(result.signals.some(
    (signal) => signal.kind === "required_check_unknown" && signal.status === "unknown",
  ));
});

test("manual workflow dispatch on the exact PR head ref is still applicable", () => {
  const result = qualifyPullRequest(
    facts({ runs: [
      run({
        id: 200,
        conclusion: "success",
        event: "workflow_dispatch",
        headBranch: "feat/worker-404",
      }),
    ] }),
    { requiredChecks: requiredChecks() },
  );
  assert.equal(result.status, "observed");
  assert.equal(result.checks.workflows[0].applicableRun?.id, 200);
  assert.equal(result.checks.workflows[0].outcome, "success");
});
