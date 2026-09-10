import type {
  GitHubOrganizationObservability,
  GitHubProjectSummary,
  OrganizationRepository,
  OrganizationSnapshot,
  RepositoryGovernance,
  RepositoryRelease,
  RepositoryWorkflow,
  WorkflowConclusion,
} from "./shared";

const ORG = "uichat-mira";
const API = "https://api.github.com";
const GRAPHQL = "https://api.github.com/graphql";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

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

interface GitHubIssueLike {
  pull_request?: unknown;
}

interface GitHubBranch {
  protected: boolean;
}

interface GitHubRuleset {
  enforcement: "active" | "disabled" | "evaluate" | string;
}

interface GitHubProjectNode {
  number: number;
  title: string;
  url: string;
  closed: boolean;
  public: boolean;
  template: boolean;
  shortDescription: string | null;
  updatedAt: string;
  items: { totalCount: number };
}

interface GitHubProjectsGraphQL {
  organization: {
    projectsV2: {
      nodes: Array<GitHubProjectNode | null>;
    };
  } | null;
}

interface GitHubGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export interface GitHubSnapshot {
  status: "connected" | "degraded";
  organization: OrganizationSnapshot["organization"];
  repositories: OrganizationRepository[];
  github: GitHubOrganizationObservability;
  authenticated: boolean;
  error?: string;
}

function apiError(response: Response): string {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  return `GitHub API ${response.status}${remaining ? ` · remaining ${remaining}` : ""}${reset ? ` · reset ${reset}` : ""}`;
}

async function request<T>(env: GitHubEnv, path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: headers(env) });
  if (!response.ok) throw new Error(apiError(response));
  return response.json() as Promise<T>;
}

async function optional<T>(env: GitHubEnv, path: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`, { headers: headers(env) });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

async function paged<T>(env: GitHubEnv, path: string): Promise<T[]> {
  const output: T[] = [];
  const separator = path.includes("?") ? "&" : "?";

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = await request<T[]>(env, `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`);
    output.push(...rows);
    if (rows.length < PAGE_SIZE) return output;
  }

  return output;
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

async function governance(env: GitHubEnv, repo: GitHubRepo): Promise<RepositoryGovernance> {
  const repoName = encodeURIComponent(repo.name);
  const branchName = encodeURIComponent(repo.default_branch);
  const [issuesResult, branchResult, rulesetsResult] = await Promise.allSettled([
    paged<GitHubIssueLike>(env, `/repos/${ORG}/${repoName}/issues?state=open`),
    request<GitHubBranch>(env, `/repos/${ORG}/${repoName}/branches/${branchName}`),
    paged<GitHubRuleset>(env, `/repos/${ORG}/${repoName}/rulesets?includes_parents=true`),
  ]);

  const issues = issuesResult.status === "fulfilled" ? issuesResult.value : null;
  const branch = branchResult.status === "fulfilled" ? branchResult.value : null;
  const rulesets = rulesetsResult.status === "fulfilled" ? rulesetsResult.value : null;
  const failed = [issuesResult, branchResult, rulesetsResult].some((result) => result.status === "rejected");

  return {
    status: failed ? "partial" : "connected",
    openIssues: issues ? issues.filter((item) => !item.pull_request).length : null,
    openPullRequests: issues ? issues.filter((item) => Boolean(item.pull_request)).length : null,
    defaultBranchProtected: branch?.protected ?? null,
    activeRulesets: rulesets ? rulesets.filter((ruleset) => ruleset.enforcement === "active").length : null,
  };
}

async function projects(env: GitHubEnv): Promise<GitHubOrganizationObservability["projects"]> {
  if (!env.GITHUB_READ_TOKEN) {
    return {
      status: "unavailable",
      items: [],
      error: "Authenticated GitHub token required for organization Projects",
    };
  }

  const query = `
    query MiraPublicProjects($login: String!) {
      organization(login: $login) {
        projectsV2(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            number
            title
            url
            closed
            public
            template
            shortDescription
            updatedAt
            items(first: 1) { totalCount }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(GRAPHQL, {
      method: "POST",
      headers: {
        ...headers(env),
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables: { login: ORG } }),
    });

    if (!response.ok) throw new Error(`GitHub GraphQL ${response.status}`);
    const payload = (await response.json()) as GitHubGraphQLResponse<GitHubProjectsGraphQL>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join(" · "));
    }

    const nodes = payload.data?.organization?.projectsV2.nodes ?? [];
    const items: GitHubProjectSummary[] = nodes
      .filter((project): project is GitHubProjectNode => Boolean(project?.public && !project.template))
      .map((project) => ({
        number: project.number,
        title: project.title,
        url: project.url,
        closed: project.closed,
        shortDescription: project.shortDescription,
        updatedAt: project.updatedAt,
        itemCount: project.items.totalCount,
      }));

    return { status: "connected", items };
  } catch (error) {
    return {
      status: "unavailable",
      items: [],
      error: error instanceof Error ? error.message : "GitHub Projects unavailable",
    };
  }
}

export async function getGitHubSnapshot(env: GitHubEnv = {}): Promise<GitHubSnapshot> {
  const authenticated = Boolean(env.GITHUB_READ_TOKEN);

  try {
    // Public-only is deliberate: Control Room is currently publicly reachable even when
    // the organization token itself can see private repositories.
    const [organization, repositories] = await Promise.all([
      request<GitHubOrg>(env, `/orgs/${ORG}`),
      request<GitHubRepo[]>(env, `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=100`),
    ]);
    const [activities, governanceRows, publicProjects] = await Promise.all([
      Promise.all(repositories.map((repo) => activity(env, repo))),
      Promise.all(repositories.map((repo) => governance(env, repo))),
      projects(env),
    ]);
    const governanceStatus =
      publicProjects.status === "connected" && governanceRows.every((row) => row.status === "connected")
        ? "connected"
        : "partial";

    return {
      status: "connected",
      authenticated,
      github: {
        authenticated,
        governanceStatus,
        projects: publicProjects,
      },
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
        governance: governanceRows[index],
      })),
    };
  } catch (error) {
    return {
      status: "degraded",
      authenticated,
      github: {
        authenticated,
        governanceStatus: "partial",
        projects: { status: "unavailable", items: [], error: "GitHub core unavailable" },
      },
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
