import { getCloudflareSnapshot, type CloudflareEnv, type CloudflareSnapshot } from "./cloudflare";
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
const CORE_TTL_SECONDS = 15 * 60;

interface Env extends CloudflareEnv {
  DEPLOYED_COMMIT?: string;
}

interface CoreSnapshot {
  generatedAt: string;
  organization: OrganizationSnapshot["organization"];
  sources: OrganizationSnapshot["sources"];
  repositories: OrganizationRepository[];
  cloudflare: CloudflareSnapshot;
  deployedCommit: string | null;
  error?: string;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
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
  const encodedRepo = encodeURIComponent(repo.name);
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

async function coreSnapshot(env: Env): Promise<CoreSnapshot> {
  const generatedAt = new Date().toISOString();
  const cloudflarePromise = getCloudflareSnapshot(env);

  try {
    const [organization, repositories] = await Promise.all([
      github<GitHubOrg>(`/orgs/${ORG}`),
      github<GitHubRepo[]>(
        `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=100`,
      ),
    ]);

    const [activity, cloudflare] = await Promise.all([
      Promise.all(repositories.map(repositoryActivity)),
      cloudflarePromise,
    ]);

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

    return {
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
        cloudflare: cloudflare.status,
      },
      repositories: normalizedRepositories,
      cloudflare,
      deployedCommit: env.DEPLOYED_COMMIT ?? null,
    };
  } catch (error) {
    const cloudflare = await cloudflarePromise;
    return {
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
        cloudflare: cloudflare.status,
      },
      repositories: [],
      cloudflare,
      deployedCommit: env.DEPLOYED_COMMIT ?? null,
      error: error instanceof Error ? error.message : "GitHub organization data unavailable",
    };
  }
}

async function cachedCoreSnapshot(request: Request, env: Env): Promise<CoreSnapshot> {
  const workerCaches = caches as CacheStorage & { default: Cache };
  const edgeCache = workerCaches.default;
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/api/__core-cache-v2`, { method: "GET" });
  const cached = await edgeCache.match(cacheKey);

  if (cached) return cached.json() as Promise<CoreSnapshot>;

  const snapshot = await coreSnapshot(env);
  if (snapshot.sources.github === "connected") {
    await edgeCache.put(
      cacheKey,
      new Response(JSON.stringify(snapshot), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=60, s-maxage=${CORE_TTL_SECONDS}`,
        },
      }),
    );
  }

  return snapshot;
}

function buildFailed(repositories: OrganizationRepository[]): boolean {
  return repositories.some((repo) => {
    const run = repo.latestWorkflow;
    if (!run || run.status !== "completed") return false;
    return ["failure", "timed_out", "action_required", "startup_failure"].includes(
      run.conclusion ?? "",
    );
  });
}

async function organizationSnapshot(request: Request, env: Env): Promise<OrganizationSnapshot> {
  const [core, services] = await Promise.all([cachedCoreSnapshot(request, env), serviceSnapshot()]);
  const hasOfflineService = services.some((service) => service.status === "offline");
  const cloudflareDegraded = core.sources.cloudflare === "degraded";

  return {
    ...core,
    status:
      core.sources.github === "degraded" ||
      buildFailed(core.repositories) ||
      hasOfflineService ||
      cloudflareDegraded
        ? "degraded"
        : "connected",
    services,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "mira-control-room",
        version: "0.2.0",
        commit: env.DEPLOYED_COMMIT ?? null,
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/organization" || url.pathname === "/api/summary") {
      const snapshot = await organizationSnapshot(request, env);
      return json(snapshot, snapshot.sources.github === "connected" ? {} : { status: 502 });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
