import type {
  ReviewMode,
  ReviewPackage,
  TrustedTaskContractIdentity,
} from "./ai-review-package.ts";
import {
  buildReviewProviderRegistry,
  type AiReviewProviderEnv,
  type ReviewProviderSlotState,
} from "./ai-review-provider-registry.ts";
import {
  executeReviewWithFallback,
  type ReviewExecutionResult,
} from "./ai-review-runtime.ts";

export const REVIEW_EXECUTION_VERSION = "mira-ai-review-execution/v0" as const;

export interface ReviewExecutionEnvelope {
  executionVersion: typeof REVIEW_EXECUTION_VERSION;
  executedAt: string;
  identity: {
    repository: string;
    pullRequest: number;
    reviewMode: ReviewMode;
    baseSha: string;
    headSha: string;
    policyCommitSha: string;
    policyBlobSha: string;
    outputContractBlobSha: string;
    profileBlobSha: string | null;
    rootContractBlobSha: string | null;
    taskContract: TrustedTaskContractIdentity;
  };
  providerSlots: {
    primary: ReviewProviderSlotState;
    fallback: ReviewProviderSlotState;
  };
  execution: ReviewExecutionResult;
}

export function reviewPackageIdentity(pkg: ReviewPackage): ReviewExecutionEnvelope["identity"] {
  return {
    repository: pkg.pullRequest.repository,
    pullRequest: pkg.pullRequest.number,
    reviewMode: pkg.reviewMode,
    baseSha: pkg.pullRequest.base.sha,
    headSha: pkg.pullRequest.head.sha,
    policyCommitSha: pkg.controls.identity.policyCommitSha,
    policyBlobSha: pkg.controls.identity.policyBlobSha,
    outputContractBlobSha: pkg.controls.identity.outputContractBlobSha,
    profileBlobSha: pkg.controls.identity.profileBlobSha,
    rootContractBlobSha: pkg.controls.identity.rootContractBlobSha,
    taskContract: pkg.controls.identity.taskContract,
  };
}

function withDeterministicGaps(
  execution: ReviewExecutionResult,
  pkg: ReviewPackage,
): ReviewExecutionResult {
  if (execution.state !== "COMPLETED" || pkg.gaps.length === 0) return execution;

  const deterministicMessages = pkg.gaps.map((gap) => gap.message);
  const hasMaterialGap = pkg.gaps.some((gap) => gap.material);
  const currentVerdict = execution.review.verdict;
  const reconciledVerdict =
    hasMaterialGap && currentVerdict === "NO_BLOCKING_FINDINGS"
      ? "HUMAN_CHECK_NEEDED"
      : currentVerdict;

  return {
    ...execution,
    review: {
      ...execution.review,
      verdict: reconciledVerdict,
      validationGaps: [
        ...new Set([...deterministicMessages, ...execution.review.validationGaps]),
      ],
    },
  };
}

export async function executeTrustedReviewPackage(
  env: AiReviewProviderEnv,
  pkg: ReviewPackage,
): Promise<ReviewExecutionEnvelope> {
  const registry = buildReviewProviderRegistry(env);
  const rawExecution = await executeReviewWithFallback(pkg, registry.providers);
  const execution = withDeterministicGaps(rawExecution, pkg);

  return {
    executionVersion: REVIEW_EXECUTION_VERSION,
    executedAt: new Date().toISOString(),
    identity: reviewPackageIdentity(pkg),
    providerSlots: registry.slots,
    execution,
  };
}
