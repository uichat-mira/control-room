import type { GitHubEnv } from "./github.ts";
import {
  PILOT_REPOSITORIES,
  failedMeta,
  fetchFact,
  parseWorkflowRuns,
  stateFromMeta,
  type FactQueryMeta,
  type FactSourceState,
  type MeterState,
  type ParsedValue,
  type PilotWorkflowRunFact,
  type WorkflowPayload,
} from "./github-facts.ts";

const ORG = "uichat-mira";
const REVIEWS_PER_PAGE = 30;
const HEAD_RUNS_PER_PAGE = 30;

// One PR projection is deliberately three explicit reads:
//   1. PR detail (base/head/draft/mergeability/state)
//   2. reviews (authority, commit identity, dismissal/submission order)
//   3. workflow runs for the exact head SHA (reuses the OPS-035 assessment)
// The cap leaves room for one bounded rate-limit retry without widening into a
// repository-wide Reviews/Checks fan-out.
export const DEFAULT_PR_FACT_LIMITS: PullRequestFactLimits = {
  maxRequests: 5,
  concurrency: 2,
  timeoutMs: 8_000,
  maxRetries: 1,
  maxRetryDelayMs: 2_000,
  refreshSeconds: 60,
};

export interface PullRequestFactLimits {
  maxRequests: number;
  concurrency: number;
  timeoutMs: number;
  maxRetries: number;
  maxRetryDelayMs: number;
  refreshSeconds: number;
}

export interface PullRequestDetailFact {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  authorLogin: string | null;
  authorAssociation: string | null;
  /**
   * GitHub computes mergeability asynchronously. `null` is "not computed / not
   * decidable yet", never a conflict. Only `false` is a confirmed conflict.
   */
  mergeable: boolean | null;
  mergeableState: string | null;
  baseRef: string;
  headRef: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface PullRequestReviewFact {
  id: number;
  login: string;
  userType: string | null;
  state: string;
  commitId: string | null;
  submittedAt: string | null;
  authorAssociation: string | null;
  htmlUrl: string | null;
}

export interface PullRequestCollection<T> {
  state: FactSourceState;
  items: T[];
  truncated: boolean;
  observedAt: string | null;
  query: FactQueryMeta;
}

export interface PullRequestFactsBudget {
  scope: "per-pull-request";
  plannedRequests: number;
  maxRequests: number;
  usedRequests: number;
  remainingRequests: number;
  retries: number;
  notModifiedResponses: number;
  concurrency: number;
  timeoutMs: number;
  refreshSeconds: number;
  note: string;
}

export interface PullRequestFactsCoverage {
  status: "complete" | "partial" | "unavailable";
  plannedQueries: number;
  completedQueries: number;
  failedQueries: number;
  notAttemptedQueries: number;
  truncatedSources: string[];
  reasons: string[];
}

export interface PullRequestFactsSnapshot {
  apiVersion: "v1";
  source: "github-rest";
  generatedAt: string;
  repository: string;
  number: number;
  status: PullRequestFactsStatus;
  authentication: {
    mode: "authenticated" | "anonymous";
    credentialPresent: boolean;
    note: string;
  };
  detail: PullRequestDetailFact | null;
  reviews: PullRequestCollection<PullRequestReviewFact>;
  headWorkflowRuns: PullRequestCollection<PilotWorkflowRunFact>;
  budget: PullRequestFactsBudget;
  coverage: PullRequestFactsCoverage;
  warnings: string[];
  error?: string;
}

export type PullRequestFactsStatus = "complete" | "partial" | "unavailable";

export interface CollectPullRequestFactsOptions {
  limits?: Partial<PullRequestFactLimits>;
  now?: number;
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeLimits(
  input: Partial<PullRequestFactLimits> | undefined,
): PullRequestFactLimits {
  return {
    maxRequests: boundedLimit(
      input?.maxRequests,
      DEFAULT_PR_FACT_LIMITS.maxRequests,
      1,
      DEFAULT_PR_FACT_LIMITS.maxRequests,
    ),
    concurrency: boundedLimit(
      input?.concurrency,
      DEFAULT_PR_FACT_LIMITS.concurrency,
      1,
      DEFAULT_PR_FACT_LIMITS.concurrency,
    ),
    timeoutMs: boundedLimit(
      input?.timeoutMs,
      DEFAULT_PR_FACT_LIMITS.timeoutMs,
      1,
      DEFAULT_PR_FACT_LIMITS.timeoutMs,
    ),
    maxRetries: boundedLimit(
      input?.maxRetries,
      DEFAULT_PR_FACT_LIMITS.maxRetries,
      0,
      DEFAULT_PR_FACT_LIMITS.maxRetries,
    ),
    maxRetryDelayMs: boundedLimit(
      input?.maxRetryDelayMs,
      DEFAULT_PR_FACT_LIMITS.maxRetryDelayMs,
      0,
      DEFAULT_PR_FACT_LIMITS.maxRetryDelayMs,
    ),
    refreshSeconds: boundedLimit(
      input?.refreshSeconds,
      DEFAULT_PR_FACT_LIMITS.refreshSeconds,
      1,
      24 * 60 * 60,
    ),
  };
}

// PullRequestFactLimits is structurally the same envelope OPS-034 uses, so
// fetchFact reuses the same timeout/retry/403/429 handling without a second
// request implementation.

export function pilotRepositoryName(repository: string): string | null {
  const short = repository.startsWith(`${ORG}/`)
    ? repository.slice(ORG.length + 1)
    : repository;
  return PILOT_REPOSITORIES.some((target) => target.name === short) ? short : null;
}

function pullRequestPath(repository: string, number: number): string {
  return `/repos/${ORG}/${encodeURIComponent(repository)}/pulls/${number}`;
}

function reviewsPath(repository: string, number: number): string {
  return `/repos/${ORG}/${encodeURIComponent(repository)}/pulls/${number}/reviews?per_page=${REVIEWS_PER_PAGE}`;
}

function headRunsPath(repository: string, sha: string): string {
  return `/repos/${ORG}/${encodeURIComponent(repository)}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=${HEAD_RUNS_PER_PAGE}`;
}

function parsePullRequestDetail(payload: unknown): ParsedValue<PullRequestDetailFact> | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as {
    number?: unknown;
    title?: unknown;
    state?: unknown;
    draft?: unknown;
    merged?: unknown;
    mergeable?: unknown;
    mergeable_state?: unknown;
    user?: { login?: unknown };
    author_association?: unknown;
    base?: { ref?: unknown };
    head?: { ref?: unknown; sha?: unknown };
    created_at?: unknown;
    updated_at?: unknown;
    html_url?: unknown;
  };
  if (
    typeof row.number !== "number" ||
    !Number.isSafeInteger(row.number) ||
    row.number <= 0 ||
    typeof row.title !== "string" ||
    typeof row.state !== "string" ||
    typeof row.base?.ref !== "string" ||
    typeof row.head?.ref !== "string" ||
    typeof row.head?.sha !== "string" ||
    !/^[0-9a-f]{7,64}$/i.test(row.head.sha) ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string" ||
    typeof row.html_url !== "string"
  ) {
    return null;
  }
  return {
    value: {
      number: row.number,
      title: row.title,
      state: row.state,
      draft: row.draft === true,
      merged: row.merged === true,
      authorLogin: typeof row.user?.login === "string" ? row.user.login : null,
      authorAssociation:
        typeof row.author_association === "string" ? row.author_association : null,
      mergeable: typeof row.mergeable === "boolean" ? row.mergeable : null,
      mergeableState:
        typeof row.mergeable_state === "string" ? row.mergeable_state : null,
      baseRef: row.base.ref,
      headRef: row.head.ref,
      headSha: row.head.sha,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      htmlUrl: row.html_url,
    },
    truncated: false,
  };
}

function parsePullRequestReviews(
  payload: unknown,
): ParsedValue<PullRequestReviewFact[]> | null {
  if (!Array.isArray(payload)) return null;
  const items: PullRequestReviewFact[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as {
      id?: unknown;
      user?: { login?: unknown; type?: unknown };
      state?: unknown;
      commit_id?: unknown;
      submitted_at?: unknown;
      author_association?: unknown;
      html_url?: unknown;
    };
    if (
      typeof row.id !== "number" ||
      !Number.isSafeInteger(row.id) ||
      row.id <= 0 ||
      typeof row.state !== "string" ||
      typeof row.user?.login !== "string"
    ) {
      continue;
    }
    items.push({
      id: row.id,
      login: row.user.login,
      userType: typeof row.user.type === "string" ? row.user.type : null,
      state: row.state,
      commitId: typeof row.commit_id === "string" ? row.commit_id : null,
      submittedAt: typeof row.submitted_at === "string" ? row.submitted_at : null,
      authorAssociation:
        typeof row.author_association === "string" ? row.author_association : null,
      htmlUrl: typeof row.html_url === "string" ? row.html_url : null,
    });
  }
  return {
    value: items,
    truncated: payload.length >= REVIEWS_PER_PAGE,
  };
}

function emptyCollection<T>(
  state: FactSourceState,
  query: FactQueryMeta,
): PullRequestCollection<T> {
  return {
    state,
    items: [],
    truncated: false,
    observedAt: query.observedAt,
    query,
  };
}

function queryStatus(queries: FactQueryMeta[]): PullRequestFactsCoverage["status"] {
  const completed = queries.filter(
    (query) => query.status === "ok" || query.status === "not_modified",
  ).length;
  if (completed === 0) return "unavailable";
  return completed === queries.length ? "complete" : "partial";
}

export async function collectPullRequestFacts(
  env: GitHubEnv = {},
  repository: string,
  number: number,
  options: CollectPullRequestFactsOptions = {},
): Promise<PullRequestFactsSnapshot> {
  const shortName = pilotRepositoryName(repository);
  if (!shortName) throw new Error("unsupported_repository");
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("invalid_pull_request_number");
  }

  const now = options.now ?? Date.now();
  const limits = normalizeLimits(options.limits);
  const meter: MeterState = {
    used: 0,
    retries: 0,
    notModified: 0,
    halted: null,
    rateLimit: { remaining: null, resetAt: null, retryAfterSeconds: null, observedAt: null },
  };
  const fullName = `${ORG}/${shortName}`;
  const detailPath = pullRequestPath(shortName, number);

  const detailOutcome = await fetchFact<PullRequestDetailFact>(
    env,
    detailPath,
    meter,
    limits,
    parsePullRequestDetail,
    null,
    now,
  );
  const detailState = stateFromMeta(detailOutcome.meta);
  const detail = detailState === "observed" ? detailOutcome.value : null;

  const warnings: string[] = [];
  let reviews = emptyCollection<PullRequestReviewFact>(
    "unavailable",
    failedMeta(reviewsPath(shortName, number), now, "unavailable", {
      error: "PR detail was unavailable; the reviews read was not attempted.",
    }),
  );
  let headWorkflowRuns = emptyCollection<PilotWorkflowRunFact>(
    "unavailable",
    failedMeta(
      `/repos/${ORG}/${shortName}/actions/runs`,
      now,
      "unavailable",
      { error: "PR detail was unavailable; the head workflow-run read was not attempted." },
    ),
  );
  let notAttemptedQueries = 2;

  if (detail) {
    notAttemptedQueries = 0;
    const reviewPath = reviewsPath(shortName, number);
    const runsPath = headRunsPath(shortName, detail.headSha);
    const tasks: Array<() => Promise<void>> = [
      async () => {
        const outcome = await fetchFact<PullRequestReviewFact[]>(
          env,
          reviewPath,
          meter,
          limits,
          parsePullRequestReviews,
          null,
          now,
        );
        reviews = {
          state: stateFromMeta(outcome.meta),
          items: outcome.value ?? [],
          truncated: outcome.meta.truncated,
          observedAt: outcome.meta.observedAt,
          query: outcome.meta,
        };
      },
      async () => {
        const outcome = await fetchFact<WorkflowPayload>(
          env,
          runsPath,
          meter,
          limits,
          parseWorkflowRuns,
          null,
          now,
        );
        headWorkflowRuns = {
          state: stateFromMeta(outcome.meta),
          items: outcome.value?.runs ?? [],
          truncated: outcome.meta.truncated,
          observedAt: outcome.meta.observedAt,
          query: outcome.meta,
        };
      },
    ];
    for (let index = 0; index < tasks.length; index += limits.concurrency) {
      await Promise.all(tasks.slice(index, index + limits.concurrency).map((task) => task()));
    }
  }

  // Dependent reads are not attempted when the PR detail is unreadable. Count
  // only attempted queries here; notAttemptedQueries records the difference.
  const attemptedQueries = detail
    ? [detailOutcome.meta, reviews.query, headWorkflowRuns.query]
    : [detailOutcome.meta];
  const completedQueries = attemptedQueries.filter(
    (query) => query.status === "ok" || query.status === "not_modified",
  ).length;
  const failedQueries = attemptedQueries.filter((query) =>
    ["missing", "inaccessible", "rate_limited", "timeout", "unavailable"].includes(query.status),
  ).length;
  const truncatedSources = attemptedQueries
    .filter((query) => query.truncated)
    .map((query) => query.path);
  const reasons = attemptedQueries
    .filter(
      (query) =>
        query.status !== "ok" &&
        query.status !== "not_modified" &&
        query.status !== "skipped",
    )
    .map((query) => `${query.status}: ${query.path}${query.error ? ` (${query.error})` : ""}`);

  if (detailState !== "observed") {
    warnings.push(
      `PR detail for ${fullName}#${number} is ${detailState}; mergeability, reviews and head checks stay unknown, not zero.`,
    );
  }
  if (reviews.truncated) {
    warnings.push(
      `Review history for ${fullName}#${number} was truncated at ${REVIEWS_PER_PAGE}; an older effective review may be outside this window.`,
    );
  }
  if (headWorkflowRuns.truncated) {
    warnings.push(
      `Head workflow-run history for ${fullName}#${number} was truncated at ${HEAD_RUNS_PER_PAGE}; an absent workflow is unknown, not green.`,
    );
  }
  if (meter.halted === "budget_exhausted") {
    warnings.push(
      `PR detail collection stopped at the ${limits.maxRequests}-request budget; dependent facts are unknown.`,
    );
  }
  if (meter.halted === "upstream_rate_limited") {
    warnings.push(
      "GitHub rate limiting halted this PR detail read; dependent facts are unknown, not zero.",
    );
  }
  if (detail && headWorkflowRuns.state === "observed") {
    warnings.push(
      "Only GitHub Actions workflow runs for the head SHA are projected. Required checks supplied by other GitHub Apps or legacy commit statuses are outside this read and stay unknown.",
    );
  }
  warnings.push(
    "Hold/dependency intent is applied only when a trusted caller supplies explicit sourced evidence. PR text, comments, labels and ordinary AI review strings are not parsed as hold authority.",
  );
  if (!env.GITHUB_READ_TOKEN) {
    warnings.push(
      "GitHub read credential is missing; inaccessible PR sources stay inaccessible and are not reported as zero.",
    );
  }

  const status: PullRequestFactsStatus =
    detailState !== "observed"
      ? "unavailable"
      : queryStatus([reviews.query, headWorkflowRuns.query]) === "complete" &&
          !reviews.truncated &&
          !headWorkflowRuns.truncated
        ? "complete"
        : "partial";

  const credentialPresent = Boolean(env.GITHUB_READ_TOKEN);
  return {
    apiVersion: "v1",
    source: "github-rest",
    generatedAt: iso(now),
    repository: fullName,
    number,
    status,
    authentication: {
      mode: credentialPresent ? "authenticated" : "anonymous",
      credentialPresent,
      note: credentialPresent
        ? "A server-side GitHub read token is configured; it is never included in this public projection."
        : "No server-side GitHub read token is configured; unauthenticated reads may be lower-rate-limited or inaccessible.",
    },
    detail,
    reviews,
    headWorkflowRuns,
    budget: {
      scope: "per-pull-request",
      plannedRequests: 3,
      maxRequests: limits.maxRequests,
      usedRequests: meter.used,
      remainingRequests: Math.max(0, limits.maxRequests - meter.used),
      retries: meter.retries,
      notModifiedResponses: meter.notModified,
      concurrency: limits.concurrency,
      timeoutMs: limits.timeoutMs,
      refreshSeconds: limits.refreshSeconds,
      note: "Measured for this single PR projection only. The shared edge cache absorbs repeat views; this is not a global hourly cap.",
    },
    coverage: {
      status,
      plannedQueries: 3,
      completedQueries,
      failedQueries,
      notAttemptedQueries,
      truncatedSources,
      reasons,
    },
    warnings,
    ...(status === "unavailable" ? { error: "Pull request facts are unavailable" } : {}),
  };
}
