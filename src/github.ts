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
  node_id: string;
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

interface GitHubReleaseNode {
  tagName: string;
  name: string | null;
  url: string;
  publishedAt: string | null;
}

interface GitHubRepositoryNode {
  name: string;
  latestRelease: GitHubReleaseNode | null;
}

interface GitHubLatestReleasesGraphQL {
  nodes: Array<GitHubRepositoryNode | null>;
}

interface GitHubGovernanceRuleNode {
  repositoryRuleset: { id: string } | null;
}

interface GitHubGovernanceRef {
  branchProtectionRule: { id: string } | null;
  rules: {
    totalCount: number;
    nodes: Array<GitHubGovernanceRuleNode | null>;
    pageInfo: { hasNextPage: boolean };
  };
}

interface GitHubGovernanceNode {
  name: string;
  issues: { totalCount: number };
  pullRequests: { totalCount: number };
  defaultBranchRef: GitHubGovernanceRef | null;
}

interface GitHubGovernanceGraphQL {
  nodes: Array<GitHubGovernanceNode | null>;
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

export interface GitHubGovernanceRepository {
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  governance: RepositoryGovernance;
}

export interface GitHubGovernanceSnapshot {
  status: "connected" | "degraded";
  generatedAt: string;
  authenticated: boolean;
  governanceStatus: "connected" | "partial";
  projects: GitHubOrganizationObservability["projects"];
  repositories: GitHubGovernanceRepository[];
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

async function latestWorkflow(
  env: GitHubEnv,
  repo: GitHubRepo,
): Promise<RepositoryWorkflow | null> {
  if (repo.name === ".github") return null;

  const repoName = encodeURIComponent(repo.name);
  const branch = encodeURIComponent(repo.default_branch);
  const workflows = await optional<{ workflow_runs: GitHubWorkflowRun[] }>(
    env,
    `/repos/${ORG}/${repoName}/actions/runs?branch=${branch}&per_page=1`,
  );
  const run = workflows?.workflow_runs[0] ?? null;
  return run
    ? {
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        htmlUrl: run.html_url,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
      }
    : null;
}

async function latestReleases(
  env: GitHubEnv,
  repositories: GitHubRepo[],
): Promise<{ releases: Map<string, RepositoryRelease>; error?: string }> {
  if (repositories.length === 0) return { releases: new Map() };
  if (!env.GITHUB_READ_TOKEN) {
    return {
      releases: new Map(),
      error: "Authenticated GitHub token required for bounded latest-release enrichment",
    };
  }

  const query = `
    query MiraLatestReleases($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Repository {
          name
          latestRelease {
            tagName
            name
            url
            publishedAt
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
      body: JSON.stringify({
        query,
        variables: { ids: repositories.map((repo) => repo.node_id) },
      }),
    });
    if (!response.ok) throw new Error(`GitHub GraphQL ${response.status}`);

    const payload = (await response.json()) as GitHubGraphQLResponse<GitHubLatestReleasesGraphQL>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join(" · "));
    }

    const releases = new Map<string, RepositoryRelease>();
    for (const repository of payload.data?.nodes ?? []) {
      if (!repository?.latestRelease) continue;
      releases.set(repository.name, {
        tagName: repository.latestRelease.tagName,
        name: repository.latestRelease.name,
        htmlUrl: repository.latestRelease.url,
        publishedAt: repository.latestRelease.publishedAt,
      });
    }
    return { releases };
  } catch (error) {
    return {
      releases: new Map(),
      error: error instanceof Error ? error.message : "Latest release enrichment unavailable",
    };
  }
}

function unavailableGovernance(): RepositoryGovernance {
  return {
    status: "partial",
    openIssues: null,
    openPullRequests: null,
    defaultBranchProtected: null,
    activeRulesets: null,
  };
}

async function governanceRows(
  env: GitHubEnv,
  repositories: GitHubRepo[],
): Promise<{ rows: Map<string, RepositoryGovernance>; error?: string }> {
  if (repositories.length === 0) return { rows: new Map() };
  if (!env.GITHUB_READ_TOKEN) {
    return {
      rows: new Map(),
      error: "Authenticated GitHub token required for bounded governance projection",
    };
  }

  const query = `
    query MiraGovernanceRows($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Repository {
          name
          issues(states: OPEN) { totalCount }
          pullRequests(states: OPEN) { totalCount }
          defaultBranchRef {
            branchProtectionRule { id }
            rules(first: 100) {
              totalCount
              pageInfo { hasNextPage }
              nodes {
                repositoryRuleset { id }
              }
            }
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
      body: JSON.stringify({
        query,
        variables: { ids: repositories.map((repo) => repo.node_id) },
      }),
    });
    if (!response.ok) throw new Error(`GitHub GraphQL ${response.status}`);

    const payload = (await response.json()) as GitHubGraphQLResponse<GitHubGovernanceGraphQL>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join(" · "));
    }

    const rows = new Map<string, RepositoryGovernance>();
    for (const repository of payload.data?.nodes ?? []) {
      if (!repository) continue;
      const ref = repository.defaultBranchRef;
      if (!ref) {
        rows.set(repository.name, {
          ...unavailableGovernance(),
          openIssues: repository.issues.totalCount,
          openPullRequests: repository.pullRequests.totalCount,
        });
        continue;
      }

      const activeRulesets = new Set(
        ref.rules.nodes
          .map((rule) => rule?.repositoryRuleset?.id ?? null)
          .filter((id): id is string => Boolean(id)),
      );
      const completeRulesetProjection = !ref.rules.pageInfo.hasNextPage;

      rows.set(repository.name, {
        status: completeRulesetProjection ? "connected" : "partial",
        openIssues: repository.issues.totalCount,
        openPullRequests: repository.pullRequests.totalCount,
        defaultBranchProtected:
          ref.branchProtectionRule !== null || ref.rules.totalCount > 0,
        activeRulesets: completeRulesetProjection ? activeRulesets.size : null,
      });
    }

    return { rows };
  } catch (error) {
    return {
      rows: new Map(),
      error: error instanceof Error ? error.message : "GitHub governance batch unavailable",
    };
  }
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
    // Public-only is deliberate: the Worker is currently publicly reachable.
    const [organization, repositories] = await Promise.all([
      request<GitHubOrg>(env, `/orgs/${ORG}`),
      request<GitHubRepo[]>(env, `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=100`),
    ]);
    const [workflows, releaseResult] = await Promise.all([
      Promise.all(repositories.map((repo) => latestWorkflow(env, repo))),
      latestReleases(env, repositories),
    ]);

    return {
      status: releaseResult.error ? "degraded" : "connected",
      authenticated,
      github: {
        authenticated,
        governanceStatus: "partial",
        projects: {
          status: "unavailable",
          items: [],
          error: "Governance is loaded separately",
        },
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
        latestWorkflow: workflows[index] ?? null,
        latestRelease: releaseResult.releases.get(repo.name) ?? null,
      })),
      ...(releaseResult.error ? { error: releaseResult.error } : {}),
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

export async function getGitHubGovernanceSnapshot(env: GitHubEnv = {}): Promise<GitHubGovernanceSnapshot> {
  const authenticated = Boolean(env.GITHUB_READ_TOKEN);
  const generatedAt = new Date().toISOString();

  try {
    const repositories = await request<GitHubRepo[]>(
      env,
      `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=100`,
    );
    const [governanceResult, publicProjects] = await Promise.all([
      governanceRows(env, repositories),
      projects(env),
    ]);
    const repositoryRows = repositories.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch,
      governance: governanceResult.rows.get(repo.name) ?? unavailableGovernance(),
    }));
    const governanceStatus =
      !governanceResult.error &&
      publicProjects.status === "connected" &&
      repositoryRows.every((row) => row.governance.status === "connected")
        ? "connected"
        : "partial";

    return {
      status: governanceResult.error ? "degraded" : "connected",
      generatedAt,
      authenticated,
      governanceStatus,
      projects: publicProjects,
      repositories: repositoryRows,
      ...(governanceResult.error ? { error: governanceResult.error } : {}),
    };
  } catch (error) {
    return {
      status: "degraded",
      generatedAt,
      authenticated,
      governanceStatus: "partial",
      projects: { status: "unavailable", items: [], error: "GitHub governance unavailable" },
      repositories: [],
      error: error instanceof Error ? error.message : "GitHub governance unavailable",
    };
  }
}
