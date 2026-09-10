import { getCloudflareSnapshot, type CloudflareEnv, type CloudflareSnapshot } from "./cloudflare";
import {
  getGitHubGovernanceSnapshot,
  getGitHubSnapshot,
  type GitHubEnv,
  type GitHubGovernanceSnapshot,
} from "./github";
import { getServiceSnapshot } from "./services";
import type { OrganizationRepository, OrganizationSnapshot } from "./shared";

const AUTH_CORE_TTL_SECONDS = 15 * 60;
const ANON_CORE_TTL_SECONDS = 30 * 60;
const GOVERNANCE_TTL_SECONDS = 30 * 60;
const STALE_TTL_SECONDS = 24 * 60 * 60;
const CLOUDFLARE_TTL_SECONDS = 5 * 60;
const CORE_CACHE_SCHEMA = "v8";
const GOVERNANCE_CACHE_SCHEMA = "v2";

interface Env extends CloudflareEnv, GitHubEnv {
  DEPLOYED_COMMIT?: string;
}

interface CoreSnapshot {
  generatedAt: string;
  organization: OrganizationSnapshot["organization"];
  sources: OrganizationSnapshot["sources"];
  repositories: OrganizationRepository[];
  github?: OrganizationSnapshot["github"];
  cloudflare: CloudflareSnapshot;
  deployedCommit: string | null;
  error?: string;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

function coreCacheKeys(request: Request, env: Env) {
  const url = new URL(request.url);
  const cfState = env.CLOUDFLARE_READ_TOKEN ? "cf" : "no-cf";
  const ghState = env.GITHUB_READ_TOKEN ? "gh-auth" : "gh-anon";
  const prefix = `${url.origin}/api/__core-${CORE_CACHE_SCHEMA}-${cfState}-${ghState}`;
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

async function currentCore(request: Request, env: Env): Promise<CoreSnapshot> {
  const generatedAt = new Date().toISOString();
  const [github, cloudflare] = await Promise.all([
    getGitHubSnapshot(env),
    cachedCloudflare(request, env),
  ]);

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
    deployedCommit: env.DEPLOYED_COMMIT ?? null,
    error: github.error,
  };
}

async function cachedCore(request: Request, env: Env): Promise<CoreSnapshot> {
  const workerCaches = caches as CacheStorage & { default: Cache };
  const edgeCache = workerCaches.default;
  const keys = coreCacheKeys(request, env);
  const cached = await edgeCache.match(keys.fresh);

  if (cached) {
    const [snapshot, cloudflare] = await Promise.all([
      cached.json() as Promise<CoreSnapshot>,
      cachedCloudflare(request, env),
    ]);
    return {
      ...snapshot,
      sources: { ...snapshot.sources, cloudflare: cloudflare.status },
      cloudflare,
      deployedCommit: env.DEPLOYED_COMMIT ?? null,
    };
  }

  const next = await currentCore(request, env);
  if (next.sources.github === "connected") {
    const ttl = env.GITHUB_READ_TOKEN ? AUTH_CORE_TTL_SECONDS : ANON_CORE_TTL_SECONDS;
    await Promise.all([
      edgeCache.put(keys.fresh, cacheResponse(next, ttl)),
      edgeCache.put(keys.stale, cacheResponse(next, STALE_TTL_SECONDS)),
    ]);
    return next;
  }

  const stale = await edgeCache.match(keys.stale);
  if (!stale) return next;

  const previous = (await stale.json()) as CoreSnapshot;
  return {
    ...previous,
    sources: {
      github: "degraded",
      cloudflare: next.sources.cloudflare,
    },
    cloudflare: next.cloudflare,
    deployedCommit: env.DEPLOYED_COMMIT ?? null,
    error: next.error || "GitHub temporarily unavailable; showing last successful snapshot",
  };
}

async function resilientCore(request: Request, env: Env): Promise<CoreSnapshot> {
  try {
    return await cachedCore(request, env);
  } catch {
    return currentCore(request, env);
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
  const [core, services] = await Promise.all([resilientCore(request, env), getServiceSnapshot()]);
  const serviceIssue = services.some((service) => service.status !== "online");
  const githubIssue = core.sources.github === "degraded";
  const cloudflareIssue =
    core.sources.cloudflare === "degraded" &&
    core.cloudflare.workers.length === 0 &&
    core.cloudflare.pages.length === 0;

  return {
    ...core,
    services,
    status:
      githubIssue || cloudflareIssue || serviceIssue || buildFailed(core.repositories)
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "mira-control-room",
        version: "0.2.0",
        commit: env.DEPLOYED_COMMIT ?? null,
        githubAuth: env.GITHUB_READ_TOKEN ? "authenticated" : "anonymous",
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/organization" || url.pathname === "/api/summary") {
      const snapshot = await summary(request, env);
      return json(snapshot, {
        headers: {
          "x-mira-github": snapshot.sources.github,
          "x-mira-github-auth": env.GITHUB_READ_TOKEN ? "authenticated" : "anonymous",
          "x-mira-cloudflare": snapshot.sources.cloudflare,
        },
      });
    }

    if (url.pathname === "/api/governance") {
      return json(await governanceView(request, env));
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
