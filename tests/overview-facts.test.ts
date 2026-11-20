import assert from "node:assert/strict";
import test from "node:test";
import { collectAttention, isFactoryFeed, workerIsActive, workerRunLabel } from "../src/overview-facts.ts";
import type { OrganizationRepository, ServiceProbe } from "../src/shared.ts";
import type { GovernanceRepository } from "../src/data.ts";
import type { FactoryFeedItem } from "../src/factory-feed.ts";

const lastRun = (status: "queued" | "in_progress" | "completed", conclusion: string | null) => ({
  name: "Mira Gate",
  status,
  conclusion,
  htmlUrl: "https://github.com/uichat-mira/repo/actions/runs/19",
  createdAt: "2026-11-19T10:00:00Z",
  updatedAt: "2026-11-19T10:12:00Z",
});
const repo = (name: string, run: ReturnType<typeof lastRun> | null) =>
  ({
    name,
    fullName: "uichat-mira/" + name,
    htmlUrl: "https://github.com/uichat-mira/" + name,
    defaultBranch: "dev",
    latestWorkflow: run,
  } as OrganizationRepository);
const service = (id: string, status: "online" | "degraded" | "offline"): ServiceProbe => ({
  id, label: "probe-" + id, url: "https://mira.tomz.io/",
  status, httpStatus: status === "offline" ? null : 200,
  latencyMs: status === "offline" ? null : 80,
  detail: status === "offline" ? "Timeout" : "HTTP probe",
});
const governance = (name: string, protectedState: boolean | null): GovernanceRepository => ({
  name, fullName: "uichat-mira/" + name,
  defaultBranch: "dev", htmlUrl: "https://github.com/uichat-mira/" + name,
  governance: { status: "connected", openIssues: 1, openPullRequests: 2,
    defaultBranchProtected: protectedState, activeRulesets: 0 },
});

test("runtime failures lead; a latest Run failure is archive, not a service outage", () => {
  const result = collectAttention(
    [repo("failed", lastRun("completed", "failure"))],
    [service("ok", "online"), service("bad", "offline"), service("slow", "degraded")],
    [governance("open", false), governance("unknown", null), governance("good", true)],
  );
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(x => x.category), ["service", "service", "policy"]);
  assert.deepEqual(result.map(x => x.severity), ["failure", "warning", "review"]);
  assert.equal(result.filter(x => x.category === "policy").length, 1);
  assert.equal(result.filter(x => x.category !== "policy").length, 2);
  assert.equal(result[0].href, "https://mira.tomz.io/");
});

test("running, successful, cancelled, action_required and failed latest Runs are all archive facts", () => {
  const result = collectAttention([
    repo("pending", lastRun("queued", null)),
    repo("running", lastRun("in_progress", null)),
    repo("passed", lastRun("completed", "success")),
    repo("cancelled", lastRun("completed", "cancelled")),
    repo("missing", lastRun("completed", null)),
    repo("no-run", null),
    repo("action", lastRun("completed", "action_required")),
    repo("failed", lastRun("completed", "failure")),
  ], [service("ok", "online")], [governance("unknown", null)]);
  // A raw latest Run (even failure/action_required) cannot prove a necessary
  // Gate or runtime impact, so it does not become an attention item here.
  assert.deepEqual(result, []);
});

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
