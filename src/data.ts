import { useEffect, useState } from "react";
import type {
  CloudflarePageDeployment,
  CloudflareSourceStatus,
  CloudflareWorkerDeployment,
} from "./cloudflare";
import type { CloudflareAnalytics24h } from "./cloudflare-analytics";
import type {
  GitHubOrganizationObservability,
  OrganizationRepository,
  OrganizationSnapshot,
  RepositoryGovernance,
  RepositoryWorkflow,
  ServiceProbe,
} from "./shared";

export type SummaryPayload = OrganizationSnapshot & { apiVersion: "v1" };

export interface RepositoriesPayload {
  apiVersion: "v1";
  generatedAt: string;
  status: "connected" | "degraded";
  items: OrganizationRepository[];
}

export interface ServicesPayload {
  apiVersion: "v1";
  generatedAt: string;
  status: "connected" | "degraded";
  items: ServiceProbe[];
}

export interface DeploymentsPayload {
  apiVersion: "v1";
  generatedAt: string;
  status: CloudflareSourceStatus;
  workers: CloudflareWorkerDeployment[];
  pages: CloudflarePageDeployment[];
}

export type AnalyticsPayload = CloudflareAnalytics24h & {
  apiVersion: "v1";
  generatedAt: string;
};

export interface GovernanceRepository {
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  governance: RepositoryGovernance;
}

export interface GovernancePayload {
  apiVersion: "v1";
  generatedAt: string;
  status: "connected" | "degraded";
  organization: {
    login: string;
    htmlUrl: string;
  };
  github: GitHubOrganizationObservability;
  repositories: GovernanceRepository[];
  error?: string;
}

export function usePolling<T>(url: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`${url} returned ${response.status}`);
        const body = (await response.json()) as T;
        if (!active) return;
        setData(body);
        setError(null);
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : `${url} unavailable`);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [intervalMs, url]);

  return { data, error };
}

export const formatTime = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

export const formatCount = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);

export const shortSha = (value: string | null | undefined) => (value ? value.slice(0, 7) : "—");

export const workflowText = (run: RepositoryWorkflow | null) => {
  if (!run) return "No runs";
  if (run.status !== "completed") return run.status === "in_progress" ? "Running" : "Queued";
  if (run.conclusion === "success") return "Passed";
  if (run.conclusion === "cancelled") return "Cancelled";
  if (run.conclusion === "skipped" || run.conclusion === "neutral") return "Neutral";
  return run.conclusion ? run.conclusion.replaceAll("_", " ") : "Completed";
};

export const workflowTone = (run: RepositoryWorkflow | null) => {
  if (!run) return "muted";
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "cancelled" || run.conclusion === "skipped" || run.conclusion === "neutral") {
    return "muted";
  }
  return "failure";
};

export const buildIsFailure = (run: RepositoryWorkflow | null) => {
  if (!run || run.status !== "completed") return false;
  return !["success", "cancelled", "skipped", "neutral"].includes(run.conclusion ?? "");
};

export const cloudflareLabel = (status: CloudflareSourceStatus | undefined) => {
  if (status === "connected") return "connected";
  if (status === "degraded") return "partial";
  if (status === "unconfigured") return "unconfigured";
  return "loading";
};
