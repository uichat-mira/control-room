import {
  assessWorkflowsForSha,
  requiredWorkflowFilesFor,
  type CandidatePriority,
  type GateWorkflowAssessment,
  type QualificationEvidence,
  type RequiredCheckEvidence,
} from "./github-gate-facts.ts";
import type {
  PilotWorkflowFact,
  PilotWorkflowRunFact,
} from "./github-facts.ts";
import type {
  PullRequestDetailFact,
  PullRequestFactsSnapshot,
  PullRequestReviewFact,
} from "./github-pr-facts.ts";

const ORG = "uichat-mira";
const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const DECISION_REVIEW_STATES = new Set([
  "CHANGES_REQUESTED",
  "APPROVED",
  "DISMISSED",
]);

export type PullRequestQualificationStatus =
  | "needs_attention"
  | "in_progress"
  | "observed"
  | "unknown";

export type PullRequestSignalKind =
  | "draft"
  | "hold"
  | "dependency"
  | "hold_stale"
  | "merge_conflict"
  | "mergeable_true"
  | "mergeable_unknown"
  | "review_changes_requested"
  | "review_changes_requested_stale"
  | "review_changes_requested_without_authority"
  | "review_approved"
  | "review_none"
  | "review_coverage"
  | "required_check_failed"
  | "required_check_action_required"
  | "required_check_pending"
  | "required_check_unknown"
  | "check_failed_not_proven_required"
  | "check_pending"
  | "check_failed_not_required"
  | "gate_recovered"
  | "checks_no_actions"
  | "checks_coverage"
  | "pr_merged"
  | "pr_closed"
  | "coverage_gap";

export interface PullRequestSignal {
  kind: PullRequestSignalKind;
  status: PullRequestQualificationStatus;
  detail: string;
  evidence: QualificationEvidence[];
  priority: CandidatePriority | null;
  /**
   * A real blocker can be suppressed by a Draft or an explicit Hold. The
   * signal still records the raw evidence, but it is not a human todo.
   */
  suppressedBy?: "draft" | "hold";
}

export interface PullRequestHoldEvidence {
  repository: string;
  number: number;
  kind: "hold" | "dependency";
  /**
   * Optional SHA scope. When supplied and different from the current head, the
   * evidence is stale rather than silently applied to new code.
   */
  headSha?: string | null;
  reason: string;
  source: string;
  observedAt: string;
  url?: string | null;
}

export interface PullRequestReviewSummary {
  decision: "changes_requested" | "approved" | "none" | "unknown";
  decisionAppliesToCurrentHead: boolean | null;
  maintainerAuthority: boolean | null;
  reviewersObserved: number;
  botReviewsIgnored: number;
  dismissedReviews: number;
  unverifiableChangesRequested: number;
  truncated: boolean;
  state: PullRequestFactsSnapshot["reviews"]["state"];
  effectiveReview: {
    id: number;
    login: string;
    userType: string | null;
    state: string;
    commitId: string | null;
    submittedAt: string | null;
    authorAssociation: string | null;
    htmlUrl: string | null;
    appliesToCurrentHead: boolean;
    maintainerAuthority: boolean;
  } | null;
}

export interface PullRequestCheckSummary {
  requiredByGithub: "unknown" | "observed";
  requiredSource: string | null;
  requiredObservedAt: string | null;
  state: PullRequestFactsSnapshot["headWorkflowRuns"]["state"];
  truncated: boolean;
  workflows: GateWorkflowAssessment[];
  failingRequired: string[];
  actionRequired: string[];
  pendingRequired: string[];
  unknownRequired: string[];
  failedNotProvenRequired: string[];
}

export interface PullRequestHoldSummary {
  active: boolean;
  kind: "hold" | "dependency" | null;
  source: string | null;
  observedAt: string | null;
  reason: string | null;
  stale: boolean;
}

export interface PullRequestQualification {
  apiVersion: "v1";
  source: "github-pr-derivation";
  generatedAt: string;
  factsGeneratedAt: string;
  factsStatus: PullRequestFactsSnapshot["status"];
  id: string;
  repository: string;
  number: number;
  status: PullRequestQualificationStatus;
  classification: "attention" | "in_progress" | "unknown" | "observation";
  priority: CandidatePriority | null;
  who: string;
  what: string;
  whyNow: string;
  nextStep: string;
  evidence: QualificationEvidence[];
  observedAt: string | null;
  exitCondition: string;
  state: string | null;
  draft: boolean | null;
  merged: boolean | null;
  baseRef: string | null;
  headSha: string | null;
  mergeable: boolean | null;
  mergeableState: string | null;
  review: PullRequestReviewSummary;
  checks: PullRequestCheckSummary;
  hold: PullRequestHoldSummary;
  signals: PullRequestSignal[];
  coverage: {
    status: "complete" | "partial" | "unavailable";
    reasons: string[];
    truncatedSources: string[];
  };
  warnings: string[];
}

export interface PullRequestQualificationOptions {
  hold?: PullRequestHoldEvidence | null;
  requiredChecks?: readonly RequiredCheckEvidence[];
  now?: number;
}

const CLASSIFICATION: Record<
  PullRequestQualification["status"],
  PullRequestQualification["classification"]
> = {
  needs_attention: "attention",
  in_progress: "in_progress",
  observed: "observation",
  unknown: "unknown",
};

const PRIORITY_RANK: Record<CandidatePriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

function iso(now: number): string {
  return new Date(now).toISOString();
}

function shortName(repository: string): string {
  return repository.startsWith(`${ORG}/`) ? repository.slice(ORG.length + 1) : repository;
}

function commitUrl(repository: string, sha: string | null): string | null {
  return sha ? `https://github.com/${repository}/commit/${sha}` : null;
}

function reviewTime(review: PullRequestReviewFact): number {
  if (!review.submittedAt) return 0;
  const parsed = Date.parse(review.submittedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newerReview(a: PullRequestReviewFact, b: PullRequestReviewFact): number {
  return reviewTime(a) - reviewTime(b) || a.id - b.id;
}

function hasMaintainerAuthority(review: PullRequestReviewFact): boolean {
  if (review.userType === "Bot") return false;
  return review.authorAssociation !== null &&
    MAINTAINER_ASSOCIATIONS.has(review.authorAssociation);
}

function reviewEvidence(
  repository: string,
  review: PullRequestReviewFact,
): QualificationEvidence[] {
  const evidence: QualificationEvidence[] = [];
  if (review.htmlUrl) {
    evidence.push({
      label: `${review.state} review #${review.id} by @${review.login}`,
      url: review.htmlUrl,
      observedAt: review.submittedAt,
    });
  }
  const commit = commitUrl(repository, review.commitId);
  if (commit) {
    evidence.push({
      label: `Review commit ${review.commitId}`,
      url: commit,
      observedAt: review.submittedAt,
    });
  }
  return evidence;
}

function emptyReviewSummary(): PullRequestReviewSummary {
  return {
    decision: "unknown",
    decisionAppliesToCurrentHead: null,
    maintainerAuthority: null,
    reviewersObserved: 0,
    botReviewsIgnored: 0,
    dismissedReviews: 0,
    unverifiableChangesRequested: 0,
    truncated: false,
    state: "unavailable",
    effectiveReview: null,
  };
}

function effectiveReviewView(
  review: PullRequestReviewFact,
  headSha: string,
): NonNullable<PullRequestReviewSummary["effectiveReview"]> {
  return {
    id: review.id,
    login: review.login,
    userType: review.userType,
    state: review.state,
    commitId: review.commitId,
    submittedAt: review.submittedAt,
    authorAssociation: review.authorAssociation,
    htmlUrl: review.htmlUrl,
    appliesToCurrentHead: review.commitId !== null && review.commitId === headSha,
    maintainerAuthority: hasMaintainerAuthority(review),
  };
}

function assessReviews(
  facts: PullRequestFactsSnapshot,
  detail: PullRequestDetailFact,
): { summary: PullRequestReviewSummary; signals: PullRequestSignal[] } {
  const signals: PullRequestSignal[] = [];
  const reviews = facts.reviews;
  const summary = emptyReviewSummary();
  summary.state = reviews.state;
  summary.truncated = reviews.truncated;

  if (reviews.state !== "observed") {
    signals.push({
      kind: "review_coverage",
      status: "unknown",
      detail: `Review history is ${reviews.state}; a current change request cannot be proven or ruled out.`,
      evidence: [
        {
          label: `Review query ${reviews.query.status}`,
          url: null,
          observedAt: reviews.query.fetchedAt,
        },
      ],
      priority: null,
    });
    return { summary, signals };
  }

  // GitHub evaluates a reviewer's latest substantive review. COMMENTED/PENDING
  // reviews do not clear an earlier CHANGES_REQUESTED; APPROVED and DISMISSED do.
  const byReviewer = new Map<string, PullRequestReviewFact>();
  for (const review of reviews.items) {
    if (review.userType === "Bot") {
      summary.botReviewsIgnored += 1;
      continue;
    }
    if (review.state === "DISMISSED") {
      summary.dismissedReviews += 1;
    }
    if (!DECISION_REVIEW_STATES.has(review.state)) continue;
    const key = review.login.toLowerCase();
    const existing = byReviewer.get(key);
    if (!existing || newerReview(review, existing) > 0) {
      byReviewer.set(key, review);
    }
  }

  const decisions = [...byReviewer.values()];
  summary.reviewersObserved = decisions.length;
  const changesRequested = decisions.filter(
    (review) => review.state === "CHANGES_REQUESTED",
  );
  const approvals = decisions.filter((review) => review.state === "APPROVED");

  let blocking: PullRequestReviewFact | null = null;
  let stale: PullRequestReviewFact | null = null;
  let withoutAuthority: PullRequestReviewFact | null = null;

  for (const review of changesRequested) {
    const applies = review.commitId !== null && review.commitId === detail.headSha;
    const authority = hasMaintainerAuthority(review);
    const evidence = reviewEvidence(facts.repository, review);
    if (!applies) {
      summary.unverifiableChangesRequested += 1;
      stale ??= review;
      signals.push({
        kind: "review_changes_requested_stale",
        status: "unknown",
        detail: `@${review.login} requested changes on commit ${review.commitId ?? "unknown"}, not the current head ${detail.headSha}. GitHub's stale-review dismissal configuration is unreadable, so this is unknown rather than a confirmed blocker or a cleared review.`,
        evidence,
        priority: null,
      });
      continue;
    }
    if (!authority) {
      withoutAuthority ??= review;
      signals.push({
        kind: "review_changes_requested_without_authority",
        status: "observed",
        detail: `@${review.login} requested changes on the current head, but author_association=${review.authorAssociation ?? "unknown"} is not maintainer/reviewer authority. It is not presented as a maintainer action.`,
        evidence,
        priority: null,
      });
      continue;
    }
    blocking ??= review;
    signals.push({
      kind: "review_changes_requested",
      status: "needs_attention",
      detail: `Maintainer @${review.login} requested changes on the current head ${detail.headSha}.`,
      evidence,
      priority: "P1",
    });
  }

  if (blocking) {
    summary.decision = "changes_requested";
    summary.decisionAppliesToCurrentHead = true;
    summary.maintainerAuthority = true;
    summary.effectiveReview = effectiveReviewView(blocking, detail.headSha);
  } else if (stale) {
    summary.decision = "changes_requested";
    summary.decisionAppliesToCurrentHead = false;
    summary.maintainerAuthority = hasMaintainerAuthority(stale);
    summary.effectiveReview = effectiveReviewView(stale, detail.headSha);
  } else if (approvals.length > 0) {
    const current = approvals.find(
      (review) => review.commitId !== null && review.commitId === detail.headSha,
    );
    summary.decision = "approved";
    summary.decisionAppliesToCurrentHead = Boolean(current);
    summary.maintainerAuthority = current ? hasMaintainerAuthority(current) : null;
    summary.effectiveReview = effectiveReviewView(current ?? approvals[0], detail.headSha);
    if (current) {
      signals.push({
        kind: "review_approved",
        status: "observed",
        detail: `@${current.login} approved the current head ${detail.headSha}. An approval does not prove required-check or mergeability status.`,
        evidence: reviewEvidence(facts.repository, current),
        priority: null,
      });
    }
  } else if (withoutAuthority) {
    summary.decision = "none";
    summary.decisionAppliesToCurrentHead = null;
    summary.maintainerAuthority = false;
    summary.effectiveReview = effectiveReviewView(withoutAuthority, detail.headSha);
  } else if (reviews.truncated) {
    summary.decision = "unknown";
    signals.push({
      kind: "review_coverage",
      status: "unknown",
      detail:
        "The bounded review window was truncated and no effective decision was observed; an older change request may be outside this window.",
      evidence: [
        {
          label: `Review history truncated at ${reviews.items.length} entries`,
          url: null,
          observedAt: reviews.observedAt,
        },
      ],
      priority: null,
    });
  } else {
    summary.decision = "none";
    summary.decisionAppliesToCurrentHead = null;
    signals.push({
      kind: "review_none",
      status: "observed",
      detail: "No effective human review decision was observed for this PR.",
      evidence: [
        {
          label: "Review list observed with no decision-changing review",
          url: null,
          observedAt: reviews.observedAt,
        },
      ],
      priority: null,
    });
  }

  if (reviews.truncated) {
    if (!signals.some((signal) => signal.kind === "review_coverage")) {
      signals.push({
        kind: "review_coverage",
        status: "unknown",
        detail:
          "The bounded review window is truncated; the newest review decision may be outside it. A change request inside this window is not promoted to attention because a later approval/dismissal cannot be ruled out.",
        evidence: [
          {
            label: `Review history truncated at ${reviews.items.length} entries`,
            url: null,
            observedAt: reviews.observedAt,
          },
        ],
        priority: null,
      });
    }
    for (const signal of signals) {
      if (signal.kind === "review_changes_requested") {
        signal.kind = "review_coverage";
        signal.status = "unknown";
        signal.priority = null;
        signal.detail =
          "A current-head change request was observed, but a truncated review window cannot prove it is the latest decision.";
      }
    }
    summary.decision = "unknown";
    summary.decisionAppliesToCurrentHead = null;
    summary.maintainerAuthority = null;
  }

  return { summary, signals };
}

function workflowFile(run: PilotWorkflowRunFact): string | null {
  if (!run.path) return null;
  const file = run.path.split("/").pop();
  return file && file.length > 0 ? file : null;
}

function groupWorkflowRuns(
  facts: PullRequestFactsSnapshot,
): { workflows: PilotWorkflowFact[]; unassignedRuns: number } {
  const grouped = new Map<string, { label: string; runs: PilotWorkflowRunFact[] }>();
  let unassignedRuns = 0;
  for (const run of facts.headWorkflowRuns.items) {
    const file = workflowFile(run);
    if (!file) {
      unassignedRuns += 1;
      continue;
    }
    const existing = grouped.get(file);
    if (existing) {
      existing.runs.push(run);
    } else {
      grouped.set(file, { label: run.name, runs: [run] });
    }
  }
  const workflows: PilotWorkflowFact[] = [...grouped.entries()]
    .map(([file, value]) => ({
      file,
      label: value.label,
      state: facts.headWorkflowRuns.state,
      runs: value.runs,
      totalCount: value.runs.length,
      observedAt: facts.headWorkflowRuns.observedAt,
      query: facts.headWorkflowRuns.query,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
  return { workflows, unassignedRuns };
}

function requiredEvidenceFor(
  requiredChecks: readonly RequiredCheckEvidence[] | undefined,
  repository: string,
  branch: string | null,
): RequiredCheckEvidence | null {
  if (!requiredChecks || !branch) return null;
  return (
    requiredChecks.find(
      (entry) =>
        shortName(entry.repository) === shortName(repository) &&
        entry.branch === branch,
    ) ?? null
  );
}

function assessChecks(
  facts: PullRequestFactsSnapshot,
  detail: PullRequestDetailFact,
  requiredChecks: readonly RequiredCheckEvidence[] | undefined,
): { summary: PullRequestCheckSummary; signals: PullRequestSignal[] } {
  const signals: PullRequestSignal[] = [];
  const requiredFiles = requiredWorkflowFilesFor(
    facts.repository,
    detail.baseRef,
    requiredChecks,
  );
  const requiredEvidence = requiredEvidenceFor(
    requiredChecks,
    facts.repository,
    detail.baseRef,
  );
  const { workflows, unassignedRuns } = groupWorkflowRuns(facts);
  const assessed = assessWorkflowsForSha(
    workflows,
    detail.headSha,
    requiredFiles,
    detail.headRef,
  );

  const summary: PullRequestCheckSummary = {
    requiredByGithub: requiredFiles === null ? "unknown" : "observed",
    requiredSource: requiredEvidence?.source ?? null,
    requiredObservedAt: requiredEvidence?.observedAt ?? null,
    state: facts.headWorkflowRuns.state,
    truncated: facts.headWorkflowRuns.truncated,
    workflows: assessed,
    failingRequired: [],
    actionRequired: [],
    pendingRequired: [],
    unknownRequired: [],
    failedNotProvenRequired: [],
  };

  if (facts.headWorkflowRuns.state !== "observed") {
    signals.push({
      kind: "checks_coverage",
      status: "unknown",
      detail: `Head workflow-run history is ${facts.headWorkflowRuns.state}; required-check status cannot be proven.`,
      evidence: [
        {
          label: `Head workflow-run query ${facts.headWorkflowRuns.query.status}`,
          url: null,
          observedAt: facts.headWorkflowRuns.query.fetchedAt,
        },
      ],
      priority: null,
    });
    return { summary, signals };
  }

  if (unassignedRuns > 0) {
    signals.push({
      kind: "checks_coverage",
      status: "unknown",
      detail: `${unassignedRuns} head workflow run(s) had no workflow path and could not be matched to an OPS-033 workflow identity.`,
      evidence: [
        {
          label: "Unassigned workflow runs",
          url: null,
          observedAt: facts.headWorkflowRuns.observedAt,
        },
      ],
      priority: null,
    });
  }

  // The GitHub-required workflow set describes expected checks, not merely
  // checks that happened to appear in the bounded head-SHA run list. A missing
  // required workflow is *unknown*, never a successful/empty observation.
  if (requiredFiles) {
    const seen = new Set(assessed.map((workflow) => workflow.file));
    for (const file of requiredFiles) {
      if (seen.has(file)) continue;
      summary.unknownRequired.push(file);
      signals.push({
        kind: "required_check_unknown",
        status: "unknown",
        detail: `Required workflow ${file} has no observed run for this PR head ref ${detail.headRef} and SHA ${detail.headSha}; this is not a proven pass.`,
        evidence: [
          {
            label: `Required workflow ${file}: ${requiredEvidence?.source ?? "trusted source"}`,
            url: null,
            observedAt: requiredEvidence?.observedAt ?? facts.generatedAt,
          },
          {
            label: `PR #${detail.number} head`,
            url: detail.htmlUrl,
            observedAt: detail.updatedAt,
          },
        ],
        priority: null,
      });
    }
  }

  // SHA-only queries may include Runs of other refs or trigger types. The
  // shared OPS-035 assessor drops those from applicableRun; preserve this
  // uncertainty visibly rather than describing the PR as having passed checks.
  const unmatched = assessed.filter(
    (workflow) =>
      workflows.some((source) => source.file === workflow.file && source.runs.length > 0) &&
      workflow.applicableRun === null,
  );
  if (unmatched.length > 0) {
    signals.push({
      kind: "checks_coverage",
      status: "unknown",
      detail: `${unmatched.length} workflow(s) have SHA-matching runs but no run with the current PR head ref and applicable event; these runs cannot prove this PR's Gate status.`,
      evidence: unmatched.flatMap((workflow) =>
        workflow.latestRun
          ? [{
              label: `Excluded ${workflow.label} Run #${workflow.latestRun.id}`,
              url: workflow.latestRun.htmlUrl,
              observedAt: workflow.latestRun.updatedAt,
            }]
          : [],
      ),
      priority: null,
    });
  }

  if (assessed.length === 0 && unassignedRuns === 0) {
    signals.push({
      kind: "checks_no_actions",
      status: "observed",
      detail:
        "No GitHub Actions workflow run was observed on the current head. This does not prove that non-Actions required checks passed.",
      evidence: [
        {
          label: "Head workflow-run list observed with zero runs",
          url: null,
          observedAt: facts.headWorkflowRuns.observedAt,
        },
      ],
      priority: null,
    });
    return { summary, signals };
  }

  for (const workflow of assessed) {
    const evidence: QualificationEvidence[] = [];
    if (workflow.applicableRun) {
      evidence.push({
        label: `${workflow.label} Run #${workflow.applicableRun.id} attempt ${workflow.applicableRun.attempt}`,
        url: workflow.applicableRun.htmlUrl,
        observedAt: workflow.applicableRun.updatedAt,
      });
    }
    const commit = commitUrl(facts.repository, detail.headSha);
    if (commit) {
      evidence.push({
        label: `PR head commit ${detail.headSha}`,
        url: commit,
        observedAt: null,
      });
    }

    if (workflow.required === "observed_required") {
      if (workflow.outcome === "failure") {
        summary.failingRequired.push(workflow.file);
        signals.push({
          kind: "required_check_failed",
          status: "needs_attention",
          detail: `${workflow.label} is a proven required workflow and failed on the current head ${detail.headSha}.`,
          evidence,
          priority: "P1",
        });
      } else if (workflow.outcome === "action_required") {
        summary.actionRequired.push(workflow.file);
        signals.push({
          kind: "required_check_action_required",
          status: "needs_attention",
          detail: `${workflow.label} is required and needs an approval/manual action on the current head ${detail.headSha}.`,
          evidence,
          priority: "P2",
        });
      } else if (workflow.outcome === "running") {
        summary.pendingRequired.push(workflow.file);
        signals.push({
          kind: "required_check_pending",
          status: "in_progress",
          detail: `${workflow.label} is required and still running on the current head.`,
          evidence,
          priority: null,
        });
      } else if (workflow.outcome === "unknown") {
        summary.unknownRequired.push(workflow.file);
        signals.push({
          kind: "required_check_unknown",
          status: "unknown",
          detail: `${workflow.label} is required but has no readable applicable attempt on the current head.`,
          evidence,
          priority: "P3",
        });
      } else if (
        workflow.outcome === "neutral" ||
        workflow.outcome === "cancelled" ||
        workflow.outcome === "skipped"
      ) {
        summary.unknownRequired.push(workflow.file);
        signals.push({
          kind: "required_check_unknown",
          status: "unknown",
          detail: `${workflow.label} is required but completed as ${workflow.outcome}; that is not a decisive required-check pass.`,
          evidence,
          priority: "P3",
        });
      }
    } else if (workflow.required === "unknown") {
      if (workflow.outcome === "failure" || workflow.outcome === "action_required") {
        summary.failedNotProvenRequired.push(workflow.file);
        signals.push({
          kind: "check_failed_not_proven_required",
          status: "unknown",
          detail: `${workflow.label} reports ${workflow.outcome} on the current head, but GitHub required-check evidence is unavailable. It is not presented as a confirmed required gate.`,
          evidence,
          priority: null,
        });
      } else if (workflow.outcome === "running") {
        signals.push({
          kind: "check_pending",
          status: "in_progress",
          detail: `${workflow.label} is still running on the current head; required-check necessity is unknown.`,
          evidence,
          priority: null,
        });
      }
    } else if (
      workflow.outcome === "failure" ||
      workflow.outcome === "action_required"
    ) {
      signals.push({
        kind: "check_failed_not_required",
        status: "observed",
        detail: `${workflow.label} reports ${workflow.outcome}, but the supplied required-check evidence marks it as not required.`,
        evidence,
        priority: null,
      });
    }

    if (workflow.recovered) {
      signals.push({
        kind: "gate_recovered",
        status: "observed",
        detail: `${workflow.label} recovered on the same head SHA after an earlier failed attempt; the old failure is archive evidence only.`,
        evidence,
        priority: null,
      });
    }
  }

  if (facts.headWorkflowRuns.truncated) {
    signals.push({
      kind: "checks_coverage",
      status: "unknown",
      detail:
        "The bounded head workflow-run window was truncated; a required workflow missing from this window is unknown, not green.",
      evidence: [
        {
          label: `Head workflow-run history truncated at ${facts.headWorkflowRuns.items.length} runs`,
          url: null,
          observedAt: facts.headWorkflowRuns.observedAt,
        },
      ],
      priority: null,
    });
  }

  // Missing required-check evidence does not by itself make an otherwise
  // healthy PR a blocker. It does prevent a workflow failure from being
  // promoted to a proven required gate; that is handled above and reported in
  // checks.requiredByGithub plus the top-level warning.
  return { summary, signals };
}

function assessHold(
  evidence: PullRequestHoldEvidence | null | undefined,
  facts: PullRequestFactsSnapshot,
  detail: PullRequestDetailFact,
): { summary: PullRequestHoldSummary; signal: PullRequestSignal | null } {
  const inactive: PullRequestHoldSummary = {
    active: false,
    kind: null,
    source: null,
    observedAt: null,
    reason: null,
    stale: false,
  };
  if (!evidence) return { summary: inactive, signal: null };
  if (
    shortName(evidence.repository) !== shortName(facts.repository) ||
    evidence.number !== facts.number
  ) {
    return { summary: inactive, signal: null };
  }

  const url = evidence.url ?? null;
  const evidenceRows: QualificationEvidence[] = [
    {
      label: `Trusted ${evidence.kind} evidence (${evidence.source})`,
      url,
      observedAt: evidence.observedAt,
    },
  ];

  if (evidence.headSha && evidence.headSha !== detail.headSha) {
    return {
      summary: {
        active: false,
        kind: evidence.kind,
        source: evidence.source,
        observedAt: evidence.observedAt,
        reason: evidence.reason,
        stale: true,
      },
      signal: {
        kind: "hold_stale",
        status: "unknown",
        detail: `Trusted ${evidence.kind} evidence targets head ${evidence.headSha}, not the current head ${detail.headSha}; its applicability is unknown, not an active hold.`,
        evidence: evidenceRows,
        priority: null,
      },
    };
  }

  return {
    summary: {
      active: true,
      kind: evidence.kind,
      source: evidence.source,
      observedAt: evidence.observedAt,
      reason: evidence.reason,
      stale: false,
    },
    signal: {
      kind: evidence.kind,
      status: evidence.kind === "dependency" ? "in_progress" : "observed",
      detail: `Trusted ${evidence.kind} evidence: ${evidence.reason}`,
      evidence: evidenceRows,
      priority: null,
    },
  };
}

function pickPriority(signals: PullRequestSignal[]): CandidatePriority | null {
  const priorities = signals
    .filter((signal) => signal.status === "needs_attention" && signal.priority)
    .map((signal) => signal.priority as CandidatePriority);
  if (priorities.length === 0) return null;
  return priorities.sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0];
}

function uniqueEvidence(rows: QualificationEvidence[]): QualificationEvidence[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}|${row.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function primarySignals(
  status: PullRequestQualificationStatus,
  signals: PullRequestSignal[],
): PullRequestSignal[] {
  const wanted =
    status === "needs_attention"
      ? ["needs_attention"]
      : status === "in_progress"
        ? ["in_progress"]
        : status === "unknown"
          ? ["unknown"]
          : ["observed"];
  const matches = signals.filter((signal) => wanted.includes(signal.status));
  return matches.length > 0 ? matches : signals.slice(0, 1);
}

function whyNowFor(
  status: PullRequestQualificationStatus,
  detail: PullRequestDetailFact,
  hold: PullRequestHoldSummary,
): string {
  if (hold.active) {
    return `An explicit trusted ${hold.kind ?? "hold"} is recorded, so this PR is intentionally waiting rather than a maintainer todo.`;
  }
  if (detail.draft) {
    return "This PR is intentionally Draft. Draft itself is work-in-progress noise, not a merge blocker requiring maintainer action.";
  }
  switch (status) {
    case "needs_attention":
      return "The PR is open and not Draft/Hold, and the evidence below is a concrete merge blocker with a maintainer/reviewer next step.";
    case "in_progress":
      return "Work is still in progress; no human action is proven yet.";
    case "unknown":
      return "The available public evidence is insufficient to prove a blocker or to prove there is none. Unknown is not a todo count.";
    case "observed":
      return "No maintainer-actionable merge blocker was proven from the current evidence.";
  }
}

function nextStepFor(
  status: PullRequestQualificationStatus,
  signals: PullRequestSignal[],
  detail: PullRequestDetailFact,
  hold: PullRequestHoldSummary,
): string {
  if (hold.active) {
    return "No maintainer action while the explicit hold/dependency remains sourced; re-read the same PR after that evidence changes.";
  }
  if (detail.draft) {
    return "No maintainer action while the PR remains Draft; wait for the author to mark it ready or supply explicit hold evidence.";
  }
  const kinds = new Set(signals.map((signal) => signal.kind));
  if (kinds.has("merge_conflict")) {
    return "Resolve the real merge conflict on the current head, push the new head, and re-read mergeability for that new SHA.";
  }
  if (kinds.has("review_changes_requested")) {
    return "Open the current change-request review, address it on the current head, or dismiss it with maintainer authority; re-read the new head afterwards.";
  }
  if (
    kinds.has("required_check_failed") ||
    kinds.has("required_check_action_required")
  ) {
    return "Open the failed/action-required required check, fix or approve the current head, and confirm a new attempt on the same or newer SHA.";
  }
  if (status === "in_progress") {
    return "Wait for the current run or author action; re-read the same PR and head SHA instead of escalating a pending state.";
  }
  if (status === "unknown") {
    return "Re-read the same PR later, obtain the missing read permission/required-check evidence, or inspect the original GitHub evidence; do not turn unknown into a blocker count.";
  }
  return "No action; re-read only if the PR head, Draft state, hold evidence, reviews or checks change.";
}

function whatFor(signals: PullRequestSignal[], detail: PullRequestDetailFact): string {
  if (signals.length === 0) {
    return `${detail.state === "open" ? "Open" : detail.state} PR has no blocker signal in the current evidence.`;
  }
  return signals.map((signal) => signal.detail).join(" ");
}

function exitConditionFor(status: PullRequestQualificationStatus): string {
  switch (status) {
    case "needs_attention":
      return "The current head's conflict/review/required-check blocker is cleared by a newer head, a valid review update/dismissal, a successful required attempt on the same target, or the PR is merged/closed.";
    case "in_progress":
      return "The pending run/review reaches a terminal state, or the head/Draft/hold evidence changes; re-read the same PR.";
    case "unknown":
      return "The missing mergeability, review authority/commit applicability, required-check evidence or readable source becomes available for the same head.";
    case "observed":
      return "Already no maintainer-actionable blocker; exits only if the PR head, Draft/hold evidence, review or checks later produce a blocker.";
  }
}

export function qualifyPullRequest(
  facts: PullRequestFactsSnapshot,
  options: PullRequestQualificationOptions = {},
): PullRequestQualification {
  const now = options.now ?? Date.now();
  const detail = facts.detail;
  const warnings = [...facts.warnings];
  const baseReview = emptyReviewSummary();
  const baseChecks: PullRequestCheckSummary = {
    requiredByGithub: "unknown",
    requiredSource: null,
    requiredObservedAt: null,
    state: facts.headWorkflowRuns.state,
    truncated: facts.headWorkflowRuns.truncated,
    workflows: [],
    failingRequired: [],
    actionRequired: [],
    pendingRequired: [],
    unknownRequired: [],
    failedNotProvenRequired: [],
  };
  const baseHold: PullRequestHoldSummary = {
    active: false,
    kind: null,
    source: null,
    observedAt: null,
    reason: null,
    stale: false,
  };

  if (!detail) {
    const signals: PullRequestSignal[] = [
      {
        kind: "coverage_gap",
        status: "unknown",
        detail: `PR detail is unavailable (${facts.reviews.query.status}/${facts.headWorkflowRuns.query.status}). Mergeability, reviews and checks are unknown, not zero.`,
        evidence: [
          {
            label: `PR detail query ${facts.coverage.status}`,
            url: null,
            observedAt: facts.generatedAt,
          },
        ],
        priority: null,
      },
    ];
    return {
      apiVersion: "v1",
      source: "github-pr-derivation",
      generatedAt: iso(now),
      factsGeneratedAt: facts.generatedAt,
      factsStatus: facts.status,
      id: `pr:${facts.repository}#${facts.number}`,
      repository: facts.repository,
      number: facts.number,
      status: "unknown",
      classification: "unknown",
      priority: null,
      who: `${facts.repository} maintainers`,
      what: `PR #${facts.number} detail is unreadable or not computed.`,
      whyNow: whyNowFor("unknown", {
        number: facts.number,
        title: "",
        state: "unknown",
        draft: false,
        merged: false,
        authorLogin: null,
        authorAssociation: null,
        mergeable: null,
        mergeableState: null,
        baseRef: "",
        headRef: "",
        headSha: "",
        createdAt: facts.generatedAt,
        updatedAt: facts.generatedAt,
        htmlUrl: `https://github.com/${facts.repository}/pull/${facts.number}`,
      }, baseHold),
      nextStep:
        "Re-read the same PR with public read access; do not infer a conflict, review or zero checks from this gap.",
      evidence: [
        {
          label: `PR #${facts.number}`,
          url: `https://github.com/${facts.repository}/pull/${facts.number}`,
          observedAt: facts.generatedAt,
        },
      ],
      observedAt: facts.generatedAt,
      exitCondition: exitConditionFor("unknown"),
      state: null,
      draft: null,
      merged: null,
      baseRef: null,
      headSha: null,
      mergeable: null,
      mergeableState: null,
      review: baseReview,
      checks: baseChecks,
      hold: baseHold,
      signals,
      coverage: {
        status: facts.coverage.status,
        reasons: facts.coverage.reasons,
        truncatedSources: facts.coverage.truncatedSources,
      },
      warnings,
    };
  }

  const signals: PullRequestSignal[] = [];
  const hold = assessHold(options.hold, facts, detail);
  if (hold.signal) signals.push(hold.signal);
  const review = assessReviews(facts, detail);
  const checks = assessChecks(facts, detail, options.requiredChecks);

  if (detail.draft) {
    signals.push({
      kind: "draft",
      status: "observed",
      detail: `PR #${detail.number} is Draft. Draft state suppresses attention even if a conflict, review or check also exists.`,
      evidence: [
        {
          label: `Draft PR #${detail.number}`,
          url: detail.htmlUrl,
          observedAt: detail.updatedAt,
        },
      ],
      priority: null,
    });
  }

  if (detail.merged || detail.state !== "open") {
    signals.push({
      kind: detail.merged ? "pr_merged" : "pr_closed",
      status: "observed",
      detail: detail.merged
        ? `PR #${detail.number} is merged; no merge-blocking work remains.`
        : `PR #${detail.number} is ${detail.state}; no merge-blocking work remains.`,
      evidence: [
        {
          label: `${detail.merged ? "Merged" : "Closed"} PR #${detail.number}`,
          url: detail.htmlUrl,
          observedAt: detail.updatedAt,
        },
      ],
      priority: null,
    });
    const summary: PullRequestQualification = {
      apiVersion: "v1",
      source: "github-pr-derivation",
      generatedAt: iso(now),
      factsGeneratedAt: facts.generatedAt,
      factsStatus: facts.status,
      id: `pr:${facts.repository}#${detail.number}`,
      repository: facts.repository,
      number: detail.number,
      status: "observed",
      classification: "observation",
      priority: null,
      who: `${facts.repository} maintainers`,
      what: signals[signals.length - 1].detail,
      whyNow: whyNowFor("observed", detail, hold.summary),
      nextStep: nextStepFor("observed", signals, detail, hold.summary),
      evidence: uniqueEvidence(signals.flatMap((signal) => signal.evidence)),
      observedAt: facts.generatedAt,
      exitCondition: exitConditionFor("observed"),
      state: detail.state,
      draft: detail.draft,
      merged: detail.merged,
      baseRef: detail.baseRef,
      headSha: detail.headSha,
      mergeable: detail.mergeable,
      mergeableState: detail.mergeableState,
      review: review.summary,
      checks: checks.summary,
      hold: hold.summary,
      signals,
      coverage: {
        status: facts.coverage.status,
        reasons: facts.coverage.reasons,
        truncatedSources: facts.coverage.truncatedSources,
      },
      warnings,
    };
    return summary;
  }

  if (detail.mergeable === false) {
    signals.push({
      kind: "merge_conflict",
      status: "needs_attention",
      detail: `GitHub reports mergeable=false (mergeable_state=${detail.mergeableState ?? "unknown"}) on the current head ${detail.headSha}: a confirmed merge conflict.`,
      evidence: [
        {
          label: `PR #${detail.number} reports a real conflict`,
          url: detail.htmlUrl,
          observedAt: detail.updatedAt,
        },
        ...(commitUrl(facts.repository, detail.headSha)
          ? [
              {
                label: `PR head commit ${detail.headSha}`,
                url: commitUrl(facts.repository, detail.headSha) as string,
                observedAt: null,
              },
            ]
          : []),
      ],
      priority: "P1",
    });
  } else if (detail.mergeable === true) {
    signals.push({
      kind: "mergeable_true",
      status: "observed",
      detail: `GitHub reports mergeable=true on the current head; no merge conflict is proven.`,
      evidence: [
        {
          label: `PR #${detail.number} mergeability`,
          url: detail.htmlUrl,
          observedAt: detail.updatedAt,
        },
      ],
      priority: null,
    });
  } else {
    signals.push({
      kind: "mergeable_unknown",
      status: "unknown",
      detail: `GitHub reports mergeable=null (mergeable_state=${detail.mergeableState ?? "unknown"}). This is "not computed / undecidable", not a confirmed conflict.`,
      evidence: [
        {
          label: `PR #${detail.number} mergeability is still unknown`,
          url: detail.htmlUrl,
          observedAt: detail.updatedAt,
        },
      ],
      priority: null,
    });
  }

  signals.push(...review.signals);
  signals.push(...checks.signals);

  const suppression = hold.summary.active
    ? "hold"
    : detail.draft
      ? "draft"
      : null;
  if (suppression) {
    for (const signal of signals) {
      if (signal.status === "needs_attention") {
        signal.suppressedBy = suppression;
      }
    }
  }

  const activeBlockers = signals.filter(
    (signal) => signal.status === "needs_attention" && !signal.suppressedBy,
  );
  const pending = signals.filter(
    (signal) => signal.status === "in_progress" && !signal.suppressedBy,
  );
  const unknown = signals.filter((signal) => signal.status === "unknown");

  let status: PullRequestQualificationStatus;
  if (hold.summary.active) {
    status = hold.summary.kind === "dependency" ? "in_progress" : "observed";
  } else if (detail.draft) {
    status = "observed";
  } else if (activeBlockers.length > 0) {
    status = "needs_attention";
  } else if (pending.length > 0) {
    status = "in_progress";
  } else if (unknown.length > 0) {
    status = "unknown";
  } else {
    status = "observed";
  }

  if (status === "observed" && !detail.draft && !hold.summary.active) {
    // A recovered/approved/no-review observation is useful, but an absent
    // signal must still produce an explicit observed record.
    if (!signals.some((signal) => signal.status === "observed")) {
      signals.push({
        kind: "review_none",
        status: "observed",
        detail: "No maintainer-actionable merge blocker was observed.",
        evidence: [
          {
            label: `PR #${detail.number}`,
            url: detail.htmlUrl,
            observedAt: detail.updatedAt,
          },
        ],
        priority: null,
      });
    }
  }

  const priority =
    status === "needs_attention" ? pickPriority(activeBlockers) : null;
  const top = primarySignals(status, signals);
  const evidence = uniqueEvidence([
    {
      label: `PR #${detail.number}`,
      url: detail.htmlUrl,
      observedAt: detail.updatedAt,
    },
    ...(commitUrl(facts.repository, detail.headSha)
      ? [
          {
            label: `PR head commit ${detail.headSha}`,
            url: commitUrl(facts.repository, detail.headSha) as string,
            observedAt: null,
          },
        ]
      : []),
    ...top.flatMap((signal) => signal.evidence),
  ]);

  const reviewBlocker = top.find(
    (signal) => signal.kind === "review_changes_requested",
  );
  const reviewerLogin = reviewBlocker?.detail.match(/@([A-Za-z0-9-]+)/)?.[1] ?? null;
  const who = reviewerLogin
    ? `reviewer @${reviewerLogin} / ${facts.repository} maintainers`
    : detail.authorLogin
      ? `PR author @${detail.authorLogin} / ${facts.repository} maintainers`
      : `${facts.repository} maintainers`;

  if (checks.summary.requiredByGithub === "unknown") {
    warnings.push(
      "GitHub required-check configuration is unreadable in this boundary; a failed workflow is not promoted to a proven required gate.",
    );
  }
  if (review.summary.truncated) {
    warnings.push(
      "Review history is bounded/truncated; a decision outside the window stays unknown.",
    );
  }
  if (!options.hold) {
    warnings.push(
      "No trusted hold/dependency evidence was supplied to this projection; absence of hold evidence is not proof that no hold exists.",
    );
  }

  return {
    apiVersion: "v1",
    source: "github-pr-derivation",
    generatedAt: iso(now),
    factsGeneratedAt: facts.generatedAt,
    factsStatus: facts.status,
    id: `pr:${facts.repository}#${detail.number}`,
    repository: facts.repository,
    number: detail.number,
    status,
    classification: CLASSIFICATION[status],
    priority,
    who,
    what: whatFor(top, detail),
    whyNow: whyNowFor(status, detail, hold.summary),
    nextStep: nextStepFor(status, top, detail, hold.summary),
    evidence,
    observedAt: facts.generatedAt,
    exitCondition: exitConditionFor(status),
    state: detail.state,
    draft: detail.draft,
    merged: detail.merged,
    baseRef: detail.baseRef,
    headSha: detail.headSha,
    mergeable: detail.mergeable,
    mergeableState: detail.mergeableState,
    review: review.summary,
    checks: checks.summary,
    hold: hold.summary,
    signals,
    coverage: {
      status: facts.coverage.status,
      reasons: facts.coverage.reasons,
      truncatedSources: facts.coverage.truncatedSources,
    },
    warnings: Array.from(new Set(warnings)),
  };
}
