import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import {
  collectGitHubFacts,
  type FactSourceState,
  type GitHubFactsSnapshot,
  type PilotBranchFact,
  type PilotRepositoryFacts,
  type PilotWorkflowFact,
  type PilotWorkflowRunFact,
} from "../src/github-facts.ts";
import {
  qualifyGitHubGates,
  type QualificationCandidate,
} from "../src/github-gate-facts.ts";

const network = setupServer();
const token = "gate-fixture-token";

before(() => network.listen({ onUnhandledRequest: "error" }));
afterEach(() => network.resetHandlers());
after(() => network.close());

function sha(label: string): string {
  return label.repeat(40).slice(0, 40);
}

function hexSha(label: string): string {
  let hash = 0;
  for (const character of label) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(5);
}

function branch(
  name: string,
  headSha: string,
  state: FactSourceState = "observed",
): PilotBranchFact {
  return {
    name,
    state,
    sha: state === "observed" ? headSha : null,
    protected: name === "prod",
    observedAt: "2026-11-20T10:00:00Z",
    query: {
      source: "github-rest",
      path: `/repos/uichat-mira/fixture/branches/${name}`,
      status: state === "observed" ? "ok" : state === "unavailable" ? "unavailable" : "missing",
      httpStatus: state === "observed" ? 200 : state === "unavailable" ? 503 : 404,
      fetchedAt: "2026-11-20T10:00:00Z",
      observedAt: state === "observed" ? "2026-11-20T10:00:00Z" : null,
      cache: "upstream",
      etag: null,
      truncated: false,
      retryAfterSeconds: null,
      skipReason: null,
      error: null,
    },
  };
}

function run(
  id: number,
  file: string,
  options: {
    branch?: string;
    headSha?: string;
    event?: string;
    status?: string;
    conclusion?: string | null;
    attempt?: number;
    updatedAt?: string;
  } = {},
): PilotWorkflowRunFact {
  const branchName = options.branch ?? "prod";
  return {
    id,
    name: file.replace(".yml", ""),
    path: `.github/workflows/${file}`,
    event: options.event ?? "push",
    status: options.status ?? "completed",
    conclusion: options.conclusion === undefined ? "success" : options.conclusion,
    headBranch: branchName,
    headSha: options.headSha ?? sha(branchName),
    attempt: options.attempt ?? 1,
    htmlUrl: `https://github.com/uichat-mira/fixture/actions/runs/${id}`,
    createdAt: options.updatedAt ?? "2026-11-20T01:00:00Z",
    updatedAt: options.updatedAt ?? "2026-11-20T01:05:00Z",
  };
}

function workflow(
  file: string,
  runs: PilotWorkflowRunFact[],
  options: { label?: string; state?: FactSourceState; truncated?: boolean } = {},
): PilotWorkflowFact {
  const state = options.state ?? "observed";
  return {
    file,
    label: options.label ?? file.replace(".yml", ""),
    state,
    runs: state === "observed" ? runs : [],
    totalCount: state === "observed" ? runs.length : null,
    observedAt: state === "observed" ? "2026-11-20T10:00:00Z" : null,
    query: {
      source: "github-rest",
      path: `/repos/uichat-mira/fixture/actions/workflows/${file}/runs`,
      status: state === "observed" ? "ok" : state === "inaccessible" ? "inaccessible" : "missing",
      httpStatus: state === "observed" ? 200 : state === "inaccessible" ? 403 : 404,
      fetchedAt: "2026-11-20T10:00:00Z",
      observedAt: state === "observed" ? "2026-11-20T10:00:00Z" : null,
      cache: "upstream",
      etag: null,
      truncated: options.truncated ?? false,
      retryAfterSeconds: null,
      skipReason: null,
      error: null,
    },
  };
}

function repository(
  name: string,
  options: {
    defaultBranch?: string | null;
    branches?: PilotBranchFact[];
    workflows?: PilotWorkflowFact[];
    presence?: "observed" | "missing" | "unknown";
  } = {},
): PilotRepositoryFacts {
  const branches = options.branches ?? [
    branch("dev", sha("dev")),
    branch("test", sha("test")),
    branch("prod", sha("prod")),
  ];
  const workflows = options.workflows ?? [];
  return {
    repository: `uichat-mira/${name}`,
    name,
    defaultBranch: options.defaultBranch === undefined ? "prod" : options.defaultBranch,
    presence: options.presence ?? "observed",
    branches,
    workflows,
    pullRequests: {
      state: "observed",
      items: [],
      truncated: false,
      observedAt: "2026-11-20T10:00:00Z",
      query: {
        source: "github-rest",
        path: `/repos/uichat-mira/${name}/pulls`,
        status: "ok",
        httpStatus: 200,
        fetchedAt: "2026-11-20T10:00:00Z",
        observedAt: "2026-11-20T10:00:00Z",
        cache: "upstream",
        etag: null,
        truncated: false,
        retryAfterSeconds: null,
        skipReason: null,
        error: null,
      },
    },
    coverage: {
      status: "complete",
      plannedQueries: 4,
      completedQueries: 4,
      failedQueries: 0,
      budgetSkippedQueries: 0,
      missingBranches: [],
      truncatedSources: [],
      reasons: [],
    },
  };
}

function facts(repositories: PilotRepositoryFacts[]): GitHubFactsSnapshot {
  return {
    apiVersion: "v1",
    source: "github-rest",
    generatedAt: "2026-11-20T10:00:00Z",
    status: "complete",
    authentication: {
      mode: "authenticated",
      credentialPresent: true,
      note: "fixture",
    },
    freshness: {
      observedAt: "2026-11-20T10:00:00Z",
      maxAgeSeconds: 3600,
      ageSeconds: 0,
      state: "fresh",
    },
    scope: {
      kind: "pilot-allowlist",
      organization: "uichat-mira",
      pilotRepositories: repositories.map((entry) => entry.repository),
      listing: {
        status: "ok",
        publicRepositories: repositories.length,
        outsidePilotRepositories: 0,
        truncated: false,
        observedAt: "2026-11-20T10:00:00Z",
        query: {
          source: "github-rest",
          path: "/orgs/uichat-mira/repos",
          status: "ok",
          httpStatus: 200,
          fetchedAt: "2026-11-20T10:00:00Z",
          observedAt: "2026-11-20T10:00:00Z",
          cache: "upstream",
          etag: null,
          truncated: false,
          retryAfterSeconds: null,
          skipReason: null,
          error: null,
        },
      },
      note: "fixture",
    },
    budget: {
      scope: "per-snapshot-round",
      plannedRequests: 36,
      maxRequests: 40,
      usedRequests: 36,
      remainingRequests: 4,
      retries: 0,
      notModifiedResponses: 0,
      concurrency: 4,
      timeoutMs: 8000,
      refreshSeconds: 3600,
      designTargetRestPerHour: 60,
      designTargetStatus: "unproven",
      globalBoundProven: false,
      note: "fixture",
    },
    coverage: {
      repositoriesPlanned: repositories.length,
      repositoriesComplete: repositories.length,
      repositoriesPartial: 0,
      repositoriesUnavailable: 0,
      branchesPlanned: repositories.reduce((total, entry) => total + entry.branches.length, 0),
      branchesObserved: repositories.reduce(
        (total, entry) => total + entry.branches.filter((item) => item.state === "observed").length,
        0,
      ),
      branchesMissing: 0,
      branchesUnavailable: 0,
      workflowsPlanned: repositories.reduce((total, entry) => total + entry.workflows.length, 0),
      workflowsObserved: repositories.reduce(
        (total, entry) => total + entry.workflows.filter((item) => item.state === "observed").length,
        0,
      ),
      pullRequestListsObserved: repositories.length,
      truncatedSources: [],
      budgetSkippedQueries: 0,
    },
    rateLimit: { remaining: 100, resetAt: null, retryAfterSeconds: null, observedAt: null },
    repositories,
    warnings: [],
  };
}

function gateCandidates(candidates: QualificationCandidate[]): QualificationCandidate[] {
  return candidates.filter((entry) => entry.category === "actions_gate");
}

function releaseCandidates(candidates: QualificationCandidate[]): QualificationCandidate[] {
  return candidates.filter((entry) => entry.category === "deployment");
}

test("same-SHA rerun recovery clears the old failed attempt and keeps it as archive evidence", () => {
  const target = sha("prod");
  const projected = qualifyGitHubGates(
    facts([
      repository("control-room", {
        workflows: [
          workflow("deploy.yml", [
            run(10, "deploy.yml", {
              headSha: target,
              attempt: 1,
              conclusion: "failure",
              updatedAt: "2026-11-20T01:05:00Z",
            }),
            run(10, "deploy.yml", {
              headSha: target,
              attempt: 2,
              conclusion: "success",
              updatedAt: "2026-11-20T01:10:00Z",
            }),
          ]),
        ],
      }),
    ]),
  );

  const controlRoom = projected.repositories[0];
  assert.equal(controlRoom.gate.effectiveBranch, "prod");
  assert.equal(controlRoom.gate.targetSha, target);
  assert.equal(controlRoom.gate.outcome, "success");
  assert.equal(controlRoom.gate.workflows[0].earlierFailedAttempts, 1);
  assert.equal(controlRoom.gate.workflows[0].recovered, true);
  assert.equal(controlRoom.gate.requiredByGithub, "unknown");
  assert.equal(controlRoom.gate.requiredByWorkflow, "candidate");
  assert.equal(projected.requiredCheckEvidence, "unavailable");

  assert.equal(
    gateCandidates(controlRoom.candidates).filter((entry) => entry.classification === "attention")
      .length,
    0,
  );
  const recovered = gateCandidates(controlRoom.candidates).find((entry) =>
    entry.id.endsWith(":recovered"),
  );
  assert.equal(recovered?.classification, "observation");
  assert.match(recovered?.whyNow ?? "", /newer successful attempt/i);

  // Deploy success still does not prove production SHA or smoke.
  assert.equal(controlRoom.release.releaseStatus, "succeeded");
  assert.equal(controlRoom.release.releaseRecovered, true);
  assert.equal(controlRoom.release.production.status, "unverified");
  assert.equal(
    releaseCandidates(controlRoom.candidates).filter((entry) => entry.classification === "attention")
      .length,
    0,
  );
  assert.ok(projected.warnings.some((warning) => /required checks are not readable/i.test(warning)));
  assert.ok(projected.warnings.some((warning) => /production SHA or smoke/i.test(warning)));
});

test("a newer Run attempt=1 supersedes an older Run attempt=2 on the same target", () => {
  const target = sha("prod");
  const oldFailedRerun = run(100, "deploy.yml", {
    headSha: target,
    attempt: 2,
    conclusion: "failure",
    updatedAt: "2026-11-20T01:00:00Z",
  });
  const newerSuccessfulRun = run(200, "deploy.yml", {
    headSha: target,
    attempt: 1,
    conclusion: "success",
    updatedAt: "2026-11-20T02:00:00Z",
  });
  const snapshot = qualifyGitHubGates(
    facts([
      repository("control-room", {
        workflows: [workflow("deploy.yml", [oldFailedRerun, newerSuccessfulRun])],
      }),
    ]),
  );
  const controlRoom = snapshot.repositories[0];
  assert.equal(controlRoom.gate.workflows[0].applicableRun?.id, 200);
  assert.equal(controlRoom.gate.workflows[0].latestRun?.id, 200);
  assert.equal(controlRoom.gate.outcome, "success");
  assert.equal(controlRoom.gate.workflows[0].recovered, true);
  assert.equal(controlRoom.gate.workflows[0].earlierFailedAttempts, 1);
  assert.equal(controlRoom.release.releaseRun?.id, 200);
  assert.equal(controlRoom.release.releaseStatus, "succeeded");
  assert.equal(controlRoom.release.releaseRecovered, true);
  assert.equal(controlRoom.release.production.status, "unverified");
  assert.equal(
    releaseCandidates(controlRoom.candidates).filter(
      (candidate) => candidate.classification === "attention",
    ).length,
    0,
  );
});

test("a newer failed Run is not masked by a success on an older Run with a higher attempt", () => {
  const target = sha("prod");
  const snapshot = qualifyGitHubGates(
    facts([
      repository("control-room", {
        workflows: [
          workflow("deploy.yml", [
            run(100, "deploy.yml", {
              headSha: target,
              attempt: 3,
              conclusion: "success",
              updatedAt: "2026-11-20T01:00:00Z",
            }),
            run(200, "deploy.yml", {
              headSha: target,
              attempt: 1,
              conclusion: "failure",
              updatedAt: "2026-11-20T02:00:00Z",
            }),
          ]),
        ],
      }),
    ]),
  );
  const controlRoom = snapshot.repositories[0];
  assert.equal(controlRoom.gate.workflows[0].applicableRun?.id, 200);
  assert.equal(controlRoom.gate.outcome, "failure");
  assert.equal(controlRoom.release.releaseRun?.id, 200);
  assert.equal(controlRoom.release.releaseStatus, "failed");
  assert.ok(
    releaseCandidates(controlRoom.candidates).some(
      (candidate) => candidate.classification === "attention" && candidate.priority === "P1",
    ),
  );
});

test("attempt remains the tie-breaker for multiple attempts of the same Run", () => {
  const target = sha("prod");
  const observedAt = "2026-11-20T02:00:00Z";
  const snapshot = qualifyGitHubGates(
    facts([
      repository("control-room", {
        workflows: [
          workflow("deploy.yml", [
            run(100, "deploy.yml", {
              headSha: target,
              attempt: 1,
              conclusion: "failure",
              updatedAt: observedAt,
            }),
            run(100, "deploy.yml", {
              headSha: target,
              attempt: 2,
              conclusion: "success",
              updatedAt: observedAt,
            }),
          ]),
        ],
      }),
    ]),
  );
  const controlRoom = snapshot.repositories[0];
  assert.equal(controlRoom.gate.workflows[0].applicableRun?.attempt, 2);
  assert.equal(controlRoom.gate.outcome, "success");
  assert.equal(controlRoom.release.releaseStatus, "succeeded");
});

test("an old-SHA failure stays historical and does not describe the current target", () => {
  const current = sha("prod");
  const projected = qualifyGitHubGates(
    facts([
      repository("control-room", {
        workflows: [
          workflow("deploy.yml", [
            run(11, "deploy.yml", {
              headSha: current,
              conclusion: "success",
              updatedAt: "2026-11-20T01:00:00Z",
            }),
            run(12, "deploy.yml", {
              headSha: sha("old"),
              conclusion: "failure",
              updatedAt: "2026-11-20T02:00:00Z",
            }),
          ]),
        ],
      }),
    ]),
  );

  const controlRoom = projected.repositories[0];
  assert.equal(controlRoom.gate.outcome, "success");
  assert.equal(controlRoom.gate.workflows[0].applicableRun?.headSha, current);
  const historical = gateCandidates(controlRoom.candidates).find((entry) =>
    entry.id.endsWith(":historical"),
  );
  assert.equal(historical?.classification, "observation");
  assert.match(historical?.whyNow ?? "", /does not describe the current target/i);
});

test("a success from another workflow/SHA does not clear the target workflow's failure", () => {
  const target = sha("dev");
  const projected = qualifyGitHubGates(
    facts([
      repository("mira-cloud", {
        defaultBranch: "dev",
        workflows: [
          workflow("mira-gate.yml", [
            run(20, "mira-gate.yml", {
              branch: "dev",
              headSha: target,
              conclusion: "failure",
              updatedAt: "2026-11-20T02:00:00Z",
            }),
          ]),
          workflow("tencent-prod-deploy.yml", [
            run(21, "tencent-prod-deploy.yml", {
              branch: "dev",
              headSha: sha("other"),
              conclusion: "success",
              updatedAt: "2026-11-20T03:00:00Z",
            }),
          ]),
        ],
      }),
    ]),
  );

  const cloud = projected.repositories[0];
  assert.equal(cloud.gate.outcome, "failure");
  // Required checks are unreadable, so this is a candidate outcome, not an
  // invented confirmed Gate blockage.
  const failure = gateCandidates(cloud.candidates).find((entry) =>
    entry.id.endsWith(":candidate-failure"),
  );
  assert.equal(failure?.classification, "unknown");
  assert.equal(failure?.priority, null);
  assert.match(failure?.whyNow ?? "", /required checks are unreadable/i);
});

test("an issue_comment skipped Worker never replaces the target branch push Gate", () => {
  const target = sha("prod");
  const projected = qualifyGitHubGates(
    facts([
      repository("control-room", {
        workflows: [
          workflow("deploy.yml", [
            run(30, "deploy.yml", {
              headSha: target,
              event: "push",
              conclusion: "success",
              updatedAt: "2026-11-20T01:00:00Z",
            }),
            run(31, "deploy.yml", {
              headSha: target,
              event: "issue_comment",
              conclusion: "skipped",
              updatedAt: "2026-11-20T02:00:00Z",
            }),
          ]),
        ],
      }),
    ]),
  );

  const controlRoom = projected.repositories[0];
  assert.equal(controlRoom.gate.workflows[0].latestRun?.event, "issue_comment");
  assert.equal(controlRoom.gate.workflows[0].latestRun?.conclusion, "skipped");
  assert.equal(controlRoom.gate.workflows[0].applicableRun?.event, "push");
  assert.equal(controlRoom.gate.workflows[0].outcome, "success");
  assert.equal(
    gateCandidates(controlRoom.candidates).filter((entry) => entry.classification === "attention")
      .length,
    0,
  );
});

test("action_required is unknown without required-check evidence and becomes manual only when required is observed", () => {
  const target = sha("dev");
  const snapshot = facts([
    repository("cloud-auth", {
      defaultBranch: "dev",
      workflows: [
        workflow("ci.yml", [
          run(40, "ci.yml", {
            branch: "dev",
            headSha: target,
            conclusion: "action_required",
          }),
        ]),
      ],
    }),
  ]);

  const unknown = qualifyGitHubGates(snapshot);
  const cloudAuth = unknown.repositories[0];
  assert.equal(cloudAuth.gate.outcome, "action_required");
  assert.equal(cloudAuth.gate.requiredByGithub, "unknown");
  const unknownCandidate = gateCandidates(cloudAuth.candidates).find((entry) =>
    entry.id.endsWith(":candidate-action_required"),
  );
  assert.equal(unknownCandidate?.classification, "unknown");
  assert.equal(
    gateCandidates(cloudAuth.candidates).filter((entry) => entry.classification === "attention")
      .length,
    0,
  );

  const observed = qualifyGitHubGates(snapshot, {
    requiredChecks: [
      {
        repository: "uichat-mira/cloud-auth",
        branch: "dev",
        workflowFiles: ["ci.yml"],
        source: "fixture-protection",
        observedAt: "2026-11-20T10:00:00Z",
      },
    ],
  });
  assert.equal(observed.repositories[0].gate.requiredByGithub, "observed");
  assert.equal(observed.requiredCheckEvidence, "supplied");
  const required = gateCandidates(observed.repositories[0].candidates).find((entry) =>
    entry.id.endsWith(":required-action"),
  );
  assert.equal(required?.classification, "attention");
  assert.equal(required?.priority, "P1");
  assert.match(required?.nextStep ?? "", /approval/i);
});

test("required evidence makes a target failure actionable while neutral/cancelled stays non-decisive", () => {
  const target = sha("pass");
  const snapshot = facts([
    repository("cloud-auth", {
      defaultBranch: "dev",
      workflows: [
        workflow("ci.yml", [
          run(50, "ci.yml", {
            branch: "dev",
            headSha: sha("dev"),
            conclusion: "failure",
          }),
        ]),
      ],
    }),
    repository("mira-desktop", {
      branches: [
        branch("dev", sha("d")),
        branch("test", sha("t")),
        branch("prod", target),
      ],
      workflows: [
        workflow("build-desktop.yml", [
          run(51, "build-desktop.yml", {
            headSha: target,
            conclusion: "cancelled",
          }),
        ]),
      ],
    }),
  ]);

  const projected = qualifyGitHubGates(snapshot, {
    requiredChecks: [
      {
        repository: "uichat-mira/cloud-auth",
        branch: "dev",
        workflowFiles: ["ci.yml"],
        source: "fixture-protection",
        observedAt: "2026-11-20T10:00:00Z",
      },
    ],
  });

  const cloudAuth = projected.repositories.find((entry) => entry.repository.endsWith("cloud-auth"));
  assert.equal(cloudAuth?.gate.requiredByGithub, "observed");
  assert.equal(
    gateCandidates(cloudAuth?.candidates ?? []).some(
      (entry) => entry.classification === "attention" && entry.priority === "P1",
    ),
    true,
  );

  const desktop = projected.repositories.find((entry) => entry.repository.endsWith("mira-desktop"));
  assert.equal(desktop?.gate.outcome, "neutral");
  assert.equal(desktop?.gate.workflows[0].outcome, "cancelled");
  assert.equal(
    gateCandidates(desktop?.candidates ?? []).filter(
      (entry) => entry.classification === "attention",
    ).length,
    0,
  );
});

test("a truncated 5-Run window that misses the target SHA is unknown, never healthy", () => {
  const projected = qualifyGitHubGates(
    facts([
      repository("mira-mobile", {
        workflows: [
          workflow(
            "mobile-ci.yml",
            [1, 2, 3, 4, 5].map((number) =>
              run(60 + number, "mobile-ci.yml", {
                branch: "dev",
                headSha: sha(`dev-${number}`),
                conclusion: "success",
              }),
            ),
            { truncated: true },
          ),
        ],
      }),
    ]),
  );

  const mobile = projected.repositories[0];
  assert.equal(mobile.gate.effectiveBranch, "prod");
  assert.equal(mobile.gate.targetSha, sha("prod"));
  assert.equal(mobile.gate.outcome, "unknown");
  assert.notEqual(mobile.gate.outcome, "success");
  assert.equal(mobile.gate.coverage, "partial");
  assert.ok(mobile.gate.coverageReasons.some((reason) => /truncated at 5 Runs/i.test(reason)));
  const candidate = gateCandidates(mobile.candidates).find((entry) =>
    entry.id.endsWith(":coverage"),
  );
  assert.equal(candidate?.classification, "unknown");
  assert.match(candidate?.whyNow ?? "", /unknown, not healthy/i);
});

test("an unreadable workflow or an uncollected default branch is an explicit unknown", () => {
  const projected = qualifyGitHubGates(
    facts([
      repository("cloud-pi", {
        defaultBranch: "dev",
        branches: [
          branch("dev", sha("dev")),
          branch("test", sha("test")),
          branch("prod", sha("prod")),
        ],
        workflows: [workflow("validate.yml", [], { state: "inaccessible" })],
      }),
      repository("mira-desktop", {
        defaultBranch: "main",
        branches: [
          branch("dev", sha("dev")),
          branch("test", sha("test")),
          branch("prod", sha("prod")),
        ],
        workflows: [workflow("build-desktop.yml", [])],
      }),
    ]),
  );

  const cloudPi = projected.repositories.find((entry) => entry.repository.endsWith("cloud-pi"));
  assert.equal(cloudPi?.gate.coverage, "unknown");
  assert.equal(cloudPi?.gate.outcome, "unknown");
  assert.ok(cloudPi?.gate.coverageReasons.some((reason) => /not readable/i.test(reason)));

  const desktop = projected.repositories.find((entry) => entry.repository.endsWith("mira-desktop"));
  assert.equal(desktop?.gate.effectiveBranch, null);
  assert.equal(desktop?.gate.targetSha, null);
  assert.ok(
    gateCandidates(desktop?.candidates ?? []).some((entry) =>
      entry.id.endsWith(":target-unknown"),
    ),
  );
});

test("deploy workflow success stays unverified; only trusted production evidence verifies or escalates", () => {
  const target = sha("prod");
  const base = facts([
    repository("control-room", {
      workflows: [
        workflow("deploy.yml", [
          run(70, "deploy.yml", { headSha: target, conclusion: "success" }),
        ]),
      ],
    }),
  ]);

  const unverified = qualifyGitHubGates(base);
  const controlRoom = unverified.repositories[0];
  assert.equal(controlRoom.release.releaseStatus, "succeeded");
  assert.equal(controlRoom.release.production.status, "unverified");
  const unverifiedCandidate = releaseCandidates(controlRoom.candidates).find((entry) =>
    entry.id.endsWith(":production-unverified"),
  );
  assert.equal(unverifiedCandidate?.classification, "unknown");
  assert.equal(unverifiedCandidate?.priority, null);

  const verified = qualifyGitHubGates(base, {
    production: [
      {
        repository: "uichat-mira/control-room",
        observedSha: target,
        healthy: true,
        source: "fixture-public-health",
        observedAt: "2026-11-20T02:00:00Z",
        url: "https://control.test/api/v1/health",
      },
    ],
  });
  assert.equal(verified.repositories[0].release.production.status, "verified");
  assert.equal(
    releaseCandidates(verified.repositories[0].candidates).filter(
      (entry) => entry.classification === "attention",
    ).length,
    0,
  );

  const unhealthy = qualifyGitHubGates(base, {
    production: [
      {
        repository: "control-room",
        observedSha: target,
        healthy: false,
        source: "fixture-public-smoke",
        observedAt: "2026-11-20T02:00:00Z",
      },
    ],
  });
  const incident = releaseCandidates(unhealthy.repositories[0].candidates).find((entry) =>
    entry.id.endsWith(":production-unhealthy"),
  );
  assert.equal(incident?.classification, "attention");
  assert.equal(incident?.priority, "P0");
  assert.match(incident?.whyNow ?? "", /confirmed production impact/i);
});

test("production SHA mismatch is a release claim gap, not a guessed P0", () => {
  const target = sha("prod");
  const projected = qualifyGitHubGates(
    facts([
      repository("control-room", {
        workflows: [
          workflow("deploy.yml", [
            run(80, "deploy.yml", { headSha: target, conclusion: "success" }),
          ]),
        ],
      }),
    ]),
    {
      production: [
        {
          repository: "control-room",
          observedSha: sha("older"),
          healthy: true,
          source: "fixture-runtime",
          observedAt: "2026-11-20T02:00:00Z",
        },
      ],
    },
  );

  const production = projected.repositories[0].release.production;
  assert.equal(production.status, "mismatch");
  const mismatch = releaseCandidates(projected.repositories[0].candidates).find((entry) =>
    entry.id.endsWith(":production-mismatch"),
  );
  assert.equal(mismatch?.classification, "attention");
  assert.equal(mismatch?.priority, "P1");
  assert.equal(
    releaseCandidates(projected.repositories[0].candidates).some(
      (entry) => entry.priority === "P0",
    ),
    false,
  );
});

test("a failed release attempt stays attention until the same target recovers", () => {
  const target = sha("prod");
  const failed = qualifyGitHubGates(
    facts([
      repository("mira-cloud", {
        defaultBranch: "dev",
        workflows: [
          workflow("tencent-prod-deploy.yml", [
            run(90, "tencent-prod-deploy.yml", {
              headSha: target,
              event: "workflow_dispatch",
              conclusion: "failure",
              updatedAt: "2026-11-20T02:00:00Z",
            }),
          ]),
          workflow("mira-gate.yml", [
            run(91, "mira-gate.yml", {
              branch: "dev",
              headSha: sha("dev"),
              conclusion: "success",
              updatedAt: "2026-11-20T03:00:00Z",
            }),
          ]),
        ],
      }),
    ]),
  );

  const cloud = failed.repositories[0];
  assert.equal(cloud.release.releaseStatus, "failed");
  const releaseFailure = releaseCandidates(cloud.candidates).find((entry) =>
    entry.id.endsWith(":release-failed"),
  );
  assert.equal(releaseFailure?.classification, "attention");
  assert.equal(releaseFailure?.priority, "P1");
  // An unrelated Gate success on a different SHA does not clear it.
  assert.equal(cloud.release.releaseStatus, "failed");

  const recovered = qualifyGitHubGates(
    facts([
      repository("mira-cloud", {
        defaultBranch: "dev",
        workflows: [
          workflow("tencent-prod-deploy.yml", [
            run(90, "tencent-prod-deploy.yml", {
              headSha: target,
              event: "workflow_dispatch",
              attempt: 1,
              conclusion: "failure",
              updatedAt: "2026-11-20T02:00:00Z",
            }),
            run(90, "tencent-prod-deploy.yml", {
              headSha: target,
              event: "workflow_dispatch",
              attempt: 2,
              conclusion: "success",
              updatedAt: "2026-11-20T02:10:00Z",
            }),
          ]),
        ],
      }),
    ]),
  );

  const cloudRecovered = recovered.repositories[0];
  assert.equal(cloudRecovered.release.releaseStatus, "succeeded");
  assert.equal(cloudRecovered.release.releaseRecovered, true);
  assert.equal(
    releaseCandidates(cloudRecovered.candidates).filter(
      (entry) => entry.classification === "attention",
    ).length,
    0,
  );
});

test("later verified production evidence supersedes an older failed release attempt", () => {
  const target = sha("prod");
  const snapshot = facts([
    repository("control-room", {
      workflows: [
        workflow("deploy.yml", [
          run(95, "deploy.yml", {
            headSha: target,
            conclusion: "failure",
            updatedAt: "2026-11-20T01:05:00Z",
          }),
        ]),
      ],
    }),
  ]);
  const projected = qualifyGitHubGates(snapshot, {
    production: [
      {
        repository: "control-room",
        observedSha: target,
        healthy: true,
        source: "fixture-public-smoke",
        observedAt: "2026-11-20T02:00:00Z",
      },
    ],
  });

  const controlRoom = projected.repositories[0];
  assert.equal(controlRoom.release.production.status, "verified");
  assert.equal(controlRoom.release.releaseStatus, "failed");
  const superseded = releaseCandidates(controlRoom.candidates).find((entry) =>
    entry.id.endsWith(":release-superseded"),
  );
  assert.equal(superseded?.classification, "observation");
  assert.equal(
    controlRoom.candidates.filter((entry) => entry.classification === "attention").length,
    0,
  );
  // The same failed release Run is not duplicated as a Gate candidate.
  assert.equal(
    gateCandidates(controlRoom.candidates).some((entry) => entry.runId === 95),
    false,
  );

  const olderProduction = qualifyGitHubGates(snapshot, {
    production: [
      {
        repository: "control-room",
        observedSha: target,
        healthy: true,
        source: "fixture-public-smoke",
        observedAt: "2026-11-20T00:30:00Z",
      },
    ],
  });
  assert.equal(
    releaseCandidates(olderProduction.repositories[0].candidates).some(
      (entry) => entry.id.endsWith(":release-failed") && entry.classification === "attention",
    ),
    true,
  );
});

test("T2: real Actions payload shapes feed the qualification without promoting skipped/comment Runs", async () => {
  network.use(
    http.get("https://api.github.com/orgs/uichat-mira/repos", () =>
      HttpResponse.json([
        {
          name: "control-room",
          full_name: "uichat-mira/control-room",
          visibility: "public",
          default_branch: "prod",
          archived: false,
        },
      ]),
    ),
    http.get("https://api.github.com/repos/uichat-mira/:repo/branches/:branch", ({ params }) =>
      HttpResponse.json({
        name: params.branch,
        commit: { sha: hexSha(`live-${String(params.branch)}`) },
        protected: params.branch === "prod",
      }),
    ),
    http.get(
      "https://api.github.com/repos/uichat-mira/control-room/actions/workflows/deploy.yml/runs",
      () =>
        HttpResponse.json({
          total_count: 3,
          workflow_runs: [
            {
              id: 500,
              name: "Control Room CI / Deploy",
              path: ".github/workflows/deploy.yml",
              event: "push",
              status: "completed",
              conclusion: "failure",
              head_branch: "prod",
              head_sha: hexSha("live-prod"),
              run_attempt: 1,
              html_url: "https://github.com/uichat-mira/control-room/actions/runs/500",
              created_at: "2026-11-20T01:00:00Z",
              updated_at: "2026-11-20T01:05:00Z",
            },
            {
              id: 500,
              name: "Control Room CI / Deploy",
              path: ".github/workflows/deploy.yml",
              event: "push",
              status: "completed",
              conclusion: "success",
              head_branch: "prod",
              head_sha: hexSha("live-prod"),
              run_attempt: 2,
              html_url: "https://github.com/uichat-mira/control-room/actions/runs/500",
              created_at: "2026-11-20T01:00:00Z",
              updated_at: "2026-11-20T01:10:00Z",
            },
            {
              id: 501,
              name: "Control Room CI / Deploy",
              path: ".github/workflows/deploy.yml",
              event: "issue_comment",
              status: "completed",
              conclusion: "skipped",
              head_branch: "prod",
              head_sha: hexSha("live-prod"),
              run_attempt: 1,
              html_url: "https://github.com/uichat-mira/control-room/actions/runs/501",
              created_at: "2026-11-20T01:20:00Z",
              updated_at: "2026-11-20T01:21:00Z",
            },
          ],
        }),
    ),
    http.get(
      "https://api.github.com/repos/uichat-mira/:repo/actions/workflows/:file/runs",
      () => HttpResponse.json({ total_count: 0, workflow_runs: [] }),
    ),
    http.get("https://api.github.com/repos/uichat-mira/:repo/pulls", () => HttpResponse.json([])),
  );

  const snapshot = await collectGitHubFacts(
    { GITHUB_READ_TOKEN: token },
    { now: Date.parse("2026-11-20T10:00:00Z") },
  );
  const projected = qualifyGitHubGates(snapshot);
  const controlRoom = projected.repositories.find((entry) =>
    entry.repository.endsWith("control-room"),
  );

  assert.equal(snapshot.budget.usedRequests, 36);
  assert.equal(controlRoom?.gate.workflows[0].recovered, true);
  assert.equal(controlRoom?.gate.workflows[0].outcome, "success");
  assert.equal(controlRoom?.gate.workflows[0].applicableRun?.attempt, 2);
  assert.equal(controlRoom?.gate.workflows[0].latestRun?.event, "issue_comment");
  assert.equal(controlRoom?.release.production.status, "unverified");
  assert.ok(
    projected.repositories.every((entry) => entry.gate.requiredByGithub === "unknown"),
  );
});
