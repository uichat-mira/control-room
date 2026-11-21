import type { GitHubEnv } from "./github.ts";
import {
  fetchFact,
  type GitHubFactLimits,
  type MeterState,
  type ParsedValue,
} from "./github-facts.ts";
import type { WorkerIssueLookup, WorkerIssueState } from "./factory-attention.ts";

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
