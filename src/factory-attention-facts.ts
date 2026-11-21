import type { GitHubEnv } from "./github.ts";
import {
  fetchFact,
  type GitHubFactLimits,
  type MeterState,
  type ParsedValue,
  type FactQueryMeta,
} from "./github-facts.ts";
import type {
  WorkerIssueLookup,
  WorkerIssueState,
  WorkerIssueCurrentness,
} from "./factory-attention.ts";

const ORG = "uichat-mira";

// Exactly one Issue-state read. The extra request slot only covers one bounded
// rate-limit retry; this module never lists Issues or scans a repository.
export const WORKER_ISSUE_READ_LIMITS: GitHubFactLimits = {
  maxRequests: 2,
  concurrency: 1,
  timeoutMs: 8_000,
  maxRetries: 1,
  maxRetryDelayMs: 1_000,
  refreshSeconds: 60,
};

interface IssuePayload {
  kind: "issue";
  issue: WorkerIssueState;
}

interface PullRequestPayload {
  kind: "pull_request";
  number: number;
}

type IssueOrPullRequest = IssuePayload | PullRequestPayload;

function parseIssueState(payload: unknown): ParsedValue<IssueOrPullRequest> | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as {
    number?: unknown;
    state?: unknown;
    state_reason?: unknown;
    title?: unknown;
    html_url?: unknown;
    updated_at?: unknown;
    closed_at?: unknown;
    pull_request?: unknown;
  };
  if (
    typeof row.number !== "number" ||
    !Number.isSafeInteger(row.number) ||
    row.number <= 0 ||
    (row.state !== "open" && row.state !== "closed") ||
    typeof row.html_url !== "string"
  ) {
    return null;
  }
  if (row.pull_request !== undefined) {
    return {
      value: { kind: "pull_request", number: row.number },
      truncated: false,
    };
  }
  return {
    value: {
      kind: "issue",
      issue: {
        number: row.number,
        state: row.state,
        stateReason: typeof row.state_reason === "string" ? row.state_reason : null,
        title: typeof row.title === "string" ? row.title : null,
        htmlUrl: row.html_url,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        closedAt: typeof row.closed_at === "string" ? row.closed_at : null,
      },
    },
    truncated: false,
  };
}

export function workerIssuePath(repository: string, issueNumber: number): string {
  const short = repository.startsWith(`${ORG}/`)
    ? repository.slice(ORG.length + 1)
    : repository;
  return `/repos/${ORG}/${encodeURIComponent(short)}/issues/${issueNumber}`;
}

/**
 * Reads one public Issue's current state. Pull requests also respond to the
 * Issues API; `pull_request` payloads are rejected so a PR number can never be
 * silently accepted as a work-item Issue.
 */
export async function readWorkerIssueState(
  env: GitHubEnv,
  repository: string,
  issueNumber: number,
  now = Date.now(),
): Promise<WorkerIssueLookup> {
  if (!/^uichat-mira\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("unsupported_repository");
  }
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("invalid_issue_number");
  }

  const path = workerIssuePath(repository, issueNumber);
  const meter: MeterState = {
    used: 0,
    retries: 0,
    notModified: 0,
    halted: null,
    rateLimit: { remaining: null, resetAt: null, retryAfterSeconds: null, observedAt: null },
  };

  const outcome = await fetchFact<IssueOrPullRequest>(
    env,
    path,
    meter,
    WORKER_ISSUE_READ_LIMITS,
    parseIssueState,
    null,
    now,
  );

  if (outcome.value?.kind === "pull_request") {
    return {
      issue: null,
      query: {
        ...outcome.meta,
        status: "missing",
        error: "GitHub returned a pull request; a PR number is not a verified work-item Issue",
      },
    };
  }

  return {
    issue: outcome.value?.kind === "issue" ? outcome.value.issue : null,
    query: outcome.meta,
  };
}

/**
 * Recovery pointer is written by the trusted GitHub-hosted recovery_index job,
 * not by model code. Reading only a bounded first page is deliberately fail-
 * closed: >=100 comments cannot prove which pointer is latest.
 */
const RECOVERY_COMMENT_LIMIT = 100;
const GITHUB_ACTIONS_BOT_ID = 41898282;

export interface WorkerRecoveryPointer {
  runId: number;
  attempt: number;
  lifecycleState: "BLOCKED" | "ESCALATED" | "VERIFIED";
  createdAt: string;
  url: string;
}

export interface WorkerRecoveryIndex {
  pointers: WorkerRecoveryPointer[];
  malformed: boolean;
  query: FactQueryMeta;
}

function parseRecoveryIndex(
  payload: unknown,
  repository: string,
  issueNumber: number,
): ParsedValue<{ pointers: WorkerRecoveryPointer[]; malformed: boolean }> | null {
  if (!Array.isArray(payload)) return null;
  const pointers: WorkerRecoveryPointer[] = [];
  let malformed = false;
  for (const item of payload) {
    if (!item || typeof item !== "object") { malformed = true; continue; }
    const row = item as Record<string, unknown>;
    const user = row.user as Record<string, unknown> | null | undefined;
    // A comment with the same marker from a human or another bot is untrusted.
    if (user?.id !== GITHUB_ACTIONS_BOT_ID ||
        user.login !== "github-actions[bot]" || user.type !== "Bot") continue;
    if (typeof row.body !== "string" || !row.body.includes("mira-recovery-candidate:v1")) continue;
    const match = row.body.match(/^<!-- mira-recovery-candidate:v1\r?\n([^\n]+)\r?\n-->\r?\n/);
    if (!match || row.body.indexOf("mira-recovery-candidate:v1", match[0].length) !== -1) {
      malformed = true;
      continue;
    }
    let value: unknown;
    try { value = JSON.parse(match[1]); }
    catch { malformed = true; continue; }
    if (!value || typeof value !== "object") { malformed = true; continue; }
    const pointer = value as Record<string, unknown>;
    const valid = pointer.schema_version === 1 &&
      pointer.repository === repository &&
      pointer.issue_number === issueNumber &&
      Number.isSafeInteger(pointer.run_id) && (pointer.run_id as number) > 0 &&
      Number.isSafeInteger(pointer.run_attempt) && (pointer.run_attempt as number) > 0 &&
      ["BLOCKED", "ESCALATED", "VERIFIED"].includes(String(pointer.lifecycle_state)) &&
      typeof pointer.candidate_artifact_id === "string" &&
      /^\d+$/.test(pointer.candidate_artifact_id) &&
      typeof pointer.base_sha === "string" &&
      /^[a-f0-9]{40}$/i.test(pointer.base_sha) &&
      typeof row.html_url === "string" &&
      typeof row.created_at === "string" &&
      Number.isFinite(Date.parse(row.created_at));
    if (!valid) { malformed = true; continue; }
    pointers.push({
      runId: pointer.run_id as number,
      attempt: pointer.run_attempt as number,
      lifecycleState: pointer.lifecycle_state as WorkerRecoveryPointer["lifecycleState"],
      createdAt: row.created_at as string,
      url: row.html_url as string,
    });
  }
  return { value: { pointers, malformed }, truncated: payload.length >= RECOVERY_COMMENT_LIMIT };
}

/** Bounded one-page Issue Recovery index. Absence/truncation is NOT proof of currentness. */
export async function readWorkerRecoveryIndex(
  env: GitHubEnv,
  repository: string,
  issueNumber: number,
  now = Date.now(),
): Promise<WorkerRecoveryIndex> {
  if (!/^uichat-mira\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("unsupported_repository");
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) throw new Error("invalid_issue_number");
  const path = workerIssuePath(repository, issueNumber) + "/comments?per_page=" + RECOVERY_COMMENT_LIMIT;
  const meter: MeterState = {
    used: 0, retries: 0, notModified: 0, halted: null,
    rateLimit: { remaining: null, resetAt: null, retryAfterSeconds: null, observedAt: null },
  };
  const outcome = await fetchFact(
    env, path, meter, WORKER_ISSUE_READ_LIMITS,
    (payload: unknown) => parseRecoveryIndex(payload, repository, issueNumber), null, now,
  );
  return {
    pointers: outcome.value?.pointers ?? [],
    malformed: outcome.value?.malformed ?? false,
    query: outcome.meta,
  };
}


/**
 * A stale Issue is never a reason to re-surface an old escalation. A complete,
 * trusted pointer page proves *indexed* currentness only; later Issue activity
 * without a corresponding pointer makes that evidence inconclusive.
 */
export function qualifyRecoveryCurrentness(
  index: WorkerRecoveryIndex,
  runId: number,
  attempt: number,
  expectedState: "escalated" | "blocked",
  issueUpdatedAt: string | null,
): WorkerIssueCurrentness {
  const base: WorkerIssueCurrentness = {
    status: "unknown",
    observedAt: index.query.observedAt,
    evidenceUrl: null,
    latestRunId: null,
    latestAttempt: null,
    reason: "Latest same-Issue Recovery pointer cannot be proven from bounded trusted GitHub evidence.",
  };
  if (!["ok", "not_modified"].includes(index.query.status) ||
      index.query.truncated || index.malformed || index.pointers.length === 0) {
    const gap = index.query.status !== "ok"
      ? index.query.status
      : index.query.truncated ? "truncated comments" : index.malformed ? "invalid trusted pointer" : "no trusted pointer";
    return { ...base, reason: `Recovery index is ${gap}; no current terminal human handoff can be asserted.` };
  }
  const pointers = [...index.pointers].sort((a, b) =>
    b.runId - a.runId || b.attempt - a.attempt,
  );
  const latest = pointers[0];
  const proof: WorkerIssueCurrentness = {
    ...base,
    observedAt: latest.createdAt,
    evidenceUrl: latest.url,
    latestRunId: latest.runId,
    latestAttempt: latest.attempt,
  };
  if (latest.runId > runId || latest.runId === runId && latest.attempt > attempt) {
    return {
      ...proof,
      status: "superseded",
      reason: `A newer verified Issue Recovery pointer is indexed at Run #${latest.runId}/${latest.attempt} (${latest.lifecycleState}); the queried old Run #${runId}/${attempt} is not a current blocker. Latest Run still needs its own evidence before declaring acceptance.`,
    };
  }
  if (latest.runId !== runId || latest.attempt !== attempt) {
    return { ...proof, reason: "The queried Run/attempt is newer than the last indexed Recovery pointer; indexing may still be in progress." };
  }
  if (latest.lifecycleState !== expectedState.toUpperCase()) {
    return { ...proof, reason: `Indexed lifecycle state ${latest.lifecycleState} does not match the queried ${expectedState} state.` };
  }
  const issueUpdate = issueUpdatedAt ? Date.parse(issueUpdatedAt) : NaN;
  const pointerTime = Date.parse(latest.createdAt);
  if (!Number.isFinite(issueUpdate) || issueUpdate > pointerTime + 5000) {
    return { ...proof, reason: "The owning Issue changed after its last trusted Recovery pointer; an unindexed newer execution or decision cannot be ruled out." };
  }
  return {
    ...proof,
    status: "confirmed_current",
    reason: `Latest complete trusted Issue Recovery pointer identifies this Run #${runId}/${attempt} as ${latest.lifecycleState}; Issue activity has not advanced beyond the indexed observation.`,
  };
}
