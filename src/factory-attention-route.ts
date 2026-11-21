import type { GitHubEnv } from "./github.ts";
import type { FactoryRunProjection } from "./factory-read-model.ts";
import {
  qualifyWorkerAttention,
  type FactoryAttentionRun,
  type WorkerIssueLink,
  type WorkerIssueLookup,
} from "./factory-attention.ts";
import { readWorkerIssueState } from "./factory-attention-facts.ts";

const API_VERSION = "v1";
const ATTENTION_ISSUE_CACHE_SCHEMA = "v1";
const ATTENTION_ISSUE_REFRESH_SECONDS = 60;
const ISOLATE_FALLBACK_LIMIT = 50;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Accept, Content-Type",
  "access-control-max-age": "86400",
  "x-content-type-options": "nosniff",
};

const publicApiJson = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders,
      ...init.headers,
    },
  });

type IssueCacheState = "hit" | "miss" | "bypass";

export type FactoryRunLoader = (
  repository: string,
  runId: number,
  includeReporter: boolean,
) => Promise<FactoryRunProjection>;

interface LoadedIssue {
  lookup: WorkerIssueLookup;
  cache: IssueCacheState;
}

let isolateFallback = new Map<string, { lookup: WorkerIssueLookup; expiresAt: number }>();

function authState(env: GitHubEnv): "gh-auth" | "gh-anon" {
  return env.GITHUB_READ_TOKEN ? "gh-auth" : "gh-anon";
}

function cacheKey(
  request: Request,
  env: GitHubEnv,
  repository: string,
  issueNumber: number,
): string {
  const url = new URL(request.url);
  return `${url.origin}/api/__factory-attention-issue-${ATTENTION_ISSUE_CACHE_SCHEMA}-${authState(env)}-${encodeURIComponent(repository)}-${issueNumber}`;
}

function cacheResponse(value: unknown, ttl: number): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=30, s-maxage=${ttl}`,
    },
  });
}

function fallbackGet(key: string): WorkerIssueLookup | null {
  const cached = isolateFallback.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    isolateFallback.delete(key);
    return null;
  }
  return cached.lookup;
}

function fallbackSet(key: string, lookup: WorkerIssueLookup): void {
  if (isolateFallback.size >= ISOLATE_FALLBACK_LIMIT) {
    isolateFallback = new Map();
  }
  isolateFallback.set(key, {
    lookup,
    expiresAt: Date.now() + ATTENTION_ISSUE_REFRESH_SECONDS * 1000,
  });
}

/**
 * One bounded Issue-state read, cached by repository/Issue/auth state. This is
 * the only extra GitHub request the attention route can add; it never scans the
 * Factory Feed or Workers Observability.
 */
async function loadIssue(
  request: Request,
  env: GitHubEnv,
  repository: string,
  issueNumber: number,
): Promise<LoadedIssue> {
  const key = cacheKey(request, env, repository, issueNumber);
  let edgeCache: Cache | null = null;

  try {
    edgeCache = (caches as CacheStorage & { default: Cache }).default;
    const cached = await edgeCache.match(new Request(key, { method: "GET" }));
    if (cached) {
      try {
        return {
          lookup: (await cached.json()) as WorkerIssueLookup,
          cache: "hit",
        };
      } catch {
        // A corrupt cache entry is a miss, not an upstream fact.
      }
    }
  } catch {
    edgeCache = null;
  }

  if (!edgeCache) {
    const fallback = fallbackGet(key);
    if (fallback) return { lookup: fallback, cache: "bypass" };
  }

  const lookup = await readWorkerIssueState(env, repository, issueNumber);

  if (edgeCache) {
    try {
      await edgeCache.put(
        new Request(key, { method: "GET" }),
        cacheResponse(lookup, ATTENTION_ISSUE_REFRESH_SECONDS),
      );
    } catch {
      fallbackSet(key, lookup);
    }
  } else {
    fallbackSet(key, lookup);
  }

  return { lookup, cache: "miss" };
}

function issueLinkFor(
  projection: FactoryRunProjection,
  issueNumber: number,
): WorkerIssueLink {
  return {
    repository: projection.repository,
    issueNumber,
    runId: projection.run.id,
    attempt: projection.run.attempt,
    source: "trusted-reporter",
    observedAt: projection.reporter.observedAt ?? projection.generatedAt,
    url: `https://github.com/${projection.repository}/issues/${issueNumber}`,
  };
}

function errorResponse(error: unknown): Response {
  const reason = error instanceof Error ? error.message : "factory_attention_unavailable";
  const status = [
    "unsupported_repository",
    "repository_not_public",
    "invalid_run_id",
    "not_external_worker_run",
    "GitHub API 404",
  ].includes(reason)
    ? 404
    : 503;
  return publicApiJson(
    { apiVersion: API_VERSION, status: "unavailable", error: reason },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * On-demand, read-only qualification for one real External Worker Run.
 *
 * Default is GitHub-only (`includeReporter=false`) and therefore never triggers
 * a Cloudflare Workers Observability query. `includeReporter=true` is an explicit
 * detail action that reuses the existing cached Factory projection; only then can
 * a trusted escalated/blocked state exist. A verified Reporter Issue number
 * enables exactly one bounded, cached Issue-state read.
 */
export async function handleFactoryAttentionRequest(
  request: Request,
  env: GitHubEnv,
  loadRun: FactoryRunLoader,
): Promise<Response> {
  const url = new URL(request.url);
  const repository = url.searchParams.get("repository") ?? "";
  const rawRunId = url.searchParams.get("runId");
  const runId = rawRunId ? Number(rawRunId) : NaN;

  if (!repository || !/^uichat-mira\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return publicApiJson(
      {
        apiVersion: API_VERSION,
        status: "invalid_request",
        error: "repository_must_be_a_public_uichat-mira_repository",
      },
      { status: 400 },
    );
  }
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return publicApiJson(
      {
        apiVersion: API_VERSION,
        status: "invalid_request",
        error: "positive_runId_required",
      },
      { status: 400 },
    );
  }

  const includeReporter = url.searchParams.get("includeReporter") === "true";

  let projection: FactoryRunProjection;
  try {
    projection = await loadRun(repository, runId, includeReporter);
  } catch (error) {
    return errorResponse(error);
  }

  // The canonical projection only exposes issueNumber from a trusted Reporter
  // event. A GitHub-only projection is null and stays unknown; no number is
  // guessed from display_title, branch, or artifact names.
  const issueNumber =
    includeReporter &&
    projection.reporter.status === "available" &&
    projection.reporter.events.some((event) => event.issueNumber !== null)
      ? projection.issueNumber
      : null;

  let issue: WorkerIssueLink | null = null;
  let issueLookup: WorkerIssueLookup | null = null;
  let issueCache: IssueCacheState = "bypass";
  let apiResolved = false;

  if (issueNumber !== null) {
    issue = issueLinkFor(projection, issueNumber);
    try {
      const loaded = await loadIssue(request, env, repository, issueNumber);
      issueLookup = loaded.lookup;
      issueCache = loaded.cache;
      apiResolved = true;
    } catch {
      issueLookup = null;
      issueCache = "bypass";
    }
  }

  const run: FactoryAttentionRun = { projection, issue, issueLookup };
  const qualification = qualifyWorkerAttention([run]);
  const candidate = qualification.candidates[0];

  if (!candidate) {
    return publicApiJson(
      { apiVersion: API_VERSION, status: "unavailable", error: "no_candidate" },
      { status: 503 },
    );
  }

  const payload = {
    ...candidate,
    scope: {
      kind: "single-run",
      repository: projection.repository,
      runId: projection.run.id,
      attempt: projection.run.attempt,
      note: "One canonical Factory projection is assessed on demand. The Factory Feed was not scanned; this is not an organization-wide count and cannot prove that no newer same-Issue Run exists.",
    },
    budget: {
      scope: "per-attention-read",
      additionalGithubRequests: issue ? 1 : 0,
      issueReadAttempted: issue !== null,
      issueReadResolved: apiResolved,
      reporterQueried: includeReporter,
      note: "The lifecycle projection reuses the existing Factory read/cache budget. This route adds at most one bounded, cached Issue-state read and never scans Workers Observability unless includeReporter=true was explicitly requested.",
    },
    warnings: Array.from(
      new Set([...qualification.warnings, ...candidate.warnings]),
    ),
  };

  return publicApiJson(payload, {
    headers: {
      "cache-control": "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
      "x-mira-api-version": API_VERSION,
      "x-mira-factory-attention-status": candidate.status,
      "x-mira-factory-attention-classification": candidate.classification,
      "x-mira-factory-attention-source": includeReporter
        ? "github+trusted-reporter"
        : "github-only",
      "x-mira-factory-attention-issue-read": issue ? "1" : "0",
      "x-mira-factory-attention-issue-cache": issueCache,
      "x-mira-factory-attention-coverage": candidate.coverage.status,
      "x-mira-factory-attention-reporter": candidate.reporter.status,
    },
  });
}
