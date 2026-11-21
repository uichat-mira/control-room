import assert from "node:assert/strict";
import test from "node:test";
import {
  isGateSnapshot, isGitHubFactsSnapshot, isPullQualification,
  isWorkerQualification, listedNonDraftPulls, projectAttentionDesk,
} from "../src/attention-center.ts";
import type { GitHubGateQualificationSnapshot, QualificationCandidate } from "../src/github-gate-facts.ts";
import type { GitHubFactsSnapshot } from "../src/github-facts.ts";
import type { PullRequestQualification } from "../src/github-pr-qualification.ts";
import type { WorkerAttentionCandidate } from "../src/factory-attention.ts";

const observedAt = "2026-11-21T10:10:00Z";
const url = "https://github.com/uichat-mira/control-room/actions/runs/123";
function candidate(input: Partial<QualificationCandidate> = {}): QualificationCandidate {
  return {
    id: "gate:uichat-mira/control-room:prod:fail",
    category: "actions_gate", classification: "attention", priority: "P1",
    who: "control-room maintainers", what: "Required workflow fails",
    whyNow: "Current head cannot merge", nextStep: "Inspect exact run",
    exitCondition: "Current necessary gate succeeds",
    evidence: [{ label: "Real current run", url, observedAt }],
    observedAt, repository: "uichat-mira/control-room",
    branch: "prod", headSha: "a".repeat(40), workflowFile: "deploy.yml",
    runId: 123, attempt: 1, ...input,
  };
}
function gate(candidates: QualificationCandidate[] = [], status: "complete" | "partial" | "unknown" = "partial") {
  return {
    apiVersion: "v1", source: "github-facts-derivation",
    coverage: { status, repositoriesPlanned: 6 },
    factsGeneratedAt: observedAt, candidates,
    requiredCheckEvidence: "unavailable",
  } as unknown as GitHubGateQualificationSnapshot;
}
function facts() {
  return {
    apiVersion: "v1", source: "github-rest", status: "partial",
    generatedAt: observedAt,
    coverage: { truncatedSources: ["mira-desktop PR"] },
    scope: { pilotRepositories: ["uichat-mira/control-room"],
      listing: { outsidePilotRepositories: 5 } },
    freshness: { state: "fresh" }, repositories: [
      { repository: "uichat-mira/control-room", pullRequests: {
        state: "observed",
        items: [
          { number: 15, draft: true, updatedAt: observedAt, title: "Draft" },
          { number: 16, draft: false, updatedAt: observedAt, title: "Open PR", headSha: "b".repeat(40) },
        ],
      } },
    ],
  } as unknown as GitHubFactsSnapshot;
}
function pr(input: Partial<PullRequestQualification> = {}) {
  return {
    apiVersion: "v1", source: "github-pr-derivation",
    id: "pr:uichat-mira/control-room:16", repository: "uichat-mira/control-room",
    number: 16, status: "needs_attention", classification: "attention", priority: "P1",
    what: "Real merge conflict", whyNow: "Current head conflicts", nextStep: "Resolve conflict",
    exitCondition: "New head no longer conflicts", observedAt,
    evidence: [{ label: "PR", url: "https://github.com/uichat-mira/control-room/pull/16", observedAt }],
    coverage: { status: "partial" }, checks: { requiredByGithub: "unknown" },
    ...input,
  } as unknown as PullRequestQualification;
}
function worker(input: Partial<WorkerAttentionCandidate> = {}) {
  return {
    apiVersion: "v1", source: "factory-attention-derivation",
    id: "worker:uichat-mira/control-room:99",
    identity: { repository: "uichat-mira/control-room", issueNumber: 50, runId: 99, attempt: 1 },
    category: "worker_escalation",
    status: "needs_attention", classification: "attention", priority: "P1",
    what: "Trusted recovery exhausted", whyNow: "Terminal escalation current",
    whatSystemTried: "Two automatic repair rounds", nextStep: "Human inspect",
    exitCondition: "Newer same Issue recovery", observedAt,
    evidence: [{ label: "Run", url, observedAt }],
    coverage: { status: "partial" }, reporter: { status: "available" },
    ...input,
  } as unknown as WorkerAttentionCandidate;
}

test("duplicate required checks, Gate and release evidence for one head become one root item", () => {
  const first = candidate();
  const second = candidate({
    id: "release:uichat-mira/control-room:prod:fail", category: "deployment",
    evidence: [{ label: "Deploy run", url: "https://github.com/uichat-mira/control-room/actions/runs/124", observedAt }],
  });
  const d = projectAttentionDesk({ gates: gate([first, second]), facts: facts() });
  assert.equal(d.attention.length, 1);
  assert.equal(d.attention[0].relatedCandidates, 2);
  assert.equal(d.attention[0].evidence.length, 2);
  assert.equal(d.attention[0].priority, "P1");
});

test("qualified recovery removes the old human item without local dismissal", () => {
  const failing = projectAttentionDesk({ gates: gate([candidate()]), facts: facts() });
  const recovered = projectAttentionDesk({ gates: gate([
    candidate({ classification: "observation", priority: null, what: "Recovered", observedAt: "2026-11-21T10:30:00Z" }),
  ]), facts: facts() });
  assert.equal(failing.attention.length, 1);
  assert.equal(recovered.attention.length, 0);
  assert.equal(recovered.observed.length, 1);
});

test("unproven required Gate or unknown candidate never becomes a human todo", () => {
  const unknown = candidate({ classification: "unknown", priority: null, observedAt: null, evidence: [] });
  const missingEvidence = candidate({ id: "gate:missing", evidence: [], headSha: "c".repeat(40) });
  const d = projectAttentionDesk({ gates: gate([unknown, missingEvidence]), facts: facts() });
  assert.equal(d.attention.length, 0);
  assert.equal(d.unknown.length, 2);
  assert.ok(d.unknown.some(item => item.whyNow.includes("可核验")));
});

test("known service failure, unprotected default branch, Draft and raw latest CI are not attention inputs", () => {
  const d = projectAttentionDesk({ gates: gate([]), facts: facts() });
  assert.equal(d.attention.length, 0);
  assert.equal(d.unreviewedPulls, 1);
  assert.deepEqual(listedNonDraftPulls(facts()).map(item => item.number), [16]);
  assert.ok(d.disclosure.some(item => item.includes("非 Draft PR")));
});

test("current on-demand PR blocker and real Worker escalation enter separately; closed / recovered leave", () => {
  const d = projectAttentionDesk({ gates: gate([]), facts: facts(), pr: pr(), worker: worker() });
  assert.equal(d.attention.length, 2);
  assert.ok(d.attention.some(item => item.objectKey === "pr:uichat-mira/control-room:16"));
  assert.ok(d.attention.some(item => item.objectKey === "issue:uichat-mira/control-room:50"));
  const cleared = projectAttentionDesk({ gates: gate([]), facts: facts(),
    pr: pr({ classification: "observation", status: "observed", priority: null }),
    worker: worker({ classification: "unknown", status: "unknown", priority: null }) });
  assert.equal(cleared.attention.length, 0);
  assert.equal(cleared.observed.length, 1);
  assert.equal(cleared.unknown.length, 1);
});

test("a missing Gate or stale/truncated GitHub facts is disclosed, not silently healthy", () => {
  const d = projectAttentionDesk({ gates: null, facts: {
    ...facts(), freshness: { ...facts().freshness, state: "stale" },
  } });
  assert.equal(d.attention.length, 0);
  assert.equal(d.gateCoverage, "unavailable");
  assert.ok(d.disclosure.some(item => item.includes("过期")));
  assert.ok(d.disclosure.some(item => item.includes("截断")));
  assert.equal(d.outsidePilot, 5);
});

test("public API source shapes are validated and unrelated responses rejected", () => {
  assert.equal(isGateSnapshot(gate()), true);
  assert.equal(isGitHubFactsSnapshot(facts()), true);
  assert.equal(isPullQualification(pr()), true);
  assert.equal(isWorkerQualification(worker()), true);
  assert.equal(isGateSnapshot({ source: "github-rest", candidates: [] }), false);
  assert.equal(isGitHubFactsSnapshot({ source: "mock", repositories: [] }), false);
  assert.equal(isPullQualification({ source: "github-pr-derivation", number: "16" }), false);
  assert.equal(isWorkerQualification({ source: "factory-attention-derivation", identity: null }), false);
});

test("an unrefreshable Gate snapshot never leaves its old P1 in the current human queue", () => {
  const reliable = projectAttentionDesk({ gates: gate([candidate()]), facts: facts() });
  const unavailable = projectAttentionDesk({ gates: gate([candidate()]), facts: facts(), gatesCurrent: false });
  assert.equal(reliable.attention.length, 1);
  assert.equal(unavailable.attention.length, 0);
  assert.equal(unavailable.unknown.length, 1);
  assert.ok(unavailable.disclosure.some(item => item.includes("过期")));
});

test("a Gate projection from the previous facts round never becomes a current P1", () => {
  const differentRound = gate([candidate()]);
  const changedFacts = { ...facts(), generatedAt: "2026-11-21T11:30:00Z" };
  const d = projectAttentionDesk({ gates: differentRound, facts: changedFacts });
  assert.equal(d.attention.length, 0);
  assert.equal(d.unknown.length, 1);
});
