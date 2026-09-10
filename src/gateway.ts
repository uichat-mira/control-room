import app from "./worker";

type BaseEnv = Parameters<typeof app.fetch>[1];

type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

type Env = BaseEnv & {
  API_RATE_LIMITER?: RateLimitBinding;
  HEALTH_RATE_LIMITER?: RateLimitBinding;
};

const API_LIMIT_PER_MINUTE = 30;
const HEALTH_LIMIT_PER_MINUTE = 120;

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
    // The limiter protects the API but must not become a new availability dependency.
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (!pathname.startsWith("/api/") || request.method === "OPTIONS") {
      return app.fetch(request, env);
    }

    const healthRoute = pathname === "/api/health" || pathname === "/api/v1/health";
    const limit = healthRoute ? HEALTH_LIMIT_PER_MINUTE : API_LIMIT_PER_MINUTE;
    const limiter = healthRoute ? env.HEALTH_RATE_LIMITER : env.API_RATE_LIMITER;
    const key = `${clientKey(request)}:${healthRoute ? "health" : "api"}`;

    if (!(await isAllowed(limiter, key))) {
      return tooManyRequests(limit);
    }

    return withPolicyHeader(await app.fetch(request, env), limit);
  },
};
