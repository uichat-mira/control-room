import {
  AI_REVIEW_RUNTIME_VERSION,
  REVIEW_PACKAGE_VERSION,
  ReviewPackageError,
  buildReviewPackageData,
  type AiReviewPackageEnv,
} from "./ai-review-package";

export interface AiReviewEnv extends AiReviewPackageEnv {
  AI_REVIEW_GATEWAY_TOKEN?: string;
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });
}

async function sameSecret(left: string, right: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);

  let mismatch = aa.length ^ bb.length;
  const length = Math.min(aa.length, bb.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= aa[index] ^ bb[index];
  }
  return mismatch === 0;
}

async function authorized(request: Request, env: AiReviewEnv) {
  const configured = env.AI_REVIEW_GATEWAY_TOKEN?.trim();
  if (!configured) return "unconfigured" as const;

  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return false as const;
  return sameSecret(match[1].trim(), configured);
}

function health(env: AiReviewEnv) {
  return {
    ok: true,
    service: "mira-ai-review-gateway",
    runtimeVersion: AI_REVIEW_RUNTIME_VERSION,
    packageVersion: REVIEW_PACKAGE_VERSION,
    mode: "trusted-package-only",
    github: env.GITHUB_READ_TOKEN ? "configured" : "unconfigured",
    callerAuth: env.AI_REVIEW_GATEWAY_TOKEN ? "configured" : "unconfigured",
    policyRef: env.AI_REVIEW_POLICY_REF?.trim() || "main",
  };
}

function packageErrorResponse(error: ReviewPackageError) {
  if (error.code === "invalid_pull_request" || error.code === "repository_mismatch") {
    return json({ error: error.code }, { status: error.status });
  }
  return json({ error: error.code, message: error.message }, { status: error.status });
}

async function buildReviewPackageResponse(request: Request, env: AiReviewEnv) {
  const auth = await authorized(request, env);
  if (auth === "unconfigured") {
    return json(
      {
        error: "gateway_auth_unconfigured",
        message: "AI_REVIEW_GATEWAY_TOKEN is required before review package requests are accepted.",
      },
      { status: 503 },
    );
  }
  if (!auth) return json({ error: "unauthorized" }, { status: 401 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const body = input as { repository?: unknown; pullRequest?: unknown };
  const repository = typeof body.repository === "string" ? body.repository.trim() : "";
  const pullRequest =
    typeof body.pullRequest === "number" && Number.isInteger(body.pullRequest)
      ? body.pullRequest
      : NaN;

  try {
    return json(await buildReviewPackageData(env, repository, pullRequest));
  } catch (error) {
    if (error instanceof ReviewPackageError) return packageErrorResponse(error);
    return json(
      {
        error: "review_package_failed",
        message: error instanceof Error ? error.message : "Unknown review package failure",
      },
      { status: 502 },
    );
  }
}

export async function handleAiReviewRequest(request: Request, env: AiReviewEnv): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/v1/ai-review/health") {
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "GET" } });
    }
    return json(health(env));
  }

  if (pathname === "/api/v1/ai-review/package") {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          allow: "POST, OPTIONS",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "Authorization, Content-Type",
          "access-control-max-age": "86400",
        },
      });
    }
    if (request.method !== "POST") {
      return json(
        { error: "method_not_allowed" },
        { status: 405, headers: { allow: "POST, OPTIONS" } },
      );
    }
    return buildReviewPackageResponse(request, env);
  }

  return json({ error: "not_found" }, { status: 404 });
}
