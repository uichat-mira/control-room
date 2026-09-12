export const MIRA_REVIEW_VERDICTS = [
  "NO_BLOCKING_FINDINGS",
  "CHANGES_NEEDED",
  "HUMAN_CHECK_NEEDED",
  "CONTRACT_CONFLICT",
] as const;

export const MIRA_REVIEW_SEVERITIES = ["P0", "P1", "P2"] as const;

export type MiraReviewVerdict = (typeof MIRA_REVIEW_VERDICTS)[number];
export type MiraReviewSeverity = (typeof MIRA_REVIEW_SEVERITIES)[number];
export type ReviewProviderRole = "routine" | "fallback" | "escalation";
export type ReviewFailureClass =
  | "rate_limit"
  | "quota"
  | "timeout"
  | "provider_unavailable"
  | "provider_auth"
  | "malformed_response"
  | "input_limit"
  | "unknown";
export type ReviewFailureDetail =
  | "response_too_large"
  | "invalid_chat_response"
  | "missing_message_content"
  | "review_json_fenced"
  | "non_json_review_text"
  | "invalid_review_json"
  | "invalid_review_contract"
  | "network_request_failed"
  | "network_response_failed";

export type ReviewNormalizationReason =
  | "review_not_object"
  | "verdict_invalid"
  | "findings_not_array"
  | "finding_not_object"
  | "finding_severity_invalid"
  | "finding_field_invalid"
  | "validation_gaps_not_array"
  | "validation_gap_invalid"
  | "changes_needed_without_finding"
  | "human_check_without_gap"
  | "contract_conflict_missing"
  | "contract_conflict_invalid"
  | "contract_conflict_unexpected";

export interface ReviewFinding {
  severity: MiraReviewSeverity;
  observation: string;
  inference: string;
  judgment: string;
  impact: string;
  location: string;
  suggestedFix: string;
  verification: string;
}

export interface ContractConflictDetail {
  sources: string[];
  conflictingRequirements: string[];
  whyItChangesJudgment: string;
  maintainerDecisionRequired: string;
}

export interface NormalizedReview {
  verdict: MiraReviewVerdict;
  findings: ReviewFinding[];
  validationGaps: string[];
  contractConflict?: ContractConflictDetail;
}

export interface ReviewProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ReviewProviderResponse {
  output: unknown;
  usage?: ReviewProviderUsage;
}

export interface ReviewProvider<Input> {
  id: string;
  model: string;
  role: ReviewProviderRole;
  review(input: Input): Promise<ReviewProviderResponse>;
}

export interface ProviderAttempt {
  provider: string;
  model: string;
  role: ReviewProviderRole;
  status: "success" | "failed";
  latencyMs: number;
  failureClass?: ReviewFailureClass;
  failureDetail?: ReviewFailureDetail;
  normalizationReason?: ReviewNormalizationReason;
  normalizationPath?: string;
  upstreamStatus?: number;
  usage?: ReviewProviderUsage;
}

export interface CompletedReviewExecution {
  state: "COMPLETED";
  review: NormalizedReview;
  provider: {
    id: string;
    model: string;
    role: ReviewProviderRole;
  };
  attempts: ProviderAttempt[];
}

export interface UnavailableReviewExecution {
  state: "REVIEW_UNAVAILABLE";
  reason: "no_eligible_provider" | "all_eligible_providers_failed";
  attempts: ProviderAttempt[];
}

export type ReviewExecutionResult = CompletedReviewExecution | UnavailableReviewExecution;

export class ReviewProviderError extends Error {
  readonly failureClass: ReviewFailureClass;
  readonly failureDetail: ReviewFailureDetail | undefined;
  readonly upstreamStatus: number | undefined;
  readonly usage: ReviewProviderUsage | undefined;

  constructor(
    message: string,
    failureClass: ReviewFailureClass,
    options: {
      failureDetail?: ReviewFailureDetail;
      upstreamStatus?: number;
      usage?: ReviewProviderUsage;
    } = {},
  ) {
    super(message);
    this.name = "ReviewProviderError";
    this.failureClass = failureClass;
    this.failureDetail = options.failureDetail;
    this.upstreamStatus = options.upstreamStatus;
    this.usage = options.usage;
  }
}

export class ReviewNormalizationError extends Error {
  readonly reason: ReviewNormalizationReason;
  readonly path: string | undefined;

  constructor(message: string, reason: ReviewNormalizationReason, path?: string) {
    super(message);
    this.name = "ReviewNormalizationError";
    this.reason = reason;
    this.path = path;
  }
}

function asRecord(
  value: unknown,
  label: string,
  reason: ReviewNormalizationReason,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewNormalizationError(`${label} must be an object.`, reason, label);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(
  value: unknown,
  label: string,
  reason: ReviewNormalizationReason,
) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ReviewNormalizationError(
      `${label} must be a non-empty string.`,
      reason,
      label,
    );
  }
  return value.trim();
}

function stringArray(
  value: unknown,
  label: string,
  arrayReason: ReviewNormalizationReason,
  itemReason: ReviewNormalizationReason,
  minimum = 0,
) {
  if (!Array.isArray(value)) {
    throw new ReviewNormalizationError(`${label} must be an array.`, arrayReason, label);
  }
  const result = value.map((item, index) =>
    nonEmptyString(item, `${label}[${index}]`, itemReason),
  );
  if (result.length < minimum) {
    throw new ReviewNormalizationError(
      `${label} must contain at least ${minimum} entries.`,
      itemReason,
      label,
    );
  }
  return result;
}

function normalizeFinding(value: unknown, index: number): ReviewFinding {
  const basePath = `review.findings[${index}]`;
  const finding = asRecord(value, basePath, "finding_not_object");
  const severity = nonEmptyString(
    finding.severity,
    `${basePath}.severity`,
    "finding_severity_invalid",
  );

  if (!MIRA_REVIEW_SEVERITIES.includes(severity as MiraReviewSeverity)) {
    throw new ReviewNormalizationError(
      `${basePath}.severity must be one of ${MIRA_REVIEW_SEVERITIES.join(", ")}.`,
      "finding_severity_invalid",
      `${basePath}.severity`,
    );
  }

  return {
    severity: severity as MiraReviewSeverity,
    observation: nonEmptyString(
      finding.observation,
      `${basePath}.observation`,
      "finding_field_invalid",
    ),
    inference: nonEmptyString(
      finding.inference,
      `${basePath}.inference`,
      "finding_field_invalid",
    ),
    judgment: nonEmptyString(
      finding.judgment,
      `${basePath}.judgment`,
      "finding_field_invalid",
    ),
    impact: nonEmptyString(
      finding.impact,
      `${basePath}.impact`,
      "finding_field_invalid",
    ),
    location: nonEmptyString(
      finding.location,
      `${basePath}.location`,
      "finding_field_invalid",
    ),
    suggestedFix: nonEmptyString(
      finding.suggestedFix,
      `${basePath}.suggestedFix`,
      "finding_field_invalid",
    ),
    verification: nonEmptyString(
      finding.verification,
      `${basePath}.verification`,
      "finding_field_invalid",
    ),
  };
}

function normalizeContractConflict(value: unknown): ContractConflictDetail {
  const detail = asRecord(value, "review.contractConflict", "contract_conflict_invalid");
  return {
    sources: stringArray(
      detail.sources,
      "review.contractConflict.sources",
      "contract_conflict_invalid",
      "contract_conflict_invalid",
      2,
    ),
    conflictingRequirements: stringArray(
      detail.conflictingRequirements,
      "review.contractConflict.conflictingRequirements",
      "contract_conflict_invalid",
      "contract_conflict_invalid",
      2,
    ),
    whyItChangesJudgment: nonEmptyString(
      detail.whyItChangesJudgment,
      "review.contractConflict.whyItChangesJudgment",
      "contract_conflict_invalid",
    ),
    maintainerDecisionRequired: nonEmptyString(
      detail.maintainerDecisionRequired,
      "review.contractConflict.maintainerDecisionRequired",
      "contract_conflict_invalid",
    ),
  };
}

export function normalizeProviderReview(value: unknown): NormalizedReview {
  const raw = asRecord(value, "review", "review_not_object");
  const verdict = nonEmptyString(raw.verdict, "review.verdict", "verdict_invalid");
  if (!MIRA_REVIEW_VERDICTS.includes(verdict as MiraReviewVerdict)) {
    throw new ReviewNormalizationError(
      `review.verdict must be one of ${MIRA_REVIEW_VERDICTS.join(", ")}.`,
      "verdict_invalid",
      "review.verdict",
    );
  }

  if (!Array.isArray(raw.findings)) {
    throw new ReviewNormalizationError(
      "review.findings must be an array.",
      "findings_not_array",
      "review.findings",
    );
  }
  const findings = raw.findings.map(normalizeFinding);
  const validationGaps = stringArray(
    raw.validationGaps,
    "review.validationGaps",
    "validation_gaps_not_array",
    "validation_gap_invalid",
  );
  const normalizedVerdict = verdict as MiraReviewVerdict;

  if (normalizedVerdict === "CHANGES_NEEDED" && findings.length === 0) {
    throw new ReviewNormalizationError(
      "CHANGES_NEEDED requires at least one P0-P2 finding.",
      "changes_needed_without_finding",
      "review.findings",
    );
  }
  if (normalizedVerdict === "HUMAN_CHECK_NEEDED" && validationGaps.length === 0) {
    throw new ReviewNormalizationError(
      "HUMAN_CHECK_NEEDED requires at least one material validation gap.",
      "human_check_without_gap",
      "review.validationGaps",
    );
  }

  if (normalizedVerdict === "CONTRACT_CONFLICT") {
    if (raw.contractConflict === undefined) {
      throw new ReviewNormalizationError(
        "CONTRACT_CONFLICT requires contractConflict detail.",
        "contract_conflict_missing",
        "review.contractConflict",
      );
    }
    return {
      verdict: normalizedVerdict,
      findings,
      validationGaps,
      contractConflict: normalizeContractConflict(raw.contractConflict),
    };
  }

  if (raw.contractConflict !== undefined) {
    throw new ReviewNormalizationError(
      "contractConflict detail is only valid for CONTRACT_CONFLICT.",
      "contract_conflict_unexpected",
      "review.contractConflict",
    );
  }

  return {
    verdict: normalizedVerdict,
    findings,
    validationGaps,
  };
}

export function failureClassForHttpStatus(status: number): ReviewFailureClass {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "provider_unavailable";
  return "unknown";
}

function technicalFailure(
  error: unknown,
  providerUsage?: ReviewProviderUsage,
): {
  failureClass: ReviewFailureClass;
  failureDetail?: ReviewFailureDetail;
  normalizationReason?: ReviewNormalizationReason;
  normalizationPath?: string;
  upstreamStatus?: number;
  usage?: ReviewProviderUsage;
} {
  if (error instanceof ReviewProviderError) {
    return {
      failureClass: error.failureClass,
      ...(error.failureDetail ? { failureDetail: error.failureDetail } : {}),
      ...(error.upstreamStatus !== undefined ? { upstreamStatus: error.upstreamStatus } : {}),
      ...(error.usage ?? providerUsage ? { usage: error.usage ?? providerUsage } : {}),
    };
  }
  if (error instanceof ReviewNormalizationError) {
    return {
      failureClass: "malformed_response",
      failureDetail: "invalid_review_contract",
      normalizationReason: error.reason,
      ...(error.path ? { normalizationPath: error.path } : {}),
      ...(providerUsage ? { usage: providerUsage } : {}),
    };
  }
  return {
    failureClass: "unknown",
    ...(providerUsage ? { usage: providerUsage } : {}),
  };
}

export async function executeReviewWithFallback<Input>(
  input: Input,
  providers: ReviewProvider<Input>[],
): Promise<ReviewExecutionResult> {
  if (providers.length === 0) {
    return {
      state: "REVIEW_UNAVAILABLE",
      reason: "no_eligible_provider",
      attempts: [],
    };
  }

  const attempts: ProviderAttempt[] = [];

  for (const provider of providers) {
    const startedAt = Date.now();
    let providerUsage: ReviewProviderUsage | undefined;
    try {
      const response = await provider.review(input);
      providerUsage = response.usage;
      const review = normalizeProviderReview(response.output);
      attempts.push({
        provider: provider.id,
        model: provider.model,
        role: provider.role,
        status: "success",
        latencyMs: Date.now() - startedAt,
        ...(response.usage ? { usage: response.usage } : {}),
      });
      return {
        state: "COMPLETED",
        review,
        provider: {
          id: provider.id,
          model: provider.model,
          role: provider.role,
        },
        attempts,
      };
    } catch (error) {
      const failure = technicalFailure(error, providerUsage);
      attempts.push({
        provider: provider.id,
        model: provider.model,
        role: provider.role,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        ...failure,
      });
    }
  }

  return {
    state: "REVIEW_UNAVAILABLE",
    reason: "all_eligible_providers_failed",
    attempts,
  };
}
