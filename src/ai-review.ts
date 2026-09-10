const GITHUB_API = "https://api.github.com";
const ORGANIZATION = "uichat-mira";
const POLICY_REPOSITORY = "uichat-mira/.github";
const DEFAULT_POLICY_REF = "main";
const PROFILE_PATH = ".ai/review-profile.md";
const ROOT_CONTRACT_PATH = "AGENTS.md";
const MAX_DIFF_CHARS = 180_000;
const REVIEW_PACKAGE_VERSION = "mira-ai-review-package/v0";
const RUNTIME_VERSION = "control-room-ai-review/v0";

export interface AiReviewEnv {
  GITHUB_READ_TOKEN?: string;
  AI_REVIEW_GATEWAY_TOKEN?: string;
  AI_REVIEW_POLICY_REF?: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  draft: boolean;
  user: { login: string };
  base: {
    ref: string;
    sha: string;
    repo: { full_name: string };
  };
  head: {
    ref: string;
    sha: string;
    repo: { full_name: string } | null;
  };
}

interface GitHubCommit {
  sha: string;
}

interface GitHubContentFile {
  type: "file";
  path: string;
  sha: string;
  encoding: "base64";
  content: string;
}

interface TrustedText {
  source: "organization" | "base";
  repository: string;
  path: string;
  ref: string;
  blobSha: string;
  content: string;
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

function githubHeaders(env: AiReviewEnv, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    "User-Agent": "uichat-mira-control-room-ai-review",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(env.GITHUB_READ_TOKEN
      ? { Authorization: `Bearer ${env.GITHUB_READ_TOKEN}` }
      : {}),
  };
}

function githubError(response: Response) {
  const remaining = response.headers.get("x-ratelimit-remaining");
  return `GitHub API ${response.status}${remaining ? ` · remaining ${remaining}` : ""}`;
}

async function githubJson<T>(env: AiReviewEnv, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(env),
  });
  if (!response.ok) throw new Error(githubError(response));
  return response.json() as Promise<T>;
}

async function githubText(env: AiReviewEnv, path: string, accept: string) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(env, accept),
  });
  if (!response.ok) throw new Error(githubError(response));
  return response.text();
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function repositoryParts(repository: string) {
  const [owner, repo] = repository.split("/");
  return { owner, repo };
}

async function resolveCommitSha(env: AiReviewEnv, repository: string, ref: string) {
  const { owner, repo } = repositoryParts(repository);
  const commit = await githubJson<GitHubCommit>(
    env,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
  );
  return commit.sha;
}

async function trustedFile(
  env: AiReviewEnv,
  repository: string,
  path: string,
  immutableRef: string,
  source: TrustedText["source"],
  required: boolean,
): Promise<TrustedText | null> {
  const { owner, repo } = repositoryParts(repository);
  const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?ref=${encodeURIComponent(immutableRef)}`;
  const response = await fetch(`${GITHUB_API}${endpoint}`, {
    headers: githubHeaders(env),
  });

  if (response.status === 404 && !required) return null;
  if (!response.ok) throw new Error(githubError(response));

  const file = (await response.json()) as GitHubContentFile;
  if (file.type !== "file" || file.encoding !== "base64") {
    throw new Error(`Unsupported trusted file response for ${repository}:${path}`);
  }

  return {
    source,
    repository,
    path: file.path,
    ref: immutableRef,
    blobSha: file.sha,
    content: decodeBase64(file.content),
  };
}

function validRepository(repository: string) {
  return /^uichat-mira\/[A-Za-z0-9._-]+$/.test(repository);
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
    runtimeVersion: RUNTIME_VERSION,
    packageVersion: REVIEW_PACKAGE_VERSION,
    mode: "trusted-package-only",
    github: env.GITHUB_READ_TOKEN ? "configured" : "unconfigured",
    callerAuth: env.AI_REVIEW_GATEWAY_TOKEN ? "configured" : "unconfigured",
    policyRef: env.AI_REVIEW_POLICY_REF?.trim() || DEFAULT_POLICY_REF,
  };
}

async function buildReviewPackage(request: Request, env: AiReviewEnv) {
  if (!env.GITHUB_READ_TOKEN?.trim()) {
    return json(
      { error: "github_unconfigured", message: "GITHUB_READ_TOKEN is required." },
      { status: 503 },
    );
  }

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

  if (!validRepository(repository)) {
    return json(
      {
        error: "invalid_repository",
        message: `Only ${ORGANIZATION} repositories are accepted.`,
      },
      { status: 400 },
    );
  }
  if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) {
    return json({ error: "invalid_pull_request" }, { status: 400 });
  }

  try {
    const { repo } = repositoryParts(repository);
    const pr = await githubJson<GitHubPullRequest>(
      env,
      `/repos/${ORGANIZATION}/${encodeURIComponent(repo)}/pulls/${pullRequest}`,
    );

    if (pr.base.repo.full_name !== repository) {
      return json({ error: "repository_mismatch" }, { status: 409 });
    }
    if (!pr.head.repo || pr.head.repo.full_name !== repository) {
      return json(
        {
          error: "fork_pull_request_not_supported",
          message: "AI Review Gateway v0 only accepts same-repository pull requests.",
        },
        { status: 409 },
      );
    }

    // Resolve every mutable control ref before reading any trusted Organization file.
    // PR base/head are already immutable commit SHAs from the GitHub PR object.
    const requestedPolicyRef = env.AI_REVIEW_POLICY_REF?.trim() || DEFAULT_POLICY_REF;
    const policyCommitSha = await resolveCommitSha(env, POLICY_REPOSITORY, requestedPolicyRef);

    const [policy, outputContract, profile, rootContract, rawDiff] = await Promise.all([
      trustedFile(
        env,
        POLICY_REPOSITORY,
        "ai-review/POLICY.md",
        policyCommitSha,
        "organization",
        true,
      ),
      trustedFile(
        env,
        POLICY_REPOSITORY,
        "ai-review/OUTPUT-CONTRACT.md",
        policyCommitSha,
        "organization",
        true,
      ),
      trustedFile(env, repository, PROFILE_PATH, pr.base.sha, "base", false),
      trustedFile(env, repository, ROOT_CONTRACT_PATH, pr.base.sha, "base", false),
      githubText(
        env,
        `/repos/${ORGANIZATION}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(pr.base.sha)}...${encodeURIComponent(pr.head.sha)}`,
        "application/vnd.github.v3.diff",
      ),
    ]);

    if (!policy || !outputContract) {
      throw new Error("Organization review policy is unavailable.");
    }

    const diffTruncated = rawDiff.length > MAX_DIFF_CHARS;
    const diff = diffTruncated ? rawDiff.slice(0, MAX_DIFF_CHARS) : rawDiff;

    return json({
      packageVersion: REVIEW_PACKAGE_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      generatedAt: new Date().toISOString(),
      trust: {
        headIsUntrusted: true,
        executesPullRequestCode: false,
        organizationControlsSource: `${POLICY_REPOSITORY}@${policyCommitSha}`,
        requestedOrganizationPolicyRef: requestedPolicyRef,
        repositoryControlsSource: `${repository}@${pr.base.sha}`,
      },
      pullRequest: {
        repository,
        number: pr.number,
        title: pr.title,
        body: pr.body,
        author: pr.user.login,
        draft: pr.draft,
        base: { ref: pr.base.ref, sha: pr.base.sha },
        head: { ref: pr.head.ref, sha: pr.head.sha },
      },
      controls: {
        policy,
        outputContract,
        repositoryProfile: profile,
        rootContract,
        identity: {
          policyCommitSha,
          policyBlobSha: policy.blobSha,
          outputContractBlobSha: outputContract.blobSha,
          profileBlobSha: profile?.blobSha ?? null,
          rootContractBlobSha: rootContract?.blobSha ?? null,
        },
      },
      diff: {
        source: `${pr.base.sha}...${pr.head.sha}`,
        content: diff,
        chars: diff.length,
        originalChars: rawDiff.length,
        truncated: diffTruncated,
        limitChars: MAX_DIFF_CHARS,
      },
      gaps: [
        ...(profile
          ? []
          : [`Missing ${PROFILE_PATH} at base SHA; repository-specific review rules are not yet migrated.`]),
        ...(diffTruncated
          ? [`PR diff exceeded ${MAX_DIFF_CHARS} characters and was truncated by Review Gateway v0.`]
          : []),
      ],
    });
  } catch (error) {
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
    return buildReviewPackage(request, env);
  }

  return json({ error: "not_found" }, { status: 404 });
}
