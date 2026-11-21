import type { GitHubEnv } from "./github";

const ORG = "uichat-mira";
const API = "https://api.github.com";
const MAX_REPOSITORIES = 24; // Workers Free has a bounded subrequest budget.
// Exported so attention projections can state the discovery bounds instead of
// repeating (and drifting from) these magic numbers.
export const FACTORY_FEED_RUNS_PER_REPOSITORY = 20;
export const FACTORY_FEED_MAX_ITEMS = 12;
export const FACTORY_FEED_HISTORY_DAYS = 14;
const WORKER_PATH = "uichat-mira/.github/.github/workflows/mira-external-worker.yml";

type Repo = { name: string; default_branch: string; archived: boolean; fork: boolean; visibility: string };
type WorkerRun = {
  id: number;
  name: string;
  path: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_attempt: number;
  html_url: string;
  display_title: string;
  head_branch: string | null;
  referenced_workflows?: Array<{ path: string }>;
};

export interface FactoryFeedItem {
  id: number;
  repository: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  htmlUrl: string;
  title: string;
  branch: string | null;
}

export interface FactoryFeed {
  apiVersion: "v1";
  source: "github-actions";
  generatedAt: string;
  status: "connected" | "partial";
  scannedRepositories: number;
  eligibleRepositories: number;
  failedRepositories: number;
  coverageLimited: boolean;
  historyDays: number;
  items: FactoryFeedItem[];
}

function headers(env: GitHubEnv): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "uichat-mira-control-room",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(env.GITHUB_READ_TOKEN ? { Authorization: `Bearer ${env.GITHUB_READ_TOKEN}` } : {}),
  };
}

async function jsonGet<T>(env: GitHubEnv, path: string): Promise<{ status: number; value: T | null }> {
  const response = await fetch(`${API}${path}`, { headers: headers(env) });
  if (response.status === 404) return { status: 404, value: null };
  if (!response.ok) throw new Error(`GitHub Actions discovery ${response.status}`);
  return { status: response.status, value: await response.json() as T };
}

// One GraphQL read finds which default branches actually own a Worker caller.
// On missing GraphQL capability, the bounded REST scan remains available.
async function callerRepositories(env: GitHubEnv, repos: Repo[]): Promise<Repo[]> {
  if (!repos.length) return [];
  if (!env.GITHUB_READ_TOKEN || repos.some((repo) => !/^[A-Za-z0-9._/-]+$/.test(repo.default_branch))) return repos;
  try {
    const definitions = repos.map((repo, i) =>
      "r" + i + ': repository(owner:"' + ORG + '",name:"' + repo.name +
      '"){object(expression:"' + repo.default_branch +
      ':.github/workflows/mira-external-worker.yml"){oid}}').join("\n");
    const response = await fetch(API + "/graphql", {
      method: "POST",
      headers: { ...headers(env), "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query FactoryWorkerCallers {\n" + definitions + "\n}" }),
    });
    if (!response.ok) return repos;
    const payload = await response.json() as {
      data?: Record<string, { object: { oid: string } | null } | null>;
      errors?: Array<{ message: string }>;
    };
    if (payload.errors?.length || !payload.data ||
      repos.some((_, i) => !Object.prototype.hasOwnProperty.call(payload.data, "r" + i))) return repos;
    return repos.filter((_, i) => Boolean(payload.data?.["r" + i]?.object?.oid));
  } catch {
    return repos;
  }
}

export async function getFactoryFeed(env: GitHubEnv, now = Date.now()): Promise<FactoryFeed> {
  const reposResult = await jsonGet<Repo[]>(env, `/orgs/${ORG}/repos?type=public&sort=updated&direction=desc&per_page=100`);
  if (!Array.isArray(reposResult.value)) throw new Error("Public repositories unavailable");

  const eligible = reposResult.value.filter((repo) =>
    repo.visibility === "public" && !repo.archived && !repo.fork &&
    /^[A-Za-z0-9_.-]+$/.test(repo.name),
  );
  const selected = await callerRepositories(env, eligible.slice(0, MAX_REPOSITORIES));
  const all: FactoryFeedItem[] = [];
  let failedRepositories = 0;
  // Small fixed batches avoid launching an unbounded fan-out at the edge.
  for (let offset = 0; offset < selected.length; offset += 6) {
    const batch = await Promise.all(selected.slice(offset, offset + 6).map(async (repo) => {
      try {
        const { value } = await jsonGet<{ workflow_runs?: WorkerRun[] }>(
          env,
          `/repos/${ORG}/${repo.name}/actions/workflows/mira-external-worker.yml/runs?per_page=${FACTORY_FEED_RUNS_PER_REPOSITORY}`,
        );
        // 404 means this repository has no External Worker caller.
        return { failed: false, repository: repo.name, runs: value?.workflow_runs ?? [] };
      } catch {
        return { failed: true, repository: repo.name, runs: [] as WorkerRun[] };
      }
    }));
    for (const result of batch) {
      if (result.failed) {
        failedRepositories += 1;
        continue;
      }
      for (const run of result.runs) {
        if (run.conclusion === "skipped" || run.status === "completed" && !run.conclusion) continue;
        if (!run.referenced_workflows?.some((workflow) => workflow.path.startsWith(WORKER_PATH + "@"))) continue;
        if (!Number.isSafeInteger(run.id) || run.id <= 0) continue;
        const created = Date.parse(run.created_at);
        if (!Number.isFinite(created) || created > now || now - created > FACTORY_FEED_HISTORY_DAYS * 86400000) continue;
        all.push({
          id: run.id, repository: `${ORG}/${result.repository}`,
          status: run.status, conclusion: run.conclusion,
          createdAt: run.created_at, updatedAt: run.updated_at,
          attempt: run.run_attempt, htmlUrl: run.html_url,
          title: run.display_title || run.name || "Mira External Worker",
          branch: run.head_branch,
        });
      }
    }
  }

  if (selected.length && failedRepositories === selected.length) {
    throw new Error("All GitHub Actions sources unavailable");
  }

  all.sort((a, b) => {
    const aActive = a.status === "in_progress" || a.status === "queued" ? 1 : 0;
    const bActive = b.status === "in_progress" || b.status === "queued" ? 1 : 0;
    return bActive - aActive || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });

  return {
    apiVersion: "v1", source: "github-actions",
    generatedAt: new Date(now).toISOString(),
    status: failedRepositories || eligible.length > MAX_REPOSITORIES ? "partial" : "connected",
    scannedRepositories: selected.length,
    eligibleRepositories: eligible.length,
    failedRepositories,
    coverageLimited: eligible.length > MAX_REPOSITORIES,
    historyDays: FACTORY_FEED_HISTORY_DAYS,
    items: all.slice(0, FACTORY_FEED_MAX_ITEMS),
  };
}
