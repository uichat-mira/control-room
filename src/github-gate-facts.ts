import {
  PILOT_REPOSITORIES,
  type FactSourceState,
  type GitHubFactsSnapshot,
  type PilotRepositoryFacts,
  type PilotWorkflowFact,
  type PilotWorkflowRunFact,
} from "./github-facts.ts";

const ORG = "uichat-mira";

// OPS-035 is a read-only derivation over the bounded OPS-034 snapshot. It must
// never add an upstream read: the six-repository snapshot is the only source.
// The workflow identity list (including releaseWorkflow) is the OPS-033 pilot
// allowlist, not a claim that GitHub enforces any of these checks.

export type GateRunOutcome =
  | "success"
  | "failure"
  | "action_required"
  | "running"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "unknown";

export type GateCoverage = "complete" | "partial" | "unknown";

export type RequiredState =
  | "unknown"
  | "observed_required"
  | "observed_not_required";

export type CandidateClassification =
  | "attention"
  | "in_progress"
  | "unknown"
  | "observation";

export type CandidatePriority = "P0" | "P1" | "P2" | "P3";

export interface QualificationEvidence {
  label: string;
  url: string | null;
  observedAt: string | null;
}

export interface GateRunEvidence {
  id: number;
  attempt: number;
  event: string | null;
  status: string;
  conclusion: string | null;
  headBranch: string | null;
  headSha: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface GateWorkflowAssessment {
  file: string;
  label: string;
  workflowState: FactSourceState;
  required: RequiredState;
  applicableRun: GateRunEvidence | null;
  // The newest Run for this workflow regardless of branch/SHA. It is kept as
  // archive evidence so a historical failure is not mistaken for the target.
  latestRun: GateRunEvidence | null;
  earlierFailedAttempts: number;
  recovered: boolean;
  outcome: GateRunOutcome;
  reason: string;
  truncated: boolean;
}

export interface RepositoryGateAssessment {
  repository: string;
  effectiveBranch: string | null;
  targetSha: string | null;
  branchState: FactSourceState;
  requiredByGithub: "unknown" | "observed";
  requiredByWorkflow: "unknown" | "candidate";
  outcome: GateRunOutcome;
  outcomeMeaning: "decisive" | "pending" | "insufficient";
  coverage: GateCoverage;
  coverageReasons: string[];
  workflows: GateWorkflowAssessment[];
}

export type ReleaseStatus =
  | "succeeded"
  | "failed"
  | "action_required"
  | "running"
  | "not_observed"
  | "unknown";

export type ProductionStatus =
  | "verified"
  | "unverified"
  | "mismatch"
  | "unhealthy";

export interface RepositoryReleaseAssessment {
  repository: string;
  branch: "prod";
  targetSha: string | null;
  branchState: FactSourceState;
  workflowFile: string | null;
  releaseRun: GateRunEvidence | null;
  releaseStatus: ReleaseStatus;
  releaseRecovered: boolean;
  production: {
    status: ProductionStatus;
    expectedSha: string | null;
    observedSha: string | null;
    healthy: boolean | null;
    source: string | null;
    observedAt: string | null;
    url: string | null;
    note: string;
  };
}

export interface QualificationCandidate {
  id: string;
  category: "actions_gate" | "deployment";
  classification: CandidateClassification;
  priority: CandidatePriority | null;
  who: string;
  what: string;
  whyNow: string;
  nextStep: string;
  evidence: QualificationEvidence[];
  observedAt: string | null;
  exitCondition: string;
  repository: string;
  branch: string | null;
  headSha: string | null;
  workflowFile: string | null;
  runId: number | null;
  attempt: number | null;
}

export interface RepositoryQualification {
  repository: string;
  gate: RepositoryGateAssessment;
  release: RepositoryReleaseAssessment;
  candidates: QualificationCandidate[];
}

export interface GitHubGateQualificationSnapshot {
  apiVersion: "v1";
  source: "github-facts-derivation";
  generatedAt: string;
  factsGeneratedAt: string;
  factsStatus: GitHubFactsSnapshot["status"];
  requiredCheckEvidence: "unavailable" | "supplied";
  productionEvidence: "unavailable" | "supplied" | "partial";
  coverage: {
    status: "complete" | "partial" | "unknown";
    repositoriesPlanned: number;
    repositoriesAssessed: number;
    gateDecisive: number;
    gateUnknown: number;
    productionVerified: number;
    productionUnverified: number;
    reasons: string[];
  };
  repositories: RepositoryQualification[];
  candidates: QualificationCandidate[];
  warnings: string[];
}

/**
 * Explicit, caller-supplied evidence that GitHub actually requires these
 * workflow checks on a branch. The default is `undefined`: branch protection
 * and ruleset detail reads currently return 403, so the projection must report
 * `required_by_github: unknown` rather than invent a required set.
 */
export interface RequiredCheckEvidence {
  repository: string;
  branch: string;
  workflowFiles: readonly string[];
  source: string;
  observedAt: string;
}

/**
 * Explicit production observation. A deploy workflow success is not this
 * evidence. `healthy` is a smoke result for `observedSha`, and `expectedSha`
 * defaults to the observed prod branch SHA.
 */
export interface ProductionEvidence {
  repository: string;
  branch?: string;
  expectedSha?: string | null;
  observedSha: string | null;
  healthy: boolean | null;
  source: string;
  observedAt: string | null;
  url?: string | null;
}

export interface GateQualificationOptions {
  requiredChecks?: readonly RequiredCheckEvidence[];
  production?: readonly ProductionEvidence[];
  now?: number;
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

function shortName(repository: string): string {
  return repository.startsWith(`${ORG}/`) ? repository.slice(ORG.length + 1) : repository;
}

function commitUrl(repository: string, sha: string | null): string | null {
  return sha ? `https://github.com/${repository}/commit/${sha}` : null;
}

function runEvidence(run: PilotWorkflowRunFact): GateRunEvidence {
  return {
    id: run.id,
    attempt: run.attempt,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    headBranch: run.headBranch,
    headSha: run.headSha,
    htmlUrl: run.htmlUrl,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function runTime(run: PilotWorkflowRunFact): number {
  const parsed = Date.parse(run.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(a: PilotWorkflowRunFact, b: PilotWorkflowRunFact): number {
  // run_attempt is scoped to one Run ID. A newer Run with attempt=1 can
  // supersede an older Run with attempt=2 on the same branch and SHA.
  // updated_at is the observation of the last execution/re-run; Run ID and
  // attempt provide a stable tie-break without treating attempt as global.
  return runTime(b) - runTime(a) || b.id - a.id || b.attempt - a.attempt;
}

// An issue_comment Run is an External Worker dispatch/skip signal, never a
// necessary Gate for the target commit. It is retained in `latestRun` as raw
// archive evidence but excluded from applicability.
function isGateEligible(run: PilotWorkflowRunFact): boolean {
  return run.event !== "issue_comment";
}

function outcomeOf(run: PilotWorkflowRunFact | null): GateRunOutcome {
  if (!run) return "unknown";
  return outcomeOfRunEvidence(run.status, run.conclusion);
}

function outcomeOfRunEvidence(status: string, conclusion: string | null): GateRunOutcome {
  if (status === "queued" || status === "in_progress") return "running";
  switch (conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "failure";
    case "action_required":
      return "action_required";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    case "neutral":
      return "neutral";
    default:
      return "unknown";
  }
}

function outcomeReason(outcome: GateRunOutcome, truncated: boolean, observed: boolean): string {
  switch (outcome) {
    case "success":
      return "The target branch/SHA has a completed successful attempt.";
    case "failure":
      return "The latest applicable attempt on the target branch/SHA failed.";
    case "action_required":
      return "The latest applicable attempt needs an approval or manual action.";
    case "running":
      return "An applicable attempt is queued or in progress.";
    case "neutral":
    case "cancelled":
    case "skipped":
      return "The applicable attempt completed without a decisive pass/fail result.";
    case "unknown":
      if (!observed) return "The workflow history was not readable.";
      if (truncated) {
        return "No applicable attempt is inside the bounded 5-Run window; absence is unknown, not healthy.";
      }
      return "No applicable attempt for the target branch/SHA was observed in the bounded window.";
  }
}

function selectWorkflowRuns(
  workflow: PilotWorkflowFact,
  branch: string | null,
  sha: string | null,
): PilotWorkflowRunFact[] {
  if (!branch || !sha) return [];
  return workflow.runs
    .filter(
      (run) =>
        run.headBranch === branch &&
        run.headSha === sha &&
        isGateEligible(run),
    )
    .sort(newestFirst);
}

function assessWorkflow(
  workflow: PilotWorkflowFact,
  branch: string | null,
  sha: string | null,
  required: RequiredState,
): GateWorkflowAssessment {
  const applicable = selectWorkflowRuns(workflow, branch, sha);
  const latest = applicable[0] ?? null;
  const earlierFailedAttempts = applicable.filter(
    (run) =>
      run !== latest &&
      run.status === "completed" &&
      ["failure", "timed_out", "startup_failure"].includes(run.conclusion ?? ""),
  ).length;
  const outcome = outcomeOf(latest);
  const recovered =
    outcome === "success" &&
    earlierFailedAttempts > 0;

  return {
    file: workflow.file,
    label: workflow.label,
    workflowState: workflow.state,
    required,
    applicableRun: latest ? runEvidence(latest) : null,
    latestRun: newestFirstRun(workflow.runs),
    earlierFailedAttempts,
    recovered,
    outcome,
    reason: outcomeReason(outcome, workflow.query.truncated, workflow.state === "observed"),
    truncated: workflow.query.truncated,
  };
}

function newestFirstRun(runs: PilotWorkflowRunFact[]): GateRunEvidence | null {
  // Archive and applicable Gate views share the same chronology; they differ
  // only in target-SHA/branch/event eligibility, not cross-Run attempt order.
  const latest = [...runs].sort(newestFirst)[0];
  return latest ? runEvidence(latest) : null;
}

function aggregateOutcome(workflows: GateWorkflowAssessment[]): GateRunOutcome {
  const outcomes = workflows.map((workflow) => workflow.outcome);
  if (outcomes.includes("failure")) return "failure";
  if (outcomes.includes("action_required")) return "action_required";
  if (outcomes.includes("running")) return "running";
  if (outcomes.includes("success")) return "success";
  if (outcomes.some((outcome) => ["neutral", "cancelled", "skipped"].includes(outcome))) {
    return "neutral";
  }
  return "unknown";
}

function outcomeMeaning(outcome: GateRunOutcome): RepositoryGateAssessment["outcomeMeaning"] {
  if (outcome === "success" || outcome === "failure" || outcome === "action_required") {
    return "decisive";
  }
  if (outcome === "running") return "pending";
  return "insufficient";
}

function requiredFilesFor(
  options: GateQualificationOptions,
  repository: string,
  branch: string | null,
): Set<string> | null {
  if (!branch || !options.requiredChecks) return null;
  const matches = options.requiredChecks.filter(
    (entry) =>
      shortName(entry.repository) === shortName(repository) && entry.branch === branch,
  );
  if (matches.length === 0) return null;
  return new Set(matches.flatMap((entry) => [...entry.workflowFiles]));
}

function requiredStateFor(file: string, requiredFiles: Set<string> | null): RequiredState {
  if (requiredFiles === null) return "unknown";
  return requiredFiles.has(file) ? "observed_required" : "observed_not_required";
}

function productionEvidenceFor(
  options: GateQualificationOptions,
  repository: string,
): ProductionEvidence | null {
  if (!options.production) return null;
  return (
    options.production.find(
      (entry) =>
        shortName(entry.repository) === shortName(repository) &&
        (entry.branch ?? "prod") === "prod",
    ) ?? null
  );
}

function assessProduction(
  prodSha: string | null,
  evidence: ProductionEvidence | null,
): RepositoryReleaseAssessment["production"] {
  if (!evidence) {
    return {
      status: "unverified",
      expectedSha: prodSha,
      observedSha: null,
      healthy: null,
      source: null,
      observedAt: null,
      url: null,
      note:
        "No trusted production SHA or smoke observation was supplied. A deploy workflow conclusion and a prod ref are not production proof.",
    };
  }

  // The current prod ref is the authoritative target when it is readable; a
  // caller-supplied expected SHA only fills a missing target, it cannot
  // silently replace the current branch target.
  const expectedSha = prodSha ?? evidence.expectedSha ?? null;
  const base = {
    expectedSha,
    observedSha: evidence.observedSha,
    healthy: evidence.healthy,
    source: evidence.source,
    observedAt: evidence.observedAt,
    url: evidence.url ?? null,
  };

  if (!evidence.observedSha) {
    return {
      ...base,
      status: "unverified",
      note: "Production SHA could not be read; success and failure both remain unproven.",
    };
  }
  if (!expectedSha) {
    return {
      ...base,
      status: "unverified",
      note: "The expected production target SHA is unknown, so the observed SHA cannot be compared.",
    };
  }
  if (evidence.observedSha !== expectedSha) {
    return {
      ...base,
      status: "mismatch",
      note: "Observed production SHA differs from the expected target SHA.",
    };
  }
  if (evidence.healthy === true) {
    return {
      ...base,
      status: "verified",
      note: "Observed production SHA matches the target and the supplied smoke result is healthy.",
    };
  }
  if (evidence.healthy === false) {
    return {
      ...base,
      status: "unhealthy",
      note: "Observed production SHA matches the target but the supplied smoke result is unhealthy.",
    };
  }
  return {
    ...base,
    status: "unverified",
    note: "Observed production SHA matches the target, but no smoke result was supplied.",
  };
}

function assessRelease(
  repository: PilotRepositoryFacts,
  options: GateQualificationOptions,
): RepositoryReleaseAssessment {
  const branch = repository.branches.find((entry) => entry.name === "prod");
  const branchState: FactSourceState = branch?.state ?? "missing";
  const targetSha = branch?.state === "observed" ? branch.sha : null;
  const target = PILOT_REPOSITORIES.find(
    (entry) => entry.name === shortName(repository.repository),
  );
  const workflowFile = target?.releaseWorkflow ?? null;
  const workflow = workflowFile
    ? repository.workflows.find((entry) => entry.file === workflowFile) ?? null
    : null;
  const runs = workflow ? selectWorkflowRuns(workflow, "prod", targetSha) : [];
  const latest = runs[0] ?? null;
  const earlierFailedAttempts = runs
    .filter(
      (run) =>
        run !== latest &&
        run.status === "completed" &&
        ["failure", "timed_out", "startup_failure"].includes(run.conclusion ?? ""),
    ).length;
  const outcome = outcomeOf(latest);

  let releaseStatus: ReleaseStatus;
  if (!workflowFile || !workflow || workflow.state !== "observed") {
    releaseStatus = "unknown";
  } else if (!latest) {
    releaseStatus = workflow.query.truncated ? "unknown" : "not_observed";
  } else if (outcome === "success") {
    releaseStatus = "succeeded";
  } else if (outcome === "failure") {
    releaseStatus = "failed";
  } else if (outcome === "action_required") {
    releaseStatus = "action_required";
  } else if (outcome === "running") {
    releaseStatus = "running";
  } else {
    releaseStatus = "not_observed";
  }

  return {
    repository: repository.repository,
    branch: "prod",
    targetSha,
    branchState,
    workflowFile,
    releaseRun: latest ? runEvidence(latest) : null,
    releaseStatus,
    releaseRecovered: releaseStatus === "succeeded" && earlierFailedAttempts > 0,
    production: assessProduction(
      targetSha,
      productionEvidenceFor(options, repository.repository),
    ),
  };
}

function gateEvidence(
  repository: string,
  assessment: GateWorkflowAssessment,
  targetSha: string | null,
): QualificationEvidence[] {
  const evidence: QualificationEvidence[] = [];
  if (assessment.applicableRun) {
    evidence.push({
      label: `${assessment.label} Run #${assessment.applicableRun.id} attempt ${assessment.applicableRun.attempt}`,
      url: assessment.applicableRun.htmlUrl,
      observedAt: assessment.applicableRun.updatedAt,
    });
  }
  const commit = commitUrl(repository, targetSha);
  if (commit) {
    evidence.push({ label: `Target commit ${targetSha}`, url: commit, observedAt: null });
  }
  return evidence;
}

function gateCandidates(
  repository: PilotRepositoryFacts,
  gate: RepositoryGateAssessment,
  requiredFiles: Set<string> | null,
): QualificationCandidate[] {
  const candidates: QualificationCandidate[] = [];
  const repo = repository.repository;
  const who = `${repo} maintainers`;
  const branch = gate.effectiveBranch;
  const targetSha = gate.targetSha;

  if (!branch || !targetSha) {
    candidates.push({
      id: `gate:${repo}:target-unknown`,
      category: "actions_gate",
      classification: "unknown",
      priority: null,
      who,
      what: `No effective target branch/SHA is readable for ${repo}.`,
      whyNow:
        "Branch facts are missing or unavailable, so Gate outcomes cannot be tied to a current target commit.",
      nextStep: "Re-read the repository default branch and the target channel ref.",
      evidence: [
        {
          label: `Branch state: ${gate.branchState}`,
          url: null,
          observedAt: null,
        },
      ],
      observedAt: null,
      exitCondition:
        "A current default branch and head SHA become readable from the bounded fact snapshot.",
      repository: repo,
      branch,
      headSha: targetSha,
      workflowFile: null,
      runId: null,
      attempt: null,
    });
    return candidates;
  }

  if (requiredFiles !== null) {
    for (const workflow of gate.workflows) {
      if (workflow.required !== "observed_required") continue;
      const evidence = gateEvidence(repo, workflow, targetSha);
      const run = workflow.applicableRun;

      if (workflow.outcome === "failure") {
        candidates.push({
          id: `gate:${repo}:${workflow.file}:required-failed`,
          category: "actions_gate",
          classification: "attention",
          priority: "P1",
          who,
          what: `${workflow.label} failed on required target ${branch}@${targetSha}.`,
          whyNow:
            "GitHub required-check evidence covers this workflow and the latest applicable attempt failed.",
          nextStep:
            "Inspect the failed required Check, fix or re-run the same target, and confirm the new attempt on the same SHA.",
          evidence,
          observedAt: run?.updatedAt ?? null,
          exitCondition:
            "A later attempt of the same required workflow succeeds on the same branch/SHA, or the required set changes with evidence.",
          repository: repo,
          branch,
          headSha: targetSha,
          workflowFile: workflow.file,
          runId: run?.id ?? null,
          attempt: run?.attempt ?? null,
        });
      } else if (workflow.outcome === "action_required") {
        candidates.push({
          id: `gate:${repo}:${workflow.file}:required-action`,
          category: "actions_gate",
          classification: "attention",
          priority: "P1",
          who,
          what: `${workflow.label} needs manual action on required target ${branch}@${targetSha}.`,
          whyNow:
            "This is a required check and GitHub reports action_required instead of a completed pass/fail.",
          nextStep: "Open the Run, grant the required approval, and re-run on the same target.",
          evidence,
          observedAt: run?.updatedAt ?? null,
          exitCondition:
            "The required workflow completes successfully on the same branch/SHA.",
          repository: repo,
          branch,
          headSha: targetSha,
          workflowFile: workflow.file,
          runId: run?.id ?? null,
          attempt: run?.attempt ?? null,
        });
      } else if (workflow.outcome === "running") {
        candidates.push({
          id: `gate:${repo}:${workflow.file}:required-running`,
          category: "actions_gate",
          classification: "in_progress",
          priority: null,
          who,
          what: `${workflow.label} is still running on required target ${branch}@${targetSha}.`,
          whyNow: "The required check has not reached a terminal conclusion yet.",
          nextStep: "Wait for the current attempt; do not start an unrelated re-run.",
          evidence,
          observedAt: run?.updatedAt ?? null,
          exitCondition: "The required workflow reaches a terminal conclusion on the same SHA.",
          repository: repo,
          branch,
          headSha: targetSha,
          workflowFile: workflow.file,
          runId: run?.id ?? null,
          attempt: run?.attempt ?? null,
        });
      } else if (workflow.outcome === "unknown") {
        candidates.push({
          id: `gate:${repo}:${workflow.file}:required-unknown`,
          category: "actions_gate",
          classification: "unknown",
          priority: "P3",
          who,
          what: `${workflow.label} is required but has no readable applicable attempt on ${branch}@${targetSha}.`,
          whyNow:
            "Required-check evidence exists, but the bounded Run window is truncated, unavailable, or has no matching attempt.",
          nextStep: "Read the workflow history for the exact SHA before assuming it passed.",
          evidence,
          observedAt: null,
          exitCondition:
            "An applicable attempt for the required workflow becomes visible on the same branch/SHA.",
          repository: repo,
          branch,
          headSha: targetSha,
          workflowFile: workflow.file,
          runId: null,
          attempt: null,
        });
      }
    }
  } else if (gate.outcome === "failure" || gate.outcome === "action_required") {
    const failed = gate.workflows.find((workflow) => workflow.outcome === gate.outcome);
    candidates.push({
      id: `gate:${repo}:candidate-${gate.outcome}`,
      category: "actions_gate",
      classification: "unknown",
      priority: null,
      who,
      what: `A repository-owned workflow reports ${gate.outcome} on candidate target ${branch}@${targetSha}.`,
      whyNow:
        "GitHub branch-protection/ruleset required checks are unreadable in this boundary, so this may be a real blocker or only an advisory workflow. It is not presented as a confirmed gate failure.",
      nextStep:
        "Read the repository's current branch protection/ruleset or Gate contract; if required, fix or re-run on the same SHA.",
      evidence: failed ? gateEvidence(repo, failed, targetSha) : [],
      observedAt: failed?.applicableRun?.updatedAt ?? null,
      exitCondition:
        "The same workflow succeeds on the same branch/SHA, or required-check evidence proves it is not needed.",
      repository: repo,
      branch,
      headSha: targetSha,
      workflowFile: failed?.file ?? null,
      runId: failed?.applicableRun?.id ?? null,
      attempt: failed?.applicableRun?.attempt ?? null,
    });
  } else if (gate.outcome === "running") {
    const running = gate.workflows.find((workflow) => workflow.outcome === "running");
    candidates.push({
      id: `gate:${repo}:candidate-running`,
      category: "actions_gate",
      classification: "in_progress",
      priority: null,
      who,
      what: `A repository-owned workflow is running on candidate target ${branch}@${targetSha}.`,
      whyNow:
        "The bounded facts show an active attempt; required-check necessity is still unknown.",
      nextStep: "Wait for the current attempt before drawing a Gate conclusion.",
      evidence: running ? gateEvidence(repo, running, targetSha) : [],
      observedAt: running?.applicableRun?.updatedAt ?? null,
      exitCondition:
        "The running workflow reaches a terminal conclusion on the same branch/SHA.",
      repository: repo,
      branch,
      headSha: targetSha,
      workflowFile: running?.file ?? null,
      runId: running?.applicableRun?.id ?? null,
      attempt: running?.applicableRun?.attempt ?? null,
    });
  } else if (gate.outcome === "unknown" || gate.coverage !== "complete") {
    candidates.push({
      id: `gate:${repo}:coverage`,
      category: "actions_gate",
      classification: "unknown",
      priority: null,
      who,
      what: `Gate coverage is ${gate.coverage} for ${branch}@${targetSha}.`,
      whyNow:
        "No decisive applicable Gate evidence exists. A truncated 5-Run window, unreadable workflow, or absent attempt is unknown, not healthy.",
      nextStep:
        "Read the exact workflow history for this SHA and the current required-check configuration.",
      evidence: gate.coverageReasons.map((reason) => ({
        label: reason,
        url: null,
        observedAt: null,
      })),
      observedAt: null,
      exitCondition:
        "A decisive applicable attempt or required-check configuration becomes readable for the same target.",
      repository: repo,
      branch,
      headSha: targetSha,
      workflowFile: null,
      runId: null,
      attempt: null,
    });
  }

  for (const workflow of gate.workflows) {
    if (!workflow.recovered) continue;
    candidates.push({
      id: `gate:${repo}:${workflow.file}:recovered`,
      category: "actions_gate",
      classification: "observation",
      priority: null,
      who,
      what: `${workflow.label} recovered on ${branch}@${targetSha} after an earlier failed attempt.`,
      whyNow:
        "The same workflow and target SHA have a newer successful attempt; the old failure is archive evidence only.",
      nextStep: "No manual action; keep the earlier failed Run as history.",
      evidence: gateEvidence(repo, workflow, targetSha),
      observedAt: workflow.applicableRun?.updatedAt ?? null,
      exitCondition: "Already satisfied by the newer successful attempt on the same SHA.",
      repository: repo,
      branch,
      headSha: targetSha,
      workflowFile: workflow.file,
      runId: workflow.applicableRun?.id ?? null,
      attempt: workflow.applicableRun?.attempt ?? null,
    });
  }

  const historical = gate.workflows.filter((workflow) => {
    const latest = workflow.latestRun;
    if (!latest) return false;
    if (latest.headBranch === branch && latest.headSha === targetSha) return false;
    // A skipped issue_comment dispatch is not a failure worth archiving.
    if (latest.event === "issue_comment" && latest.conclusion === "skipped") return false;
    return ["failure", "action_required"].includes(
      outcomeOfRunEvidence(latest.status, latest.conclusion),
    );
  });
  if (historical.length > 0) {
    candidates.push({
      id: `gate:${repo}:historical`,
      category: "actions_gate",
      classification: "observation",
      priority: null,
      who,
      what: `The newest Run for ${historical.map((workflow) => workflow.label).join(", ")} is not on target ${branch}@${targetSha}.`,
      whyNow:
        "A newer or unrelated Run failure is historical/other-branch evidence. It does not describe the current target Gate.",
      nextStep: "Open the original Run only as engineering archive evidence.",
      evidence: historical
        .filter((workflow) => workflow.latestRun)
        .map((workflow) => ({
          label: `${workflow.label}: ${workflow.latestRun?.headBranch ?? "unknown branch"}@${workflow.latestRun?.headSha ?? "unknown SHA"} ${workflow.latestRun?.conclusion ?? workflow.latestRun?.status}`,
          url: workflow.latestRun?.htmlUrl ?? null,
          observedAt: workflow.latestRun?.updatedAt ?? null,
        })),
      observedAt: historical[0]?.latestRun?.updatedAt ?? null,
      exitCondition:
        "A Run on the current target branch/SHA supersedes the historical record.",
      repository: repo,
      branch,
      headSha: targetSha,
      workflowFile: null,
      runId: null,
      attempt: null,
    });
  }

  return candidates;
}

function releaseCandidates(
  repository: PilotRepositoryFacts,
  release: RepositoryReleaseAssessment,
): QualificationCandidate[] {
  const candidates: QualificationCandidate[] = [];
  const repo = repository.repository;
  const who = `${repo} maintainers`;
  const run = release.releaseRun;
  const evidence: QualificationEvidence[] = run
    ? [
        {
          label: `Release workflow Run #${run.id} attempt ${run.attempt}`,
          url: run.htmlUrl,
          observedAt: run.updatedAt,
        },
      ]
    : [];
  if (release.targetSha) {
    const commit = commitUrl(repo, release.targetSha);
    if (commit) {
      evidence.push({
        label: `prod target commit ${release.targetSha}`,
        url: commit,
        observedAt: null,
      });
    }
  }
  if (release.production.source) {
    evidence.push({
      label: `Production observation (${release.production.source})`,
      url: release.production.url,
      observedAt: release.production.observedAt,
    });
  }

  const production = release.production;
  if (production.status === "unhealthy") {
    candidates.push({
      id: `release:${repo}:production-unhealthy`,
      category: "deployment",
      classification: "attention",
      priority: "P0",
      who,
      what: `Production smoke evidence reports an unhealthy deployment at ${production.observedSha}.`,
      whyNow:
        "Both the observed production SHA and its smoke evidence are supplied and negative, which is confirmed production impact.",
      nextStep:
        "Treat this as a production incident: inspect the deployment and smoke evidence, then roll back or repair with maintainer authorization.",
      evidence,
      observedAt: production.observedAt,
      exitCondition:
        "Trusted smoke evidence for the same production SHA becomes healthy, or a verified later deployment replaces it.",
      repository: repo,
      branch: "prod",
      headSha: release.targetSha,
      workflowFile: release.workflowFile,
      runId: run?.id ?? null,
      attempt: run?.attempt ?? null,
    });
    return candidates;
  }

  if (production.status === "mismatch") {
    candidates.push({
      id: `release:${repo}:production-mismatch`,
      category: "deployment",
      classification: "attention",
      priority: "P1",
      who,
      what: `Observed production SHA ${production.observedSha} does not match target ${production.expectedSha}.`,
      whyNow:
        "A trusted production observation exists and differs from the release target; the release claim is not verified.",
      nextStep:
        "Check the deployment input and production version, then redeploy the intended SHA or correct the target.",
      evidence,
      observedAt: production.observedAt,
      exitCondition:
        "Observed production SHA matches the target SHA with a healthy smoke result.",
      repository: repo,
      branch: "prod",
      headSha: release.targetSha,
      workflowFile: release.workflowFile,
      runId: run?.id ?? null,
      attempt: run?.attempt ?? null,
    });
    return candidates;
  }

  const productionVerifiedAfterReleaseFailure =
    production.status === "verified" &&
    production.observedAt !== null &&
    run !== null &&
    Date.parse(production.observedAt) >= Date.parse(run.updatedAt);

  if (release.releaseStatus === "failed" && productionVerifiedAfterReleaseFailure) {
    candidates.push({
      id: `release:${repo}:release-superseded`,
      category: "deployment",
      classification: "observation",
      priority: null,
      who,
      what: `The release attempt for prod@${release.targetSha} failed, but later trusted production evidence verifies the same SHA.`,
      whyNow:
        "The newer verified production SHA + healthy smoke observation supersedes the older failed release attempt.",
      nextStep: "No manual action; keep the failed Run as release history.",
      evidence,
      observedAt: production.observedAt,
      exitCondition:
        "Already satisfied by the later verified production observation for the same SHA.",
      repository: repo,
      branch: "prod",
      headSha: release.targetSha,
      workflowFile: release.workflowFile,
      runId: run?.id ?? null,
      attempt: run?.attempt ?? null,
    });
    return candidates;
  }

  if (release.releaseStatus === "failed" && !productionVerifiedAfterReleaseFailure) {
    candidates.push({
      id: `release:${repo}:release-failed`,
      category: "deployment",
      classification: "attention",
      priority: "P1",
      who,
      what: `The release workflow ${release.workflowFile} failed on prod@${release.targetSha}.`,
      whyNow:
        "A concrete release attempt failed and no later verified production evidence supersedes it.",
      nextStep:
        "Inspect the failed release Run, then retry the same target or correct the deployment input. Production is still unverified unless separate smoke evidence exists.",
      evidence,
      observedAt: run?.updatedAt ?? null,
      exitCondition:
        "A later release attempt succeeds on the same prod target and production SHA/smoke evidence is verified against it.",
      repository: repo,
      branch: "prod",
      headSha: release.targetSha,
      workflowFile: release.workflowFile,
      runId: run?.id ?? null,
      attempt: run?.attempt ?? null,
    });
    return candidates;
  }

  if (release.releaseStatus === "action_required") {
    candidates.push({
      id: `release:${repo}:release-approval`,
      category: "deployment",
      classification: "attention",
      priority: "P2",
      who,
      what: `The release workflow ${release.workflowFile} needs manual approval on prod@${release.targetSha}.`,
      whyNow:
        "A release entry explicitly requires a maintainer/environment approval before it can continue.",
      nextStep: "Review the release Run and grant or decline the required approval.",
      evidence,
      observedAt: run?.updatedAt ?? null,
      exitCondition:
        "The release workflow leaves action_required and reaches a terminal conclusion for the same target.",
      repository: repo,
      branch: "prod",
      headSha: release.targetSha,
      workflowFile: release.workflowFile,
      runId: run?.id ?? null,
      attempt: run?.attempt ?? null,
    });
    return candidates;
  }

  if (release.releaseStatus === "running") {
    candidates.push({
      id: `release:${repo}:release-running`,
      category: "deployment",
      classification: "in_progress",
      priority: null,
      who,
      what: `The release workflow ${release.workflowFile} is running on prod@${release.targetSha}.`,
      whyNow: "A release attempt is still in progress; deployment is not yet proven either way.",
      nextStep: "Wait for the current release attempt to finish.",
      evidence,
      observedAt: run?.updatedAt ?? null,
      exitCondition: "The release attempt reaches a terminal conclusion.",
      repository: repo,
      branch: "prod",
      headSha: release.targetSha,
      workflowFile: release.workflowFile,
      runId: run?.id ?? null,
      attempt: run?.attempt ?? null,
    });
    return candidates;
  }

  if (release.releaseStatus === "succeeded" && production.status !== "verified") {
    candidates.push({
      id: `release:${repo}:production-unverified`,
      category: "deployment",
      classification: "unknown",
      priority: null,
      who,
      what: `${release.workflowFile} reported success on prod@${release.targetSha}, but production SHA/smoke is ${production.status}.`,
      whyNow:
        "A deployment workflow conclusion is not proof that the production version or public smoke matches this target.",
      nextStep:
        "Read the approved production version and smoke evidence for this exact SHA before claiming release success.",
      evidence,
      observedAt: run?.updatedAt ?? null,
      exitCondition:
        "Trusted production evidence verifies the same SHA with a healthy smoke result, or a newer deployment supersedes it.",
      repository: repo,
      branch: "prod",
      headSha: release.targetSha,
      workflowFile: release.workflowFile,
      runId: run?.id ?? null,
      attempt: run?.attempt ?? null,
    });
    return candidates;
  }

  if (
    release.releaseStatus === "not_observed" ||
    release.releaseStatus === "unknown"
  ) {
    candidates.push({
      id: `release:${repo}:release-coverage`,
      category: "deployment",
      classification: "unknown",
      priority: null,
      who,
      what: `Release evidence for prod@${release.targetSha} is ${release.releaseStatus}.`,
      whyNow:
        "No applicable release Run and no trusted production observation exist, so release status and production version remain unproven.",
      nextStep:
        "Check the repository release contract and any maintainer-approved production version/smoke source.",
      evidence,
      observedAt: run?.updatedAt ?? null,
      exitCondition:
        "An applicable release Run or trusted production observation becomes readable for the target.",
      repository: repo,
      branch: "prod",
      headSha: release.targetSha,
      workflowFile: release.workflowFile,
      runId: run?.id ?? null,
      attempt: run?.attempt ?? null,
    });
  }

  return candidates;
}

function candidateRank(candidate: QualificationCandidate): number {
  const classification: Record<CandidateClassification, number> = {
    attention: 0,
    in_progress: 1,
    unknown: 2,
    observation: 3,
  };
  const priority: Record<CandidatePriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (
    classification[candidate.classification] * 10 +
    (candidate.priority ? priority[candidate.priority] : 9)
  );
}

function dedupeCandidates(candidates: QualificationCandidate[]): QualificationCandidate[] {
  // One root cause should not appear as both a Gate and a deployment item when
  // both refer to the same release-entry Run.
  const deploymentRuns = new Set(
    candidates
      .filter(
        (entry) =>
          entry.category === "deployment" &&
          entry.runId !== null &&
          (entry.classification === "attention" ||
            entry.id.endsWith(":release-superseded")),
      )
      .map((entry) => `${entry.repository}#${entry.runId}`),
  );
  const seen = new Set<string>();
  return candidates.filter((entry) => {
    if (seen.has(entry.id)) return false;
    if (
      entry.category === "actions_gate" &&
      entry.runId !== null &&
      deploymentRuns.has(`${entry.repository}#${entry.runId}`)
    ) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

export function qualifyGitHubGates(
  snapshot: GitHubFactsSnapshot,
  options: GateQualificationOptions = {},
): GitHubGateQualificationSnapshot {
  const now = options.now ?? Date.now();
  const generatedAt = iso(now);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (snapshot.status !== "complete") {
    warnings.push(
      `Source GitHub facts are ${snapshot.status}; missing sources stay unknown and are not healthy.`,
    );
  }
  if (!options.requiredChecks) {
    warnings.push(
      "GitHub branch-protection/ruleset required checks are not readable in this boundary (403/unknown). required_by_github is unknown; workflow outcomes are candidates, not proven required gates.",
    );
  }
  if (!options.production) {
    warnings.push(
      "No trusted production SHA or smoke observation is available. Deployment workflow success remains unverified and no P0 is inferred.",
    );
  }

  const repositories: RepositoryQualification[] = snapshot.repositories.map((repository) => {
    const branchNames = repository.branches.map((entry) => entry.name);
    const effectiveBranch =
      repository.defaultBranch && branchNames.includes(repository.defaultBranch)
        ? repository.defaultBranch
        : null;
    const branch = effectiveBranch
      ? repository.branches.find((entry) => entry.name === effectiveBranch) ?? null
      : null;
    const targetSha = branch?.state === "observed" ? branch.sha : null;
    const requiredFiles = requiredFilesFor(options, repository.repository, effectiveBranch);

    const workflows = repository.workflows.map((workflow) =>
      assessWorkflow(
        workflow,
        effectiveBranch,
        targetSha,
        requiredStateFor(workflow.file, requiredFiles),
      ),
    );

    const coverageReasons: string[] = [];
    if (!effectiveBranch) {
      coverageReasons.push(
        repository.defaultBranch
          ? `Default branch ${repository.defaultBranch} is outside the collected channel set; the current target is unknown.`
          : "The repository default branch was not readable; the current target is unknown.",
      );
    } else if (!targetSha) {
      coverageReasons.push(
        `Target branch ${effectiveBranch} was ${branch?.state ?? "missing"}; the head SHA is unknown.`,
      );
    }
    if (repository.presence !== "observed") {
      coverageReasons.push(`Repository presence is ${repository.presence}.`);
    }
    for (const workflow of workflows) {
      if (workflow.workflowState !== "observed") {
        coverageReasons.push(
          `${workflow.label} workflow history is ${workflow.workflowState}; the applicable Gate is not readable.`,
        );
      } else if (workflow.truncated) {
        coverageReasons.push(
          `${workflow.label} candidate history is truncated at 5 Runs; an absent target attempt is unknown.`,
        );
      } else if (!workflow.applicableRun) {
        coverageReasons.push(
          `${workflow.label} has no applicable attempt on this target; it may be path-filtered or release-only, so Gate coverage is partial.`,
        );
      }
    }

    const observedWorkflows = workflows.filter(
      (workflow) => workflow.workflowState === "observed",
    ).length;
    const completeWorkflows = workflows.filter(
      (workflow) => workflow.applicableRun !== null,
    ).length;
    const anyTruncated = workflows.some((workflow) => workflow.truncated);
    const coverage: GateCoverage =
      observedWorkflows === 0 || !effectiveBranch || !targetSha
        ? "unknown"
        : completeWorkflows === workflows.length && !anyTruncated
          ? "complete"
          : "partial";

    // A pass is only decidable when every collected candidate workflow has an
    // applicable attempt and no bounded window is truncated. A partial snapshot
    // keeps failures/pending facts but never upgrades the rest to "success".
    let gateOutcome: GateRunOutcome =
      coverage === "unknown" ? "unknown" : aggregateOutcome(workflows);
    if (coverage !== "complete" && gateOutcome === "success") {
      gateOutcome = "unknown";
    }

    const gate: RepositoryGateAssessment = {
      repository: repository.repository,
      effectiveBranch,
      targetSha,
      branchState: branch?.state ?? "missing",
      requiredByGithub: requiredFiles === null ? "unknown" : "observed",
      // The workflow identity is a bounded OPS-033 candidate, never a claim
      // that the repository or GitHub actually requires it.
      requiredByWorkflow: "candidate",
      outcome: gateOutcome,
      outcomeMeaning: outcomeMeaning(gateOutcome),
      coverage,
      coverageReasons,
      workflows,
    };

    const release = assessRelease(repository, options);
    const candidates = dedupeCandidates([
      ...gateCandidates(repository, gate, requiredFiles),
      ...releaseCandidates(repository, release),
    ]).sort((a, b) => candidateRank(a) - candidateRank(b) || a.id.localeCompare(b.id));

    if (gate.requiredByGithub === "unknown") {
      reasons.push(`${repository.repository}: required_by_github is unknown.`);
    }
    if (release.production.status !== "verified") {
      reasons.push(
        `${repository.repository}: production is ${release.production.status}.`,
      );
    }

    return {
      repository: repository.repository,
      gate,
      release,
      candidates,
    };
  });

  const candidates = repositories
    .flatMap((repository) => repository.candidates)
    .sort((a, b) => candidateRank(a) - candidateRank(b) || a.id.localeCompare(b.id));

  const gateDecisive = repositories.filter(
    (repository) => repository.gate.outcomeMeaning === "decisive",
  ).length;
  const gateUnknown = repositories.filter(
    (repository) => repository.gate.outcome === "unknown",
  ).length;
  const productionVerified = repositories.filter(
    (repository) => repository.release.production.status === "verified",
  ).length;
  const productionUnverified = repositories.filter(
    (repository) => repository.release.production.status !== "verified",
  ).length;

  const coverageStatus: GitHubGateQualificationSnapshot["coverage"]["status"] =
    snapshot.status === "unavailable"
      ? "unknown"
      : snapshot.status === "partial" ||
          !options.requiredChecks ||
          gateUnknown > 0 ||
          productionUnverified > 0
        ? "partial"
        : "complete";

  const productionEvidenceState: GitHubGateQualificationSnapshot["productionEvidence"] =
    !options.production || options.production.length === 0 || repositories.length === 0
      ? "unavailable"
      : options.production.length < repositories.length
        ? "partial"
        : "supplied";

  return {
    apiVersion: "v1",
    source: "github-facts-derivation",
    generatedAt,
    factsGeneratedAt: snapshot.generatedAt,
    factsStatus: snapshot.status,
    requiredCheckEvidence: options.requiredChecks ? "supplied" : "unavailable",
    productionEvidence: productionEvidenceState,
    coverage: {
      status: coverageStatus,
      repositoriesPlanned: snapshot.repositories.length,
      repositoriesAssessed: repositories.length,
      gateDecisive,
      gateUnknown,
      productionVerified,
      productionUnverified,
      reasons: Array.from(new Set(reasons)),
    },
    repositories,
    candidates,
    warnings,
  };
}
