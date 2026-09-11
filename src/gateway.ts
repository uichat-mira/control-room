import { handleAiReviewRequest, type AiReviewEnv } from "./ai-review";
import { handleMcpRequest } from "./mcp";
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
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const apiRoute = pathname.startsWith("/api/");
    const mcpRoute = pathname === "/mcp";
    const aiReviewRoute = pathname.startsWith("/api/v1/ai-review/");

    if (!apiRoute && !mcpRoute) {
      return app.fetch(request, env);
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
