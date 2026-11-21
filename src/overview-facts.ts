import type { FactoryFeed, FactoryFeedItem } from "./factory-feed.ts";

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
