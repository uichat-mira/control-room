# GitHub Gate / release qualification (#106)

> Status: OPS-035 implementation slice. Read-only, public-safe projection derived
> from the OPS-034 bounded fact snapshot. It is not a second Issue/PR/release
> ledger, not a required-check configuration store, and not a production health
> certification.

## Scope

`src/github-gate-facts.ts` turns `GET /api/v1/github/facts` facts into:

- `GET /api/v1/github/gates` — per-repository Gate eligibility, release attempt,
  production evidence state, and action-oriented candidates.

The projection makes **zero additional GitHub requests**. The route calls the
same `loadGitHubFactsSnapshot` used by `/api/v1/github/facts`, so it inherits the
same 36-request round, 40-request cap, 4-way concurrency, isolate-local
singleflight, edge cache, ETag reuse, and unknown/truncated semantics.

## Gate applicability

A Run applies to the current target only when all of these match:

- repository workflow identity from the OPS-033/OPS-034 pilot allowlist;
- effective target branch (the observed repository default branch, which must be
  one of the collected `dev` / `test` / `prod` channels);
- current branch `head_sha`;
- workflow `path` identity;
- `run_attempt` (ordered within the same Run ID; a newer Run's attempt 1
  supersedes an older Run's attempt 2 when its updated time is later).

`issue_comment` Runs are retained as raw archive evidence but are **never** part
of the target Gate. This is the same signal that made `per_page=1` misread an
External Worker dispatch/skip as CI.

Per-workflow outcomes stay distinct:

| Outcome | Meaning |
| --- | --- |
| `success` | latest applicable attempt succeeded |
| `failure` | latest applicable attempt failed/timed out/startup failed |
| `action_required` | latest applicable attempt needs approval/manual action |
| `running` | queued or in progress |
| `neutral`, `cancelled`, `skipped` | completed without a decisive pass/fail |
| `unknown` | no readable applicable attempt, or a truncated window |

An earlier failed attempt followed by a newer success **on the same branch and
SHA** is `recovered`; the failed Run stays archive evidence. A success on another
branch, another SHA, or another workflow does not clear the target failure.

### Required-check truth boundary

GitHub branch-protection/ruleset required checks are not readable with the
current public read scope. The live probe below returned `401`, and OPS-033
recorded `403` for the six repositories. Therefore:

- `required_by_github` is `unknown` by default;
- `required_by_workflow` is `unknown` (the workflow identity is a candidate, not
  a proven requirement);
- a failed/action-required candidate outcome is classified `unknown`, not a
  confirmed blockage and not P0/P1.

`qualifyGitHubGates(snapshot, { requiredChecks })` accepts explicit trusted
evidence for a future authorized read boundary. Only when that evidence names a
branch's required workflow files does the projection produce a `P1` attention
candidate for a required failure/action. The route does not supply this evidence
today, so it cannot invent a required set.

## Release versus production

These are separate facts:

- `releaseStatus` comes from an applicable release-entry workflow Run on
  `prod@<target SHA>` (OPS-033 identities: Mobile CI, Cloud Auth deploy,
  Mira Cloud Tencent deploy, Control Room deploy). `null` means the formal
  release entry (for example a stable tag workflow) is outside the bounded
  slice, so release status is `unknown`.
- `production` requires explicit trusted evidence with an observed production
  SHA and, for `verified`, a healthy smoke result for that exact SHA.

A deploy workflow `success` therefore remains
`production.status = unverified`. A Release/tag, prod ref, or deploy workflow
success is never treated as production proof.

Candidate priority:

- `P0` only when supplied evidence has a matching production SHA **and** an
  unhealthy smoke result;
- `P1` for a failed release attempt, a production-SHA mismatch, or a proven
  required-check failure/action;
- `P2` for explicit release approval (`action_required`);
- `P3` for a required workflow whose applicable attempt is unavailable;
- coverage-only unknowns keep `priority: null`.

A later verified production observation supersedes an older release failure. A
failed older Run does not permanently represent the current production state.

## Candidates and coverage

Every candidate carries `who`, `what`, `whyNow`, `nextStep`, `evidence`,
`observedAt`, `exitCondition`, plus repository/branch/SHA/workflow/Run identity.
Classifications are `attention`, `in_progress`, `unknown`, and `observation`.
The same release Run is not emitted twice as both a Gate and deployment item.

Coverage stays explicit:

- a 404/default-branch gap is `unknown`, not healthy;
- an inaccessible workflow is `unknown`;
- a 5-Run window that does not contain the target SHA is `unknown/truncated`,
  even when every returned Run is green;
- a repository outside the six-repository allowlist is unknown, not healthy.

## Live, traceable GitHub case (2026-11-20 probe, anonymous public reads)

Observed facts (independent of this repository's deployment):

- `uichat-mira/control-room` default branch is `prod`; prod ref
  `f2a89a5ae42a2d6bbc76025dcf900ead3317b38e`; branch metadata
  `protected: false`.
- [prod deploy Run #44655515292](https://github.com/uichat-mira/control-room/actions/runs/44655515292)
  is `push prod@f2a89a5`, completed `success`, attempt 1.
- The deploy workflow's latest 5 Runs at probe time were
  [#44700491025](https://github.com/uichat-mira/control-room/actions/runs/44700491025)
  (push `dev@a1642f1`, success) and four pull-request/dev Runs. **None covered
  the current prod SHA.**
- The newest Runs on `branch=prod` were `workflow_run` specialty workflows such
  as AI Review Package Probe / Publisher Secret Sync / Gateway Smoke, all
  `skipped` on prod@f2a89a5. A naive `per_page=1` default-branch read sees
  `skipped`, not the prod deploy Run.
- Public `https://control.mira.tomz.io/api/v1/health` returned HTTP 200 with
  `commit: f2a89a5ae42a2d6bbc76025dcf900ead3317b38e` at probe time.
- `GET /repos/uichat-mira/control-room/branches/prod/protection` returned HTTP
  401 without credentials; required checks/search results are unreadable.
- Running `collectGitHubFacts` + `qualifyGitHubGates` live used **36/40**
  anonymous requests and produced `facts.status: partial`,
  `required_by_github: unknown`, and for control-room:
  `gate.outcome: unknown`, `gate.coverage: partial`, `release.status: unknown`,
  `production.status: unverified`, with only two `unknown` candidates
  (`gate:...:coverage`, `release:...:release-coverage`) and no attention/P0.
  The deploy workflow's applicable Run was `null` because the 5-Run window was
  explicitly `truncated`; the code did not infer "missing" or "healthy".

Limited inference:

- The bounded deploy workflow window is **truncated** with respect to the
  current prod target. OPS-035 must return `unknown`, not "green" or "missing".
- A latest-Run-only summary can report a skipped specialty workflow or an
  unrelated dev Run while saying nothing about the current prod Gate.
- The public health commit identity matches the prod ref, but this is process
  health/version evidence, not the workflow's production smoke or required-check
  configuration.

Unresolved proof:

- Actual GitHub required status checks for `prod` (401/403/unknown).
- The production smoke result for #44655515292 and current runtime behavior
  beyond the health endpoint.
- Whether the release contract requires any additional workflow outside the
  OPS-034 bounded slice.

## Verification

- `tests/github-gate-facts.test.ts` covers same-SHA rerun recovery, old SHA,
  unrelated workflow success, `issue_comment` skipped, `action_required` with and
  without required evidence, neutral/cancelled, truncated window, unreadable
  workflow/default-branch gap, deploy success without production proof,
  production mismatch, unhealthy P0, release failure/recovery, and a T2 real
  Actions payload shape via MSW.
- `tests/worker-github-facts-route.test.ts` covers the read-only handler reusing
  one cached 36-request round with no extra upstream calls or token leakage.
- `npm run check` includes `npm run test:github-gates`, typecheck, the other
  bounded fact tests, and the production build.

## Rollback

The change is additive plus a narration fix:

- remove `/api/v1/github/gates`, `src/github-gate-facts.ts`, its test and check
  entry, and the OpenAPI/README/doc additions to roll back the projection;
- `worker.ts` no longer degrades the organization summary from a raw latest Run
  failure; `overview-facts.ts` no longer promotes it to an attention item. The
  raw `latestWorkflow` record stays in `/api/v1/summary`, `/api/v1/builds`, the
  Engineering view, and the Wall.
