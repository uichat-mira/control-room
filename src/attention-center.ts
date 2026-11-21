import type { GitHubGateQualificationSnapshot, QualificationCandidate, QualificationEvidence } from "./github-gate-facts.ts";
import type { GitHubFactsSnapshot, PilotPullRequestFact } from "./github-facts.ts";
import type { PullRequestQualification } from "./github-pr-qualification.ts";
import type { WorkerAttentionCandidate } from "./factory-attention.ts";

export type AttentionClass = "attention" | "in_progress" | "observation" | "unknown";
export type AttentionSource = "gate" | "pull_request" | "worker";
export type Priority = "P0" | "P1" | "P2" | "P3";

export interface AttentionRecord {
  id: string;
  objectKey: string;
  source: AttentionSource;
  category: string;
  classification: AttentionClass;
  priority: Priority | null;
  repository: string;
  subject: string;
  what: string;
  whyNow: string;
  whatSystemTried: string;
  nextStep: string;
  exitCondition: string;
  observedAt: string | null;
  evidence: QualificationEvidence[];
  coverage: string;
  relatedCandidates: number;
}

export interface AttentionDesk {
  attention: AttentionRecord[];
  inProgress: AttentionRecord[];
  observed: AttentionRecord[];
  unknown: AttentionRecord[];
  gateCoverage: "complete" | "partial" | "unknown" | "unavailable";
  factsCoverage: "complete" | "partial" | "unavailable";
  pilotCount: number;
  outsidePilot: number | null;
  listedPulls: number;
  unreviewedPulls: number;
  disclosure: string[];
}

export function isGateSnapshot(value: unknown): value is GitHubGateQualificationSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<GitHubGateQualificationSnapshot>;
  return data.apiVersion === "v1" && data.source === "github-facts-derivation" &&
    Array.isArray(data.candidates) && !!data.coverage &&
    ["complete", "partial", "unknown"].includes(data.coverage.status) &&
    data.candidates.every(item =>
      item && typeof item.id === "string" &&
      typeof item.repository === "string" &&
      typeof item.what === "string" && typeof item.whyNow === "string" &&
      typeof item.nextStep === "string" && typeof item.exitCondition === "string" &&
      ["attention", "in_progress", "observation", "unknown"].includes(item.classification) &&
      Array.isArray(item.evidence));
}

export function isGitHubFactsSnapshot(value: unknown): value is GitHubFactsSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<GitHubFactsSnapshot>;
  return data.apiVersion === "v1" && data.source === "github-rest" &&
    ["complete", "partial", "unavailable"].includes(data.status ?? "") &&
    Array.isArray(data.repositories) && !!data.coverage && !!data.scope;
}

export function isPullQualification(value: unknown): value is PullRequestQualification {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PullRequestQualification>;
  return item.source === "github-pr-derivation" && item.apiVersion === "v1" &&
    typeof item.repository === "string" && Number.isSafeInteger(item.number) &&
    typeof item.id === "string" && typeof item.status === "string" &&
    ["attention", "in_progress", "observation", "unknown"].includes(item.classification ?? "") &&
    Array.isArray(item.evidence) && !!item.coverage &&
    !!item.checks && typeof item.checks.requiredByGithub === "string";
}

export function isWorkerQualification(value: unknown): value is WorkerAttentionCandidate {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkerAttentionCandidate>;
  return item.source === "factory-attention-derivation" &&
    item.apiVersion === "v1" && !!item.identity &&
    Number.isSafeInteger(item.identity.runId) &&
    Number.isSafeInteger(item.identity.attempt) &&
    typeof item.identity.repository === "string" && typeof item.id === "string" &&
    typeof item.status === "string" &&
    ["attention", "in_progress", "observation", "unknown"].includes(item.classification ?? "") &&
    Array.isArray(item.evidence) && !!item.coverage &&
    !!item.reporter && typeof item.reporter.status === "string";
}

const validEvidence = (items: QualificationEvidence[]) =>
  items.filter(item => typeof item?.url === "string" &&
    /^https:\/\/github\.com\/uichat-mira\/[A-Za-z0-9_.-]+\/.+/.test(item.url));

const priorityRank: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function subjectFor(source: AttentionSource, category: string, repository: string, number?: number) {
  const repo = repository.replace(/^uichat-mira\//, "");
  if (source === "pull_request") return repo + " · PR #" + number;
  if (source === "worker") return repo + " · Worker 接手";
  return repo + (category === "deployment" ? " · 发布与生产" : " · Gate / CI");
}

function normalize(
  source: AttentionSource,
  objectKey: string,
  record: {
    id: string; category: string; classification: AttentionClass;
    priority: Priority | null; repository: string; what: string;
    whyNow: string; nextStep: string; evidence: QualificationEvidence[];
    observedAt: string | null; exitCondition: string;
    whatSystemTried?: string; coverage?: string;
  },
  number?: number,
): AttentionRecord {
  const evidence = validEvidence(record.evidence);
  // A candidate without original GitHub evidence AND an observation time
  // cannot be promoted to a current human todo in the presentation layer.
  const classification = record.classification === "attention" &&
    (evidence.length === 0 || !record.observedAt) ? "unknown" : record.classification;
  return {
    id: record.id, objectKey, source, category: record.category, classification,
    priority: classification === "attention" ? record.priority : null,
    repository: record.repository,
    subject: subjectFor(source, record.category, record.repository, number),
    what: record.what,
    whyNow: classification === "unknown" && record.classification === "attention"
      ? "缺少可核验的原始 GitHub 链接或观察时间，不能确认为待接手事项。" : record.whyNow,
    whatSystemTried: record.whatSystemTried ?? "来源未提供可证实的自动处理动作",
    nextStep: record.nextStep, exitCondition: record.exitCondition,
    observedAt: record.observedAt, evidence,
    coverage: record.coverage ?? "覆盖结论未提供",
    relatedCandidates: 1,
  };
}

function gateRecord(value: QualificationCandidate, scope: string): AttentionRecord {
  const root = value.branch && value.headSha
    ? "release:" + value.repository + ":" + value.branch + ":" + value.headSha
    : "gate:" + value.id;
  return normalize("gate", root, { ...value, coverage: scope });
}

function pullRecord(value: PullRequestQualification): AttentionRecord {
  return normalize("pull_request", "pr:" + value.repository + ":" + value.number, {
    ...value, category: "pull_request",
    coverage: "PR " + value.coverage.status + " · required checks " + value.checks.requiredByGithub,
  }, value.number);
}

function workerRecord(value: WorkerAttentionCandidate): AttentionRecord {
  const { repository, issueNumber, runId } = value.identity;
  const key = issueNumber && Number.isSafeInteger(issueNumber)
    ? "issue:" + repository + ":" + issueNumber : "worker:" + repository + ":" + runId;
  return normalize("worker", key, {
    ...value, repository,
    coverage: "Worker " + value.coverage.status + " · Reporter " + value.reporter.status,
  });
}

function prefer(a: AttentionRecord, b: AttentionRecord): AttentionRecord {
  const rank: Record<AttentionClass, number> = {
    attention: 0, in_progress: 1, unknown: 2, observation: 3,
  };
  if (rank[a.classification] !== rank[b.classification]) {
    return rank[a.classification] < rank[b.classification] ? a : b;
  }
  const pa = a.priority ? priorityRank[a.priority] : 9;
  const pb = b.priority ? priorityRank[b.priority] : 9;
  if (pa !== pb) return pa < pb ? a : b;
  const at = a.observedAt ? Date.parse(a.observedAt) : 0;
  const bt = b.observedAt ? Date.parse(b.observedAt) : 0;
  return at >= bt ? a : b;
}

function mergeRoot(records: AttentionRecord[]): AttentionRecord[] {
  const groups = new Map<string, AttentionRecord[]>();
  for (const item of records) groups.set(item.objectKey, [...(groups.get(item.objectKey) ?? []), item]);
  return [...groups.values()].map(items => {
    const chosen = items.reduce(prefer);
    const evidence = [...new Map(items.flatMap(item => item.evidence)
      .map(item => [item.url + ":" + item.label, item])).values()];
    return { ...chosen, evidence, relatedCandidates: items.length };
  });
}

function stableSort(a: AttentionRecord, b: AttentionRecord) {
  const pa = a.priority ? priorityRank[a.priority] : 9;
  const pb = b.priority ? priorityRank[b.priority] : 9;
  return pa - pb ||
    (Date.parse(b.observedAt ?? "") || 0) - (Date.parse(a.observedAt ?? "") || 0) ||
    a.objectKey.localeCompare(b.objectKey);
}

export function projectAttentionDesk(input: {
  gates: GitHubGateQualificationSnapshot | null;
  facts: GitHubFactsSnapshot | null;
  pr?: PullRequestQualification | null;
  worker?: WorkerAttentionCandidate | null;
  /** False when a cached Gate or its shared GitHub facts cannot be refreshed. */
  gatesCurrent?: boolean;
}): AttentionDesk {
  const { gates, facts, pr, worker } = input;
  const gatesCurrent = input.gatesCurrent !== false &&
    facts?.freshness.state !== "stale" &&
    (!gates || !facts || gates.factsGeneratedAt === facts.generatedAt);
  const scope = gates
    ? "Gate " + gates.coverage.status + " · 必要性 " + gates.requiredCheckEvidence
    : "Gate 来源未就绪";
  const all = mergeRoot([
    ...(gates?.candidates ?? []).map(item => {
      const projected = gateRecord(item, scope);
      // Do not keep a past P1 alive when this page cannot refresh the
      // shared facts / Gate source. Unknown means re-observe, never "fixed".
      return !gatesCurrent && projected.classification === "attention"
        ? { ...projected, classification: "unknown" as const, priority: null,
          whyNow: "Gate 资格快照无法确认仍为当前状态，旧人工待办已降级为待核实。" }
        : projected;
    }),
    ...(pr ? [pullRecord(pr)] : []),
    ...(worker ? [workerRecord(worker)] : []),
  ]).sort(stableSort);
  const listed = facts?.repositories.flatMap(item =>
    item.pullRequests.state === "observed" ? item.pullRequests.items : []) ?? [];
  const disclosure: string[] = [];
  if (!gates) disclosure.push("必要 Gate 与发布资格来源未就绪；不能断言没有待办。");
  else if (!gatesCurrent) disclosure.push("Gate 资格快照已过期或刷新失败；历史 P1 不再冒充当前待办。");
  if (gates && gates.coverage.status !== "complete") disclosure.push(
    "Gate 资格仅 " + gates.coverage.status + " 覆盖，必要检查或生产证据不足。",
  );
  if (!facts) disclosure.push("试点 GitHub PR 列表不可用，不能断言没有 PR 阻塞。");
  else {
    if (facts.status !== "complete" || facts.coverage.truncatedSources.length) disclosure.push(
      "GitHub 列表存在覆盖缺口或截断，不能据此计算全组织待办总数。",
    );
    if (facts.freshness.state === "stale") disclosure.push("GitHub 试点快照已过期，当前状态需重新采集。");
  }
  if (listed.some(item => !item.draft)) disclosure.push(
    "非 Draft PR 仅有目录事实；合并阻塞须逐条核实，未核实不计待办。",
  );
  if (!worker) disclosure.push(
    "Worker 列表不包含可信 Reporter 当前性判断，需逐条主动核实人工接手。",
  );
  return {
    attention: all.filter(item => item.classification === "attention"),
    inProgress: all.filter(item => item.classification === "in_progress"),
    observed: all.filter(item => item.classification === "observation"),
    unknown: all.filter(item => item.classification === "unknown"),
    gateCoverage: gates?.coverage.status ?? "unavailable",
    factsCoverage: facts?.status ?? "unavailable",
    pilotCount: facts?.scope.pilotRepositories.length ?? gates?.coverage.repositoriesPlanned ?? 6,
    outsidePilot: facts?.scope.listing.outsidePilotRepositories ?? null,
    listedPulls: listed.length,
    unreviewedPulls: listed.filter(item => !item.draft).length,
    disclosure,
  };
}

export function listedNonDraftPulls(facts: GitHubFactsSnapshot | null): Array<PilotPullRequestFact & { repository: string }> {
  if (!facts) return [];
  return facts.repositories.flatMap(entry => entry.pullRequests.state === "observed"
    ? entry.pullRequests.items.filter(item => !item.draft)
      .map(item => ({ ...item, repository: entry.repository })) : [],
  ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
