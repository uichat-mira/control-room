import {
  AI_REVIEW_RUNTIME_VERSION,
  REVIEW_PACKAGE_VERSION,
  type ReviewPackage,
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

export const MIRA_REVIEW_MARKER = "<!-- mira-ai-review:v1 -->" as const;
export const REVIEW_OUTPUT_CONTRACT_VERSION = "mira-ai-review-output/v1" as const;
export const MAX_REVIEW_COMMENT_CHARS = 60_000;

export type ReviewStaleReason =
  | "repository"
  | "pull_request"
  | "base_sha"
  | "head_sha"
  | "policy_commit"
  | "policy_blob"
  | "output_contract_blob"
  | "profile_blob"
  | "root_contract_blob";

export type ReviewFreshness =
  | { state: "CURRENT"; reasons: [] }
  | { state: "STALE_REVIEW"; reasons: ReviewStaleReason[] };

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
    .replace(/([\\`*_[\]{}()#+!|])/g, "\\$1");
}

function safeIdentity(value: string | null) {
  return value ? safeInline(value) : "none";
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

export function renderReviewComment(envelope: ReviewExecutionEnvelope) {
  if (envelope.execution.state !== "COMPLETED") {
    throw new ReviewPublicationError(
      "Only a completed normalized review can be rendered as the current Mira review comment.",
    );
  }

  const review = envelope.execution.review;
  const provider = envelope.execution.provider;
  const conflict = review.verdict === "CONTRACT_CONFLICT"
    ? `\n\n${renderConflict(review.contractConflict)}`
    : "";

  const body = [
    MIRA_REVIEW_MARKER,
    "## Mira AI Review",
    "",
    "### Verdict",
    `\`${review.verdict}\``,
    conflict,
    "",
    "### Findings",
    renderFindings(review),
    "",
    "### Validation gaps",
    renderValidationGaps(review),
    "",
    "### Review metadata",
    `- **Repository:** ${safeInline(envelope.identity.repository)}`,
    `- **Pull request:** #${envelope.identity.pullRequest}`,
    `- **Base SHA:** ${safeInline(envelope.identity.baseSha)}`,
    `- **Head SHA:** ${safeInline(envelope.identity.headSha)}`,
    `- **Provider:** ${safeInline(provider.id)}`,
    `- **Provider role:** ${safeInline(provider.role)}`,
    `- **Model:** ${safeInline(provider.model)}`,
    `- **Organization policy commit:** ${safeInline(envelope.identity.policyCommitSha)}`,
    `- **Organization policy blob:** ${safeInline(envelope.identity.policyBlobSha)}`,
    `- **Output contract:** ${REVIEW_OUTPUT_CONTRACT_VERSION} / ${safeInline(envelope.identity.outputContractBlobSha)}`,
    `- **Repository profile blob:** ${safeIdentity(envelope.identity.profileBlobSha)}`,
    `- **Root contract blob:** ${safeIdentity(envelope.identity.rootContractBlobSha)}`,
    `- **Runtime:** ${AI_REVIEW_RUNTIME_VERSION}`,
    `- **Package:** ${REVIEW_PACKAGE_VERSION}`,
    `- **Execution:** ${REVIEW_EXECUTION_VERSION}`,
    `- **Executed at:** ${safeInline(envelope.executedAt)}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  if (body.length > MAX_REVIEW_COMMENT_CHARS) {
    throw new ReviewPublicationError(
      `Rendered review exceeds the ${MAX_REVIEW_COMMENT_CHARS}-character publication limit.`,
    );
  }

  return body;
}

export function compareReviewFreshness(
  envelope: ReviewExecutionEnvelope,
  current: ReviewPackage,
): ReviewFreshness {
  const reasons: ReviewStaleReason[] = [];
  const identity = envelope.identity;

  if (identity.repository !== current.pullRequest.repository) reasons.push("repository");
  if (identity.pullRequest !== current.pullRequest.number) reasons.push("pull_request");
  if (identity.baseSha !== current.pullRequest.base.sha) reasons.push("base_sha");
  if (identity.headSha !== current.pullRequest.head.sha) reasons.push("head_sha");
  if (identity.policyCommitSha !== current.controls.identity.policyCommitSha) reasons.push("policy_commit");
  if (identity.policyBlobSha !== current.controls.identity.policyBlobSha) reasons.push("policy_blob");
  if (identity.outputContractBlobSha !== current.controls.identity.outputContractBlobSha) {
    reasons.push("output_contract_blob");
  }
  if (identity.profileBlobSha !== current.controls.identity.profileBlobSha) reasons.push("profile_blob");
  if (identity.rootContractBlobSha !== current.controls.identity.rootContractBlobSha) {
    reasons.push("root_contract_blob");
  }

  return reasons.length === 0
    ? { state: "CURRENT", reasons: [] }
    : { state: "STALE_REVIEW", reasons };
}
