import type { CloudflareSnapshot, CloudflareSourceStatus } from "./cloudflare";

export type WorkflowConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "skipped"
  | "stale"
  | "startup_failure"
  | null;

export interface RepositoryWorkflow {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: WorkflowConclusion;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryRelease {
  tagName: string;
  name: string | null;
  htmlUrl: string;
  publishedAt: string | null;
}

export interface RepositoryGovernance {
  status: "connected" | "partial";
  openIssues: number | null;
  openPullRequests: number | null;
  defaultBranchProtected: boolean | null;
  activeRulesets: number | null;
}

export interface OrganizationRepository {
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  visibility: "public";
  defaultBranch: string;
  archived: boolean;
  fork: boolean;
  language: string | null;
  pushedAt: string | null;
  updatedAt: string;
  openIssuesCount: number;
  stars: number;
  latestWorkflow: RepositoryWorkflow | null;
  latestRelease: RepositoryRelease | null;
  governance?: RepositoryGovernance;
}

export interface GitHubProjectSummary {
  number: number;
  title: string;
  url: string;
  closed: boolean;
  shortDescription: string | null;
  updatedAt: string;
  itemCount: number;
}

export interface GitHubOrganizationObservability {
  authenticated: boolean;
  governanceStatus: "connected" | "partial";
  projects: {
    status: "connected" | "unavailable";
    items: GitHubProjectSummary[];
    error?: string;
  };
}

export interface ServiceProbe {
  id: string;
  label: string;
  url: string;
  status: "online" | "degraded" | "offline";
  httpStatus: number | null;
  latencyMs: number | null;
  detail: string;
}

export interface OrganizationSnapshot {
  status: "connected" | "degraded";
  generatedAt: string;
  organization: {
    login: string;
    name: string | null;
    htmlUrl: string;
    avatarUrl: string;
    description: string | null;
    publicRepos: number;
    followers: number;
  };
  sources: {
    github: "connected" | "degraded";
    cloudflare: CloudflareSourceStatus;
  };
  repositories: OrganizationRepository[];
  github?: GitHubOrganizationObservability;
  services: ServiceProbe[];
  cloudflare: CloudflareSnapshot;
  deployedCommit: string | null;
  error?: string;
}
