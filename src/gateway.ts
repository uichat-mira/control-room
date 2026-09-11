import { handleAiReviewRequest, type AiReviewEnv } from "./ai-review";
import {
  renderGitHubOverviewSvg,
  renderGitHubOverviewUnavailableSvg,
} from "./github-overview";
import { handleMcpRequest } from "./mcp";
import type { OrganizationSnapshot } from "./shared";
import app from "./worker";

type BaseEnv = Parameters<typeof app.fetch>[1];

type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

type Env = BaseEnv &
  AiReviewEnv & {
    API_RATE_LIMITER?: RateLimitBinding;
    HEALTH_RATE_LIMITER?: RateLimitBinding;
  };

const API_LIMIT_PER_MINUTE = 30;
const HEALTH_LIMIT_PER_MINUTE = 120;
const MCP_HOSTS = new Set([
  "uichat-mira-control-room.dangjingtao.workers.dev",
  "control.mira.tomz.io",
  "localhost",
  "127.0.0.1",
]);

function clientKey(request: Request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const forwardedIp = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwardedIp || "unknown";
}

async function isAllowed(binding: RateLimitBinding | undefined, key: string) {
  if (!binding) return true;

  try {
    return (await binding.limit({ key })).success;
  } catch {
    // The limiter protects the public surface but must not become a new availability dependency.
    return true;
  }
}

function tooManyRequests(limit: number) {
  return new Response(
    JSON.stringify(
      {
        error: "rate_limited",
        message: "Too many requests. Retry later.",
        retryAfterSeconds: 60,
      },
      null,
      2,
    ),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": "60",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "Retry-After, X-Mira-Rate-Limit-Policy",
        "x-content-type-options": "nosniff",
        "x-mira-rate-limit-policy": `${limit};w=60`,
      },
    },
  );
}

function withPolicyHeader(response: Response, limit: number) {
  const headers = new Headers(response.headers);
  headers.set("x-mira-rate-limit-policy", `${limit};w=60`);
  headers.set(
    "access-control-expose-headers",
    "Retry-After, X-Mira-Rate-Limit-Policy",
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function validateMcpOrigin(request: Request): Response | null {
  const requestHost = new URL(request.url).hostname.toLowerCase();
  if (!MCP_HOSTS.has(requestHost)) {
    return new Response("MCP host is not allowed", { status: 421 });
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    if (MCP_HOSTS.has(originHost)) return null;
  } catch {
    // Fall through to the same explicit rejection below.
  }

  return new Response("MCP origin is not allowed", { status: 403 });
}

function sharedAiReviewEnv(env: Env): AiReviewEnv {
  return {
    GITHUB_READ_TOKEN: env.GITHUB_READ_TOKEN,
    AI_REVIEW_GATEWAY_TOKEN: env.GITHUB_READ_TOKEN,
    AI_REVIEW_POLICY_REF: env.AI_REVIEW_POLICY_REF,
    AI_REVIEW_PRIMARY_ID: env.AI_REVIEW_PRIMARY_ID,
    AI_REVIEW_PRIMARY_ENDPOINT: env.AI_REVIEW_PRIMARY_ENDPOINT,
    AI_REVIEW_PRIMARY_API_KEY: env.AI_REVIEW_PRIMARY_API_KEY,
    AI_REVIEW_PRIMARY_MODEL: env.AI_REVIEW_PRIMARY_MODEL,
    AI_REVIEW_PRIMARY_RESPONSE_FORMAT: env.AI_REVIEW_PRIMARY_RESPONSE_FORMAT,
    AI_REVIEW_FALLBACK_ID: env.AI_REVIEW_FALLBACK_ID,
    AI_REVIEW_FALLBACK_ENDPOINT: env.AI_REVIEW_FALLBACK_ENDPOINT,
    AI_REVIEW_FALLBACK_API_KEY: env.AI_REVIEW_FALLBACK_API_KEY,
    AI_REVIEW_FALLBACK_MODEL: env.AI_REVIEW_FALLBACK_MODEL,
    AI_REVIEW_FALLBACK_RESPONSE_FORMAT: env.AI_REVIEW_FALLBACK_RESPONSE_FORMAT,
  };
}

function overviewSvgResponse(svg: string, status: string, method: string) {
  return new Response(method === "HEAD" ? null : svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "x-mira-snapshot-status": status,
    },
  });
}

function overviewCacheKey(request: Request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}/embed/__github-overview-cache.svg`, { method: "GET" });
}

async function readOverviewCache(request: Request): Promise<Response | null> {
  try {
    const workerCaches = caches as CacheStorage & { default: Cache };
    return (await workerCaches.default.match(overviewCacheKey(request))) ?? null;
  } catch {
    return null;
  }
}

async function writeOverviewCache(request: Request, response: Response) {
  try {
    const workerCaches = caches as CacheStorage & { default: Cache };
    await workerCaches.default.put(overviewCacheKey(request), response.clone());
  } catch {
    // Cache is an optimization. The embed must remain available without it.
  }
}

function headOnly(response: Response) {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function handleGitHubOverviewRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const cached = await readOverviewCache(request);
  if (cached) {
    return request.method === "HEAD" ? headOnly(cached) : cached;
  }

  try {
    const summaryUrl = new URL("/api/v1/summary", request.url);
    const summaryResponse = await app.fetch(
      new Request(summaryUrl, {
        method: "GET",
        headers: { accept: "application/json" },
      }),
      env,
    );

    if (!summaryResponse.ok) {
      throw new Error(`Summary returned ${summaryResponse.status}`);
    }

    const snapshot = (await summaryResponse.json()) as OrganizationSnapshot & {
      apiVersion?: string;
    };
    const response = overviewSvgResponse(
      renderGitHubOverviewSvg(snapshot),
      snapshot.status,
      "GET",
    );
    await writeOverviewCache(request, response);
    return request.method === "HEAD" ? headOnly(response) : response;
  } catch {
    const response = overviewSvgResponse(
      renderGitHubOverviewUnavailableSvg(),
      "unavailable",
      "GET",
    );
    await writeOverviewCache(request, response);
    return request.method === "HEAD" ? headOnly(response) : response;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const apiRoute = pathname.startsWith("/api/");
    const mcpRoute = pathname === "/mcp";
    const embedRoute = pathname === "/embed/github-overview.svg";
    const aiReviewRoute = pathname.startsWith("/api/v1/ai-review/");

    if (!apiRoute && !mcpRoute && !embedRoute) {
      return app.fetch(request, env);
    }

    if (embedRoute) {
      // GitHub may proxy this image through shared infrastructure, so keep the embed
      // public and outside the per-client API rate-limit bucket. A short edge cache
      // prevents repeated organization/service probes from direct image requests.
      return handleGitHubOverviewRequest(request, env);
    }

    if (mcpRoute) {
      const rejected = validateMcpOrigin(request);
      if (rejected) return rejected;
    }

    if (request.method === "OPTIONS") {
      if (aiReviewRoute) return handleAiReviewRequest(request, sharedAiReviewEnv(env));
      if (apiRoute) return app.fetch(request, env);
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          "access-control-allow-headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
          "access-control-max-age": "86400",
        },
      });
    }

    const healthRoute =
      pathname === "/api/health" ||
      pathname === "/api/v1/health" ||
      pathname === "/api/v1/ai-review/health";
    const limit = healthRoute ? HEALTH_LIMIT_PER_MINUTE : API_LIMIT_PER_MINUTE;
    const limiter = healthRoute ? env.HEALTH_RATE_LIMITER : env.API_RATE_LIMITER;
    const key = healthRoute
      ? `${clientKey(request)}:health`
      : `${clientKey(request)}:${aiReviewRoute ? "ai-review" : "public-read"}`;

    if (!(await isAllowed(limiter, key))) {
      return tooManyRequests(limit);
    }

    const response = aiReviewRoute
      ? await handleAiReviewRequest(request, sharedAiReviewEnv(env))
      : mcpRoute
        ? await handleMcpRequest(request, env)
        : await app.fetch(request, env);
    return withPolicyHeader(response, limit);
  },
};
