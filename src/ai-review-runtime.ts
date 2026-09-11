export const MIRA_REVIEW_VERDICTS = [
  "NO_BLOCKING_FINDINGS",
  "CHANGES_NEEDED",
  "HUMAN_CHECK_NEEDED",
  "CONTRACT_CONFLICT",
] as const;

export const MIRA_REVIEW_SEVERITIES = ["P0", "P1", "P2"] as const;

export type MiraReviewVerdict = (typeof MIRA_REVIEW_VERDICTS)[number];
export type MiraReviewSeverity = (typeof MIRA_REVIEW_SEVERITIES)[number];
export type ReviewProviderRole = "primary" | "fallback" | "reserve" | "judge";
export type ReviewFailureClass =
  | "rate_limit"
  | "quota"
  | "timeout"
  | "provider_unavailable"
  | "provider_auth"
  | "malformed_response"
  | "unknown";

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

  constructor(message: string, failureClass: ReviewFailureClass) {
    super(message);
    this.name = "ReviewProviderError";
    this.failureClass = failureClass;
  }
}

export class ReviewNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewNormalizationError";
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewNormalizationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ReviewNormalizationError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function stringArray(value: unknown, label: string, minimum = 0) {
  if (!Array.isArray(value)) {
    throw new ReviewNormalizationError(`${label} must be an array.`);
  }
  const result = value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
  if (result.length < minimum) {
    throw new ReviewNormalizationError(`${label} must contain at least ${minimum} entries.`);
  }
  return result;
}

function normalizeFinding(value: unknown, index: number): ReviewFinding {
  const finding = asRecord(value, `findings[${index}]`);
  const severity = nonEmptyString(finding.severity, `findings[${index}].severity`);

  if (!MIRA_REVIEW_SEVERITIES.includes(severity as MiraReviewSeverity)) {
    throw new ReviewNormalizationError(
      `findings[${index}].severity must be one of ${MIRA_REVIEW_SEVERITIES.join(", ")}.`,
    );
  }

  return {
    severity: severity as MiraReviewSeverity,
    observation: nonEmptyString(finding.observation, `findings[${index}].observation`),
    inference: nonEmptyString(finding.inference, `findings[${index}].inference`),
    judgment: nonEmptyString(finding.judgment, `findings[${index}].judgment`),
    impact: nonEmptyString(finding.impact, `findings[${index}].impact`),
    location: nonEmptyString(finding.location, `findings[${index}].location`),
    suggestedFix: nonEmptyString(finding.suggestedFix, `findings[${index}].suggestedFix`),
    verification: nonEmptyString(finding.verification, `findings[${index}].verification`),
  };
}

function normalizeContractConflict(value: unknown): ContractConflictDetail {
  const detail = asRecord(value, "contractConflict");
  return {
    sources: stringArray(detail.sources, "contractConflict.sources", 2),
    conflictingRequirements: stringArray(
      detail.conflictingRequirements,
      "contractConflict.conflictingRequirements",
      2,
    ),
    whyItChangesJudgment: nonEmptyString(
      detail.whyItChangesJudgment,
      "contractConflict.whyItChangesJudgment",
    ),
    maintainerDecisionRequired: nonEmptyString(
      detail.maintainerDecisionRequired,
      "contractConflict.maintainerDecisionRequired",
    ),
  };
}

export function normalizeProviderReview(value: unknown): NormalizedReview {
  const raw = asRecord(value, "review");
  const verdict = nonEmptyString(raw.verdict, "verdict");

  if (!MIRA_REVIEW_VERDICTS.includes(verdict as MiraReviewVerdict)) {
    throw new ReviewNormalizationError(
      `verdict must be one of ${MIRA_REVIEW_VERDICTS.join(", ")}.`,
    );
  }

  if (!Array.isArray(raw.findings)) {
    throw new ReviewNormalizationError("findings must be an array.");
  }

  const findings = raw.findings.map(normalizeFinding);
  const validationGaps = stringArray(raw.validationGaps, "validationGaps");
  const normalizedVerdict = verdict as MiraReviewVerdict;

  if (normalizedVerdict === "CHANGES_NEEDED" && findings.length === 0) {
    throw new ReviewNormalizationError("CHANGES_NEEDED requires at least one P0-P2 finding.");
  }

  if (normalizedVerdict !== "CHANGES_NEEDED" && findings.length > 0) {
    throw new ReviewNormalizationError(
      `${normalizedVerdict} cannot contain blocking P0-P2 findings; use CHANGES_NEEDED.`,
    );
  }

  if (normalizedVerdict === "HUMAN_CHECK_NEEDED" && validationGaps.length === 0) {
    throw new ReviewNormalizationError(
      "HUMAN_CHECK_NEEDED requires at least one material validation gap.",
    );
  }

  const contractConflict =
    normalizedVerdict === "CONTRACT_CONFLICT"
      ? normalizeContractConflict(raw.contractConflict)
      : undefined;

  return {
    verdict: normalizedVerdict,
    findings,
    validationGaps,
    ...(contractConflict ? { contractConflict } : {}),
  };
}

export function failureClassForHttpStatus(status: number): ReviewFailureClass {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500 && status <= 599) return "provider_unavailable";
  return "unknown";
}

function classifyFailure(error: unknown): ReviewFailureClass {
  if (error instanceof ReviewProviderError) return error.failureClass;
  if (error instanceof ReviewNormalizationError) return "malformed_response";
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  return "unknown";
}

export async function executeReviewWithFallback<Input>(
  input: Input,
  providers: readonly ReviewProvider<Input>[],
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

    try {
      const response = await provider.review(input);
      const review = normalizeProviderReview(response.output);
      const attempt: ProviderAttempt = {
        provider: provider.id,
        model: provider.model,
        role: provider.role,
        status: "success",
        latencyMs: Date.now() - startedAt,
        ...(response.usage ? { usage: response.usage } : {}),
      };
      attempts.push(attempt);

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
      attempts.push({
        provider: provider.id,
        model: provider.model,
        role: provider.role,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        failureClass: classifyFailure(error),
      });
    }
  }

  return {
    state: "REVIEW_UNAVAILABLE",
    reason: "all_eligible_providers_failed",
    attempts,
  };
}
