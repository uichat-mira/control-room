import type { CandidatePriority, QualificationEvidence } from "./github-gate-facts.ts";
import type {
  FactoryEvent,
  FactoryFreshness,
  FactoryRunProjection,
  FactoryState,
} from "./factory-read-model.ts";
import {
  FACTORY_FEED_HISTORY_DAYS,
  FACTORY_FEED_MAX_ITEMS,
  FACTORY_FEED_RUNS_PER_REPOSITORY,
  type FactoryFeed,
} from "./factory-feed.ts";
import type { FactQueryMeta } from "./github-facts.ts";

/**
 * OPS-037 derives "does this Worker state need a human now?" from the canonical
 * Factory TV read model. It does not reimplement Worker dispatch, retry, verify,
 * delivery, or the GitHub-only lifecycle projection.
 *
 * The derivation is deliberately conservative:
 * - a GitHub Run failure alone is not a human todo;
 * - a trusted terminal `escalated`/`blocked` state is a todo only when a
 *   verified Issue link is still open at GitHub;
 * - missing Reporter/Issue/Artifact evidence is `unknown`, never a fake
 *   failure, fake recovery, or organization-wide todo count.
 */

export type WorkerAttentionStatus =
  | "needs_attention"
  | "in_progress"
  | "observed"
  | "unknown";

export type WorkerAttentionClassification =
  | "attention"
  | "in_progress"
  | "observation"
  | "unknown";

export type WorkerAttentionSignalKind =
  | "escalated_terminal"
  | "blocked_terminal"
  | "escalation_without_trusted_event"
  | "queued"
  | "working"
  | "candidate_captured"
  | "validating"
  | "repairing"
  | "verified_waiting_delivery"
  | "delivery_retry"
  | "delivered_observation"
  | "run_success_not_acceptance"
  | "issue_open_confirmed"
  | "issue_closed_clears"
  | "issue_identity_missing"
  | "issue_link_mismatch"
  | "issue_state_unknown"
  | "reporter_not_requested"
  | "reporter_not_expected"
  | "reporter_unavailable"
  | "reporter_expired"
  | "reporter_event_gap"
  | "artifact_expired"
  | "artifact_unavailable"
  | "candidate_artifact_missing"
  | "worker_failed_unproven_recovery"
  | "validation_gap"
  | "unknown_state"
  | "superseded_by_newer_run"
  | "same_issue_currentness_unknown"
  | "superseded_by_newer_index"
  | "recovery_evidence_without_identity"
  | "discovery_limited";

export interface WorkerAttentionSignal {
  kind: WorkerAttentionSignalKind;
  status: WorkerAttentionStatus;
  detail: string;
  evidence: QualificationEvidence[];
}

export type WorkerIssueLinkSource = "trusted-reporter" | "trusted-issue-evidence";

/**
 * A verified link between a Worker Run and a GitHub Issue. Callers must supply
 * this only from a trusted source (a trusted Reporter event or equivalent
 * sourced contract evidence). Display titles, branches, free text, and artifact
 * names are not Issue identity.
 */
export interface WorkerIssueLink {
  repository: string;
  issueNumber: number;
  runId: number;
  attempt: number;
  source: WorkerIssueLinkSource;
  observedAt: string;
  url: string | null;
}

export interface WorkerIssueState {
  number: number;
  state: "open" | "closed";
  stateReason: string | null;
  title: string | null;
  htmlUrl: string;
  updatedAt: string | null;
  closedAt: string | null;
}

/** One bounded GitHub Issue read. `query` keeps 403/429/404 as facts, not zero. */
export interface WorkerIssueLookup {
  issue: WorkerIssueState | null;
  query: FactQueryMeta;
}

/**
 * One canonical Factory projection plus any verified Issue context. A caller
 * that already knows about several Runs/attempts for the same Issue should pass
 * them together so the newest Run supersedes older attention.
 */
/** Currentness from a bounded, authenticated GitHub Issue Recovery index. */
export interface WorkerIssueCurrentness {
  status: "confirmed_current" | "superseded" | "unknown";
  observedAt: string | null;
  evidenceUrl: string | null;
  latestRunId: number | null;
  latestAttempt: number | null;
  reason: string;
}

export interface FactoryAttentionRun {
  projection: FactoryRunProjection;
  issue: WorkerIssueLink | null;
  issueLookup?: WorkerIssueLookup | null;
  currentness?: WorkerIssueCurrentness | null;
}

export interface WorkerAttentionDiscovery {
  source: "factory-feed";
  generatedAt: string;
  feedStatus: FactoryFeed["status"];
  historyDays: number;
  runsPerRepository: number;
  maxDisplayedItems: number;
  displayedItems: number;
  displayLimitReached: boolean;
  coverageLimited: boolean;
  failedRepositories: number;
  scannedRepositories: number;
  eligibleRepositories: number;
  note: string;
}

export interface WorkerAttentionCandidate {
  apiVersion: "v1";
  source: "factory-attention-derivation";
  id: string;
  category: "worker_escalation";
  status: WorkerAttentionStatus;
  classification: WorkerAttentionClassification;
  priority: CandidatePriority | null;
  who: string;
  what: string;
  whyNow: string;
  whatSystemTried: string;
  nextStep: string;
  evidence: QualificationEvidence[];
  observedAt: string | null;
  exitCondition: string;
  identity: {
    repository: string;
    issueNumber: number | null;
    issueUrl: string | null;
    issueLinkSource: WorkerIssueLinkSource | null;
    runId: number;
    attempt: number;
    runUrl: string;
    candidateArtifact: {
      artifactId: number;
      name: string;
      expired: boolean;
      url: string;
    } | null;
  };
  state: FactoryState;
  repairRound: number | null;
  freshness: FactoryFreshness;
  reporter: {
    status: FactoryRunProjection["reporter"]["status"];
    freshness: FactoryFreshness;
    observedAt: string | null;
  };
  issue: {
    number: number | null;
    state: "open" | "closed" | "unknown";
    source: "github-rest" | null;
    observedAt: string | null;
    closedAt: string | null;
    stateReason: string | null;
    queryStatus: FactQueryMeta["status"] | "not_attempted";
    error: string | null;
  };
  signals: WorkerAttentionSignal[];
  coverage: {
    status: "complete" | "partial" | "unknown";
    issueState: "observed" | "unavailable" | "not_attempted";
    sameIssueHistory: "supplied" | "not_supplied";
    reasons: string[];
    discovery: WorkerAttentionDiscovery | null;
  };
  warnings: string[];
}

export interface WorkerAttentionProjection {
  apiVersion: "v1";
  source: "factory-attention-derivation";
  generatedAt: string;
  status: "complete" | "partial" | "unknown";
  scope: {
    kind: "supplied-runs";
    runs: number;
    issueGroups: number;
    note: string;
  };
  counts: {
    attention: number;
    in_progress: number;
    observation: number;
    unknown: number;
  };
  discovery: WorkerAttentionDiscovery | null;
  candidates: WorkerAttentionCandidate[];
  warnings: string[];
}

export interface WorkerAttentionOptions {
  now?: number;
  discovery?: WorkerAttentionDiscovery | null;
}

const CLASSIFICATION: Record<WorkerAttentionStatus, WorkerAttentionClassification> = {
  needs_attention: "attention",
  in_progress: "in_progress",
  observed: "observation",
  unknown: "unknown",
};

const OBSERVED_RUN_CONCLUSIONS = new Set([
  "success",
  "failure",
  "timed_out",
  "startup_failure",
]);

function iso(now: number): string {
  return new Date(now).toISOString();
}

function sortedEvents(events: readonly FactoryEvent[]): FactoryEvent[] {
  return [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

function latestRepairEvent(
  events: readonly FactoryEvent[],
  outcome: "escalated" | "blocked",
): FactoryEvent | null {
  return (
    sortedEvents(events)
      .filter((event) => event.stage === "repair" && event.outcome === outcome)
      .at(-1) ?? null
  );
}

function issueObserved(lookup: WorkerIssueLookup | null | undefined): boolean {
  return lookup?.query.status === "ok" || lookup?.query.status === "not_modified";
}

function validIssueLink(run: FactoryAttentionRun): {
  link: WorkerIssueLink | null;
  rejected: boolean;
} {
  const link = run.issue;
  if (!link) return { link: null, rejected: false };
  const valid =
    link.repository === run.projection.repository &&
    link.runId === run.projection.run.id &&
    link.attempt === run.projection.run.attempt &&
    Number.isSafeInteger(link.issueNumber) &&
    link.issueNumber > 0;
  return valid ? { link, rejected: false } : { link: null, rejected: true };
}

interface Entry {
  run: FactoryAttentionRun;
  link: WorkerIssueLink | null;
  linkRejected: boolean;
  index: number;
}

interface Group {
  key: string;
  issueNumber: number | null;
  entries: Entry[];
}

function runTime(projection: FactoryRunProjection): number {
  const created = Date.parse(projection.run.createdAt);
  return Number.isFinite(created) ? created : 0;
}

function newestFirst(a: Entry, b: Entry): number {
  return (
    runTime(b.run.projection) - runTime(a.run.projection) ||
    b.run.projection.run.id - a.run.projection.run.id ||
    b.run.projection.run.attempt - a.run.projection.run.attempt
  );
}

function groupEntries(runs: readonly FactoryAttentionRun[]): Group[] {
  const groups = new Map<string, Group>();
  runs.forEach((run, index) => {
    const { link, rejected } = validIssueLink(run);
    const key = link
      ? `issue:${run.projection.repository}#${link.issueNumber}`
      : `run:${run.projection.repository}#${run.projection.run.id}:${run.projection.run.attempt}:${index}`;
    const existing = groups.get(key);
    const entry: Entry = { run, link, linkRejected: rejected, index };
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, {
        key,
        issueNumber: link?.issueNumber ?? null,
        entries: [entry],
      });
    }
  });
  for (const group of groups.values()) {
    group.entries.sort(newestFirst);
  }
  return [...groups.values()].sort((a, b) => newestFirst(a.entries[0], b.entries[0]));
}

function uniqueEvidence(rows: readonly QualificationEvidence[]): QualificationEvidence[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}|${row.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runEvidence(projection: FactoryRunProjection): QualificationEvidence {
  return {
    label: `Run #${projection.run.id} attempt ${projection.run.attempt} (${projection.state})`,
    url: projection.run.htmlUrl,
    observedAt: projection.run.updatedAt,
  };
}

function artifactHtmlUrl(
  repository: string,
  runId: number,
  artifactId: number,
): string {
  return `https://github.com/${repository}/actions/runs/${runId}/artifacts/${artifactId}`;
}

function candidateArtifact(projection: FactoryRunProjection): {
  artifactId: number;
  name: string;
  expired: boolean;
  url: string;
} | null {
  // Candidate identity is a distinct artifact contract; Verify/Delivery
  // artifacts must never impersonate the candidate when it is missing.
  const matches = projection.artifacts.filter((artifact) =>
    /^mira-external-worker-candidate-\d+-\d+-\d+$/.test(artifact.name),
  );
  const chosen = matches.find((artifact) => !artifact.expired) ?? matches[0] ?? null;
  if (!chosen) return null;
  return {
    artifactId: chosen.id,
    name: chosen.name,
    expired: chosen.expired,
    url: artifactHtmlUrl(projection.repository, projection.run.id, chosen.id),
  };
}

function issueEvidence(
  link: WorkerIssueLink,
  lookup: WorkerIssueLookup | null | undefined,
): QualificationEvidence {
  const state = issueObserved(lookup) ? lookup?.issue?.state : null;
  return {
    label: `Issue #${link.issueNumber}${state ? ` (${state})` : " (state unknown)"} · ${link.source}`,
    url: lookup?.issue?.htmlUrl ?? link.url ?? null,
    observedAt: lookup?.issue?.updatedAt ?? link.observedAt,
  };
}

function escalationEvidence(event: FactoryEvent): QualificationEvidence {
  return {
    label: `Trusted Reporter ${event.stage}/${event.outcome}${event.errorCode ? ` · ${event.errorCode}` : ""}`,
    url: event.evidence?.url ?? null,
    observedAt: event.occurredAt,
  };
}

function failingJobEvidence(projection: FactoryRunProjection): QualificationEvidence[] {
  return projection.jobs
    .filter((job) =>
      ["failure", "timed_out", "startup_failure"].includes(job.conclusion ?? ""),
    )
    .slice(0, 5)
    .map((job) => ({
      label: `GitHub Job ${job.name}: ${job.conclusion}`,
      url: job.evidence.url,
      observedAt: job.completedAt,
    }));
}

function whatSystemTriedFor(projection: FactoryRunProjection): string {
  if (projection.reporter.status !== "available") {
    return `Unknown: Reporter evidence is ${projection.reporter.status.replaceAll("_", " ")}; GitHub Jobs are the only visible execution evidence.`;
  }
  const events = sortedEvents(projection.reporter.events);
  const parts: string[] = [];
  for (const event of events) {
    if (event.stage === "repair") {
      parts.push(
        `repair ${event.outcome}${event.errorCode ? ` (${event.errorCode})` : ""}`,
      );
    } else if (event.kind === "verify.failed") {
      parts.push("verify failed");
    } else if (event.kind === "verify.passed") {
      parts.push("verify passed");
    } else if (event.kind === "delivery.failed") {
      parts.push("delivery failed");
    } else if (event.kind === "delivery.draft_pr_created") {
      parts.push("Draft PR delivered");
    }
  }
  const failedJobs = projection.jobs.filter((job) =>
    ["failure", "timed_out", "startup_failure"].includes(job.conclusion ?? ""),
  );
  if (failedJobs.length > 0) {
    parts.push(
      `GitHub Jobs failed: ${failedJobs.slice(0, 3).map((job) => job.name).join(", ")}`,
    );
  }
  if (projection.repairRound !== null) {
    parts.push(`repair round ${projection.repairRound}`);
  }
  return parts.length > 0
    ? parts.join(" → ")
    : "No trusted repair, verification, or delivery event was observed for this Run attempt.";
}

function decisionReason(projection: FactoryRunProjection): string {
  const event =
    projection.state === "escalated"
      ? latestRepairEvent(projection.reporter.events, "escalated")
      : projection.state === "blocked"
        ? latestRepairEvent(projection.reporter.events, "blocked")
        : null;
  const label = projection.state === "escalated" ? "escalated" : "blocked";
  if (!event) return `the Run is marked ${label} without a matching trusted repair event`;
  return `trusted repair outcome ${event.outcome}${event.errorCode ? ` (${event.errorCode})` : ""}${
    projection.repairRound !== null ? ` at repair round ${projection.repairRound}` : ""
  }`;
}

function whyNowFor(
  status: WorkerAttentionStatus,
  projection: FactoryRunProjection,
  issueState: "open" | "closed" | "unknown",
): string {
  switch (status) {
    case "needs_attention":
      return `The current terminal Worker state for this verified Issue is ${projection.state} (${decisionReason(projection)}), the Issue is still open at GitHub, and the supplied evidence shows no available automatic recovery. A maintainer decision is required now.`;
    case "in_progress":
      return "The latest supplied Run/attempt for this target is still in automatic execution or verification. A first failure, repair round, or pending delivery retry is not a maintainer todo.";
    case "observed":
      if (issueState === "closed") {
        return "The linked Issue is closed at GitHub, so this old Worker escalation is no longer current. Legitimate Issue closure, not a Run success, is what clears the attention.";
      }
      if (projection.state === "observation_gap") {
        return "GitHub reports a completed Run but no trusted Verify/Delivery event proves a product outcome. That is an observation record, not acceptance or a human todo.";
      }
      if (projection.state === "delivered") {
        return "A Draft PR was delivered. Delivery is a pipeline step, not product acceptance or Issue closure, and it does not create a human todo by itself.";
      }
      return "No maintainer-actionable Worker blocker is proven from the current evidence.";
    case "unknown":
      return "The available evidence is insufficient to prove a current terminal maintainer handoff. Converting this gap into a human todo or an organization-wide count would be a guess.";
  }
}

function nextStepFor(
  status: WorkerAttentionStatus,
  projection: FactoryRunProjection,
  link: WorkerIssueLink | null,
  issueState: "open" | "closed" | "unknown",
): string {
  if (issueState === "closed") {
    return "No action; the Issue is closed at GitHub. If more work is needed, continue a new/existing work item instead of reusing this old alert.";
  }
  if (status === "needs_attention") {
    return `Open Issue #${link?.issueNumber} and Run #${projection.run.id} attempt ${projection.run.attempt}; review the trusted repair/verification evidence, decide whether to amend scope or supply the missing permission/decision, then explicitly requeue the Worker. Do not treat Run success or a Draft PR as acceptance.`;
  }
  if (status === "in_progress") {
    return "Wait for the current automatic step; re-read the same Issue/Run/attempt or supply any newer same-Issue Run instead of escalating a pending state.";
  }
  if (status === "unknown") {
    return link
      ? `Re-read the same Run #${projection.run.id} attempt ${projection.run.attempt} with trusted Reporter evidence and a readable Issue state; do not convert the gap into a blocker.`
      : "Obtain a verified Issue link from a trusted Reporter/Issue source before assigning a human owner; do not guess an Issue number from title, branch, or artifact text.";
  }
  if (projection.state === "delivered") {
    return "Review the delivered Draft PR under its own contract; delivery alone neither accepts nor closes the Issue.";
  }
  return "No Worker action; if acceptance is still required, follow the Issue's own verification/delivery evidence rather than treating a successful Run as acceptance.";
}

function exitConditionFor(status: WorkerAttentionStatus): string {
  switch (status) {
    case "needs_attention":
      return "A newer Run/attempt for the same verified Issue reaches repairing/validating/verified/delivered with trusted evidence, the Issue is closed at GitHub, or trusted recovery evidence supersedes this escalation.";
    case "in_progress":
      return "The current automatic step reaches a terminal state, or a newer same-Issue Run changes the state; re-read the same target.";
    case "observed":
      return "Already no human todo; exits only if the same verified Issue later reaches a trusted terminal blocked/escalated state with no available recovery.";
    case "unknown":
      return "The missing trusted Reporter event, verified Issue identity, readable Issue state, or non-expired durable artifact becomes available for the same Run/attempt.";
  }
}

function stateSignal(
  projection: FactoryRunProjection,
  evidence: QualificationEvidence,
): { status: WorkerAttentionStatus; signal: WorkerAttentionSignal } {
  const value = projection.state;
  if (value === "queued") {
    return {
      status: "in_progress",
      signal: {
        kind: "queued",
        status: "in_progress",
        detail: "The Worker Run is queued; no human action is proven.",
        evidence: [evidence],
      },
    };
  }
  if (value === "working") {
    return {
      status: "in_progress",
      signal: {
        kind: "working",
        status: "in_progress",
        detail: "GitHub Jobs or the Run prove active Worker execution.",
        evidence: [evidence],
      },
    };
  }
  if (value === "candidate_captured") {
    return {
      status: "in_progress",
      signal: {
        kind: "candidate_captured",
        status: "in_progress",
        detail: "A Candidate was captured and the next automatic step is not yet a human decision.",
        evidence: [evidence],
      },
    };
  }
  if (value === "validating") {
    return {
      status: "in_progress",
      signal: {
        kind: "validating",
        status: "in_progress",
        detail: "Independent Validation is still executing.",
        evidence: [evidence],
      },
    };
  }
  if (value === "repairing") {
    return {
      status: "in_progress",
      signal: {
        kind: "repairing",
        status: "in_progress",
        detail: "The Worker is consuming a structured repair return; the earlier failure is not the current terminal state.",
        evidence: [evidence],
      },
    };
  }
  if (value === "verified") {
    return {
      status: "in_progress",
      signal: {
        kind: "verified_waiting_delivery",
        status: "in_progress",
        detail: "Verification passed; delivery is still pending, so this is not acceptance or a human todo.",
        evidence: [evidence],
      },
    };
  }
  if (value === "delivery_retry") {
    return {
      status: "in_progress",
      signal: {
        kind: "delivery_retry",
        status: "in_progress",
        detail: "Delivery failed and a model-free delivery retry is still the automatic next step.",
        evidence: [evidence],
      },
    };
  }
  if (value === "delivered") {
    return {
      status: "observed",
      signal: {
        kind: "delivered_observation",
        status: "observed",
        detail: "A Draft PR was delivered. Delivery is not product acceptance and does not close the Issue by itself.",
        evidence: [evidence],
      },
    };
  }
  if (value === "observation_gap") {
    return {
      status: "observed",
      signal: {
        kind: "run_success_not_acceptance",
        status: "observed",
        detail: "GitHub reports a completed Run without a trusted Verify/Delivery event. This is an observation gap, not product acceptance.",
        evidence: [evidence],
      },
    };
  }
  if (value === "worker_failed") {
    return {
      status: "unknown",
      signal: {
        kind: "worker_failed_unproven_recovery",
        status: "unknown",
        detail: "The Worker Run itself failed, but the current evidence does not prove that automatic retry/repair is exhausted. This is unknown, not a confirmed maintainer handoff.",
        evidence: [evidence],
      },
    };
  }
  if (value === "validation_gap") {
    return {
      status: "unknown",
      signal: {
        kind: "validation_gap",
        status: "unknown",
        detail: "Validation failed, but the next repair decision is not proven. A failed Verify alone is not a human todo.",
        evidence: [evidence],
      },
    };
  }
  if (value === "artifact_unavailable") {
    return {
      status: "unknown",
      signal: {
        kind: "artifact_unavailable",
        status: "unknown",
        detail: "The durable Candidate/verification Artifact is missing or expired, so the lifecycle is unknown rather than a Worker failure.",
        evidence: [evidence],
      },
    };
  }
  return {
    status: "unknown",
    signal: {
      kind: "unknown_state",
      status: "unknown",
      detail: `Factory state ${value} is not decidable from the available evidence.`,
      evidence: [evidence],
    },
  };
}

function buildCandidate(
  entry: Entry,
  group: Group,
  now: number,
  discovery: WorkerAttentionDiscovery | null,
): WorkerAttentionCandidate {
  const projection = entry.run.projection;
  const link = entry.link;
  const suppliedLookup = entry.run.issueLookup ?? null;
  // An Issue-state read is only meaningful for the verified Issue that was
  // linked to this exact Run/attempt. Ignore it when the Issue identity is
  // absent or the lookup returned a different Issue number.
  const lookupMismatch = Boolean(
    link && suppliedLookup?.issue && suppliedLookup.issue.number !== link.issueNumber,
  );
  const lookup = !link || lookupMismatch ? null : suppliedLookup;
  const lookupObserved = issueObserved(lookup);
  const issueState: "open" | "closed" | "unknown" =
    lookupObserved && lookup?.issue ? lookup.issue.state : "unknown";
  const signals: WorkerAttentionSignal[] = [];
  const warnings: string[] = [];
  const evidence: QualificationEvidence[] = [runEvidence(projection)];
  const runRow = evidence[0];

  if (entry.linkRejected) {
    warnings.push(
      "A supplied Issue link did not match the projection repository/run/attempt and was discarded; it was not used to group or clear attention.",
    );
  }
  if (lookupMismatch) {
    warnings.push(
      `An Issue-state read for #${suppliedLookup?.issue?.number} did not match the verified Issue #${link?.issueNumber} and was ignored.`,
    );
  }

  if (link) {
    evidence.push(issueEvidence(link, lookup));
  }
  if (projection.reporter.status === "not_requested") {
    signals.push({
      kind: "reporter_not_requested",
      status: "unknown",
      detail:
        "Reporter was intentionally not queried. A GitHub-only read cannot prove repair exhaustion or recovery.",
      evidence: [],
    });
    warnings.push(
      "GitHub-only read: trusted escalated/blocked states and automatic recovery history are not visible. This route does not treat a GitHub failure as escalation.",
    );
  } else if (projection.reporter.status === "expired") {
    signals.push({
      kind: "reporter_expired",
      status: "unknown",
      detail:
        "Reporter retention expired; the historical lifecycle may exist but is no longer readable. GitHub remains the evidence source.",
      evidence: [],
    });
  } else if (projection.reporter.status === "unavailable") {
    signals.push({
      kind: "reporter_unavailable",
      status: "unknown",
      detail:
        "The trusted Reporter source was unavailable. This is an observation gap, not a Worker failure.",
      evidence: [],
    });
  } else if (projection.reporter.status === "not_expected") {
    signals.push({
      kind: "reporter_not_expected",
      status: "observed",
      detail:
        "GitHub proves this Run state should not produce Reporter output; no Reporter event is expected.",
      evidence: [],
    });
  } else if (projection.reporter.events.length === 0) {
    signals.push({
      kind: "reporter_event_gap",
      status: "unknown",
      detail:
        "The Reporter was available but no trusted event was observed for this exact Run attempt; this is an observation gap.",
      evidence: [],
    });
  }

  if (projection.artifacts.some((artifact) => artifact.expired)) {
    signals.push({
      kind: "artifact_expired",
      status: "unknown",
      detail:
        "One or more GitHub Artifacts are expired. Expired evidence is a coverage gap, not proof of failure or success.",
      evidence: projection.artifacts
        .filter((artifact) => artifact.expired)
        .slice(0, 3)
        .map((artifact) => ({
          label: `Expired Artifact ${artifact.name}`,
          url: artifactHtmlUrl(projection.repository, projection.run.id, artifact.id),
          observedAt: artifact.expiresAt,
        })),
    });
  }

  if (projection.run.status === "completed" && !OBSERVED_RUN_CONCLUSIONS.has(projection.run.conclusion ?? "") && projection.run.conclusion !== "skipped") {
    warnings.push(
      `GitHub Run conclusion ${projection.run.conclusion ?? "unknown"} is not a decisive lifecycle result.`,
    );
  }

  if (!link && projection.state !== "escalated" && projection.state !== "blocked") {
    signals.push({
      kind: "issue_identity_missing",
      status: "unknown",
      detail:
        "No verified Issue identity was supplied; this candidate is anchored to the GitHub Run/attempt only and cannot clear another Issue.",
      evidence: [runRow],
    });
  }

  let status: WorkerAttentionStatus;
  let primaryKind: WorkerAttentionSignalKind;

  if (projection.state === "escalated" || projection.state === "blocked") {
    const expected = projection.state;
    const event = latestRepairEvent(projection.reporter.events, expected);
    const trusted = projection.reporter.status === "available" && event !== null;
    if (!trusted) {
      status = "unknown";
      primaryKind = "escalation_without_trusted_event";
      signals.push({
        kind: "escalation_without_trusted_event",
        status: "unknown",
        detail: `Factory state ${expected} has no matching trusted Reporter event in this projection. It is not presented as a confirmed maintainer handoff.`,
        evidence: [runRow],
      });
    } else if (!link) {
      status = "unknown";
      primaryKind = "issue_identity_missing";
      signals.push({
        kind: "issue_identity_missing",
        status: "unknown",
        detail:
          "Trusted escalation evidence exists, but the GitHub Issue identity is not verified. It is not guessed from title, branch, or artifact text.",
        evidence: [escalationEvidence(event)],
      });
      warnings.push(
        "No verified Issue link was supplied; Issue validity/closure and same-Issue recovery cannot be established.",
      );
    } else if (!lookup) {
      status = "unknown";
      primaryKind = "issue_state_unknown";
      signals.push({
        kind: "issue_state_unknown",
        status: "unknown",
        detail: lookupMismatch
          ? `Issue #${link.issueNumber} is linked, but the supplied Issue-state read belongs to a different Issue and was ignored.`
          : `Issue #${link.issueNumber} is linked, but no bounded Issue-state read was supplied. A closed/superseded Issue cannot be ruled out.`,
        evidence: [issueEvidence(link, null)],
      });
    } else if (!lookupObserved) {
      status = "unknown";
      primaryKind = "issue_state_unknown";
      signals.push({
        kind: "issue_state_unknown",
        status: "unknown",
        detail: `Issue #${link.issueNumber} state read is ${lookup.query.status}; issue validity is unknown, not closed and not open.`,
        evidence: [
          issueEvidence(link, lookup),
          {
            label: `Issue query ${lookup.query.status}`,
            url: null,
            observedAt: lookup.query.fetchedAt,
          },
        ],
      });
      warnings.push(
        `Issue #${link.issueNumber} could not be read (${lookup.query.status}${lookup.query.error ? `: ${lookup.query.error}` : ""}); this is a coverage gap, not a human todo.`,
      );
    } else if (issueState === "closed") {
      status = "observed";
      primaryKind = "issue_closed_clears";
      signals.push({
        kind: "issue_closed_clears",
        status: "observed",
        detail: `Issue #${link.issueNumber} is closed at GitHub${lookup?.issue?.stateReason ? ` (${lookup.issue.stateReason})` : ""}; the old Worker escalation is no longer current.`,
        evidence: [issueEvidence(link, lookup)],
      });
    } else if (entry.run.currentness?.status !== "confirmed_current") {
      // An Issue remaining open does NOT prove that a historic Run still owns
      // the handoff. In particular a newer same-Issue attempt may already be
      // repairing while this old Reporter escalation is still queryable.
      const proof = entry.run.currentness;
      status = "unknown";
      primaryKind = proof?.status === "superseded"
        ? "superseded_by_newer_index"
        : "same_issue_currentness_unknown";
      signals.push({
        kind: primaryKind,
        status: "unknown",
        detail: proof?.reason ??
          "No bounded, trusted same-Issue Recovery index was supplied, so the currentness of this escalation cannot be proven.",
        evidence: proof?.evidenceUrl
          ? [{ label: "GitHub trusted Recovery pointer", url: proof.evidenceUrl, observedAt: proof.observedAt }]
          : [runRow],
      });
    } else {
      status = "needs_attention";
      primaryKind = expected === "escalated" ? "escalated_terminal" : "blocked_terminal";
      if (entry.run.currentness.evidenceUrl) {
        evidence.push({
          label: "Current trusted Issue Recovery pointer",
          url: entry.run.currentness.evidenceUrl,
          observedAt: entry.run.currentness.observedAt,
        });
      }
      evidence.push(escalationEvidence(event));
      signals.push({
        kind: primaryKind,
        status: "needs_attention",
        detail: `Run #${projection.run.id} attempt ${projection.run.attempt} is ${expected} for the still-open Issue #${link.issueNumber}; ${decisionReason(projection)}.`,
        evidence: [escalationEvidence(event), issueEvidence(link, lookup)],
      });
      signals.push({
        kind: "issue_open_confirmed",
        status: "needs_attention",
        detail: `Issue #${link.issueNumber} is open at GitHub at observation time.`,
        evidence: [issueEvidence(link, lookup)],
      });
    }
  } else if (issueState === "closed") {
    status = "observed";
    primaryKind = "issue_closed_clears";
    signals.push({
      kind: "issue_closed_clears",
      status: "observed",
      detail: `Issue #${link?.issueNumber} is closed at GitHub; no Worker attention is current for this closed work item.`,
      evidence: link ? [issueEvidence(link, lookup)] : [],
    });
  } else {
    const derived = stateSignal(projection, runRow);
    status = derived.status;
    primaryKind = derived.signal.kind;
    signals.push(derived.signal);
    if (status === "observed") {
      warnings.push(
        "A successful or completed Run is not product acceptance and does not close the Issue.",
      );
    }
  }

  for (const older of group.entries.slice(1)) {
    const olderProjection = older.run.projection;
    const olderEvent = latestRepairEvent(olderProjection.reporter.events, "escalated") ??
      latestRepairEvent(olderProjection.reporter.events, "blocked");
    signals.push({
      kind: "superseded_by_newer_run",
      status: "observed",
      detail:
        `Run #${olderProjection.run.id} attempt ${olderProjection.run.attempt} (${olderProjection.state}) is older than the current Run #${projection.run.id} attempt ${projection.run.attempt} for the same verified Issue. It stays archive evidence and does not keep an alert open.`,
      evidence: [
        runEvidence(olderProjection),
        ...(olderEvent ? [escalationEvidence(olderEvent)] : []),
      ],
    });
  }

  const sameIssueHistory = group.entries.length > 1 ? "supplied" : "not_supplied";
  const reasons: string[] = [];
  if (!link) {
    reasons.push(
      entry.linkRejected
        ? "The supplied Issue link did not match this Run/attempt."
        : "No verified Issue identity was supplied for this Run.",
    );
  }
  if (link && !lookup) {
    reasons.push(
      lookupMismatch
        ? "The supplied Issue-state read belongs to a different Issue number."
        : "No bounded GitHub Issue-state read was supplied.",
    );
  }
  if (lookup && !lookupObserved) {
    reasons.push(`Issue state read is ${lookup.query.status}.`);
  }
  if (projection.reporter.status !== "available") {
    reasons.push(`Reporter evidence is ${projection.reporter.status.replaceAll("_", " ")}.`);
  }
  if (projection.reporter.status === "available" && projection.reporter.events.length === 0) {
    reasons.push("Reporter query returned no trusted event for this Run attempt.");
  }
  if (projection.artifacts.some((artifact) => artifact.expired)) {
    reasons.push("One or more Artifacts are expired.");
  }
  if (sameIssueHistory === "not_supplied" && entry.run.currentness?.status !== "confirmed_current") {
    reasons.push(
      "Same-Issue run history and a reliable latest trusted Recovery pointer were not both available; a newer Run/attempt may exist outside this read.",
    );
  }
  if (discovery && (discovery.coverageLimited || discovery.displayLimitReached || discovery.feedStatus !== "connected")) {
    reasons.push(
      "Factory Feed discovery is bounded and partial; absence from that feed is not proof that no Worker is blocked.",
    );
  }

  const decisionDependsOnIssue =
    projection.state === "escalated" || projection.state === "blocked";
  const coverageStatus: "complete" | "partial" | "unknown" =
    decisionDependsOnIssue && status === "unknown" && issueState !== "closed"
      ? "unknown"
      : reasons.length > 0
        ? "partial"
        : "complete";

  if (sameIssueHistory === "not_supplied") {
    warnings.push(
      entry.run.currentness?.status === "confirmed_current"
        ? "The current Run matches the latest bounded trusted Recovery pointer; unindexed in-flight Runs may still be outside this observation."
        : "Same-Issue history was not supplied. A newer Run/attempt or recovery for the same Issue may exist; do not present this Run as the current blocker.",
    );
  }
  if (discovery) {
    warnings.push(discovery.note);
  }

  const artifact = candidateArtifact(projection);
  if (!artifact && ["escalated", "blocked", "verified", "delivered"].includes(projection.state)) {
    signals.push({
      kind: "candidate_artifact_missing",
      status: "unknown",
      detail: "No canonical Candidate Artifact is present in this Run. Verify/Delivery artifacts cannot substitute for Candidate identity.",
      evidence: [runRow],
    });
    reasons.push("Canonical Candidate Artifact was not observed.");
    warnings.push("Candidate Artifact is missing; no Verify/Delivery artifact was relabeled as a Candidate.");
  }
  if (artifact) {
    evidence.push({
      label: `Candidate Artifact ${artifact.name}${artifact.expired ? " (expired)" : ""}`,
      url: artifact.url,
      observedAt: projection.artifacts.find((item) => item.id === artifact.artifactId)?.createdAt ?? null,
    });
  }
  evidence.push(...failingJobEvidence(projection));

  const id = link
    ? `worker:${projection.repository}#issue:${link.issueNumber}`
    : `worker:${projection.repository}#run:${projection.run.id}:attempt:${projection.run.attempt}`;

  return {
    apiVersion: "v1",
    source: "factory-attention-derivation",
    id,
    category: "worker_escalation",
    status,
    classification: CLASSIFICATION[status],
    priority: status === "needs_attention" ? "P1" : null,
    who: `${projection.repository} maintainers`,
    what: `${runEvidence(projection).label} for ${
      link ? `Issue #${link.issueNumber}` : "an unverified Issue target"
    } is ${projection.state}.`,
    whyNow: whyNowFor(status, projection, issueState),
    whatSystemTried: whatSystemTriedFor(projection),
    nextStep: nextStepFor(status, projection, link, issueState),
    evidence: uniqueEvidence(evidence),
    observedAt: projection.generatedAt || iso(now),
    exitCondition: exitConditionFor(status),
    identity: {
      repository: projection.repository,
      issueNumber: link?.issueNumber ?? null,
      issueUrl: lookup?.issue?.htmlUrl ?? link?.url ?? null,
      issueLinkSource: link?.source ?? null,
      runId: projection.run.id,
      attempt: projection.run.attempt,
      runUrl: projection.run.htmlUrl,
      candidateArtifact: artifact,
    },
    state: projection.state,
    repairRound: projection.repairRound,
    freshness: projection.freshness,
    reporter: {
      status: projection.reporter.status,
      freshness: projection.reporter.freshness,
      observedAt: projection.reporter.observedAt,
    },
    issue: {
      number: link?.issueNumber ?? null,
      state: issueState,
      source: lookupObserved ? "github-rest" : null,
      observedAt: lookup?.issue?.updatedAt ?? null,
      closedAt: lookup?.issue?.closedAt ?? null,
      stateReason: lookup?.issue?.stateReason ?? null,
      queryStatus: lookup?.query.status ?? "not_attempted",
      error: lookup?.query.error ?? null,
    },
    signals,
    coverage: {
      status: coverageStatus,
      issueState: !link
        ? "not_attempted"
        : lookupObserved
          ? "observed"
          : lookup
            ? "unavailable"
            : "not_attempted",
      sameIssueHistory,
      reasons,
      discovery,
    },
    warnings: Array.from(new Set(warnings)),
  };
}

export function discoveryFromFeed(feed: FactoryFeed): WorkerAttentionDiscovery {
  return {
    source: "factory-feed",
    generatedAt: feed.generatedAt,
    feedStatus: feed.status,
    historyDays: feed.historyDays ?? FACTORY_FEED_HISTORY_DAYS,
    runsPerRepository: FACTORY_FEED_RUNS_PER_REPOSITORY,
    maxDisplayedItems: FACTORY_FEED_MAX_ITEMS,
    displayedItems: feed.items.length,
    displayLimitReached: feed.items.length >= FACTORY_FEED_MAX_ITEMS,
    coverageLimited: feed.coverageLimited,
    failedRepositories: feed.failedRepositories,
    scannedRepositories: feed.scannedRepositories,
    eligibleRepositories: feed.eligibleRepositories,
    note: `Factory Feed discovery covers at most ${feed.historyDays ?? FACTORY_FEED_HISTORY_DAYS} days, ${FACTORY_FEED_RUNS_PER_REPOSITORY} Runs per repository, and ${FACTORY_FEED_MAX_ITEMS} displayed items. It is a recent-candidate source, not an organization-wide count; an absent Run is a coverage gap, not proof that no Worker needs attention.`,
  };
}

/**
 * Qualifies one or more canonical Factory projections. Runs sharing a verified
 * Issue identity are reduced to the newest Run/attempt, so an old escalation
 * cannot stay current after a newer recovery. Runs with different Issues never
 * clear each other.
 */
export function qualifyWorkerAttention(
  runs: readonly FactoryAttentionRun[],
  options: WorkerAttentionOptions = {},
): WorkerAttentionProjection {
  const now = options.now ?? Date.now();
  const discovery = options.discovery ?? null;
  const groups = groupEntries(runs);
  const candidates = groups.map((group) =>
    buildCandidate(group.entries[0], group, now, discovery),
  );

  const counts = {
    attention: candidates.filter((candidate) => candidate.classification === "attention").length,
    in_progress: candidates.filter((candidate) => candidate.classification === "in_progress").length,
    observation: candidates.filter((candidate) => candidate.classification === "observation").length,
    unknown: candidates.filter((candidate) => candidate.classification === "unknown").length,
  };

  const status: WorkerAttentionProjection["status"] =
    candidates.length === 0
      ? "unknown"
      : candidates.every(
            (candidate) =>
              candidate.coverage.status === "complete" &&
              (discovery === null ||
                (!discovery.coverageLimited &&
                  !discovery.displayLimitReached &&
                  discovery.feedStatus === "connected")),
          )
        ? "complete"
        : "partial";

  const warnings = new Set<string>([
    "Counts are scoped to the supplied Run set, not an organization-wide outstanding-Worker total.",
    "Run success and Draft PR delivery are not product acceptance or Issue closure.",
    "Issue identity is accepted only from a trusted Reporter/Issue source; display titles, branches, artifact names, and free text are never parsed as Issue numbers.",
    "A GitHub-only projection cannot prove an escalated/blocked terminal state or exhausted automatic recovery; missing Reporter/Artifact/Issue evidence is unknown, not a Worker failure.",
  ]);
  if (discovery) warnings.add(discovery.note);
  for (const candidate of candidates) {
    for (const warning of candidate.warnings) warnings.add(warning);
  }
  if (groups.length < runs.length) {
    warnings.add(
      `${runs.length} supplied Runs collapsed into ${groups.length} Issue/Run groups; there is one current candidate per verified Issue.`,
    );
  }

  return {
    apiVersion: "v1",
    source: "factory-attention-derivation",
    generatedAt: iso(now),
    status,
    scope: {
      kind: "supplied-runs",
      runs: runs.length,
      issueGroups: groups.length,
      note: "Only the supplied canonical Factory projections are assessed. This is not a complete discovery scan and cannot prove the absence of other blocked Workers.",
    },
    counts,
    discovery,
    candidates,
    warnings: [...warnings],
  };
}
