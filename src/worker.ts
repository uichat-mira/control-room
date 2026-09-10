import type {
  OrganizationRepository,
  OrganizationSnapshot,
  RepositoryRelease,
  RepositoryWorkflow,
  ServiceProbe,
  WorkflowConclusion,
} from "./shared";

const ORG = "uichat-mira";
const GITHUB_API = "https://api.github.com";
const SNAPSHOT_TTL_SECONDS = 15 * 60;

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

interface GitHubWorkflowRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: WorkflowConclusion;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface GitHubWorkflowRuns {
  workflow_runs: GitHubWorkflowRun[];
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
}

async function github<T>(path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders });

  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(
      `GitHub API ${response.status}${remaining ? ` (rate remaining: ${remaining})` : ""}`,
    );
  }

  return response.json() as Promise<T>;
}

async function githubOptional<T>(path: string): Promise<T | null> {
  const response = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders });
  if (response.status === 404) return null;
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(
      `GitHub API ${response.status}${remaining ? ` (rate remaining: ${remaining})` : ""}`,
    );
  }
  return response.json() as Promise<T>;
}

async function repositoryActivity(repo: GitHubRepo): Promise<{
  latestWorkflow: RepositoryWorkflow | null;
  latestRelease: RepositoryRelease | null;
}> {
  const encodedRepo = repo.name.split("/").map(encodeURIComponent).join("/");
  const branch = encodeURIComponent(repo.default_branch);

  const [workflowPayload, releasePayload] = await Promise.all([
    githubOptional<GitHubWorkflowRuns>(
      `/repos/${ORG}/${encodedRepo}/actions/runs?branch=${branch}&per_page=1`,
    ).catch(() => null),
    githubOptional<GitHubRelease>(`/repos/${ORG}/${encodedRepo}/releases/latest`).catch(
      () => null,
    ),
  ]);

  const run = workflowPayload?.workflow_runs[0] ?? null;

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
    latestRelease: releasePayload
      ? {
          tagName: releasePayload.tag_name,
          name: releasePayload.name,
          htmlUrl: releasePayload.html_url,
          publishedAt: releasePayload.published_at,
        }
      : null,
  };
}

async function probeService(
  id: string,
  label: string,
  url: string,
  expected?: (response: Response) => Promise<boolean>,
): Promise<ServiceProbe> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "uichat-mira-control-room-health" },
    });
    const latencyMs = Date.now() - startedAt;
    const valid = response.ok && (expected ? await expected(response.clone()) : true);

    return {
      id,
      label,
      url,
      status: valid ? "online" : response.ok ? "degraded" : "offline",
      httpStatus: response.status,
      latencyMs,
      detail: valid ? "Healthy" : response.ok ? "Unexpected response" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      id,
      label,
      url,
      status: "offline",
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.name : "Probe failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function serviceSnapshot(): Promise<ServiceProbe[]> {
  return Promise.all([
    probeService("website", "Mira Website", "https://mira.tomz.io/"),
    probeService(
      "relay",
      "Relay",
      "https://relay.tomz.io/health",
      async (response) => {
        try {
          const body = (await response.json()) as { ok?: boolean };
          return body.ok === true;
        } catch {
          return false;
        }
      },
    ),
    Promise.resolve({
      id: "control-room",
      label: "Control Room",
      url: "https://uichat-mira-control-room.dangjingtao.workers.dev",
      status: "online" as const,
      httpStatus: 200,
      latencyMs: 0,
      detail: "Serving this request",
    }),
  ]);
}

async function organizationSnapshot(): Promise<OrganizationSnapshot> {
  const generatedAt = new Date().toISOString();

  try {
    const [organization, repositories, services] = await Promise.all([
      github<GitHubOrg>(`/orgs/${ORG}`),
      github<GitHubRepo[]>(
        `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=100`,
      ),
      serviceSnapshot(),
    ]);

    const activity = await Promise.all(repositories.map(repositoryActivity));

    const normalizedRepositories: OrganizationRepository[] = repositories.map((repo, index) => ({
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
      latestWorkflow: activity[index]?.latestWorkflow ?? null,
      latestRelease: activity[index]?.latestRelease ?? null,
    }));

    const hasFailedBuild = normalizedRepositories.some((repo) => {
      const run = repo.latestWorkflow;
      if (!run || run.status !== "completed") return false;
      return ["failure", "timed_out", "action_required", "startup_failure"].includes(
        run.conclusion ?? "",
      );
    });
    const hasOfflineService = services.some((service) => service.status === "offline");

    return {
      status: hasFailedBuild || hasOfflineService ? "degraded" : "connected",
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
      sources: {
        github: "connected",
        cloudflare: "pending",
      },
      repositories: normalizedRepositories,
      services,
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
      sources: {
        github: "degraded",
        cloudflare: "pending",
      },
      repositories: [],
      services: await serviceSnapshot(),
      error: error instanceof Error ? error.message : "GitHub organization data unavailable",
    };
  }
}

async function cachedSnapshot(request: Request): Promise<Response> {
  const workerCaches = caches as CacheStorage & { default: Cache };
  const edgeCache = workerCaches.default;
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/api/__snapshot-cache`, { method: "GET" });
  const cached = await edgeCache.match(cacheKey);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-mira-cache", "HIT");
    return response;
  }

  const snapshot = await organizationSnapshot();
  const response = json(snapshot, {
    status: snapshot.sources.github === "connected" ? 200 : 502,
    headers: {
      "cache-control": `public, max-age=60, s-maxage=${SNAPSHOT_TTL_SECONDS}`,
      "x-mira-cache": "MISS",
    },
  });

  if (snapshot.sources.github === "connected") {
    await edgeCache.put(cacheKey, response.clone());
  }

  return response;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "mira-control-room",
        version: "0.2.0",
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/organization" || url.pathname === "/api/summary") {
      return cachedSnapshot(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
