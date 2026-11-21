import assert from "node:assert/strict";
import test from "node:test";
import { dashboardSignals } from "../src/dashboard-model.ts";
import type { SummaryPayload } from "../src/data.ts";
import type { FactoryFeed } from "../src/factory-feed.ts";
import type { AttentionDesk } from "../src/attention-center.ts";

function desk(attention: number): AttentionDesk {
  return {
    attention: Array.from({ length: attention }, (_, n) => ({ id: String(n) })) as AttentionDesk["attention"],
    inProgress: [], observed: [], unknown: [],
    gateCoverage: "partial", factsCoverage: "partial",
    pilotCount: 6, outsidePilot: null, listedPulls: 1, unreviewedPulls: 1, disclosure: [],
  };
}
function feed(): FactoryFeed {
  return {
    source: "github-actions", status: "partial",
    historyDays: 14, coverageLimited: true,
    items: [
      { id: 5, status: "in_progress", repository: "uichat-mira/control-room" },
      { id: 4, status: "completed", conclusion: "success", repository: "uichat-mira/control-room" },
      { id: 3, status: "completed", conclusion: "failure", repository: "uichat-mira/control-room" },
    ],
  } as unknown as FactoryFeed;
}
function summary(): SummaryPayload {
  return {
    status: "connected", services: [
      { id: "a", status: "online" }, { id: "b", status: "offline" },
    ],
  } as unknown as SummaryPayload;
}
const args = () => ({
  summary: summary(), feed: feed(), desk: desk(2),
  gatesReady: true, summaryFailed: false, workersFailed: false,
  gatesFailed: false, factsFailed: false,
});
test("dashboard only counts active bounded worker samples; finished failed/successful Runs are not active", () => {
  const value = dashboardSignals(args());
  assert.equal(value.activeWorkers, 1);
  assert.deepEqual(value.activeRunSamples.map(x => x.id), [5]);
  assert.equal(value.confirmedAttention, 2);
  assert.equal(value.coverage, "部分覆盖");
  assert.deepEqual([value.onlineProbes, value.probeTotal], [1, 2]);
});
test("missing or unreadable sources show unknown, never a fabricated zero", () => {
  const value = dashboardSignals({
    ...args(), summary: null, feed: null, gatesReady: false,
    workersFailed: true, gatesFailed: true,
  });
  assert.equal(value.confirmedAttention, null);
  assert.equal(value.activeWorkers, null);
  assert.equal(value.onlineProbes, null);
  assert.equal(value.probeTotal, null);
  assert.equal(value.coverageLimited, true);
});
test("failed Gate refresh hides cached P1 count instead of keeping a stale confirmed item", () => {
  const value = dashboardSignals({ ...args(), gatesFailed: true });
  assert.equal(value.confirmedAttention, null);
  assert.equal(value.coverage, "部分覆盖");
});
test("a completed failed Run is a historical observation, not an actionable homepage event", () => {
  const value = dashboardSignals({ ...args(), feed: {
    ...feed(), items: feed().items.filter(item => item.status === "completed"),
  } });
  assert.equal(value.activeWorkers, 0);
  assert.equal(value.activeRunSamples.length, 0);
});
