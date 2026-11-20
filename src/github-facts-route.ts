import {
  collectGitHubFacts,
  decorateFactFreshness,
  type GitHubFactsSnapshot,
} from "./github-facts.ts";
import { qualifyGitHubGates } from "./github-gate-facts.ts";
import type { GitHubEnv } from "./github.ts";

const API_VERSION = "v1";
const FACTS_CACHE_SCHEMA = "v1";
const FACTS_REFRESH_SECONDS = 60 * 60;
const FACTS_STALE_TTL_SECONDS = 24 * 60 * 60;

// If the Workers cache API is unavailable, keep at most one scan per isolate
// per refresh window instead of turning each visitor into a GitHub fan-out.
let isolateFallback: {
  authState: "gh-auth" | "gh-anon";
  snapshot: GitHubFactsSnapshot;
  expiresAt: number;
} | null = null;

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
      "cache-control": `public, max-age=60, s-maxage=${ttl}`,
    },
  });
}

function factsCacheKeys(request: Request, env: GitHubEnv) {
  const url = new URL(request.url);
  const ghState = env.GITHUB_READ_TOKEN ? "gh-auth" : "gh-anon";
  const prefix = `${url.origin}/api/__github-facts-${FACTS_CACHE_SCHEMA}-${ghState}`;
  return {
    fresh: new Request(`${prefix}-fresh`, { method: "GET" }),
    stale: new Request(`${prefix}-stale`, { method: "GET" }),
  };
}

type AuthState = "gh-auth" | "gh-anon";

async function bypassScan(
  env: GitHubEnv,
  authState: AuthState,
): Promise<{ snapshot: GitHubFactsSnapshot; cache: "bypass" }> {
  // Cache is an optimization. A missing cache must not force one GitHub scan
  // per browser request, so an isolate-local snapshot absorbs repeated reads.
  if (
    isolateFallback?.authState === authState &&
    isolateFallback.expiresAt > Date.now()
  ) {
    return { snapshot: isolateFallback.snapshot, cache: "bypass" };
  }
  const snapshot = await collectGitHubFacts(env, {
    limits: { refreshSeconds: FACTS_REFRESH_SECONDS },
  });
  isolateFallback = {
    authState,
    snapshot,
    expiresAt: Date.now() + FACTS_REFRESH_SECONDS * 1000,
  };
  return { snapshot, cache: "bypass" };
}

type FactsLoad = { snapshot: GitHubFactsSnapshot; cache: "hit" | "miss" | "bypass" };

// An edge Cache miss is not a lock. Concurrent visitors in the same isolate
// must share one outstanding refresh instead of multiplying its 36 REST calls.
// Cross-isolate/POP coordination remains unproven and is reported as such.
const inFlightLoads = new Map<string, Promise<FactsLoad>>();

async function loadUncoalescedGitHubFactsSnapshot(
  request: Request,
  env: GitHubEnv,
): Promise<FactsLoad> {
  const authState: AuthState = env.GITHUB_READ_TOKEN ? "gh-auth" : "gh-anon";
  let edgeCache: Cache | null = null;
  let keys: ReturnType<typeof factsCacheKeys> | null = null;

  try {
    edgeCache = (caches as CacheStorage & { default: Cache }).default;
    keys = factsCacheKeys(request, env);
    const cached = await edgeCache.match(keys.fresh);
    if (cached) {
      try {
        return { snapshot: (await cached.json()) as GitHubFactsSnapshot, cache: "hit" };
      } catch {
        // A corrupt cache entry is a miss, not an upstream failure.
      }
    }
  } catch {
    edgeCache = null;
    keys = null;
  }

  if (!edgeCache || !keys) {
    return bypassScan(env, authState);
  }

  let previous: GitHubFactsSnapshot | null = null;
  try {
    const stale = await edgeCache.match(keys.stale);
    if (stale) previous = (await stale.json()) as GitHubFactsSnapshot;
  } catch {
    previous = null;
  }

  const next = await collectGitHubFacts(env, {
    previous,
    limits: { refreshSeconds: FACTS_REFRESH_SECONDS },
  });

  try {
    await Promise.all([
      edgeCache.put(keys.fresh, cacheResponse(next, FACTS_REFRESH_SECONDS)),
      edgeCache.put(keys.stale, cacheResponse(next, FACTS_STALE_TTL_SECONDS)),
    ]);
  } catch {
    // A cache write failure must not trigger a second upstream scan.
    isolateFallback = {
      authState,
      snapshot: next,
      expiresAt: Date.now() + FACTS_REFRESH_SECONDS * 1000,
    };
  }
  return { snapshot: next, cache: "miss" };
}

export function loadGitHubFactsSnapshot(
  request: Request,
  env: GitHubEnv,
): Promise<FactsLoad> {
  const key = `${new URL(request.url).origin}:${env.GITHUB_READ_TOKEN ? "gh-auth" : "gh-anon"}`;
  const running = inFlightLoads.get(key);
  if (running) return running;

  const next = loadUncoalescedGitHubFactsSnapshot(request, env);
  inFlightLoads.set(key, next);
  const clear = () => {
    if (inFlightLoads.get(key) === next) inFlightLoads.delete(key);
  };
  // Both success and failure release the lock. Do not create an unhandled
  // rejected promise from a detached .finally() chain.
  void next.then(clear, clear);
  return next;
}

export async function handleGitHubFactsRequest(
  request: Request,
  env: GitHubEnv,
): Promise<Response> {
  const { snapshot, cache } = await loadGitHubFactsSnapshot(request, env);
  const facts = decorateFactFreshness(snapshot);
  return publicApiJson(
    facts,
    {
      headers: {
        "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
        "x-mira-api-version": API_VERSION,
        "x-mira-github-facts-status": facts.status,
        "x-mira-github-facts-cache": cache,
        "x-mira-github-facts-scope": "pilot-6",
        "x-mira-github-facts-budget": `${facts.budget.usedRequests}/${facts.budget.maxRequests}`,
      },
    },
  );
}

/**
 * OPS-035 Gate/Release qualification. It derives from the exact same shared
 * OPS-034 snapshot, so this route performs zero additional GitHub reads and
 * inherits the isolate-local singleflight/cache/budget evidence.
 */
export async function handleGitHubGateRequest(
  request: Request,
  env: GitHubEnv,
): Promise<Response> {
  const { snapshot, cache } = await loadGitHubFactsSnapshot(request, env);
  const facts = decorateFactFreshness(snapshot);
  const qualification = qualifyGitHubGates(facts);
  return publicApiJson(qualification, {
    headers: {
      "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
      "x-mira-api-version": API_VERSION,
      "x-mira-github-gates-status": qualification.coverage.status,
      "x-mira-github-gates-cache": cache,
      "x-mira-github-gates-scope": "pilot-6",
      "x-mira-github-gates-facts-status": facts.status,
      "x-mira-github-gates-budget": `${facts.budget.usedRequests}/${facts.budget.maxRequests}`,
      "x-mira-github-gates-required-by-github": qualification.requiredCheckEvidence,
      "x-mira-github-gates-production-evidence": qualification.productionEvidence,
    },
  });
}
