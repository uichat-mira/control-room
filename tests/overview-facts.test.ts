import assert from "node:assert/strict";
import test from "node:test";
import { isFactoryFeed, workerIsActive, workerRunLabel } from "../src/overview-facts.ts";
import type { FactoryFeedItem } from "../src/factory-feed.ts";

// The old collectAttention service/protection aggregator was retired in OPS-038.
// New T1 eligibility and suppression tests live in attention-center.test.ts.

test("unknown Worker feed is rejected, partial GitHub coverage remains valid", () => {
  assert.equal(isFactoryFeed(null), false);
  assert.equal(isFactoryFeed({ source: "github-actions", status: "connected", items: "fake" }), false);
  assert.equal(isFactoryFeed({ source: "mock", status: "connected", generatedAt: "now", items: [] }), false);
  assert.equal(isFactoryFeed({ source: "github-actions", status: "partial", generatedAt: "now", items: [] }), true);
});

test("Worker run status is only GitHub execution evidence, never delivery proof", () => {
  const run = {
    id: 2, repository: "uichat-mira/mira-desktop", createdAt: "now", updatedAt: "now",
    htmlUrl: "https://github.com/uichat-mira/mira-desktop/actions/runs/2",
    attempt: 1, title: "Mira External Worker", branch: "dev",
    status: "in_progress", conclusion: null,
  } satisfies FactoryFeedItem;
  assert.equal(workerIsActive(run), true);
  assert.equal(workerRunLabel(run), "GitHub 执行中");
  assert.equal(workerIsActive({ ...run, status: "completed", conclusion: "success" }), false);
  assert.match(workerRunLabel({ ...run, status: "completed", conclusion: "success" }), /未代表交付/);
  assert.equal(workerRunLabel({ ...run, status: "completed", conclusion: "failure" }), "Run 失败");
  assert.equal(workerRunLabel({ ...run, status: "completed", conclusion: "cancelled" }), "已取消");
});
