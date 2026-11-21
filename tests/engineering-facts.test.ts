import assert from "node:assert/strict";
import test from "node:test";
import { buildLabel, buildState, filterFleet, latestBuildRows, latestReleaseRows, summarizeFleet } from "../src/engineering-facts.ts";
import type { OrganizationRepository, RepositoryWorkflow } from "../src/shared.ts";

const workflow = (
  status: RepositoryWorkflow["status"],
  conclusion: RepositoryWorkflow["conclusion"],
  updatedAt = "2026-11-19T13:00:00Z",
): RepositoryWorkflow => ({
  name: "CI / Test",
  status, conclusion, updatedAt, createdAt: "2026-11-19T12:00:00Z",
  htmlUrl: "https://github.com/uichat-mira/example/actions/runs/1",
});

const repo = (name: string, latestWorkflow: RepositoryWorkflow | null, extras: Partial<OrganizationRepository> = {}): OrganizationRepository => ({
  name,
  fullName: "uichat-mira/" + name,
  htmlUrl: "https://github.com/uichat-mira/" + name,
  description: null, visibility: "public", defaultBranch: "dev",
  archived: false, fork: false, language: null, pushedAt: "2026-11-19T12:00:00Z",
  updatedAt: "2026-11-19T12:00:00Z",
  openIssuesCount: 0, stars: 0, latestWorkflow, latestRelease: null,
  ...extras,
});

test("differentiate GitHub workflow phases, without classing missing conclusions as failure", () => {
  assert.equal(buildState(null), "unknown");
  assert.equal(buildState(workflow("queued", null)), "running");
  assert.equal(buildState(workflow("in_progress", null)), "running");
  assert.equal(buildState(workflow("completed", null)), "unknown");
  assert.equal(buildState(workflow("completed", "success")), "passed");
  assert.equal(buildState(workflow("completed", "failure")), "failed");
  assert.equal(buildState(workflow("completed", "startup_failure")), "failed");
  assert.equal(buildState(workflow("completed", "action_required")), "action");
  assert.equal(buildLabel(workflow("completed", "action_required")), "需要人工操作");
  assert.equal(buildState(workflow("completed", "timed_out")), "failed");
  assert.equal(buildState(workflow("completed", "cancelled")), "neutral");
  assert.equal(buildState(workflow("completed", "skipped")), "neutral");
  assert.equal(buildState(workflow("completed", "stale")), "unknown");
  assert.equal(buildLabel(workflow("queued", null)), "排队中");
  assert.equal(buildLabel(workflow("completed", null)), "结果未知");
});

test("metrics use only known snapshots and last default-branch Runs for the denominator", () => {
  const rows = [
    repo("active", workflow("in_progress", null)),
    repo("ok", workflow("completed", "success"), {
      latestRelease: { tagName: "v0.3.0", name: "Release", publishedAt: "2026-11-19T13:00:00Z", htmlUrl: "https://github.com/uichat-mira/ok/releases/tag/v0.3.0" },
    }),
    repo("failed", workflow("completed", "failure")),
    repo("old", null, { archived: true }),
  ];
  assert.deepEqual(summarizeFleet(rows), {
    counts: { passed: 1, failed: 1, action: 0, running: 1, neutral: 0, unknown: 1 },
    withRuns: 3, released: 1, nonArchived: 3,
  });
});

test("fleet filters preserve all records, prioritize known failures and running builds, and keep archived last", () => {
  const rows = [
    repo("old", workflow("completed", "failure"), { archived: true }),
    repo("okay", workflow("completed", "success")),
    repo("running", workflow("in_progress", null)),
    repo("failed", workflow("completed", "failure")),
    repo("action", workflow("completed", "action_required")),
    repo("idle", null),
  ];
  assert.deepEqual(filterFleet(rows, "", "all").map(r=>r.name), ["failed","action","running","idle","okay","old"]);
  assert.deepEqual(filterFleet(rows, "", "attention").map(r=>r.name), ["failed","action","old"]);
  assert.deepEqual(filterFleet(rows, "", "running").map(r=>r.name), ["running"]);
  assert.deepEqual(filterFleet(rows, "", "archived").map(r=>r.name), ["old"]);
});

test("search considers repository name, language, description and default branch, case insensitively", () => {
  const rows = [
    repo("desktop", null, { language: "TypeScript", description: "Electron application" }),
    repo("cloud", null, { language: "Go", description: "Cloud Control Plane", defaultBranch: "prod" }),
  ];
  assert.deepEqual(filterFleet(rows, "  ELECTRON  ", "all").map(r=>r.name), ["desktop"]);
  assert.deepEqual(filterFleet(rows, "PROD", "all").map(r=>r.name), ["cloud"]);
  assert.deepEqual(filterFleet(rows, "go", "all").map(r=>r.name), ["cloud"]);
  assert.deepEqual(filterFleet(rows, "not-found", "all"), []);
});

test("engineering build route lists only actual latest default-branch Runs and filters raw states", () => {
  const rows = [
    repo("none", null),
    repo("oldsuccess", workflow("completed", "success", "2026-11-18T10:00:00Z")),
    repo("active", workflow("in_progress", null, "2026-11-21T14:00:00Z")),
    repo("fail", workflow("completed", "failure", "2026-11-20T14:00:00Z")),
    repo("action", workflow("completed", "action_required", "2026-11-20T16:00:00Z")),
    repo("unknown", workflow("completed", null, "2026-11-19T09:00:00Z")),
  ];
  assert.deepEqual(latestBuildRows(rows).map(row => row.name),
    ["active", "action", "fail", "unknown", "oldsuccess"]);
  assert.deepEqual(latestBuildRows(rows, "failed").map(row => row.name), ["action", "fail"]);
  assert.deepEqual(latestBuildRows(rows, "running").map(row => row.name), ["active"]);
  assert.deepEqual(latestBuildRows(rows, "passed").map(row => row.name), ["oldsuccess"]);
});

test("Release page uses latest discovered tag per repository and sorts by publish time", () => {
  const rows = [
    repo("without", null),
    repo("recent", null, { latestRelease: {
      tagName: "v2", name: "Second", publishedAt: "2026-11-21T11:00:00Z",
      htmlUrl: "https://github.com/uichat-mira/recent/releases/tag/v2",
    }}),
    repo("undated", null, { latestRelease: {
      tagName: "v0", name: null, publishedAt: null,
      htmlUrl: "https://github.com/uichat-mira/undated/releases/tag/v0",
    }}),
    repo("older", null, { latestRelease: {
      tagName: "v1", name: "First", publishedAt: "2026-11-19T11:00:00Z",
      htmlUrl: "https://github.com/uichat-mira/older/releases/tag/v1",
    }}),
  ];
  assert.deepEqual(latestReleaseRows(rows).map(row => row.name),
    ["recent", "older", "undated"]);
  assert.equal(latestReleaseRows(rows)[0].latestRelease?.tagName, "v2");
});
