import type { OrganizationRepository, ServiceProbe } from "./shared.ts";
import type { GovernanceRepository } from "./data.ts";
import type { FactoryFeed, FactoryFeedItem } from "./factory-feed.ts";

export type AttentionItem = {
  key: string;
  category: "service" | "build" | "policy";
  severity: "failure" | "warning" | "review";
  name: string;
  explanation: string;
  href: string;
  observedAt: string | null;
};

// These are latest observed states, not time-bounded new incidents. Default-branch
// builds and HTTP probes have different coverage and must not be merged into uptime.
export function collectAttention(
  repositories: OrganizationRepository[],
  services: ServiceProbe[],
  governance: GovernanceRepository[],
): AttentionItem[] {
  const entries: AttentionItem[] = [];

  for (const service of services) {
    if (service.status === "online") continue;
    entries.push({
      key: "service:" + service.id,
      category: "service",
      severity: service.status === "offline" ? "failure" : "warning",
      name: service.label,
      explanation: "HTTP 探针 " + service.status + " · " + service.detail,
      href: service.url,
      observedAt: null,
    });
  }
  // `latestWorkflow` is the newest Actions Run, not a necessary Gate and not
  // runtime health. An old or unrelated failed Run therefore stays an
  // engineering archive fact (Engineering/Wall) and never becomes an
  // "attention" incident here. OPS-035 Gate/Release eligibility is projected
  // separately from branch + head SHA + workflow identity.
  // An unprotected branch is a review fact, not automatically a security incident.
  for (const repo of governance) {
    if (repo.governance.defaultBranchProtected !== false) continue;
    entries.push({
      key: "policy:" + repo.fullName,
      category: "policy",
      severity: "review",
      name: repo.name,
      explanation: repo.defaultBranch + " 默认分支未报告保护；是否符合仓库规则需要核查",
      href: repo.htmlUrl,
      observedAt: null,
    });
  }
  const rank: Record<AttentionItem["severity"], number> = { failure: 0, warning: 1, review: 2 };
  return entries.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function isFactoryFeed(payload: unknown): payload is FactoryFeed {
  if (!payload || typeof payload !== "object") return false;
  const feed = payload as Partial<FactoryFeed>;
  return feed.source === "github-actions" &&
    (feed.status === "connected" || feed.status === "partial") &&
    typeof feed.generatedAt === "string" &&
    Array.isArray(feed.items) &&
    feed.items.every((item) => typeof item.id === "number" &&
      typeof item.repository === "string" &&
      typeof item.htmlUrl === "string" && typeof item.status === "string");
}

export function workerIsActive(item: FactoryFeedItem): boolean {
  return item.status === "queued" || item.status === "in_progress";
}

// A successful Actions Run only says that this Actions Run succeeded.
// It does not establish Candidate integrity, product acceptance or PR delivery.
export function workerRunLabel(item: FactoryFeedItem): string {
  if (item.status === "queued") return "GitHub 排队中";
  if (item.status === "in_progress") return "GitHub 执行中";
  if (item.conclusion === "success") return "Run 成功 · 未代表交付";
  if (item.conclusion === "failure" || item.conclusion === "timed_out" ||
      item.conclusion === "startup_failure") return "Run 失败";
  if (item.conclusion === "cancelled") return "已取消";
  return item.conclusion ? "Run " + item.conclusion : "状态待确认";
}
