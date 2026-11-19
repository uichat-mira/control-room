import { getCloudflareSnapshot, type CloudflareEnv, type CloudflareSnapshot } from "./cloudflare";
import {
  getGitHubGovernanceSnapshot,
  getGitHubSnapshot,
  type GitHubEnv,
  type GitHubGovernanceSnapshot,
  type GitHubSnapshot,
} from "./github";
import { openApiDocument } from "./openapi";
import { getServiceSnapshot } from "./services";
import { getFactoryRunProjection, type FactoryRunProjection } from "./factory-read-model";
import { getFactoryFeed, type FactoryFeed } from "./factory-feed";
import type { OrganizationRepository, OrganizationSnapshot } from "./shared";

const AUTH_GITHUB_TTL_SECONDS = 15 * 60;
const ANON_GITHUB_TTL_SECONDS = 30 * 60;
const GOVERNANCE_TTL_SECONDS = 30 * 60;
const STALE_TTL_SECONDS = 24 * 60 * 60;
const CLOUDFLARE_TTL_SECONDS = 5 * 60;
const GITHUB_CACHE_SCHEMA = "v9";
const GOVERNANCE_CACHE_SCHEMA = "v2";
const API_VERSION = "v1";

interface Env extends CloudflareEnv, GitHubEnv {
  DEPLOYED_COMMIT?: string;
}

type GitHubCoreSnapshot = GitHubSnapshot & {
  generatedAt: string;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Accept, Content-Type",
  "access-control-max-age": "86400",
  "x-content-type-options": "nosniff",
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders,
      ...init.headers,
    },
  });

const publicApiJson = (body: unknown, init: ResponseInit = {}) =>
  json(body, {
    ...init,
    headers: {
      "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
      "x-mira-api-version": API_VERSION,
      ...init.headers,
    },
  });

function legacyHeaders(successor: string) {
  return {
    deprecation: "true",
    link: `<${successor}>; rel=\"successor-version\"`,
  };
}

function githubCacheKeys(request: Request, env: Env) {
  const url = new URL(request.url);
  const ghState = env.GITHUB_READ_TOKEN ? "gh-auth" : "gh-anon";
  const prefix = `${url.origin}/api/__github-${GITHUB_CACHE_SCHEMA}-${ghState}`;
  return {
    fresh: new Request(`${prefix}-fresh`, { method: "GET" }),
    stale: new Request(`${prefix}-stale`, { method: "GET" }),
  };
}

function governanceCacheKeys(request: Request, env: Env) {
  const url = new URL(request.url);
  const ghState = env.GITHUB_READ_TOKEN ? "gh-auth" : "gh-anon";
  const prefix = `${url.origin}/api/__governance-${GOVERNANCE_CACHE_SCHEMA}-${ghState}`;
  return {
    fresh: new Request(`${prefix}-fresh`, { method: "GET" }),
    stale: new Request(`${prefix}-stale`, { method: "GET" }),
  };
}

function factoryCacheKey(request: Request, repository: string, runId: number, includeReporter: boolean) {
  const url = new URL(request.url);
  const key = new URL("/api/__factory-v1", url.origin);
  key.searchParams.set("repository", repository);
  key.searchParams.set("runId", String(runId));
  key.searchParams.set("includeReporter", String(includeReporter));
  return new Request(key, { method: "GET" });
}

function factoryCacheTtl(snapshot: FactoryRunProjection) {
  if (snapshot.run.status !== "completed") return 15;
  if (snapshot.reporter.status === "available" && snapshot.reporter.events.length > 0) return 6 * 60 * 60;
  if (snapshot.reporter.status === "not_expected" || snapshot.run.conclusion === "skipped") return 10 * 60;
  if (snapshot.reporter.status === "unavailable") return 5 * 60;
  if (snapshot.reporter.status === "expired") return 60 * 60;
  return 10 * 60;
}

async function cachedFactoryRun(
  request: Request,
  env: Env,
  repository: string,
  runId: number,
  includeReporter: boolean,
): Promise<FactoryRunProjection> {
  let edgeCache: Cache | null = null;
  let key: Request | null = null;

  try {
    const workerCaches = caches as CacheStorage & { default: Cache };
    edgeCache = workerCaches.default;
    key = factoryCacheKey(request, repository, runId, includeReporter);
    const cached = await edgeCache.match(key);
    if (cached) return (await cached.json()) as FactoryRunProjection;
  } catch {
    // Cache is an optimization. Upstream lifecycle reads still execute exactly once.
  }

  const next = await getFactoryRunProjection(env, env, repository, runId, Date.now(), includeReporter);

  if (edgeCache && key) {
    try {
      await edgeCache.put(key, cacheResponse(next, factoryCacheTtl(next)));
    } catch {
      // Cache write failure must not change the lifecycle projection.
    }
  }

  return next;
}

async function cachedFactoryFeed(request: Request, env: Env): Promise<FactoryFeed> {
  // A full organization scan is a bounded, shared snapshot, never one scan per viewer.
  const origin = new URL(request.url).origin;
  const key = new Request(origin + "/api/__factory-feed-v1-" + (env.GITHUB_READ_TOKEN ? "auth" : "anon"));
  let edgeCache: Cache | null = null;
  try {
    edgeCache = (caches as CacheStorage & { default: Cache }).default;
    const hit = await edgeCache.match(key);
    if (hit) return await hit.json() as FactoryFeed;
  } catch {
    edgeCache = null;
  }

  const feed = await getFactoryFeed(env);
  if (edgeCache) {
    try {
      await edgeCache.put(key, cacheResponse(feed, feed.status === "connected" ? 120 : 30));
    } catch {
      // The upstream read must not be repeated when cache storage is unavailable.
    }
  }
  return feed;
}

function cloudflareCacheKey(request: Request, env: Env) {
  const url = new URL(request.url);
  const configState = env.CLOUDFLARE_READ_TOKEN ? "cf" : "no-cf";
  const deploy = env.DEPLOYED_COMMIT ?? "local";
  return new Request(`${url.origin}/api/__cloudflare-${deploy}-${configState}`, { method: "GET" });
}

function cacheResponse(value: unknown, ttl: number) {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=60, s-maxage=${ttl}`,
    },
  });
}

async function cachedCloudflare(request: Request, env: Env): Promise<CloudflareSnapshot> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_READ_TOKEN) {
    return getCloudflareSnapshot(env);
  }

  try {
    const workerCaches = caches as CacheStorage & { default: Cache };
    const edgeCache = workerCaches.default;
    const key = cloudflareCacheKey(request, env);
    const cached = await edgeCache.match(key);
    if (cached) return (await cached.json()) as CloudflareSnapshot;

    const next = await getCloudflareSnapshot(env);
    const ttl = next.status === "connected" ? CLOUDFLARE_TTL_SECONDS : 60;
    await edgeCache.put(key, cacheResponse(next, ttl));
    return next;
  } catch {
    return getCloudflareSnapshot(env);
  }
}

async function currentGitHub(env: Env): Promise<GitHubCoreSnapshot> {
  return {
    ...(await getGitHubSnapshot(env)),
    generatedAt: new Date().toISOString(),
  };
}

async function cachedGitHub(request: Request, env: Env): Promise<GitHubCoreSnapshot> {
  try {
    const workerCaches = caches as CacheStorage & { default: Cache };
    const edgeCache = workerCaches.default;
    const keys = githubCacheKeys(request, env);
    const cached = await edgeCache.match(keys.fresh);
    if (cached) return (await cached.json()) as GitHubCoreSnapshot;

    const next = await currentGitHub(env);
    if (next.status === "connected") {
      const ttl = env.GITHUB_READ_TOKEN ? AUTH_GITHUB_TTL_SECONDS : ANON_GITHUB_TTL_SECONDS;
      await Promise.all([
        edgeCache.put(keys.fresh, cacheResponse(next, ttl)),
        edgeCache.put(keys.stale, cacheResponse(next, STALE_TTL_SECONDS)),
      ]);
      return next;
    }

    const stale = await edgeCache.match(keys.stale);
    if (!stale) return next;

    const previous = (await stale.json()) as GitHubCoreSnapshot;
    const authenticated = Boolean(env.GITHUB_READ_TOKEN);
    return {
      ...previous,
      status: "degraded",
      authenticated,
      github: { ...previous.github, authenticated },
      error: next.error || "GitHub temporarily unavailable; showing last successful snapshot",
    };
  } catch {
    return currentGitHub(env);
  }
}

async function cachedGovernance(request: Request, env: Env): Promise<GitHubGovernanceSnapshot> {
  try {
    const workerCaches = caches as CacheStorage & { default: Cache };
    const edgeCache = workerCaches.default;
    const keys = governanceCacheKeys(request, env);
    const cached = await edgeCache.match(keys.fresh);
    if (cached) return (await cached.json()) as GitHubGovernanceSnapshot;

    const next = await getGitHubGovernanceSnapshot(env);
    if (next.status === "connected") {
      await Promise.all([
        edgeCache.put(keys.fresh, cacheResponse(next, GOVERNANCE_TTL_SECONDS)),
        edgeCache.put(keys.stale, cacheResponse(next, STALE_TTL_SECONDS)),
      ]);
      return next;
    }

    const stale = await edgeCache.match(keys.stale);
    if (!stale) return next;
    const previous = (await stale.json()) as GitHubGovernanceSnapshot;
    return {
      ...previous,
      status: "degraded",
      governanceStatus: "partial",
      error: next.error || "GitHub governance temporarily unavailable; showing last successful snapshot",
    };
  } catch {
    return getGitHubGovernanceSnapshot(env);
  }
}

function buildFailed(repositories: OrganizationRepository[]): boolean {
  return repositories.some((repo) => {
    const run = repo.latestWorkflow;
    if (!run || run.status !== "completed") return false;

    const failed = ["failure", "timed_out", "action_required", "startup_failure"].includes(
      run.conclusion ?? "",
    );
    if (!failed) return false;

    const releaseAt = repo.latestRelease?.publishedAt;
    if (releaseAt && new Date(releaseAt).getTime() > new Date(run.updatedAt).getTime()) {
      return false;
    }

    return true;
  });
}

async function summary(request: Request, env: Env): Promise<OrganizationSnapshot> {
  const generatedAt = new Date().toISOString();
  const [github, cloudflare, services] = await Promise.all([
    cachedGitHub(request, env),
    cachedCloudflare(request, env),
    getServiceSnapshot(),
  ]);
  const serviceIssue = services.some((service) => service.status !== "online");
  const githubIssue = github.status === "degraded";
  const cloudflareIssue =
    cloudflare.status === "degraded" &&
    cloudflare.workers.length === 0 &&
    cloudflare.pages.length === 0;

  return {
    generatedAt,
    organization: github.organization,
    sources: {
      github: github.status,
      cloudflare: cloudflare.status,
    },
    repositories: github.repositories,
    github: github.github,
    cloudflare,
    services,
    deployedCommit: env.DEPLOYED_COMMIT ?? null,
    error: github.error,
    status:
      githubIssue || cloudflareIssue || serviceIssue || buildFailed(github.repositories)
        ? "degraded"
        : "connected",
  };
}

async function governanceView(request: Request, env: Env) {
  const snapshot = await cachedGovernance(request, env);
  return {
    generatedAt: snapshot.generatedAt,
    organization: {
      login: "uichat-mira",
      htmlUrl: "https://github.com/uichat-mira",
    },
    github: {
      authenticated: snapshot.authenticated,
      governanceStatus: snapshot.governanceStatus,
      projects: snapshot.projects,
    },
    repositories: snapshot.repositories,
    status: snapshot.status,
    error: snapshot.error,
  };
}

function health(env: Env) {
  return {
    ok: true,
    service: "mira-control-room",
    version: "0.2.0",
    commit: env.DEPLOYED_COMMIT ?? null,
    githubAuth: env.GITHUB_READ_TOKEN ? "authenticated" : "anonymous",
    now: new Date().toISOString(),
  };
}

function v1Envelope<T extends object>(payload: T) {
  return { apiVersion: API_VERSION, ...payload };
}

function serviceStatus(services: Awaited<ReturnType<typeof getServiceSnapshot>>) {
  return services.some((service) => service.status !== "online") ? "degraded" : "connected";
}

async function v1Route(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname === "/api/v1") {
    return publicApiJson({
      apiVersion: API_VERSION,
      name: "Mira Organization Observability API",
      readOnly: true,
      scope: "public-safe",
      documentation: "/openapi.json",
      endpoints: [
        "/api/v1/health",
        "/api/v1/summary",
        "/api/v1/repos",
        "/api/v1/builds",
        "/api/v1/services",
        "/api/v1/deployments",
        "/api/v1/analytics",
        "/api/v1/governance",
        "/api/v1/projects",
        "/api/v1/factory/runs",
        "/api/v1/factory/run?repository=uichat-mira/mira-mobile&runId=...",
      ],
    });
  }

  if (pathname === "/api/v1/health") {
    return publicApiJson(v1Envelope(health(env)));
  }

  if (pathname === "/api/v1/summary") {
    const snapshot = await summary(request, env);
    return publicApiJson(v1Envelope(snapshot), {
      headers: {
        "x-mira-github": snapshot.sources.github,
        "x-mira-github-auth": env.GITHUB_READ_TOKEN ? "authenticated" : "anonymous",
        "x-mira-cloudflare": snapshot.sources.cloudflare,
      },
    });
  }

  if (pathname === "/api/v1/repos" || pathname === "/api/v1/builds") {
    const github = await cachedGitHub(request, env);
    if (pathname === "/api/v1/repos") {
      return publicApiJson(v1Envelope({
        generatedAt: github.generatedAt,
        status: github.status,
        items: github.repositories,
      }));
    }
    return publicApiJson(v1Envelope({
      generatedAt: github.generatedAt,
      status: github.status,
      items: github.repositories.map((repo) => ({
        repository: repo.fullName,
        htmlUrl: repo.htmlUrl,
        defaultBranch: repo.defaultBranch,
        workflow: repo.latestWorkflow,
        release: repo.latestRelease,
      })),
    }));
  }

  if (pathname === "/api/v1/services") {
    const services = await getServiceSnapshot();
    return publicApiJson(v1Envelope({
      generatedAt: new Date().toISOString(),
      status: serviceStatus(services),
      items: services,
    }));
  }

  if (pathname === "/api/v1/deployments" || pathname === "/api/v1/analytics") {
    const cloudflare = await cachedCloudflare(request, env);
    if (pathname === "/api/v1/deployments") {
      return publicApiJson(v1Envelope({
        generatedAt: new Date().toISOString(),
        status: cloudflare.status,
        workers: cloudflare.workers,
        pages: cloudflare.pages,
      }));
    }
    return publicApiJson(v1Envelope({
      generatedAt: new Date().toISOString(),
      ...cloudflare.analytics24h,
    }));
  }

  if (pathname === "/api/v1/factory/runs") {
    try {
      const feed = await cachedFactoryFeed(request, env);
      return publicApiJson(feed, {
        headers: { "cache-control": "public, max-age=30, s-maxage=60" },
      });
    } catch {
      return publicApiJson({
        apiVersion: "v1", status: "unavailable", source: "github-actions",
        error: "Worker discovery temporarily unavailable",
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  }

  if (pathname === "/api/v1/factory/run") {
    const url = new URL(request.url);
    const repository = url.searchParams.get("repository");
    const rawRunId = url.searchParams.get("runId");
    const runId = rawRunId ? Number(rawRunId) : NaN;

    if (!repository || !Number.isSafeInteger(runId) || runId <= 0) {
      return publicApiJson(v1Envelope({
        status: "invalid_request",
        error: "repository_and_positive_runId_required",
      }), { status: 400 });
    }

    try {
      const includeReporter = url.searchParams.get("includeReporter") !== "false";
      const projection = await cachedFactoryRun(request, env, repository, runId, includeReporter);
      return publicApiJson(v1Envelope(projection), {
        headers: {
          "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
          "x-mira-factory-source": includeReporter ? "github+trusted-reporter" : "github-only",
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "factory_run_unavailable";
      const status = [
        "unsupported_repository",
        "repository_not_public",
        "invalid_run_id",
        "not_external_worker_run",
        "GitHub API 404",
      ].includes(reason) ? 404 : 503;
      return publicApiJson(v1Envelope({
        status: "unavailable",
        error: reason,
      }), { status });
    }
  }

  if (pathname === "/api/v1/governance" || pathname === "/api/v1/projects") {
    const governance = await governanceView(request, env);
    if (pathname === "/api/v1/projects") {
      return publicApiJson(v1Envelope({
        generatedAt: governance.generatedAt,
        status: governance.github.projects.status,
        items: governance.github.projects.items,
        error: governance.github.projects.error,
      }));
    }
    return publicApiJson(v1Envelope(governance));
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && (url.pathname.startsWith("/api/") || url.pathname === "/openapi.json")) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      if (url.pathname.startsWith("/api/") || url.pathname === "/openapi.json") {
        return json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "GET, OPTIONS" } });
      }
      return new Response("Not Found", { status: 404 });
    }

    if (url.pathname === "/openapi.json" || url.pathname === "/api/v1/openapi.json") {
      return publicApiJson(openApiDocument(url.origin), {
        headers: { "cache-control": "public, max-age=300, s-maxage=3600" },
      });
    }

    const versioned = await v1Route(request, env, url.pathname);
    if (versioned) return versioned;

    if (url.pathname === "/api/health") {
      return json(health(env), { headers: legacyHeaders("/api/v1/health") });
    }

    if (url.pathname === "/api/organization" || url.pathname === "/api/summary") {
      const snapshot = await summary(request, env);
      return json(snapshot, {
        headers: {
          ...legacyHeaders("/api/v1/summary"),
          "x-mira-github": snapshot.sources.github,
          "x-mira-github-auth": env.GITHUB_READ_TOKEN ? "authenticated" : "anonymous",
          "x-mira-cloudflare": snapshot.sources.cloudflare,
        },
      });
    }

    if (url.pathname === "/api/governance") {
      return json(await governanceView(request, env), { headers: legacyHeaders("/api/v1/governance") });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
};