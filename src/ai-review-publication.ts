import {
  AI_REVIEW_RUNTIME_VERSION,
  REVIEW_PACKAGE_VERSION,
  type ReviewPackage,
  type TrustedTaskContractIdentity,
} from "./ai-review-package.ts";
import {
  REVIEW_EXECUTION_VERSION,
  type ReviewExecutionEnvelope,
} from "./ai-review-execution.ts";
import type {
  ContractConflictDetail,
  NormalizedReview,
  ReviewFinding,
} from "./ai-review-runtime.ts";

const GITHUB_API = "https://api.github.com";
export const MIRA_REVIEW_MARKER = "<!-- mira-ai-review:v1 -->" as const;
export const REVIEW_OUTPUT_CONTRACT_VERSION = "mira-ai-review-output/v1" as const;
export const MAX_REVIEW_COMMENT_BYTES = 60_000;
export const PUBLISH_PILOT_REPOSITORIES = [
  "uichat-mira/mira-mobile",
  "uichat-mira/uichat-mira-docs",
  "uichat-mira/mira-desktop",
] as const;
export const PUBLISH_PILOT_REPOSITORY = PUBLISH_PILOT_REPOSITORIES[0];

export function isPublishPilotRepository(repository: string) {
  return PUBLISH_PILOT_REPOSITORIES.some((allowed) => allowed === repository);
}

export interface AiReviewPublicationEnv {
  GITHUB_PUBLISH_TOKEN?: string;
}

export type ReviewStaleReason =
  | "repository"
  | "pull_request"
  | "review_mode"
  | "base_sha"
  | "head_sha"
  | "policy_blob"
  | "output_contract_blob"
  | "profile_blob"
  | "root_contract_blob"
  | "task_contract";

export type ReviewFreshness =
  | { state: "CURRENT"; reasons: [] }
  | { state: "STALE_REVIEW"; reasons: ReviewStaleReason[] };

export interface ReviewPublicationResult {
  state: "CREATED" | "UPDATED";
  commentId: number;
  publisher: string;
  removedDuplicates: number;
}

interface GitHubUser {
  login: string;
}

interface GitHubIssueComment {
  id: number;
  body: string | null;
  user: { login: string };
}

export class ReviewPublicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewPublicationError";
  }
}

function safeInline(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "@\u200b")
    .replace(/([\\`*_[\]{}()#+|])/g, "\\$1");
}

function safeIdentity(value: string | null) {
  return value ? safeInline(value) : "none";
}

function renderTaskContract(identity: TrustedTaskContractIdentity) {
  if (identity.state === "unavailable") {
    return `unavailable (${identity.reason})`;
  }
  return `${safeInline(identity.repository)}#${identity.issue} / ${safeInline(identity.updatedAt)} / ${safeInline(identity.contentSha256)}`;
}

function sameTaskContract(
  left: TrustedTaskContractIdentity,
  right: TrustedTaskContractIdentity,
) {
  if (left.state !== right.state) return false;
  if (left.state === "unavailable" && right.state === "unavailable") {
    return left.reason === right.reason;
  }
  if (left.state === "resolved" && right.state === "resolved") {
    return (
      left.repository === right.repository &&
      left.issue === right.issue &&
      left.contentSha256 === right.contentSha256
    );
  }
  return false;
}

function renderFinding(finding: ReviewFinding, index: number) {
  return [
    `#### Finding ${index + 1} — ${safeInline(finding.severity)}`,
    `- **Observation:** ${safeInline(finding.observation)}`,
    `- **Inference:** ${safeInline(finding.inference)}`,
    `- **Judgment:** ${safeInline(finding.judgment)}`,
    `- **Impact:** ${safeInline(finding.impact)}`,
    `- **Location:** ${safeInline(finding.location)}`,
    `- **Suggested Fix:** ${safeInline(finding.suggestedFix)}`,
    `- **Verification:** ${safeInline(finding.verification)}`,
  ].join("\n");
}

function renderFindings(review: NormalizedReview) {
  if (review.findings.length === 0) {
    return "No high-confidence P0-P2 findings were established.";
  }
  return review.findings.map(renderFinding).join("\n\n");
}

function renderValidationGaps(review: NormalizedReview) {
  if (review.validationGaps.length === 0) return "None identified.";
  return review.validationGaps.map((gap) => `- ${safeInline(gap)}`).join("\n");
}

function renderConflict(detail: ContractConflictDetail | undefined) {
  if (!detail) return "";
  return [
    "### Contract conflict",
    `- **Sources:** ${detail.sources.map(safeInline).join("; ")}`,
    "- **Conflicting requirements:**",
    ...detail.conflictingRequirements.map((requirement) => `  - ${safeInline(requirement)}`),
    `- **Why it changes judgment:** ${safeInline(detail.whyItChangesJudgment)}`,
    `- **Maintainer decision required:** ${safeInline(detail.maintainerDecisionRequired)}`,
  ].join("\n");
}

function ensureCommentSize(body: string) {
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (bodyBytes > MAX_REVIEW_COMMENT_BYTES) {
    throw new ReviewPublicationError(
      `Rendered review exceeds the ${MAX_REVIEW_COMMENT_BYTES}-byte publication limit.`,
    );
  }
  return body;
}

function renderIdentityMetadata(envelope: ReviewExecutionEnvelope) {
  return [
    "### Review metadata",
    `- **Repository:** ${safeInline(envelope.identity.repository)}`,
    `- **Pull request:** #${envelope.identity.pullRequest}`,
    `- **Review mode:** ${envelope.identity.reviewMode}`,
    `- **Base SHA:** ${safeInline(envelope.identity.baseSha)}`,
    `- **Head SHA:** ${safeInline(envelope.identity.headSha)}`,
    `- **Trusted Task / PR contract:** ${renderTaskContract(envelope.identity.taskContract)}`,
    `- **Organization policy commit:** ${safeInline(envelope.identity.policyCommitSha)}`,
    `- **Organization policy blob:** ${safeInline(envelope.identity.policyBlobSha)}`,
    `- **Output contract:** ${REVIEW_OUTPUT_CONTRACT_VERSION} / ${safeInline(envelope.identity.outputContractBlobSha)}`,
    `- **Repository profile blob:** ${safeIdentity(envelope.identity.profileBlobSha)}`,
    `- **Root contract blob:** ${safeIdentity(envelope.identity.rootContractBlobSha)}`,
    `- **Runtime:** ${AI_REVIEW_RUNTIME_VERSION}`,
    `- **Package:** ${REVIEW_PACKAGE_VERSION}`,
    `- **Execution:** ${REVIEW_EXECUTION_VERSION}`,
    `- **Executed at:** ${safeInline(envelope.executedAt)}`,
  ].join("\n");
}

export function renderReviewComment(envelope: ReviewExecutionEnvelope) {
  if (envelope.execution.state !== "COMPLETED") {
    throw new ReviewPublicationError(
      "Only a completed normalized review can be rendered as the current Mira review comment.",
    );
  }

  const review = envelope.execution.review;
  const provider = envelope.execution.provider;
  const verdictSection = [
    "### Verdict",
    `\`${review.verdict}\``,
    ...(review.verdict === "CONTRACT_CONFLICT"
      ? [renderConflict(review.contractConflict)]
      : []),
  ].join("\n\n");

  const metadataSection = [
    renderIdentityMetadata(envelope),
    `- **Provider:** ${safeInline(provider.id)}`,
    `- **Provider role:** ${safeInline(provider.role)}`,
    `- **Model:** ${safeInline(provider.model)}`,
  ].join("\n");

  return ensureCommentSize([
    MIRA_REVIEW_MARKER,
    "## Mira AI Review",
    verdictSection,
    ["### Findings", renderFindings(review)].join("\n\n"),
    ["### Validation gaps", renderValidationGaps(review)].join("\n\n"),
    metadataSection,
  ].join("\n\n"));
}

function renderAttemptDiagnostics(attempt: ReviewExecutionEnvelope["execution"]["attempts"][number]) {
  const parts = [
    attempt.failureClass,
    attempt.failureDetail,
    attempt.normalizationReason,
    attempt.normalizationPath,
    typeof attempt.upstreamStatus === "number" ? `HTTP ${attempt.upstreamStatus}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return parts.length ? ` · ${parts.map(safeInline).join(" · ")}` : "";
}

export function renderReviewUnavailableComment(envelope: ReviewExecutionEnvelope) {
  if (envelope.execution.state !== "REVIEW_UNAVAILABLE") {
    throw new ReviewPublicationError("Review execution is not unavailable.");
  }

  const attempts = envelope.execution.attempts.length
    ? envelope.execution.attempts
        .map(
          (attempt) =>
            `- ${safeInline(attempt.role)} / ${safeInline(attempt.provider)} / ${safeInline(attempt.status)}${renderAttemptDiagnostics(attempt)}`,
        )
        .join("\n")
    : "- No eligible provider attempt was executed.";

  return ensureCommentSize([
    MIRA_REVIEW_MARKER,
    "## Mira AI Review",
    "### Status",
    "`REVIEW_UNAVAILABLE`",
    `- **Reason:** ${safeInline(envelope.execution.reason)}`,
    "- No clean or blocking verdict is current while review execution is unavailable.",
    "### Provider attempts",
    attempts,
    renderIdentityMetadata(envelope),
  ].join("\n\n"));
}

export function renderStaleReviewComment(
  envelope: ReviewExecutionEnvelope,
  current: ReviewPackage,
  freshness: Extract<ReviewFreshness, { state: "STALE_REVIEW" }>,
) {
  return ensureCommentSize([
    MIRA_REVIEW_MARKER,
    "## Mira AI Review",
    "### Status",
    "`STALE_REVIEW`",
    `- **Changed identity:** ${freshness.reasons.map(safeInline).join(", ")}`,
    `- **Reviewed head:** ${safeInline(envelope.identity.headSha)}`,
    `- **Current head:** ${safeInline(current.pullRequest.head.sha)}`,
    `- **Current base:** ${safeInline(current.pullRequest.base.sha)}`,
    "- The previous verdict is not current. A new review is required for the current identity.",
    renderIdentityMetadata(envelope),
  ].join("\n\n"));
}

export function renderPublicationUnavailableComment(
  repository: string,
  pullRequest: number,
  reason: string,
) {
  return ensureCommentSize([
    MIRA_REVIEW_MARKER,
    "## Mira AI Review",
    "### Status",
    "`REVIEW_UNAVAILABLE`",
    `- **Repository:** ${safeInline(repository)}`,
    `- **Pull request:** #${pullRequest}`,
    `- **Reason:** ${safeInline(reason)}`,
    "- No earlier Mira verdict should be treated as current until freshness can be re-established.",
  ].join("\n\n"));
}

export function compareReviewFreshness(
  envelope: ReviewExecutionEnvelope,
  current: ReviewPackage,
): ReviewFreshness {
  const reasons: ReviewStaleReason[] = [];
  const identity = envelope.identity;

  if (identity.repository !== current.pullRequest.repository) reasons.push("repository");
  if (identity.pullRequest !== current.pullRequest.number) reasons.push("pull_request");
  if (identity.reviewMode !== current.reviewMode) reasons.push("review_mode");
  if (identity.baseSha !== current.pullRequest.base.sha) reasons.push("base_sha");
  if (identity.headSha !== current.pullRequest.head.sha) reasons.push("head_sha");
  if (identity.policyBlobSha !== current.controls.identity.policyBlobSha) reasons.push("policy_blob");
  if (identity.outputContractBlobSha !== current.controls.identity.outputContractBlobSha) {
    reasons.push("output_contract_blob");
  }
  if (identity.profileBlobSha !== current.controls.identity.profileBlobSha) reasons.push("profile_blob");
  if (identity.rootContractBlobSha !== current.controls.identity.rootContractBlobSha) {
    reasons.push("root_contract_blob");
  }
  if (!sameTaskContract(identity.taskContract, current.controls.identity.taskContract)) {
    reasons.push("task_contract");
  }

  return reasons.length === 0
    ? { state: "CURRENT", reasons: [] }
    : { state: "STALE_REVIEW", reasons };
}

function publicationHeaders(env: AiReviewPublicationEnv) {
  const token = env.GITHUB_PUBLISH_TOKEN?.trim();
  if (!token) throw new ReviewPublicationError("GITHUB_PUBLISH_TOKEN is required.");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "uichat-mira-control-room-ai-review-publisher",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function publicationJson<T>(
  env: AiReviewPublicationEnv,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      ...publicationHeaders(env),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new ReviewPublicationError(`GitHub publication failed with HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

async function deletePublicationComment(
  env: AiReviewPublicationEnv,
  repository: string,
  commentId: number,
) {
  const response = await fetch(
    `${GITHUB_API}/repos/${repository}/issues/comments/${commentId}`,
    { method: "DELETE", headers: publicationHeaders(env) },
  );
  if (!response.ok && response.status !== 404) {
    throw new ReviewPublicationError(
      `GitHub duplicate review cleanup failed with HTTP ${response.status}.`,
    );
  }
}

export async function publishReviewComment(
  env: AiReviewPublicationEnv,
  repository: string,
  pullRequest: number,
  body: string,
): Promise<ReviewPublicationResult> {
  if (!isPublishPilotRepository(repository)) {
    throw new ReviewPublicationError(
      `AI Review publication is limited to ${PUBLISH_PILOT_REPOSITORIES.join(", ")} during the V1 pilot.`,
    );
  }
  ensureCommentSize(body);

  const publisher = await publicationJson<GitHubUser>(env, "/user");
  const comments = await publicationJson<GitHubIssueComment[]>(
    env,
    `/repos/${repository}/issues/${pullRequest}/comments?per_page=100`,
  );
  const owned = comments
    .filter(
      (comment) =>
        comment.user.login === publisher.login &&
        (comment.body || "").includes(MIRA_REVIEW_MARKER),
    )
    .sort((left, right) => left.id - right.id);

  let state: ReviewPublicationResult["state"];
  let canonical: GitHubIssueComment;
  if (owned.length === 0) {
    canonical = await publicationJson<GitHubIssueComment>(
      env,
      `/repos/${repository}/issues/${pullRequest}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    state = "CREATED";
  } else {
    canonical = await publicationJson<GitHubIssueComment>(
      env,
      `/repos/${repository}/issues/comments/${owned[0].id}`,
      { method: "PATCH", body: JSON.stringify({ body }) },
    );
    state = "UPDATED";
  }

  const duplicates = owned.slice(1);
  for (const duplicate of duplicates) {
    await deletePublicationComment(env, repository, duplicate.id);
  }

  return {
    state,
    commentId: canonical.id,
    publisher: publisher.login,
    removedDuplicates: duplicates.length,
  };
}
