import type { GitHubEnv } from "./github";

const ORG = "uichat-mira";
const API = "https://api.github.com";

const REPOSITORIES_PER_PAGE = 100;
const WORKFLOW_RUNS_PER_PAGE = 5;
const PULL_REQUESTS_PER_PAGE = 5;

export interface PilotWorkflowTarget {
  file: string;
  label: string;
}

export interface PilotRepositoryTarget {
  name: string;
  channels: readonly string[];
  workflows: readonly PilotWorkflowTarget[];
  // OPS-033 identifies the formal release entry per repository. `null` means
  // the release entry (for example a tag-triggered workflow) is outside this
  // bounded workflow slice, so release status stays unknown rather than green.
  releaseWorkflow: string | null;
}

// OPS-033 pilot scope. Repository and workflow identities come from the
// six-repository Gate survey; this file does not decide which checks are
// required or whether a repository is healthy.
export const PILOT_REPOSITORIES: readonly PilotRepositoryTarget[] = [
  {
    name: "mira-desktop",
    channels: ["dev", "test", "prod"],
    workflows: [
      { file: "build-desktop.yml", label: "Build Desktop Apps" },
      { file: "branch-policy.yml", label: "Branch Policy" },
    ],
    // Formal release is the stable v* tag workflow, outside this bounded slice.
    releaseWorkflow: null,
  },
  {
    name: "mira-mobile",
    channels: ["dev", "test", "prod"],
    workflows: [
      { file: "mobile-ci.yml", label: "Mobile CI" },
      { file: "r2-release-truth.yml", label: "R2 Release Truth" },
    ],
    releaseWorkflow: "mobile-ci.yml",
  },
  {
    name: "cloud-auth",
    channels: ["dev", "test", "prod"],
    workflows: [
      { file: "ci.yml", label: "Cloud Auth CI" },
      { file: "deploy-prod.yml", label: "Deploy Cloud Auth Production" },
    ],
    releaseWorkflow: "deploy-prod.yml",
  },
  {
    name: "mira-cloud",
    channels: ["dev", "test", "prod"],
    workflows: [
      { file: "mira-gate.yml", label: "Mira Cloud Gate" },
      { file: "tencent-prod-deploy.yml", label: "Tencent Production Deploy" },
    ],
    releaseWorkflow: "tencent-prod-deploy.yml",
  },
  {
    name: "cloud-pi",
    channels: ["dev", "test", "prod"],
    workflows: [
      { file: "validate.yml", label: "Validate" },
      { file: "validate-container.yml", label: "Validate Cloud Pi Container" },
    ],
    // Manual direct deploy is outside this bounded slice.
    releaseWorkflow: null,
  },
  {
    name: "control-room",
    channels: ["dev", "test", "prod"],
    workflows: [{ file: "deploy.yml", label: "Control Room CI / Deploy" }],
    releaseWorkflow: "deploy.yml",
  },
];

export type FactQueryStatus =
  | "ok"
  | "not_modified"
  | "missing"
  | "inaccessible"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "skipped";

export type FactSourceState =
  | "observed"
  | "missing"
  | "inaccessible"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "skipped";

export interface FactQueryMeta {
  source: "github-rest";
  path: string;
  status: FactQueryStatus;
  httpStatus: number | null;
  fetchedAt: string;
  observedAt: string | null;
  cache: "upstream" | "not_modified" | "none";
  etag: string | null;
  truncated: boolean;
  retryAfterSeconds: number | null;
  skipReason: "budget_exhausted" | "upstream_rate_limited" | null;
  error: string | null;
}

export interface PilotBranchFact {
  name: string;
  state: FactSourceState;
  sha: string | null;
  protected: boolean | null;
  observedAt: string | null;
  query: FactQueryMeta;
}

export interface PilotWorkflowRunFact {
  id: number;
  name: string;
  path: string | null;
  event: string | null;
  status: string;
  conclusion: string | null;
  headBranch: string | null;
  headSha: string | null;
  attempt: number;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface PilotWorkflowFact {
  file: string;
  label: string;
  state: FactSourceState;
  runs: PilotWorkflowRunFact[];
  totalCount: number | null;
  observedAt: string | null;
  query: FactQueryMeta;
}

export interface PilotPullRequestFact {
  number: number;
  title: string;
  draft: boolean;
  baseRef: string;
  headSha: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface PilotPullRequestQuery {
  state: FactSourceState;
  items: PilotPullRequestFact[];
  truncated: boolean;
  observedAt: string | null;
  query: FactQueryMeta;
}

export interface PilotRepositoryCoverage {
  status: "complete" | "partial" | "unavailable";
  plannedQueries: number;
  completedQueries: number;
  failedQueries: number;
  budgetSkippedQueries: number;
  missingBranches: string[];
  truncatedSources: string[];
  reasons: string[];
}

export interface PilotRepositoryFacts {
  repository: string;
  name: string;
  defaultBranch: string | null;
  presence: "observed" | "missing" | "unknown";
  branches: PilotBranchFact[];
  workflows: PilotWorkflowFact[];
  pullRequests: PilotPullRequestQuery;
  coverage: PilotRepositoryCoverage;
}

export interface FactBudgetReport {
  scope: "per-snapshot-round";
  plannedRequests: number;
  maxRequests: number;
  usedRequests: number;
  remainingRequests: number;
  retries: number;
  notModifiedResponses: number;
  concurrency: number;
  timeoutMs: number;
  refreshSeconds: number;
  designTargetRestPerHour: 60;
  designTargetStatus: "unproven";
  globalBoundProven: false;
  note: string;
}

export interface FactRateLimitObservation {
  remaining: number | null;
  resetAt: string | null;
  retryAfterSeconds: number | null;
  observedAt: string | null;
}

export interface PilotFactsCoverage {
  repositoriesPlanned: number;
  repositoriesComplete: number;
  repositoriesPartial: number;
  repositoriesUnavailable: number;
  branchesPlanned: number;
  branchesObserved: number;
  branchesMissing: number;
  branchesUnavailable: number;
  workflowsPlanned: number;
  workflowsObserved: number;
  pullRequestListsObserved: number;
  truncatedSources: string[];
  budgetSkippedQueries: number;
}

export interface GitHubFactsSnapshot {
  apiVersion: "v1";
  source: "github-rest";
  generatedAt: string;
  status: "complete" | "partial" | "unavailable";
  authentication: {
    mode: "authenticated" | "anonymous";
    credentialPresent: boolean;
    note: string;
  };
  freshness: {
    observedAt: string;
    maxAgeSeconds: number;
    ageSeconds: number;
    state: "fresh" | "stale";
  };
  scope: {
    kind: "pilot-allowlist";
    organization: string;
    pilotRepositories: string[];
    listing: {
      status: FactQueryStatus;
      publicRepositories: number | null;
      outsidePilotRepositories: number | null;
      truncated: boolean;
      observedAt: string | null;
      query: FactQueryMeta;
    };
    note: string;
  };
  budget: FactBudgetReport;
  coverage: PilotFactsCoverage;
  rateLimit: FactRateLimitObservation;
  repositories: PilotRepositoryFacts[];
  warnings: string[];
  error?: string;
}

export interface GitHubFactLimits {
  maxRequests: number;
  concurrency: number;
  timeoutMs: number;
  maxRetries: number;
  maxRetryDelayMs: number;
  refreshSeconds: number;
}

export const DEFAULT_FACT_LIMITS: GitHubFactLimits = {
  // One deterministic round is 1 repository listing + 18 branch reads +
  // 11 explicit workflow reads + 6 pull-request lists = 36 REST requests.
  maxRequests: 40,
  concurrency: 4,
  timeoutMs: 8_000,
  maxRetries: 1,
  maxRetryDelayMs: 2_000,
  refreshSeconds: 60 * 60,
};

export interface CollectGitHubFactsOptions {
  limits?: Partial<GitHubFactLimits>;
  previous?: GitHubFactsSnapshot | null;
  now?: number;
}

export interface MeterState {
  used: number;
  retries: number;
  notModified: number;
  halted: "budget_exhausted" | "upstream_rate_limited" | null;
  rateLimit: FactRateLimitObservation;
}

interface ListingRepository {
  name: string;
  defaultBranch: string | null;
  archived: boolean;
}

interface RepositoryListing {
  items: ListingRepository[];
  publicRepositories: number;
}

interface BranchPayload {
  sha: string | null;
  protected: boolean | null;
}

export interface WorkflowPayload {
  runs: PilotWorkflowRunFact[];
  totalCount: number | null;
}

interface PullRequestPayload {
  items: PilotPullRequestFact[];
}

export interface ParsedValue<T> {
  value: T;
  truncated: boolean;
}

export interface PreviousEntry<T> {
  meta: FactQueryMeta;
  value: T;
}

// Callers may narrow a collection round but cannot widen its validated cost
// or timeout envelope. Non-finite runtime overrides fall back to safe defaults.
function boundedLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeLimits(input: Partial<GitHubFactLimits> | undefined): GitHubFactLimits {
  return {
    maxRequests: boundedLimit(input?.maxRequests, DEFAULT_FACT_LIMITS.maxRequests, 1, DEFAULT_FACT_LIMITS.maxRequests),
    concurrency: boundedLimit(input?.concurrency, DEFAULT_FACT_LIMITS.concurrency, 1, DEFAULT_FACT_LIMITS.concurrency),
    timeoutMs: boundedLimit(input?.timeoutMs, DEFAULT_FACT_LIMITS.timeoutMs, 1, DEFAULT_FACT_LIMITS.timeoutMs),
    maxRetries: boundedLimit(input?.maxRetries, DEFAULT_FACT_LIMITS.maxRetries, 0, DEFAULT_FACT_LIMITS.maxRetries),
    maxRetryDelayMs: boundedLimit(input?.maxRetryDelayMs, DEFAULT_FACT_LIMITS.maxRetryDelayMs, 0, DEFAULT_FACT_LIMITS.maxRetryDelayMs),
    refreshSeconds: boundedLimit(input?.refreshSeconds, DEFAULT_FACT_LIMITS.refreshSeconds, 1, 24 * 60 * 60),
  };
}

function headers(env: GitHubEnv, etag: string | null): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "uichat-mira-control-room",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(etag ? { "If-None-Match": etag } : {}),
    ...(env.GITHUB_READ_TOKEN ? { Authorization: `Bearer ${env.GITHUB_READ_TOKEN}` } : {}),
  };
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

function headerInt(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function retryAfterSeconds(response: Response, now: number): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds);
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

function observeRateLimit(response: Response, meter: MeterState, now: number): void {
  const remaining = headerInt(response, "x-ratelimit-remaining");
  const reset = headerInt(response, "x-ratelimit-reset");
  const retryAfter = retryAfterSeconds(response, now);
  if (remaining === null && reset === null && retryAfter === null) return;
  meter.rateLimit = {
    // Keep the latest known values; don't erase an observed Retry-After just
    // because a later successful response did not repeat it.
    remaining: remaining ?? meter.rateLimit.remaining,
    resetAt: reset === null ? meter.rateLimit.resetAt : iso(reset * 1000),
    retryAfterSeconds: retryAfter ?? meter.rateLimit.retryAfterSeconds,
    observedAt: iso(now),
  };
}

function timeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function skippedMeta(
  path: string,
  now: number,
  reason: "budget_exhausted" | "upstream_rate_limited",
): FactQueryMeta {
  return {
    source: "github-rest",
    path,
    status: "skipped",
    httpStatus: null,
    fetchedAt: iso(now),
    observedAt: null,
    cache: "none",
    etag: null,
    truncated: false,
    retryAfterSeconds: null,
    skipReason: reason,
    error:
      reason === "budget_exhausted"
        ? "Round request budget exhausted before this query"
        : "Upstream rate limit halted this collection round",
  };
}

export function failedMeta(
  path: string,
  now: number,
  status: Exclude<FactQueryStatus, "ok" | "not_modified" | "skipped">,
  options: { httpStatus?: number | null; retryAfter?: number | null; error: string },
): FactQueryMeta {
  return {
    source: "github-rest",
    path,
    status,
    httpStatus: options.httpStatus ?? null,
    fetchedAt: iso(now),
    observedAt: null,
    cache: "none",
    etag: null,
    truncated: false,
    retryAfterSeconds: options.retryAfter ?? null,
    skipReason: null,
    error: options.error,
  };
}

export async function fetchFact<T>(
  env: GitHubEnv,
  path: string,
  meter: MeterState,
  limits: GitHubFactLimits,
  parse: (payload: unknown) => ParsedValue<T> | null,
  previous: PreviousEntry<T> | null,
  now: number,
): Promise<{ meta: FactQueryMeta; value: T | null }> {
  if (meter.halted) {
    return { meta: skippedMeta(path, now, meter.halted), value: null };
  }

  let retried = 0;
  for (;;) {
    if (meter.used >= limits.maxRequests) {
      meter.halted = "budget_exhausted";
      return { meta: skippedMeta(path, now, "budget_exhausted"), value: null };
    }

    meter.used += 1;
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        headers: headers(env, previous?.meta.etag ?? null),
        signal: AbortSignal.timeout(limits.timeoutMs),
      });
    } catch (error) {
      if (timeoutError(error)) {
        return {
          meta: failedMeta(path, now, "timeout", {
            error: `GitHub API request exceeded ${limits.timeoutMs}ms`,
          }),
          value: null,
        };
      }
      return {
        meta: failedMeta(path, now, "unavailable", {
          error: error instanceof Error ? error.message : "GitHub API request failed",
        }),
        value: null,
      };
    }

    observeRateLimit(response, meter, now);

    if (response.status === 304) {
      meter.notModified += 1;
      if (!previous) {
        return {
          meta: failedMeta(path, now, "unavailable", {
            httpStatus: 304,
            error: "Unexpected 304 without a cached representation",
          }),
          value: null,
        };
      }
      return {
        meta: {
          source: "github-rest",
          path,
          status: "not_modified",
          httpStatus: 304,
          fetchedAt: iso(now),
          observedAt: previous.meta.observedAt,
          cache: "not_modified",
          etag: previous.meta.etag,
          truncated: previous.meta.truncated,
          retryAfterSeconds: retryAfterSeconds(response, now),
          skipReason: null,
          error: null,
        },
        value: previous.value,
      };
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          meta: failedMeta(path, now, "unavailable", {
            httpStatus: response.status,
            error: "GitHub API returned an unreadable JSON payload",
          }),
          value: null,
        };
      }
      const parsed = parse(payload);
      if (!parsed) {
        return {
          meta: failedMeta(path, now, "unavailable", {
            httpStatus: response.status,
            error: "GitHub API payload did not match the expected public shape",
          }),
          value: null,
        };
      }
      return {
        meta: {
          source: "github-rest",
          path,
          status: "ok",
          httpStatus: response.status,
          fetchedAt: iso(now),
          observedAt: iso(now),
          cache: "upstream",
          etag: response.headers.get("etag"),
          truncated: parsed.truncated,
          retryAfterSeconds: retryAfterSeconds(response, now),
          skipReason: null,
          error: null,
        },
        value: parsed.value,
      };
    }

    if (response.status === 404) {
      return {
        meta: failedMeta(path, now, "missing", {
          httpStatus: 404,
          error: "GitHub resource was not found at observation time",
        }),
        value: null,
      };
    }

    if (response.status === 403 || response.status === 429) {
      const remaining = headerInt(response, "x-ratelimit-remaining");
      const retryAfter = retryAfterSeconds(response, now);
      // GitHub secondary limits can return 403 with Retry-After while the
      // primary remaining counter is still non-zero. Treat that as a limit,
      // not as a permanent permission denial.
      const rateLimited =
        response.status === 429 || remaining === 0 || retryAfter !== null;

      if (!rateLimited) {
        return {
          meta: failedMeta(path, now, "inaccessible", {
            httpStatus: response.status,
            error: "GitHub resource is not readable with the current public read scope",
          }),
          value: null,
        };
      }

      if (
        retried < limits.maxRetries &&
        retryAfter !== null &&
        retryAfter * 1000 <= limits.maxRetryDelayMs
      ) {
        meter.retries += 1;
        retried += 1;
        await sleep(retryAfter * 1000);
        continue;
      }

      meter.halted = "upstream_rate_limited";
      return {
        meta: failedMeta(path, now, "rate_limited", {
          httpStatus: response.status,
          retryAfter,
          error:
            retryAfter === null
              ? "GitHub rate limit reached; no bounded Retry-After was available"
              : `GitHub rate limit reached; Retry-After ${retryAfter}s is outside the bounded retry window`,
        }),
        value: null,
      };
    }

    return {
      meta: failedMeta(path, now, "unavailable", {
        httpStatus: response.status,
        error: `GitHub API ${response.status}`,
      }),
      value: null,
    };
  }
}

function parseRepositoryListing(payload: unknown): ParsedValue<RepositoryListing> | null {
  if (!Array.isArray(payload)) return null;
  const items: ListingRepository[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (row.visibility !== "public" || typeof row.name !== "string") continue;
    items.push({
      name: row.name,
      defaultBranch: typeof row.default_branch === "string" ? row.default_branch : null,
      archived: row.archived === true,
    });
  }
  return {
    value: { items, publicRepositories: items.length },
    truncated: payload.length >= REPOSITORIES_PER_PAGE,
  };
}

function parseBranch(payload: unknown): ParsedValue<BranchPayload> | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as { commit?: { sha?: unknown }; protected?: unknown };
  const sha = row.commit?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{7,64}$/i.test(sha)) return null;
  return {
    value: { sha, protected: typeof row.protected === "boolean" ? row.protected : null },
    truncated: false,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseWorkflowRuns(payload: unknown): ParsedValue<WorkflowPayload> | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as { workflow_runs?: unknown; total_count?: unknown };
  if (!Array.isArray(row.workflow_runs)) return null;

  const runs: PilotWorkflowRunFact[] = [];
  for (const entry of row.workflow_runs) {
    if (!entry || typeof entry !== "object") continue;
    const run = entry as Record<string, unknown>;
    if (typeof run.id !== "number" || !Number.isSafeInteger(run.id) || run.id <= 0) continue;
    const createdAt = optionalString(run.created_at);
    const updatedAt = optionalString(run.updated_at);
    const htmlUrl = optionalString(run.html_url);
    const name = optionalString(run.name);
    const status = optionalString(run.status);
    if (!createdAt || !updatedAt || !htmlUrl || !name || !status) continue;
    runs.push({
      id: run.id,
      name,
      path: optionalString(run.path),
      event: optionalString(run.event),
      status,
      conclusion: optionalString(run.conclusion),
      headBranch: optionalString(run.head_branch),
      headSha: optionalString(run.head_sha),
      attempt:
        typeof run.run_attempt === "number" && Number.isSafeInteger(run.run_attempt)
          ? run.run_attempt
          : 1,
      htmlUrl,
      createdAt,
      updatedAt,
    });
  }

  const totalCount =
    typeof row.total_count === "number" && Number.isSafeInteger(row.total_count)
      ? row.total_count
      : null;
  return {
    value: { runs, totalCount },
    truncated:
      totalCount !== null
        ? totalCount > runs.length
        : row.workflow_runs.length >= WORKFLOW_RUNS_PER_PAGE,
  };
}

function parsePullRequests(payload: unknown): ParsedValue<PullRequestPayload> | null {
  if (!Array.isArray(payload)) return null;
  const items: PilotPullRequestFact[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as {
      number?: unknown;
      title?: unknown;
      draft?: unknown;
      base?: { ref?: unknown };
      head?: { sha?: unknown };
      updated_at?: unknown;
      html_url?: unknown;
    };
    if (typeof row.number !== "number" || !Number.isSafeInteger(row.number) || row.number <= 0) {
      continue;
    }
    if (
      typeof row.title !== "string" ||
      typeof row.base?.ref !== "string" ||
      typeof row.head?.sha !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.html_url !== "string"
    ) {
      continue;
    }
    items.push({
      number: row.number,
      title: row.title,
      draft: row.draft === true,
      baseRef: row.base.ref,
      headSha: row.head.sha,
      updatedAt: row.updated_at,
      htmlUrl: row.html_url,
    });
  }
  return {
    value: { items },
    truncated: payload.length >= PULL_REQUESTS_PER_PAGE,
  };
}

export function stateFromMeta(meta: FactQueryMeta): FactSourceState {
  switch (meta.status) {
    case "ok":
    case "not_modified":
      return "observed";
    case "missing":
      return "missing";
    case "inaccessible":
      return "inaccessible";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "unavailable":
      return "unavailable";
    case "skipped":
      return "skipped";
  }
}

function branchPath(repository: string, branch: string): string {
  return `/repos/${ORG}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}`;
}

function workflowRunsPath(repository: string, file: string): string {
  return `/repos/${ORG}/${encodeURIComponent(repository)}/actions/workflows/${encodeURIComponent(file)}/runs?per_page=${WORKFLOW_RUNS_PER_PAGE}`;
}

function pullRequestsPath(repository: string): string {
  return `/repos/${ORG}/${encodeURIComponent(repository)}/pulls?state=open&sort=updated&direction=desc&per_page=${PULL_REQUESTS_PER_PAGE}`;
}

function indexPrevious(snapshot: GitHubFactsSnapshot | null): Map<string, PreviousEntry<unknown>> {
  const entries = new Map<string, PreviousEntry<unknown>>();
  if (!snapshot) return entries;

  for (const repository of snapshot.repositories) {
    for (const branch of repository.branches) {
      entries.set(branch.query.path, {
        meta: branch.query,
        value: { sha: branch.sha, protected: branch.protected } satisfies BranchPayload,
      });
    }
    for (const workflow of repository.workflows) {
      entries.set(workflow.query.path, {
        meta: workflow.query,
        value: { runs: workflow.runs, totalCount: workflow.totalCount } satisfies WorkflowPayload,
      });
    }
    entries.set(repository.pullRequests.query.path, {
      meta: repository.pullRequests.query,
      value: { items: repository.pullRequests.items } satisfies PullRequestPayload,
    });
  }
  return entries;
}

function previousValue<T>(
  entries: Map<string, PreviousEntry<unknown>>,
  path: string,
): PreviousEntry<T> | null {
  const entry = entries.get(path);
  return entry ? (entry as PreviousEntry<T>) : null;
}

async function runBatches(
  tasks: Array<() => Promise<void>>,
  concurrency: number,
): Promise<void> {
  for (let index = 0; index < tasks.length; index += concurrency) {
    await Promise.all(tasks.slice(index, index + concurrency).map((task) => task()));
  }
}

function repositoryCoverage(
  branches: PilotBranchFact[],
  workflows: PilotWorkflowFact[],
  pullRequests: PilotPullRequestQuery,
): PilotRepositoryCoverage {
  const queries = [
    ...branches.map((branch) => branch.query),
    ...workflows.map((workflow) => workflow.query),
    pullRequests.query,
  ];
  const completed = queries.filter(
    (query) => query.status === "ok" || query.status === "not_modified",
  ).length;
  const failed = queries.filter((query) =>
    ["missing", "inaccessible", "rate_limited", "timeout", "unavailable"].includes(query.status),
  ).length;
  const skipped = queries.filter((query) => query.status === "skipped").length;
  const missingBranches = branches
    .filter((branch) => branch.state === "missing")
    .map((branch) => branch.name);
  const truncatedSources = queries.filter((query) => query.truncated).map((query) => query.path);
  const reasons = queries
    .filter(
      (query) =>
        query.status !== "ok" &&
        query.status !== "not_modified" &&
        // Skipped targets are aggregated by budgetSkippedQueries and the
        // round-level warning instead of emitting one line per target.
        query.status !== "skipped",
    )
    .map((query) => `${query.status}: ${query.path}${query.error ? ` (${query.error})` : ""}`);

  return {
    status:
      completed === 0
        ? "unavailable"
        : completed < queries.length
          ? "partial"
          : "complete",
    plannedQueries: queries.length,
    completedQueries: completed,
    failedQueries: failed,
    budgetSkippedQueries: skipped,
    missingBranches,
    truncatedSources,
    reasons,
  };
}

function coverageStatus(
  repository: PilotRepositoryFacts,
  presence: "observed" | "missing" | "unknown",
): "complete" | "partial" | "unavailable" {
  if (presence === "missing") return "unavailable";
  return repository.coverage.status;
}

export function decorateFactFreshness(
  snapshot: GitHubFactsSnapshot,
  now = Date.now(),
): GitHubFactsSnapshot {
  const observed = Date.parse(snapshot.freshness.observedAt);
  const ageSeconds = Number.isFinite(observed)
    ? Math.max(0, Math.floor((now - observed) / 1000))
    : 0;
  return {
    ...snapshot,
    freshness: {
      ...snapshot.freshness,
      ageSeconds,
      state: ageSeconds <= snapshot.freshness.maxAgeSeconds ? "fresh" : "stale",
    },
  };
}

export async function collectGitHubFacts(
  env: GitHubEnv = {},
  options: CollectGitHubFactsOptions = {},
): Promise<GitHubFactsSnapshot> {
  const now = options.now ?? Date.now();
  const limits = normalizeLimits(options.limits);
  const meter: MeterState = {
    used: 0,
    retries: 0,
    notModified: 0,
    halted: null,
    rateLimit: { remaining: null, resetAt: null, retryAfterSeconds: null, observedAt: null },
  };
  const previous = indexPrevious(options.previous ?? null);

  const listingPath = `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=${REPOSITORIES_PER_PAGE}`;
  const listing = await fetchFact<RepositoryListing>(
    env,
    listingPath,
    meter,
    limits,
    parseRepositoryListing,
    null,
    now,
  );

  const branches: PilotBranchFact[][] = PILOT_REPOSITORIES.map(() => []);
  const workflows: PilotWorkflowFact[][] = PILOT_REPOSITORIES.map(() => []);
  const pullRequests: Array<PilotPullRequestQuery | null> = PILOT_REPOSITORIES.map(() => null);
  const tasks: Array<() => Promise<void>> = [];

  for (const [repositoryIndex, target] of PILOT_REPOSITORIES.entries()) {
    for (const [channelIndex, channel] of target.channels.entries()) {
      const path = branchPath(target.name, channel);
      tasks.push(async () => {
        const prior = previousValue<BranchPayload>(previous, path);
        const outcome = await fetchFact<BranchPayload>(
          env,
          path,
          meter,
          limits,
          parseBranch,
          prior,
          now,
        );
        const state = stateFromMeta(outcome.meta);
        branches[repositoryIndex][channelIndex] = {
          name: channel,
          state,
          sha: state === "observed" ? (outcome.value?.sha ?? null) : null,
          protected: state === "observed" ? (outcome.value?.protected ?? null) : null,
          observedAt: outcome.meta.observedAt,
          query: outcome.meta,
        };
      });
    }

    for (const [workflowIndex, workflow] of target.workflows.entries()) {
      const path = workflowRunsPath(target.name, workflow.file);
      tasks.push(async () => {
        const prior = previousValue<WorkflowPayload>(previous, path);
        const outcome = await fetchFact<WorkflowPayload>(
          env,
          path,
          meter,
          limits,
          parseWorkflowRuns,
          prior,
          now,
        );
        const state = stateFromMeta(outcome.meta);
        workflows[repositoryIndex][workflowIndex] = {
          file: workflow.file,
          label: workflow.label,
          state,
          runs: state === "observed" ? (outcome.value?.runs ?? []) : [],
          totalCount: state === "observed" ? (outcome.value?.totalCount ?? null) : null,
          observedAt: outcome.meta.observedAt,
          query: outcome.meta,
        };
      });
    }

    {
      const path = pullRequestsPath(target.name);
      tasks.push(async () => {
        const prior = previousValue<PullRequestPayload>(previous, path);
        const outcome = await fetchFact<PullRequestPayload>(
          env,
          path,
          meter,
          limits,
          parsePullRequests,
          prior,
          now,
        );
        const state = stateFromMeta(outcome.meta);
        pullRequests[repositoryIndex] = {
          state,
          items: state === "observed" ? (outcome.value?.items ?? []) : [],
          truncated: outcome.meta.truncated,
          observedAt: outcome.meta.observedAt,
          query: outcome.meta,
        };
      });
    }
  }

  await runBatches(tasks, limits.concurrency);

  const repositories: PilotRepositoryFacts[] = PILOT_REPOSITORIES.map((target, index) => {
    const presence: "observed" | "missing" | "unknown" =
      listing.value === null
        ? "unknown"
        : listing.value.items.some((item) => item.name === target.name)
          ? "observed"
          : "missing";
    const pullRequestQuery: PilotPullRequestQuery = pullRequests[index] ?? {
      state: "unavailable",
      items: [],
      truncated: false,
      observedAt: null,
      query: failedMeta(pullRequestsPath(target.name), now, "unavailable", {
        error: "Pull request query did not produce a result",
      }),
    };
    const repositoryBranches = branches[index];
    const repositoryWorkflows = workflows[index];
    const coverage = repositoryCoverage(repositoryBranches, repositoryWorkflows, pullRequestQuery);
    const listedDefaultBranch = listing.value?.items.find(
      (item) => item.name === target.name,
    )?.defaultBranch;
    const result: PilotRepositoryFacts = {
      repository: `${ORG}/${target.name}`,
      name: target.name,
      // Observe the current listing; the OPS-033 matrix is only an allowlist hint.
      defaultBranch: listedDefaultBranch ?? null,
      presence,
      branches: repositoryBranches,
      workflows: repositoryWorkflows,
      pullRequests: pullRequestQuery,
      coverage,
    };
    return {
      ...result,
      coverage: { ...coverage, status: coverageStatus(result, presence) },
    };
  });

  const warnings: string[] = [];
  if (listing.value === null) {
    warnings.push(
      `Public repository listing unavailable (${listing.meta.status}); allowlist presence is unknown, not missing.`,
    );
  } else {
    if (listing.meta.truncated) {
      warnings.push(
        `Public repository listing was truncated at ${REPOSITORIES_PER_PAGE}; outside-pilot coverage is incomplete.`,
      );
    }
    const outside = listing.value.items.filter(
      (item) => !PILOT_REPOSITORIES.some((target) => target.name === item.name),
    ).length;
    if (outside > 0) {
      warnings.push(
        `${outside} public repositor${outside === 1 ? "y is" : "ies are"} outside the pilot scope and were not assessed; they are not healthy by omission.`,
      );
    }
  }

  for (const repository of repositories) {
    for (const reason of repository.coverage.reasons) {
      warnings.push(`${repository.repository}: ${reason}`);
    }
    for (const branch of repository.coverage.missingBranches) {
      warnings.push(
        `${repository.repository}: target branch ${branch} was missing at observation time; this is not proof it never existed.`,
      );
    }
    for (const source of repository.coverage.truncatedSources) {
      warnings.push(`${repository.repository}: candidate list truncated for ${source}.`);
    }
    if (repository.presence === "missing") {
      warnings.push(
        `${repository.repository}: not present in the public organization listing; status is unavailable, not zero runs.`,
      );
    }
  }

  if (meter.halted === "budget_exhausted") {
    warnings.push(
      `Collection stopped at the per-round request budget (${limits.maxRequests} requests); remaining targets are unknown.`,
    );
  }
  if (meter.halted === "upstream_rate_limited") {
    warnings.push(
      "GitHub rate limiting halted this collection round; remaining targets are unknown, not zero.",
    );
  }
  const credentialPresent = Boolean(env.GITHUB_READ_TOKEN);
  if (!credentialPresent) {
    warnings.push(
      "GitHub read credential is missing; inaccessible sources stay inaccessible and are not reported as zero.",
    );
  }

  const repositoryComplete = repositories.filter(
    (repository) => repository.coverage.status === "complete",
  ).length;
  const repositoryUnavailable = repositories.filter(
    (repository) => repository.coverage.status === "unavailable",
  ).length;
  const repositoryPartial = repositories.length - repositoryComplete - repositoryUnavailable;
  const branchFacts = repositories.flatMap((repository) => repository.branches);
  const workflowFacts = repositories.flatMap((repository) => repository.workflows);
  const truncatedSources = Array.from(
    new Set([
      ...repositories.flatMap((repository) => repository.coverage.truncatedSources),
      ...(listing.meta.truncated ? [listingPath] : []),
    ]),
  );
  const budgetSkippedQueries = repositories.reduce(
    (total, repository) => total + repository.coverage.budgetSkippedQueries,
    0,
  );
  const outsidePilotRepositories =
    listing.value === null
      ? null
      : listing.value.items.filter(
          (item) => !PILOT_REPOSITORIES.some((target) => target.name === item.name),
        ).length;

  const status: GitHubFactsSnapshot["status"] =
    repositoryUnavailable === repositories.length
      ? "unavailable"
      : repositoryPartial > 0 ||
          repositoryUnavailable > 0 ||
          budgetSkippedQueries > 0 ||
          truncatedSources.length > 0 ||
          listing.meta.status !== "ok"
        ? "partial"
        : "complete";

  const observedAt = iso(now);
  const plannedRequests = 1 + tasks.length;

  return {
    apiVersion: "v1",
    source: "github-rest",
    generatedAt: observedAt,
    status,
    authentication: {
      mode: credentialPresent ? "authenticated" : "anonymous",
      credentialPresent,
      note: credentialPresent
        ? "A server-side GitHub read token is configured; it is never included in this public projection."
        : "No server-side GitHub read token is configured; unauthenticated reads may be lower-rate-limited or inaccessible.",
    },
    freshness: {
      observedAt,
      maxAgeSeconds: limits.refreshSeconds,
      ageSeconds: 0,
      state: "fresh",
    },
    scope: {
      kind: "pilot-allowlist",
      organization: ORG,
      pilotRepositories: PILOT_REPOSITORIES.map((target) => `${ORG}/${target.name}`),
      listing: {
        status: listing.meta.status,
        publicRepositories: listing.value?.publicRepositories ?? null,
        outsidePilotRepositories,
        truncated: listing.meta.truncated,
        observedAt: listing.meta.observedAt,
        query: listing.meta,
      },
      note: "Only the six OPS-033 pilot repositories are assessed. Repositories outside this allowlist are unknown for this projection, not healthy.",
    },
    budget: {
      scope: "per-snapshot-round",
      plannedRequests,
      maxRequests: limits.maxRequests,
      usedRequests: meter.used,
      remainingRequests: Math.max(0, limits.maxRequests - meter.used),
      retries: meter.retries,
      notModifiedResponses: meter.notModified,
      concurrency: limits.concurrency,
      timeoutMs: limits.timeoutMs,
      refreshSeconds: limits.refreshSeconds,
      designTargetRestPerHour: 60,
      designTargetStatus: "unproven",
      globalBoundProven: false,
      note:
        "Measured per snapshot round only. The 60 REST/hour value is an unmeasured design target, not an enforced global limit: Cloudflare edge cache is per cache location/isolate and separate cache keys, auth states or frequent cache misses can each refresh. This shared snapshot is designed to refresh at most once per refreshSeconds per cache location.",
    },
    coverage: {
      repositoriesPlanned: repositories.length,
      repositoriesComplete: repositoryComplete,
      repositoriesPartial: repositoryPartial,
      repositoriesUnavailable: repositoryUnavailable,
      branchesPlanned: branchFacts.length,
      branchesObserved: branchFacts.filter((branch) => branch.state === "observed").length,
      branchesMissing: branchFacts.filter((branch) => branch.state === "missing").length,
      branchesUnavailable: branchFacts.filter(
        (branch) => branch.state !== "observed" && branch.state !== "missing",
      ).length,
      workflowsPlanned: workflowFacts.length,
      workflowsObserved: workflowFacts.filter((workflow) => workflow.state === "observed").length,
      pullRequestListsObserved: repositories.filter(
        (repository) => repository.pullRequests.state === "observed",
      ).length,
      truncatedSources,
      budgetSkippedQueries,
    },
    rateLimit: meter.rateLimit,
    repositories,
    warnings,
    ...(status === "unavailable" ? { error: "Pilot GitHub facts are unavailable" } : {}),
  };
}
