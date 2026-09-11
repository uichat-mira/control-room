export const REVIEW_PACKAGE_VERSION = "mira-ai-review-package/v0" as const;
export const AI_REVIEW_RUNTIME_VERSION = "control-room-ai-review/v0" as const;
export const MAX_REVIEW_DIFF_CHARS = 180_000;

export interface TrustedReviewText {
  source: "organization" | "base";
  repository: string;
  path: string;
  ref: string;
  blobSha: string;
  content: string;
}

export interface ReviewPackage {
  packageVersion: typeof REVIEW_PACKAGE_VERSION;
  runtimeVersion: typeof AI_REVIEW_RUNTIME_VERSION;
  generatedAt: string;
  trust: {
    headIsUntrusted: true;
    executesPullRequestCode: false;
    organizationControlsSource: string;
    requestedOrganizationPolicyRef: string;
    repositoryControlsSource: string;
  };
  pullRequest: {
    repository: string;
    number: number;
    title: string;
    body: string | null;
    author: string;
    draft: boolean;
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
  };
  controls: {
    policy: TrustedReviewText;
    outputContract: TrustedReviewText;
    repositoryProfile: TrustedReviewText | null;
    rootContract: TrustedReviewText | null;
    identity: {
      policyCommitSha: string;
      policyBlobSha: string;
      outputContractBlobSha: string;
      profileBlobSha: string | null;
      rootContractBlobSha: string | null;
    };
  };
  diff: {
    source: string;
    content: string;
    chars: number;
    originalChars: number;
    truncated: boolean;
    limitChars: number;
  };
  gaps: string[];
}

export type ReviewPackageErrorCode =
  | "github_unconfigured"
  | "invalid_repository"
  | "invalid_pull_request"
  | "repository_mismatch"
  | "fork_pull_request_not_supported"
  | "review_package_failed";

export class ReviewPackageError extends Error {
  readonly code: ReviewPackageErrorCode;
  readonly status: number;

  constructor(code: ReviewPackageErrorCode, status: number, message: string) {
    super(message);
    this.name = "ReviewPackageError";
    this.code = code;
    this.status = status;
  }
}
