import type { OrganizationRepository, OrganizationSnapshot } from "./shared";

const ORG = "uichat-mira";
const GITHUB_API = "https://api.github.com";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=60",
      ...init.headers,
    },
  });

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "uichat-mira-control-room",
  "X-GitHub-Api-Version": "2022-11-28",
};

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

async function github<T>(path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders,
  });

  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(
      `GitHub API ${response.status}${remaining ? ` (rate remaining: ${remaining})` : ""}`,
    );
  }

  return response.json() as Promise<T>;
}

async function organizationSnapshot(): Promise<OrganizationSnapshot> {
  const generatedAt = new Date().toISOString();

  try {
    const [organization, repositories] = await Promise.all([
      github<GitHubOrg>(`/orgs/${ORG}`),
      github<GitHubRepo[]>(
        `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=100`,
      ),
    ]);

    const normalizedRepositories: OrganizationRepository[] = repositories.map((repo) => ({
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
    }));

    return {
      status: "connected",
      generatedAt,
      organization: {
        login: organization.login,
        name: organization.name,
        htmlUrl: organization.html_url,
        avatarUrl: organization.avatar_url,
        description: organization.description,
        publicRepos: organization.public_repos,
        followers: organization.followers,
      },
      repositories: normalizedRepositories,
    };
  } catch (error) {
    return {
      status: "degraded",
      generatedAt,
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
      error: error instanceof Error ? error.message : "GitHub organization data unavailable",
    };
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "mira-control-room",
        version: "0.1.0",
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/organization" || url.pathname === "/api/summary") {
      const snapshot = await organizationSnapshot();
      return json(snapshot, snapshot.status === "connected" ? {} : { status: 502 });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
