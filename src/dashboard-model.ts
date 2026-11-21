import type { AttentionDesk } from "./attention-center.ts";
import { FACTORY_FEED_MAX_ITEMS, type FactoryFeed } from "./factory-feed.ts";
import type { SummaryPayload } from "./data.ts";
import { workerIsActive } from "./overview-facts.ts";

/** Entry-dashboard signals only. The detail page owns evidence/qualification. */
export function dashboardSignals(input: {
  summary: SummaryPayload | null;
  feed: FactoryFeed | null;
  desk: AttentionDesk;
  gatesReady: boolean;
  summaryFailed: boolean;
  workersFailed: boolean;
  gatesFailed: boolean;
  factsFailed: boolean;
}) {
  const { summary, feed, desk } = input;
  const seenActive = feed ? feed.items.filter(workerIsActive) : [];
  // Zero may describe the qualified pilot, but NEVER an unobserved upstream.
  const confirmedAttention = input.gatesReady && !input.gatesFailed && !input.factsFailed
    ? desk.attention.length : null;
  const activeWorkers = feed && !input.workersFailed ? seenActive.length : null;
  const onlineProbes = summary && !input.summaryFailed
    ? summary.services.filter(service => service.status === "online").length : null;
  const probeTotal = summary && !input.summaryFailed ? summary.services.length : null;
  const limited = desk.gateCoverage !== "complete" ||
    desk.factsCoverage !== "complete" || !feed ||
    feed.status === "partial" || feed.coverageLimited ||
    !summary || summary.status !== "connected" ||
    input.summaryFailed || input.workersFailed || input.gatesFailed || input.factsFailed;

  return {
    confirmedAttention, activeWorkers, onlineProbes, probeTotal,
    coverage: limited ? "部分覆盖" : "试点已观测",
    coverageLimited: limited,
    // This is an index, never a globally exact worker count.
    workersCaveat: feed
      ? "近 " + feed.historyDays + " 天 · 最多 " + FACTORY_FEED_MAX_ITEMS + " 条有界发现"
      : "Worker 来源暂不可用",
    activeRunSamples: seenActive.slice(0, 2),
    // The top level must not list archived successes under 'in progress'.
    summaryCurrent: !!summary && !input.summaryFailed,
  };
}
