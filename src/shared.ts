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
    cloudflare: "pending";
  };
  repositories: OrganizationRepository[];
  services: ServiceProbe[];
  error?: string;
}
