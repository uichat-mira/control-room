import assert from "node:assert/strict";
import test from "node:test";
import { workflowText, workflowTone } from "../src/data.ts";
import { buildState } from "../src/engineering-facts.ts";
import { collectAttention } from "../src/overview-facts.ts";
import type { RepositoryWorkflow, OrganizationRepository } from "../src/shared.ts";

const run = (
  conclusion: RepositoryWorkflow["conclusion"],
  status: RepositoryWorkflow["status"] = "completed",
): RepositoryWorkflow => ({
  name: "Mira Gate",
  status, conclusion,
  htmlUrl: "https://github.com/uichat-mira/control-room/actions/runs/123",
  createdAt: "2026-11-19T12:00:00Z",
  updatedAt: "2026-11-19T12:30:00Z",
});

const repo = (name: string, workflow: RepositoryWorkflow | null) => ({
  name,
  fullName: "uichat-mira/" + name,
  htmlUrl: "https://github.com/uichat-mira/" + name,
  defaultBranch: "dev",
  latestWorkflow: workflow,
}) as OrganizationRepository;

test("System Wall preserves the Engineering state classification for every meaningful Run result", () => {
  const cases: [RepositoryWorkflow | null, string, string][] = [
    [null, "unknown", "muted"],
    [run(null), "unknown", "muted"],
    [run("stale"), "unknown", "muted"],
    [run("action_required"), "action", "review"],
    [run("failure"), "failed", "failure"],
    [run("timed_out"), "failed", "failure"],
    [run("startup_failure"), "failed", "failure"],
    [run("success"), "passed", "success"],
    [run("cancelled"), "neutral", "muted"],
    [run("skipped"), "neutral", "muted"],
    [run("neutral"), "neutral", "muted"],
    [run(null, "queued"), "running", "running"],
    [run(null, "in_progress"), "running", "running"],
  ];
  for (const [workflow, state, tone] of cases) {
    assert.equal(buildState(workflow), state);
    assert.equal(workflowTone(workflow), tone, "incorrect Wall tone for " + String(workflow?.conclusion));
  }
  assert.equal(workflowText(run(null)), "Unknown");
  assert.equal(workflowText(run("action_required")), "Needs action");
  assert.equal(workflowText(run("success")), "Passed");
  assert.equal(workflowText(run(null, "in_progress")), "Running");
});

test("Overview distinguishes action_required from failure and excludes unknown from attention", () => {
  const entries = collectAttention([
    repo("missing", run(null)),
    repo("stale", run("stale")),
    repo("action", run("action_required")),
    repo("failed", run("failure")),
    repo("cancelled", run("cancelled")),
    repo("queued", run(null, "queued")),
  ], [], []);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(item => [item.name, item.severity]), [
    ["failed", "failure"],
    ["action", "warning"],
  ]);
  assert.equal(entries.filter(item => item.category === "build" && item.severity === "failure").length, 1);
  assert.match(entries[1].explanation, /需要人工操作/);
  assert.equal(entries[1].href, "https://github.com/uichat-mira/control-room/actions/runs/123");
});
