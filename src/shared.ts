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
  repositories: OrganizationRepository[];
  error?: string;
}
