import { getCloudflareSnapshot, type CloudflareEnv, type CloudflareSnapshot } from "./cloudflare";
import { getGitHubSnapshot } from "./github";
import { getServiceSnapshot } from "./services";
import type { OrganizationRepository, OrganizationSnapshot } from "./shared";

const CORE_TTL_SECONDS = 15 * 60;
const STALE_TTL_SECONDS = 24 * 60 * 60;

interface Env extends CloudflareEnv {
  DEPLOYED_COMMIT?: string;
}

interface CoreSnapshot {
  generatedAt: string;
  organization: OrganizationSnapshot["organization"];
  sources: OrganizationSnapshot["sources"];
  repositories: OrganizationRepository[];
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

function cacheKeys(request: Request, env: Env) {
  const url = new URL(request.url);
  const configState = env.CLOUDFLARE_READ_TOKEN ? "cf" : "no-cf";
  const prefix = `${url.origin}/api/__core-v4-${configState}`;
  return {
    fresh: new Request(`${prefix}-fresh`, { method: "GET" }),
    stale: new Request(`${prefix}-stale`, { method: "GET" }),
  };
}

function cacheResponse(snapshot: CoreSnapshot, ttl: number) {
  return new Response(JSON.stringify(snapshot), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=60, s-maxage=${ttl}`,
    },
  });
}

async function currentCore(env: Env): Promise<CoreSnapshot> {
  const generatedAt = new Date().toISOString();
  const [github, cloudflare] = await Promise.all([
    getGitHubSnapshot(),
    getCloudflareSnapshot(env),
  ]);

  return {
    generatedAt,
    organization: github.organization,
    sources: {
      github: github.status,
      cloudflare: cloudflare.status,
    },
    repositories: github.repositories,
    cloudflare,
    deployedCommit: env.DEPLOYED_COMMIT ?? null,
    error: github.error,
  };
}

async function cachedCore(request: Request, env: Env): Promise<CoreSnapshot> {
  const workerCaches = caches as CacheStorage & { default: Cache };
  const edgeCache = workerCaches.default;
  const keys = cacheKeys(request, env);
  const cached = await edgeCache.match(keys.fresh);

  if (cached) {
    const snapshot = (await cached.json()) as CoreSnapshot;
    return { ...snapshot, deployedCommit: env.DEPLOYED_COMMIT ?? null };
  }

  const next = await currentCore(env);
  if (next.sources.github === "connected") {
    await Promise.all([
      edgeCache.put(keys.fresh, cacheResponse(next, CORE_TTL_SECONDS)),
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
  const [core, services] = await Promise.all([cachedCore(request, env), getServiceSnapshot()]);
  const serviceIssue = services.some((service) => service.status !== "online");
  const sourceIssue = core.sources.github === "degraded" || core.sources.cloudflare === "degraded";

  return {
    ...core,
    services,
    status: sourceIssue || serviceIssue || buildFailed(core.repositories) ? "degraded" : "connected",
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
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/organization" || url.pathname === "/api/summary") {
      const snapshot = await summary(request, env);
      return json(snapshot, {
        headers: {
          "x-mira-github": snapshot.sources.github,
          "x-mira-cloudflare": snapshot.sources.cloudflare,
        },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
