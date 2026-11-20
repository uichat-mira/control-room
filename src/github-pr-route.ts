import type { GitHubEnv } from "./github.ts";
import {
  collectPullRequestFacts,
  pilotRepositoryName,
  type PullRequestFactsSnapshot,
} from "./github-pr-facts.ts";
import { qualifyPullRequest } from "./github-pr-qualification.ts";

const API_VERSION = "v1";
const PR_CACHE_SCHEMA = "v1";
const PR_REFRESH_SECONDS = 60;
const PR_ISOLATE_FALLBACK_LIMIT = 50;

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

function cacheResponse(value: unknown, ttl: number) {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=30, s-maxage=${ttl}`,
    },
  });
}

type AuthState = "gh-auth" | "gh-anon";

interface LoadedPullRequestFacts {
  snapshot: PullRequestFactsSnapshot;
  cache: "hit" | "miss" | "bypass";
}

function authState(env: GitHubEnv): AuthState {
  return env.GITHUB_READ_TOKEN ? "gh-auth" : "gh-anon";
}

function requestKey(repository: string, number: number, state: AuthState): string {
  return `${repository}#${number}:${state}`;
}

function cacheKeys(
  request: Request,
  repository: string,
  number: number,
  env: GitHubEnv,
): { fresh: Request } {
  const url = new URL(request.url);
  const key = `${url.origin}/api/__github-pr-${PR_CACHE_SCHEMA}-${authState(env)}-${encodeURIComponent(repository)}-${number}`;
  return { fresh: new Request(key, { method: "GET" }) };
}

let isolateFallback = new Map<
  string,
  { snapshot: PullRequestFactsSnapshot; expiresAt: number }
>();

const inFlightLoads = new Map<string, Promise<LoadedPullRequestFacts>>();

async function bypassScan(
  env: GitHubEnv,
  repository: string,
  number: number,
): Promise<LoadedPullRequestFacts> {
  const state = authState(env);
  const key = requestKey(repository, number, state);
  const cached = isolateFallback.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { snapshot: cached.snapshot, cache: "bypass" };
  }
  const snapshot = await collectPullRequestFacts(env, repository, number, {
    limits: { refreshSeconds: PR_REFRESH_SECONDS },
  });
  if (isolateFallback.size >= PR_ISOLATE_FALLBACK_LIMIT) {
    isolateFallback = new Map();
  }
  isolateFallback.set(key, {
    snapshot,
    expiresAt: Date.now() + PR_REFRESH_SECONDS * 1000,
  });
  return { snapshot, cache: "bypass" };
}

async function loadUncoalescedPullRequest(
  request: Request,
  env: GitHubEnv,
  repository: string,
  number: number,
): Promise<LoadedPullRequestFacts> {
  let edgeCache: Cache | null = null;
  let keys: { fresh: Request } | null = null;
  try {
    edgeCache = (caches as CacheStorage & { default: Cache }).default;
    keys = cacheKeys(request, repository, number, env);
    const cached = await edgeCache.match(keys.fresh);
    if (cached) {
      try {
        return {
          snapshot: (await cached.json()) as PullRequestFactsSnapshot,
          cache: "hit",
        };
      } catch {
        // A corrupt cache entry is a miss, not an upstream failure.
      }
    }
  } catch {
    edgeCache = null;
    keys = null;
  }

  if (!edgeCache || !keys) {
    return bypassScan(env, repository, number);
  }

  const next = await collectPullRequestFacts(env, repository, number, {
    limits: { refreshSeconds: PR_REFRESH_SECONDS },
  });

  try {
    await edgeCache.put(keys.fresh, cacheResponse(next, PR_REFRESH_SECONDS));
  } catch {
    // A cache write failure must not trigger a second upstream scan.
    if (isolateFallback.size >= PR_ISOLATE_FALLBACK_LIMIT) {
      isolateFallback = new Map();
    }
    isolateFallback.set(requestKey(repository, number, authState(env)), {
      snapshot: next,
      expiresAt: Date.now() + PR_REFRESH_SECONDS * 1000,
    });
  }
  return { snapshot: next, cache: "miss" };
}

function loadPullRequest(
  request: Request,
  env: GitHubEnv,
  repository: string,
  number: number,
): Promise<LoadedPullRequestFacts> {
  const key = requestKey(repository, number, authState(env));
  const running = inFlightLoads.get(key);
  if (running) return running;

  const next = loadUncoalescedPullRequest(request, env, repository, number);
  inFlightLoads.set(key, next);
  const clear = () => {
    if (inFlightLoads.get(key) === next) inFlightLoads.delete(key);
  };
  void next.then(clear, clear);
  return next;
}

/**
 * On-demand, single-PR read-only projection. It deliberately does not list or
 * qualify every PR on every homepage view: one request reads at most one PR
 * detail, its reviews, and its head workflow runs, then shares the result via
 * the edge cache and isolate-local singleflight.
 */
export async function handleGitHubPullRequestRequest(
  request: Request,
  env: GitHubEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const repository = url.searchParams.get("repository") ?? "";
  const rawNumber = url.searchParams.get("number");
  const number = rawNumber ? Number(rawNumber) : NaN;

  if (!repository || !Number.isSafeInteger(number) || number <= 0) {
    return publicApiJson(
      {
        apiVersion: API_VERSION,
        status: "invalid_request",
        error: "repository_and_positive_number_required",
      },
      { status: 400 },
    );
  }

  const shortName = pilotRepositoryName(repository);
  if (!shortName) {
    return publicApiJson(
      {
        apiVersion: API_VERSION,
        status: "unsupported_repository",
        error: "repository_outside_pilot_allowlist",
      },
      { status: 404 },
    );
  }

  const fullName = `uichat-mira/${shortName}`;
  let snapshot: PullRequestFactsSnapshot;
  let cache: "hit" | "miss" | "bypass";
  try {
    ({ snapshot, cache } = await loadPullRequest(request, env, fullName, number));
  } catch {
    return publicApiJson(
      {
        apiVersion: API_VERSION,
        status: "unavailable",
        error: "pull_request_read_failed",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const qualification = qualifyPullRequest(snapshot);

  return publicApiJson(qualification, {
    headers: {
      "cache-control": "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
      "x-mira-api-version": API_VERSION,
      "x-mira-github-pr-status": qualification.status,
      "x-mira-github-pr-cache": cache,
      "x-mira-github-pr-scope": "pilot-6",
      "x-mira-github-pr-budget": `${snapshot.budget.usedRequests}/${snapshot.budget.maxRequests}`,
      "x-mira-github-pr-required-by-github": qualification.checks.requiredByGithub,
      "x-mira-github-pr-facts-status": snapshot.status,
    },
  });
}
