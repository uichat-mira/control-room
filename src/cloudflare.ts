import {
  getWorkerAnalytics24h,
  unavailableAnalytics,
  type CloudflareAnalytics24h,
} from "./cloudflare-analytics";

export type CloudflareSourceStatus = "connected" | "degraded" | "unconfigured";

export interface CloudflareWorkerDeployment {
  name: string;
  modifiedAt: string | null;
  deploymentId: string | null;
  deployedAt: string | null;
  versionId: string | null;
  source: string | null;
  triggeredBy: string | null;
  message: string | null;
}

export interface CloudflarePageDeployment {
  name: string;
  productionBranch: string | null;
  deploymentId: string | null;
  deployedAt: string | null;
  status: string | null;
  url: string | null;
  commitHash: string | null;
}

export interface CloudflareSnapshot {
  status: CloudflareSourceStatus;
  workers: CloudflareWorkerDeployment[];
  pages: CloudflarePageDeployment[];
  analytics24h: CloudflareAnalytics24h;
  errors: string[];
}

export interface CloudflareEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_READ_TOKEN?: string;
}

const API = "https://api.cloudflare.com/client/v4";
const MIRA_NAME = /(mira|uichat)/i;

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface GraphQLEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }> | null;
}

interface WorkerScript {
  id: string;
  modified_on?: string;
}

interface WorkerDeployment {
  id: string;
  created_on?: string;
  source?: string;
  versions?: Array<{ version_id?: string; percentage?: number }>;
  annotations?: {
    "workers/message"?: string;
    "workers/triggered_by"?: string;
  };
}

interface WorkerDeploymentsResult {
  deployments?: WorkerDeployment[];
}

interface PagesProject {
  name: string;
  production_branch?: string;
  canonical_deployment?: {
    id?: string;
    url?: string;
    created_on?: string;
    latest_stage?: { status?: string };
    deployment_trigger?: {
      metadata?: {
        branch?: string;
        commit_hash?: string;
      };
    };
  } | null;
}

function shortError(scope: string, error: unknown): string {
  const message = error instanceof Error ? error.message : "unavailable";
  return `${scope}: ${message}`.slice(0, 220);
}

async function cloudflare<T>(env: CloudflareEnv, path: string): Promise<T> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_READ_TOKEN) {
    throw new Error("read credentials not configured");
  }

  const response = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_READ_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "uichat-mira-control-room",
    },
  });

  let payload: CloudflareEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as CloudflareEnvelope<T>;
  } catch {
    // handled below with the HTTP status only
  }

  if (!response.ok || !payload?.success) {
    const first = payload?.errors?.[0];
    const code = first?.code ? ` / ${first.code}` : "";
    const message = first?.message ? ` · ${first.message}` : "";
    throw new Error(`HTTP ${response.status}${code}${message}`);
  }

  return payload.result;
}

async function cloudflareGraphQL<T>(
  env: CloudflareEnv,
  query: string,
  variables: Record<string, string>,
): Promise<T> {
  if (!env.CLOUDFLARE_READ_TOKEN) throw new Error("read credentials not configured");

  const response = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_READ_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "uichat-mira-control-room",
    },
    body: JSON.stringify({ query, variables }),
  });

  let payload: GraphQLEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as GraphQLEnvelope<T>;
  } catch {
    // handled below with the HTTP status only
  }

  const message = payload?.errors?.find((item) => item?.message)?.message;
  if (!response.ok || !payload?.data || message) {
    throw new Error(`HTTP ${response.status}${message ? ` · ${message}` : ""}`);
  }

  return payload.data;
}

async function workerSnapshot(env: CloudflareEnv): Promise<CloudflareWorkerDeployment[]> {
  const accountId = encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!);
  const scripts = await cloudflare<WorkerScript[]>(env, `/accounts/${accountId}/workers/scripts`);
  const miraScripts = scripts.filter((script) => MIRA_NAME.test(script.id)).slice(0, 24);

  return Promise.all(
    miraScripts.map(async (script) => {
      let latest: WorkerDeployment | null = null;
      try {
        const result = await cloudflare<WorkerDeploymentsResult>(
          env,
          `/accounts/${accountId}/workers/scripts/${encodeURIComponent(script.id)}/deployments`,
        );
        latest = result.deployments?.[0] ?? null;
      } catch {
        latest = null;
      }

      return {
        name: script.id,
        modifiedAt: script.modified_on ?? null,
        deploymentId: latest?.id ?? null,
        deployedAt: latest?.created_on ?? null,
        versionId: latest?.versions?.[0]?.version_id ?? null,
        source: latest?.source ?? null,
        triggeredBy: latest?.annotations?.["workers/triggered_by"] ?? null,
        message: latest?.annotations?.["workers/message"] ?? null,
      };
    }),
  );
}

async function pagesSnapshot(env: CloudflareEnv): Promise<CloudflarePageDeployment[]> {
  const accountId = encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!);
  const projects = await cloudflare<PagesProject[]>(env, `/accounts/${accountId}/pages/projects`);

  return projects
    .filter((project) => MIRA_NAME.test(project.name))
    .map((project) => {
      const deployment = project.canonical_deployment;
      return {
        name: project.name,
        productionBranch: project.production_branch ?? null,
        deploymentId: deployment?.id ?? null,
        deployedAt: deployment?.created_on ?? null,
        status: deployment?.latest_stage?.status ?? null,
        url: deployment?.url ?? null,
        commitHash: deployment?.deployment_trigger?.metadata?.commit_hash ?? null,
      };
    });
}

export async function getCloudflareSnapshot(env: CloudflareEnv): Promise<CloudflareSnapshot> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_READ_TOKEN) {
    return {
      status: "unconfigured",
      workers: [],
      pages: [],
      analytics24h: unavailableAnalytics(),
      errors: [],
    };
  }

  const [workersResult, pagesResult] = await Promise.allSettled([
    workerSnapshot(env),
    pagesSnapshot(env),
  ]);

  const workers = workersResult.status === "fulfilled" ? workersResult.value : [];
  const pages = pagesResult.status === "fulfilled" ? pagesResult.value : [];
  const errors: string[] = [];

  if (workersResult.status === "rejected") errors.push(shortError("Workers", workersResult.reason));
  if (pagesResult.status === "rejected") errors.push(shortError("Pages", pagesResult.reason));

  let analytics24h = unavailableAnalytics();
  if (workersResult.status === "fulfilled") {
    try {
      analytics24h = await getWorkerAnalytics24h(
        env.CLOUDFLARE_ACCOUNT_ID,
        workers.map((worker) => worker.name),
        <T>(query: string, variables: Record<string, string>) => cloudflareGraphQL<T>(env, query, variables),
      );
    } catch (error) {
      analytics24h = unavailableAnalytics(shortError("Analytics", error));
    }
  }

  return {
    status: errors.length === 0 ? "connected" : "degraded",
    workers,
    pages,
    analytics24h,
    errors,
  };
}
