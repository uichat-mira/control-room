import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/ai-review-real-provider-probe.yml", import.meta.url),
  "utf8",
);

test("real-provider probe is manual-only and allows the modeled long-running provider window", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s*push:/);
  assert.match(workflow, /timeout-minutes:\s+8/);
});

test("real-provider probe requires the CODE_REVIEW routine to be explicitly enabled", () => {
  assert.match(workflow, /routine\.enabled !== true/);
});

test("paid review execution is single-shot and never retried by curl", () => {
  const marker = "- name: Execute one production review";
  const executionStep = workflow.split(marker)[1];
  assert.ok(executionStep, "real-provider execution step must exist");
  assert.equal((executionStep.match(/\bcurl\b/g) ?? []).length, 1);
  assert.doesNotMatch(executionStep, /--retry(?:\s|$)/);
  assert.doesNotMatch(executionStep, /--retry-all-errors/);
});

test("real-provider probe emits safe upstream diagnostics without provider bodies", () => {
  assert.match(workflow, /upstreamStatus: attempt\.upstreamStatus \?\? null/);
  assert.doesNotMatch(workflow, /responseBody|rawProvider|providerBody/);
});
