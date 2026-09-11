const GITHUB_API = "https://api.github.com";
const ORGANIZATION = "uichat-mira";
const POLICY_REPOSITORY = "uichat-mira/.github";
const DEFAULT_POLICY_REF = "main";
const PROFILE_PATH = ".ai/review-profile.md";
const ROOT_CONTRACT_PATH = "AGENTS.md";

export const REVIEW_PACKAGE_VERSION = "mira-ai-review-package/v0" as const;
export const AI_REVIEW_RUNTIME_VERSION = "control-room-ai-review/v0" as const;
export const MAX_REVIEW_DIFF_CHARS = 180_000;

export interface AiReviewPackageEnv {
  GITHUB_READ_TOKEN?: string;
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

export interface TrustedReviewText {
  source: "organization" | "base";
  repository: string;
  path: string;
  ref: string;
  blobSha: string;
  content: string;
}

export interface ReviewPackage {
  packageVersion: typeof REVIEW_PACKAGE_VERSION;
  runtimeVersion: typeof AI_REVIEW_RUNTIME_VERSION;
  generatedAt: string;
  trust: {
    headIsUntrusted: true;
    executesPullRequestCode: false;
    organizationControlsSource: string;
    requestedOrganizationPolicyRef: string;
    repositoryControlsSource: string;
  };
  pullRequest: {
    repository: string;
    number: number;
    title: string;
    body: string | null;
    author: string;
    draft: boolean;
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
  };
  controls: {
    policy: TrustedReviewText;
    outputContract: TrustedReviewText;
    repositoryProfile: TrustedReviewText | null;
    rootContract: TrustedReviewText | null;
    identity: {
      policyCommitSha: string;
      policyBlobSha: string;
      outputContractBlobSha: string;
      profileBlobSha: string | null;
      rootContractBlobSha: string | null;
    };
  };
  diff: {
    source: string;
    content: string;
    chars: number;
    originalChars: number;
    truncated: boolean;
    limitChars: number;
  };
  gaps: string[];
}

export type ReviewPackageErrorCode =
  | "github_unconfigured"
  | "invalid_repository"
  | "invalid_pull_request"
  | "repository_mismatch"
  | "fork_pull_request_not_supported";

export class ReviewPackageError extends Error {
  readonly code: ReviewPackageErrorCode;
  readonly status: number;

  constructor(code: ReviewPackageErrorCode, status: number, message: string) {
    super(message);
    this.name = "ReviewPackageError";
    this.code = code;
    this.status = status;
  }
}

function githubHeaders(env: AiReviewPackageEnv, accept = "application/vnd.github+json") {
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

async function githubJson<T>(env: AiReviewPackageEnv, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(env),
  });
  if (!response.ok) throw new Error(githubError(response));
  return response.json() as Promise<T>;
}

async function githubText(env: AiReviewPackageEnv, path: string, accept: string) {
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

async function resolveCommitSha(
  env: AiReviewPackageEnv,
  repository: string,
  ref: string,
) {
  const { owner, repo } = repositoryParts(repository);
  const commit = await githubJson<GitHubCommit>(
    env,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
  );
  return commit.sha;
}

async function trustedFile(
  env: AiReviewPackageEnv,
  repository: string,
  path: string,
  immutableRef: string,
  source: TrustedReviewText["source"],
  required: boolean,
): Promise<TrustedReviewText | null> {
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

function validateReviewTarget(repository: string, pullRequest: number) {
  if (!validRepository(repository)) {
    throw new ReviewPackageError(
      "invalid_repository",
      400,
      `Only ${ORGANIZATION} repositories are accepted.`,
    );
  }
  if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) {
    throw new ReviewPackageError("invalid_pull_request", 400, "Invalid pull request number.");
  }
}

export async function buildReviewPackageData(
  env: AiReviewPackageEnv,
  repository: string,
  pullRequest: number,
): Promise<ReviewPackage> {
  if (!env.GITHUB_READ_TOKEN?.trim()) {
    throw new ReviewPackageError("github_unconfigured", 503, "GITHUB_READ_TOKEN is required.");
  }

  validateReviewTarget(repository, pullRequest);

  const { repo } = repositoryParts(repository);
  const pr = await githubJson<GitHubPullRequest>(
    env,
    `/repos/${ORGANIZATION}/${encodeURIComponent(repo)}/pulls/${pullRequest}`,
  );

  if (pr.base.repo.full_name !== repository) {
    throw new ReviewPackageError("repository_mismatch", 409, "Pull request repository mismatch.");
  }
  if (!pr.head.repo || pr.head.repo.full_name !== repository) {
    throw new ReviewPackageError(
      "fork_pull_request_not_supported",
      409,
      "AI Review Gateway v0 only accepts same-repository pull requests.",
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

  const diffTruncated = rawDiff.length > MAX_REVIEW_DIFF_CHARS;
  const diff = diffTruncated ? rawDiff.slice(0, MAX_REVIEW_DIFF_CHARS) : rawDiff;

  return {
    packageVersion: REVIEW_PACKAGE_VERSION,
    runtimeVersion: AI_REVIEW_RUNTIME_VERSION,
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
      limitChars: MAX_REVIEW_DIFF_CHARS,
    },
    gaps: [
      ...(profile
        ? []
        : [`Missing ${PROFILE_PATH} at base SHA; repository-specific review rules are not yet migrated.`]),
      ...(diffTruncated
        ? [`PR diff exceeded ${MAX_REVIEW_DIFF_CHARS} characters and was truncated by Review Gateway v0.`]
        : []),
    ],
  };
}
