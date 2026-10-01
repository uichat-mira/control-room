import type {
  ReviewPackage,
  TrustedTaskContractIdentity,
} from "./ai-review-package.ts";
import {
  REVIEW_EXECUTION_VERSION,
  reconcileDeterministicReview,
  reviewPackageIdentity,
  type ReviewExecutionEnvelope,
} from "./ai-review-execution.ts";
import {
  ReviewNormalizationError,
  normalizeProviderReview,
  type ReviewProviderRole,
  type ReviewProviderUsage,
} from "./ai-review-runtime.ts";

export type ExternalReviewSubmissionErrorCode =
  | "invalid_external_submission"
  | "external_identity_mismatch"
  | "invalid_external_review";

export class ExternalReviewSubmissionError extends Error {
  readonly code: ExternalReviewSubmissionErrorCode;
  readonly status: number;
  readonly mismatches: string[];

  constructor(
    code: ExternalReviewSubmissionErrorCode,
    status: number,
    message: string,
    mismatches: string[] = [],
  ) {
    super(message);
    this.name = "ExternalReviewSubmissionError";
    this.code = code;
    this.status = status;
    this.mismatches = mismatches;
  }
}

export interface ExternalReviewSubmission {
  repository: string;
  pullRequest: number;
  identity: ReviewExecutionEnvelope["identity"];
  execution: {
    engine: string;
    provider: string;
    model: string;
    role: ReviewProviderRole;
    latencyMs: number;
    usage?: ReviewProviderUsage;
    review: unknown;
  };
}

function invalid(message: string): never {
  throw new ExternalReviewSubmissionError(
    "invalid_external_submission",
    400,
    message,
  );
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, maxLength = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    invalid(`${label} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value.trim();
}

function tokenValue(value: unknown, label: string) {
  const token = stringValue(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/.test(token)) {
    invalid(`${label} contains unsupported characters.`);
  }
  return token;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalid(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid(`${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function shaValue(value: unknown, label: string) {
  const sha = stringValue(value, label, 64);
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    invalid(`${label} must be a 40-character Git commit/blob SHA.`);
  }
  return sha;
}

function nullableSha(value: unknown, label: string) {
  if (value === null) return null;
  return shaValue(value, label);
}

function reviewMode(value: unknown) {
  if (
    value !== "CODE_REVIEW" &&
    value !== "PROMOTION_REVIEW" &&
    value !== "RELEASE_REVIEW"
  ) {
    invalid("identity.reviewMode is invalid.");
  }
  return value;
}

function providerRole(value: unknown): ReviewProviderRole {
  if (value !== "routine" && value !== "fallback" && value !== "escalation") {
    invalid("execution.role is invalid.");
  }
  return value;
}

function taskContractIdentity(value: unknown): TrustedTaskContractIdentity {
  const task = asRecord(value, "identity.taskContract");
  if (task.state === "unavailable") {
    if (
      task.reason !== "no_linked_issue" &&
      task.reason !== "multiple_linked_issues" &&
      task.reason !== "linked_issue_too_large"
    ) {
      invalid("identity.taskContract.reason is invalid.");
    }
    return {
      state: "unavailable",
      reason: task.reason,
    };
  }

  if (task.state === "resolved") {
    return {
      state: "resolved",
      repository: stringValue(task.repository, "identity.taskContract.repository", 200),
      issue: positiveInteger(task.issue, "identity.taskContract.issue"),
      updatedAt: stringValue(task.updatedAt, "identity.taskContract.updatedAt", 64),
      contentSha256: (() => {
        const digest = stringValue(
          task.contentSha256,
          "identity.taskContract.contentSha256",
          64,
        );
        if (!/^[0-9a-f]{64}$/i.test(digest)) {
          invalid("identity.taskContract.contentSha256 must be a SHA-256 digest.");
        }
        return digest;
      })(),
    };
  }

  return invalid("identity.taskContract.state is invalid.");
}

function parseIdentity(value: unknown): ReviewExecutionEnvelope["identity"] {
  const identity = asRecord(value, "identity");
  return {
    repository: stringValue(identity.repository, "identity.repository", 200),
    pullRequest: positiveInteger(identity.pullRequest, "identity.pullRequest"),
    reviewMode: reviewMode(identity.reviewMode),
    baseSha: shaValue(identity.baseSha, "identity.baseSha"),
    headSha: shaValue(identity.headSha, "identity.headSha"),
    policyCommitSha: shaValue(identity.policyCommitSha, "identity.policyCommitSha"),
    policyBlobSha: shaValue(identity.policyBlobSha, "identity.policyBlobSha"),
    outputContractBlobSha: shaValue(
      identity.outputContractBlobSha,
      "identity.outputContractBlobSha",
    ),
    profileBlobSha: nullableSha(identity.profileBlobSha, "identity.profileBlobSha"),
    rootContractBlobSha: nullableSha(
      identity.rootContractBlobSha,
      "identity.rootContractBlobSha",
    ),
    taskContract: taskContractIdentity(identity.taskContract),
  };
}

function parseUsage(value: unknown): ReviewProviderUsage | undefined {
  if (value === undefined) return undefined;
  const usage = asRecord(value, "execution.usage");
  const parsed: ReviewProviderUsage = {};
  for (const [key, label] of [
    ["inputTokens", "execution.usage.inputTokens"],
    ["outputTokens", "execution.usage.outputTokens"],
    ["totalTokens", "execution.usage.totalTokens"],
  ] as const) {
    const raw = usage[key];
    if (raw !== undefined) parsed[key] = nonNegativeInteger(raw, label);
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function parseExternalReviewSubmission(input: unknown): ExternalReviewSubmission {
  const body = asRecord(input, "external review submission");
  const repository = stringValue(body.repository, "repository", 200);
  const pullRequest = positiveInteger(body.pullRequest, "pullRequest");
  const identity = parseIdentity(body.identity);
  const execution = asRecord(body.execution, "execution");

  if (identity.repository !== repository || identity.pullRequest !== pullRequest) {
    invalid("Top-level review target must match the submitted review identity.");
  }
  if (!Object.prototype.hasOwnProperty.call(execution, "review")) {
    invalid("execution.review is required.");
  }

  return {
    repository,
    pullRequest,
    identity,
    execution: {
      engine: tokenValue(execution.engine, "execution.engine"),
      provider: tokenValue(execution.provider, "execution.provider"),
      model: tokenValue(execution.model, "execution.model"),
      role: providerRole(execution.role),
      latencyMs: nonNegativeInteger(execution.latencyMs, "execution.latencyMs"),
      ...(parseUsage(execution.usage)
        ? { usage: parseUsage(execution.usage) }
        : {}),
      review: execution.review,
    },
  };
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
      left.updatedAt === right.updatedAt &&
      left.contentSha256 === right.contentSha256
    );
  }
  return false;
}

export function externalIdentityMismatches(
  pkg: ReviewPackage,
  identity: ReviewExecutionEnvelope["identity"],
) {
  const expected = reviewPackageIdentity(pkg);
  const mismatches: string[] = [];

  if (identity.repository !== expected.repository) mismatches.push("repository");
  if (identity.pullRequest !== expected.pullRequest) mismatches.push("pull_request");
  if (identity.reviewMode !== expected.reviewMode) mismatches.push("review_mode");
  if (identity.baseSha !== expected.baseSha) mismatches.push("base_sha");
  if (identity.headSha !== expected.headSha) mismatches.push("head_sha");
  if (identity.policyCommitSha !== expected.policyCommitSha) mismatches.push("policy_commit_sha");
  if (identity.policyBlobSha !== expected.policyBlobSha) mismatches.push("policy_blob_sha");
  if (identity.outputContractBlobSha !== expected.outputContractBlobSha) {
    mismatches.push("output_contract_blob_sha");
  }
  if (identity.profileBlobSha !== expected.profileBlobSha) mismatches.push("profile_blob_sha");
  if (identity.rootContractBlobSha !== expected.rootContractBlobSha) {
    mismatches.push("root_contract_blob_sha");
  }
  if (!sameTaskContract(identity.taskContract, expected.taskContract)) {
    mismatches.push("task_contract");
  }

  return mismatches;
}

export function externalIdentityEnvelope(
  submission: ExternalReviewSubmission,
): ReviewExecutionEnvelope {
  return {
    executionVersion: REVIEW_EXECUTION_VERSION,
    executedAt: new Date().toISOString(),
    identity: submission.identity,
    providerRoute: {
      routine: {
        state: "configured",
        enabled: true,
        provider: submission.execution.provider,
        model: submission.execution.model,
        driver: `external:${submission.execution.engine}`,
      },
    },
    execution: {
      state: "REVIEW_UNAVAILABLE",
      reason: "all_eligible_providers_failed",
      attempts: [],
    },
  };
}

export function buildExternalReviewEnvelope(
  pkg: ReviewPackage,
  submission: ExternalReviewSubmission,
): ReviewExecutionEnvelope {
  const mismatches = externalIdentityMismatches(pkg, submission.identity);
  if (mismatches.length > 0) {
    throw new ExternalReviewSubmissionError(
      "external_identity_mismatch",
      409,
      "External review identity does not match the current trusted review package.",
      mismatches,
    );
  }

  let normalized;
  try {
    normalized = normalizeProviderReview(submission.execution.review);
  } catch (error) {
    if (error instanceof ReviewNormalizationError) {
      throw new ExternalReviewSubmissionError(
        "invalid_external_review",
        422,
        `External review output does not satisfy the Mira review contract: ${error.reason}.`,
      );
    }
    throw error;
  }

  const review = reconcileDeterministicReview(normalized, pkg);
  const usage = submission.execution.usage;

  return {
    executionVersion: REVIEW_EXECUTION_VERSION,
    executedAt: new Date().toISOString(),
    identity: reviewPackageIdentity(pkg),
    providerRoute: {
      routine: {
        state: "configured",
        enabled: true,
        provider: submission.execution.provider,
        model: submission.execution.model,
        driver: `external:${submission.execution.engine}`,
      },
    },
    execution: {
      state: "COMPLETED",
      review,
      provider: {
        id: submission.execution.provider,
        model: submission.execution.model,
        role: submission.execution.role,
        engine: submission.execution.engine,
      },
      attempts: [
        {
          provider: submission.execution.provider,
          model: submission.execution.model,
          role: submission.execution.role,
          status: "success",
          latencyMs: submission.execution.latencyMs,
          ...(usage ? { usage } : {}),
        },
      ],
    },
  };
}
