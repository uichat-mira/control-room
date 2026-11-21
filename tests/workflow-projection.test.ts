import assert from "node:assert/strict";
import test from "node:test";
import { workflowText, workflowTone } from "../src/data.ts";
import { buildState } from "../src/engineering-facts.ts";
import { projectAttentionDesk } from "../src/attention-center.ts";
import type { RepositoryWorkflow } from "../src/shared.ts";

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

test("Overview never promotes the latest raw Run into a required Gate without qualification", () => {
  const raw = [
    run(null), run("stale"), run("action_required"), run("failure"),
    run("cancelled"), run(null, "queued"),
  ];
  assert.equal(raw.filter(item => buildState(item) === "failed").length, 1);
  // Raw Run objects are NOT inputs to the OPS-038 qualifying projection.
  const desk = projectAttentionDesk({ gates: null, facts: null });
  assert.deepEqual(desk.attention, []);
  assert.ok(desk.disclosure.some(item => item.includes("Gate")));
});
