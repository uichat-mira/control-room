import type { CloudflareEnv } from "./cloudflare.ts";
import type { GitHubEnv } from "./github.ts";

const GITHUB_API = "https://api.github.com";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const ORG = "uichat-mira";
const REPORTER_SCRIPT = "how-am-i";
const REPORTER_APP_ID = "mira-worker-reporter";
const REPORTER_TRUST_CLASS = "trusted_pipeline";
const REPORTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const REPORTER_QUERY_JOB_PADDING_MS = 5 * 1000;

export type FactoryState =
  | "queued"
  | "working"
  | "candidate_captured"
  | "validating"
  | "repairing"
  | "validation_gap"
  | "blocked"
  | "verified"
  | "delivery_retry"
  | "delivered"
  | "escalated"
  | "worker_failed"
  | "observation_gap"
  | "logs_expired"
  | "artifact_unavailable"
  | "unknown";

export type FactoryFreshness = "fresh" | "stale" | "expired" | "unavailable";

export interface FactoryEvidence {
  source: "github-run" | "github-job" | "github-artifact" | "github-pr" | "haomai-event";
  id: string;
  url: string | null;
  observedAt: string;
}

export interface FactoryEvent {
  occurredAt: string;
  kind: string;
  stage: string;
  outcome: string;
  level: string;
  errorCode: string | null;
  issueNumber: number | null;
  evidence: FactoryEvidence | null;
}

export interface FactoryJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  evidence: FactoryEvidence;
}

export interface FactoryArtifact {
  id: number;
  name: string;
  expired: boolean;
  createdAt: string;
  expiresAt: string | null;
  url: string;
  evidence: FactoryEvidence;
}

export interface FactoryPullRequest {
  number: number;
  htmlUrl: string;
  draft: boolean | null;
  title: string;
  evidence: FactoryEvidence;
}

export interface FactoryRunProjection {
  apiVersion: "v1";
  mode: "real";
  generatedAt: string;
  repository: string;
  issueNumber: number | null;
  run: {
    id: number;
    attempt: number;
    name: string;
    path: string | null;
    status: string;
    conclusion: string | null;
    event: string | null;
    branch: string | null;
    headSha: string;
    displayTitle: string;
    htmlUrl: string;
    createdAt: string;
    updatedAt: string;
    runStartedAt: string | null;
    referencedExternalWorker: boolean;
  };
  state: FactoryState;
  repairRound: number | null;
  freshness: FactoryFreshness;
  provenance: FactoryEvidence[];
  jobs: FactoryJob[];
  artifacts: FactoryArtifact[];
  pullRequests: FactoryPullRequest[];
  reporter: {
    status: "available" | "unavailable" | "expired" | "not_configured" | "not_expected";
    freshness: FactoryFreshness;
    events: FactoryEvent[];
    observedAt: string | null;
  };
  warnings: string[];
}

interface GitHubRun {
  id: number;
  name: string;
  path?: string | null;
  status: string;
  conclusion: string | null;
  event: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_attempt: number;
  head_branch: string | null;
  head_sha: string;
  display_title: string;
  run_started_at?: string | null;
  referenced_workflows?: Array<{ path?: string; sha?: string; ref?: string }>;
  pull_requests?: Array<{ number: number; url?: string; html_url?: string; base?: { ref?: string }; head?: { ref?: string } }>;
}

interface GitHubJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface GitHubArtifact {
  id: number;
  name: string;
  expired: boolean;
  created_at: string;
  expires_at: string | null;
  updated_at: string;
  url: string;
  archive_download_url: string;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
  draft: boolean | null;
  title: string;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface HaomaiQueryResult {
  events?: {
    events?: Array<{
        source?: {
          event?: string;
          schema?: string;
          received_at?: string;
          app_id?: string;
          trust_class?: string;
          level?: string;
          event_id?: string;
          occurred_at?: string;
          kind?: string;
          repository?: string;
          issue_number?: number;
          run_id?: string;
          run_attempt?: number;
          stage?: string;
          outcome?: string;
          evidence_ref?: { type?: string; id?: string };
          error_code?: string;
        };
      }>;
    };
  };
}

function githubHeaders(env: GitHubEnv): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "uichat-mira-control-room",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(env.GITHUB_READ_TOKEN ? { Authorization: `Bearer ${env.GITHUB_READ_TOKEN}` } : {}),
  };
}

async function github<T>(env: GitHubEnv, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders(env) });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json() as Promise<T>;
}

async function optionalGithub<T>(env: GitHubEnv, path: string): Promise<T | null> {
  const response = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders(env) });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

// Legacy binding name: CLOUDFLARE_READ_TOKEN is the server-only runtime token.
 // The ad-hoc Observability query API currently requires Workers Observability Write/Edit
 // permission; the token is never serialized into the browser projection.
async function cloudflare<T>(env: CloudflareEnv, path: string, body: unknown): Promise<T> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_READ_TOKEN) {
    throw new Error("Cloudflare read credentials not configured");
  }

  const response = await fetch(
    `${CLOUDFLARE_API}/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_READ_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "uichat-mira-control-room",
      },
      body: JSON.stringify(body),
    },
  );

  let payload: CloudflareEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as CloudflareEnvelope<T>;
  } catch {
    // handled by the status below
  }

  if (!response.ok || !payload?.success) {
    const detail = payload?.errors?.[0]?.message;
    throw new Error(`Cloudflare API ${response.status}${detail ? ` · ${detail}` : ""}`);
  }

  return payload.result;
}

function isExternalWorkerRun(run: GitHubRun): boolean {
  return (
    /mira external worker/i.test(run.name) ||
    (run.referenced_workflows ?? []).some((workflow) =>
      workflow.path?.includes("uichat-mira/.github/.github/workflows/mira-external-worker.yml"),
    )
  );
}

function evidence(
  source: FactoryEvidence["source"],
  id: string,
  url: string | null,
  observedAt: string,
): FactoryEvidence {
  return { source, id, url, observedAt };
}

function parseRepairRound(errorCode: string | null): number | null {
  if (errorCode === "VALIDATION_REPAIR_ROUND_1") return 1;
  if (errorCode === "VALIDATION_REPAIR_ROUND_2") return 2;
  return null;
}

function deriveState(
  run: GitHubRun,
  jobs: FactoryJob[],
  artifacts: FactoryArtifact[],
  events: FactoryEvent[],
  reporterStatus: FactoryRunProjection["reporter"]["status"],
): { state: FactoryState; repairRound: number | null } {
  const latest = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];

  if (latest?.stage === "repair" && latest.outcome === "escalated") {
    return { state: "escalated", repairRound: parseRepairRound(latest.errorCode) ?? 2 };
  }
  if (latest?.stage === "repair" && latest.outcome === "blocked") {
    return { state: "blocked", repairRound: parseRepairRound(latest.errorCode) };
  }
  if (latest?.stage === "repair" && latest.outcome === "returned") {
    return { state: "repairing", repairRound: parseRepairRound(latest.errorCode) };
  }

  const latestOccurredAt = latest ? Date.parse(latest.occurredAt) : NaN;
  const laterVerifyFailure = jobs.some((job) => {
    if (!/verify|validation/i.test(job.name)) return false;
    if (!["failure", "timed_out", "startup_failure"].includes(job.conclusion ?? "")) return false;
    if (!latest || !Number.isFinite(latestOccurredAt)) return true;
    const completedAt = job.completedAt ? Date.parse(job.completedAt) : NaN;
    return !Number.isFinite(completedAt) || completedAt >= latestOccurredAt;
  });

  if (latest?.kind === "verify.passed") {
    return laterVerifyFailure
      ? { state: "validation_gap", repairRound: null }
      : { state: "verified", repairRound: null };
  }
  if (latest?.kind === "delivery.failed") return { state: "delivery_retry", repairRound: null };
  if (latest?.kind === "delivery.draft_pr_created") return { state: "delivered", repairRound: null };
  if (latest?.kind === "verify.failed") return { state: "validation_gap", repairRound: null };
  if (latest?.kind === "candidate.captured") return { state: "candidate_captured", repairRound: null };

  const activeJob = jobs.some((job) => job.status === "in_progress" || job.status === "queued");
  if (activeJob || run.status === "in_progress") {
    if (jobs.some((job) => /verify|validation/i.test(job.name) && job.status === "in_progress")) {
      return { state: "validating", repairRound: null };
    }
    return { state: "working", repairRound: null };
  }

  if (run.status === "queued") return { state: "queued", repairRound: null };

  const executedRun =
    run.status === "completed" &&
    ["success", "failure", "timed_out", "startup_failure"].includes(run.conclusion ?? "");
  if (
    executedRun &&
    (artifacts.length === 0 || artifacts.some((artifact) => artifact.expired))
  ) {
    return { state: "artifact_unavailable", repairRound: null };
  }

  if (
    run.status === "completed" &&
    ["failure", "timed_out", "startup_failure"].includes(run.conclusion ?? "")
  ) {
    return { state: "worker_failed", repairRound: null };
  }

  if (reporterStatus === "expired") {
    return { state: "logs_expired", repairRound: null };
  }

  if (
    run.status === "completed" &&
    ["skipped", "cancelled", "neutral", "action_required", "success"].includes(run.conclusion ?? "")
  ) {
    return { state: "observation_gap", repairRound: null };
  }

  return { state: "unknown", repairRound: null };
}

function githubFreshness(run: GitHubRun, now: number): FactoryFreshness {
  const updated = Date.parse(run.updated_at);
  if (!Number.isFinite(updated)) return "unavailable";
  return now - updated > 10 * 60 * 1000 ? "stale" : "fresh";
}

function reporterFreshness(run: GitHubRun, now: number): FactoryFreshness {
  const updated = Date.parse(run.updated_at);
  if (!Number.isFinite(updated)) return "unavailable";
  if (now - updated > REPORTER_RETENTION_MS) return "expired";
  if (now - updated > 10 * 60 * 1000) return "stale";
  return "fresh";
}

async function reporterEvents(
  env: CloudflareEnv,
  run: GitHubRun,
  repository: string,
  jobs: GitHubJob[],
  now: number,
): Promise<FactoryRunProjection["reporter"]> {
  const freshness = reporterFreshness(run, now);

  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_READ_TOKEN) {
    return { status: "not_configured", freshness: "unavailable", events: [], observedAt: null };
  }
  if (freshness === "expired") {
    return { status: "expired", freshness, events: [], observedAt: null };
  }

  // Only a GitHub-proven successful trusted_reporter job may trigger the expensive
  // Workers Logs query. Historical/legacy/skipped runs must never turn arbitrary
  // public run IDs into an Observability scan oracle.
  const reporterJob = jobs.find(
    (job) => job.name?.split("/").at(-1)?.trim() === "trusted_reporter",
  );
  if (
    run.status !== "completed" ||
    !reporterJob ||
    reporterJob.status !== "completed" ||
    ["skipped", "cancelled", "neutral", "action_required"].includes(reporterJob.conclusion ?? "")
  ) {
    return { status: "not_expected", freshness, events: [], observedAt: null };
  }
  if (reporterJob.conclusion !== "success") {
    return { status: "unavailable", freshness, events: [], observedAt: null };
  }

  const startedAt = reporterJob.started_at ? Date.parse(reporterJob.started_at) : NaN;
  const completedAt = reporterJob.completed_at ? Date.parse(reporterJob.completed_at) : NaN;
  const from = startedAt - REPORTER_QUERY_JOB_PADDING_MS;
  const to = Math.min(now, completedAt + REPORTER_QUERY_JOB_PADDING_MS);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return { status: "unavailable", freshness: "unavailable", events: [], observedAt: null };
  }

  try {
    const payload = await cloudflare<HaomaiQueryResult>(env, "/workers/observability/telemetry/query", {
      queryId: "mira-control-room-factory-tv",
      timeframe: { from, to },
      view: "events",
      limit: 100,
      parameters: {
        datasets: ["cloudflare-workers"],
        filterCombination: "and",
        filters: [
          { key: "$metadata.service", operation: "eq", type: "string", value: REPORTER_SCRIPT },
          { key: "app_id", operation: "eq", type: "string", value: REPORTER_APP_ID },
          { key: "trust_class", operation: "eq", type: "string", value: REPORTER_TRUST_CLASS },
          { key: "run_id", operation: "eq", type: "string", value: String(run.id) },
        ],
      },
    });

    const rows = payload.events?.events ?? [];
    const events: FactoryEvent[] = rows
      .map((row) => row.source)
      .filter((source): source is NonNullable<typeof source> => Boolean(source))
      .filter((source) => source.repository === repository)
      .filter((source) => source.run_id === String(run.id))
      .filter((source) => source.run_attempt == null || source.run_attempt === run.run_attempt)
      .filter((source) => source.schema === "haomai.telemetry.v1")
      .map((source) => ({
        occurredAt: source.occurred_at ?? source.received_at ?? new Date(now).toISOString(),
        kind: source.kind ?? "unknown",
        stage: source.stage ?? "unknown",
        outcome: source.outcome ?? "unknown",
        level: source.level ?? "info",
        errorCode: source.error_code ?? null,
        issueNumber: source.issue_number ?? null,
        evidence: source.event_id || source.evidence_ref?.id
          ? evidence(
              "haomai-event",
              source.event_id ?? source.evidence_ref!.id,
              null,
              source.occurred_at ?? source.received_at ?? new Date(now).toISOString(),
            )
          : null,
      }))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    return {
      status: "available",
      freshness,
      events,
      observedAt: events.at(-1)?.occurredAt ?? null,
    };
  } catch {
    return { status: "unavailable", freshness, events: [], observedAt: null };
  }
}

export async function getFactoryRunProjection(
  githubEnv: GitHubEnv,
  cloudflareEnv: CloudflareEnv,
  repository: string,
  runId: number,
  now = Date.now(),
): Promise<FactoryRunProjection> {
  if (!/^uichat-mira\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("unsupported_repository");
  }
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new Error("invalid_run_id");
  }

  const repoName = repository.slice("uichat-mira/".length);
  const encodedRepo = encodeURIComponent(repoName);
  const repositoryInfo = await optionalGithub<{ visibility?: string; archived?: boolean }>(
    githubEnv,
    `/repos/${ORG}/${encodedRepo}`,
  );
  if (repositoryInfo?.visibility !== "public") {
    throw new Error("repository_not_public");
  }

  const run = await github<GitHubRun>(
    githubEnv,
    `/repos/${ORG}/${encodedRepo}/actions/runs/${runId}?exclude_pull_requests=false`,
  );

  if (!isExternalWorkerRun(run)) {
    throw new Error("not_external_worker_run");
  }

  const observedAt = new Date(now).toISOString();
  const [jobsResult, artifactsResult, pullRequestsResult] = await Promise.all([
    github<{ jobs: GitHubJob[] }>(
      githubEnv,
      `/repos/${ORG}/${encodedRepo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`,
    ),
    github<{ artifacts: GitHubArtifact[] }>(
      githubEnv,
      `/repos/${ORG}/${encodedRepo}/actions/runs/${runId}/artifacts?per_page=100&direction=desc`,
    ),
    Promise.all(
      (run.pull_requests ?? []).slice(0, 3).map(async (pull) => {
        const pr = await optionalGithub<GitHubPullRequest>(
          githubEnv,
          `/repos/${ORG}/${encodedRepo}/pulls/${pull.number}`,
        );
        return pr;
      }),
    ),
  ]);

  const reporter = await reporterEvents(cloudflareEnv, run, repository, jobsResult.jobs, now);

  const jobs = jobsResult.jobs.map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    evidence: evidence(
      "github-job",
      String(job.id),
      `https://github.com/${repository}/actions/runs/${runId}/job/${job.id}`,
      observedAt,
    ),
  }));

  const artifacts = artifactsResult.artifacts.map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    expired: artifact.expired,
    createdAt: artifact.created_at,
    expiresAt: artifact.expires_at,
    url: artifact.url,
    evidence: evidence("github-artifact", String(artifact.id), artifact.url, observedAt),
  }));

  const pullRequests = pullRequestsResult
    .filter((pr): pr is GitHubPullRequest => Boolean(pr))
    .map((pr) => ({
      number: pr.number,
      htmlUrl: pr.html_url,
      draft: pr.draft,
      title: pr.title,
      evidence: evidence("github-pr", String(pr.number), pr.html_url, observedAt),
    }));

  const issueNumber = reporter.events.find((event) => event.issueNumber != null)?.issueNumber ?? null;
  const derived = deriveState(run, jobs, artifacts, reporter.events, reporter.status);

  return {
    apiVersion: "v1",
    mode: "real",
    generatedAt: observedAt,
    repository,
    issueNumber,
    run: {
      id: run.id,
      attempt: run.run_attempt,
      name: run.name,
      path: run.path ?? null,
      status: run.status,
      conclusion: run.conclusion,
      event: run.event,
      branch: run.head_branch,
      headSha: run.head_sha,
      displayTitle: run.display_title,
      htmlUrl: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      runStartedAt: run.run_started_at ?? null,
      referencedExternalWorker: true,
    },
    state: derived.state,
    repairRound: derived.repairRound,
    freshness: githubFreshness(run, now),
    provenance: [
      evidence("github-run", String(run.id), run.html_url, observedAt),
      ...jobs.map((job) => job.evidence),
      ...artifacts.map((artifact) => artifact.evidence),
      ...pullRequests.map((pr) => pr.evidence),
      ...reporter.events.map((event) => event.evidence).filter((item): item is FactoryEvidence => Boolean(item)),
    ],
    jobs,
    artifacts,
    pullRequests,
    reporter,
    warnings: [
      ...(reporter.status === "unavailable" ? ["Reporter unavailable; GitHub remains the lifecycle source."] : []),
      ...(reporter.status === "not_expected" ? ["Reporter is not expected for this run state; GitHub remains the lifecycle source."] : []),
      ...(reporter.status === "expired" ? ["Reporter logs expired; historical lifecycle evidence remains in GitHub where available."] : []),
      ...(reporter.status === "available" && reporter.events.length === 0
        ? ["Reporter query succeeded, but no trusted event was observed for this run attempt; this is an observation gap, not a Worker failure."]
        : []),
      ...(artifacts.some((artifact) => artifact.expired) ? ["One or more GitHub Artifacts are expired."] : []),
      ...(run.status === "completed" && run.conclusion === "success" && reporter.events.length === 0
        ? ["GitHub Run succeeded, but no trusted Verify/Delivery event was observed; this is not a verified product outcome."]
        : []),
    ],
  };
}
