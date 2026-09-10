import type {
  OrganizationRepository,
  OrganizationSnapshot,
  RepositoryRelease,
  RepositoryWorkflow,
  WorkflowConclusion,
} from "./shared";

const ORG = "uichat-mira";
const API = "https://api.github.com";

export interface GitHubEnv {
  GITHUB_READ_TOKEN?: string;
}

function headers(env: GitHubEnv) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "uichat-mira-control-room",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(env.GITHUB_READ_TOKEN ? { Authorization: `Bearer ${env.GITHUB_READ_TOKEN}` } : {}),
  };
}

interface GitHubOrg {
  login: string;
  name: string | null;
  html_url: string;
  avatar_url: string;
  description: string | null;
  public_repos: number;
  followers: number;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  visibility: "public";
  default_branch: string;
  archived: boolean;
  fork: boolean;
  language: string | null;
  pushed_at: string | null;
  updated_at: string;
  open_issues_count: number;
  stargazers_count: number;
}

interface GitHubWorkflowRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: WorkflowConclusion;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
}

export interface GitHubSnapshot {
  status: "connected" | "degraded";
  organization: OrganizationSnapshot["organization"];
  repositories: OrganizationRepository[];
  authenticated: boolean;
  error?: string;
}

async function request<T>(env: GitHubEnv, path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: headers(env) });
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    throw new Error(
      `GitHub API ${response.status}${remaining ? ` · remaining ${remaining}` : ""}${reset ? ` · reset ${reset}` : ""}`,
    );
  }
  return response.json() as Promise<T>;
}

async function optional<T>(env: GitHubEnv, path: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`, { headers: headers(env) });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

async function activity(env: GitHubEnv, repo: GitHubRepo): Promise<{
  latestWorkflow: RepositoryWorkflow | null;
  latestRelease: RepositoryRelease | null;
}> {
  if (repo.name === ".github") {
    return { latestWorkflow: null, latestRelease: null };
  }

  const repoName = encodeURIComponent(repo.name);
  const branch = encodeURIComponent(repo.default_branch);
  const [workflows, release] = await Promise.all([
    optional<{ workflow_runs: GitHubWorkflowRun[] }>(
      env,
      `/repos/${ORG}/${repoName}/actions/runs?branch=${branch}&per_page=1`,
    ),
    optional<GitHubRelease>(env, `/repos/${ORG}/${repoName}/releases/latest`),
  ]);

  const run = workflows?.workflow_runs[0] ?? null;
  return {
    latestWorkflow: run
      ? {
          name: run.name,
          status: run.status,
          conclusion: run.conclusion,
          htmlUrl: run.html_url,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
        }
      : null,
    latestRelease: release
      ? {
          tagName: release.tag_name,
          name: release.name,
          htmlUrl: release.html_url,
          publishedAt: release.published_at,
        }
      : null,
  };
}

export async function getGitHubSnapshot(env: GitHubEnv = {}): Promise<GitHubSnapshot> {
  const authenticated = Boolean(env.GITHUB_READ_TOKEN);

  try {
    const [organization, repositories] = await Promise.all([
      request<GitHubOrg>(env, `/orgs/${ORG}`),
      request<GitHubRepo[]>(env, `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=100`),
    ]);
    const activities = await Promise.all(repositories.map((repo) => activity(env, repo)));

    return {
      status: "connected",
      authenticated,
      organization: {
        login: organization.login,
        name: organization.name,
        htmlUrl: organization.html_url,
        avatarUrl: organization.avatar_url,
        description: organization.description,
        publicRepos: organization.public_repos,
        followers: organization.followers,
      },
      repositories: repositories.map((repo, index) => ({
        name: repo.name,
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        description: repo.description,
        visibility: "public",
        defaultBranch: repo.default_branch,
        archived: repo.archived,
        fork: repo.fork,
        language: repo.language,
        pushedAt: repo.pushed_at,
        updatedAt: repo.updated_at,
        openIssuesCount: repo.open_issues_count,
        stars: repo.stargazers_count,
        latestWorkflow: activities[index]?.latestWorkflow ?? null,
        latestRelease: activities[index]?.latestRelease ?? null,
      })),
    };
  } catch (error) {
    return {
      status: "degraded",
      authenticated,
      organization: {
        login: ORG,
        name: null,
        htmlUrl: `https://github.com/${ORG}`,
        avatarUrl: "",
        description: null,
        publicRepos: 0,
        followers: 0,
      },
      repositories: [],
      error: error instanceof Error ? error.message : "GitHub unavailable",
    };
  }
}
