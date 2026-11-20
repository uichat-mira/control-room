# GitHub 单 PR 合并阻塞资格 (#107)

> Status: OPS-036 implementation slice. Read-only, public-safe projection of one
> current PR. It is not a second Issue/PR ledger, not a required-check
> configuration store, and not a merge/review/notification mechanism.

## Scope

`src/github-pr-facts.ts` performs one bounded, on-demand PR detail read.
`src/github-pr-qualification.ts` turns those facts into one stable PR object and
a `needs_attention / in_progress / observed / unknown` status. The public route is:

```text
GET /api/v1/github/pull?repository=uichat-mira/mira-desktop&number=404
```

Only the six OPS-033/OPS-034 pilot repositories are accepted. Other repositories
return `404 unsupported_repository` without an upstream read. The projection is
read-only: it never reviews, merges, labels, comments, notifies, closes, or
mutates GitHub/Project state.

Homepage/Overview/Factory TV/MCP behavior is unchanged. A future homepage may use
this route lazily for a PR it already discovered, but it must not fan out across
every repository and PR on every page view.

## Request budget and cache

One PR projection is exactly three explicit reads:

```text
1 PR detail           GET /repos/{owner}/{repo}/pulls/{number}
1 review list         GET /repos/{owner}/{repo}/pulls/{number}/reviews?per_page=30
1 head workflow-run list GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}&per_page=30
```

Measured normal cost is **3 requests**, with a hard cap of **5** (one bounded
rate-limit retry max), `concurrency: 2`, `timeoutMs: 8000`, and at most one
`Retry-After` retry inside a 2-second window. The Worker caches one projection
per repository/number/auth state for 60 seconds; concurrent visitors in one
isolate share one in-flight read; if the Workers cache API is unavailable, an
isolate-local fallback absorbs repeat reads for the same window.

The PR route never inherits the six-repository homepage round and never performs
a repository-wide Reviews/Checks fan-out. A caller that needs two PRs makes two
explicit single-PR requests; there is no hidden multiplier.

GitHub `403`/`429`, missing permission, `404`, timeout, truncation and cache
misses stay explicit. They are not converted into zero blockers, zero checks, or
a precise organization-wide todo count.

## Identity and applicable facts

Each result carries a stable primary object ID:

```text
pr:{repository}#{number}
```

The current identity is read from GitHub, not inferred from age or labels:

- `state`, `merged`, `draft`;
- `base.ref` and the exact `head.sha`;
- `mergeable` and `mergeable_state`;
- review `user.login`, `user.type`, `author_association`, `state`, `commit_id`,
  `submitted_at`, `id`;
- head workflow identity (`path`/`name`), event, status, conclusion, attempt,
  branch, SHA and URL.

### Mergeability

| GitHub value | Projection |
| --- | --- |
| `mergeable: false` | confirmed conflict → attention candidate |
| `mergeable: true` | no conflict proven |
| `mergeable: null` | “still computing / undecidable” → `unknown`, **not** a conflict |

`mergeable_state` is evidence, not a verdict. `dirty` accompanies a confirmed
conflict; `unknown` accompanies `mergeable=null`.

### Reviews and authority

Reviews are reduced to each reviewer's latest substantive decision. `COMMENTED`
and `PENDING` do not clear an earlier `CHANGES_REQUESTED`; `APPROVED` and
`DISMISSED` do. Bot reviews are ignored for authority and attention. A human
review is maintainer/reviewer authority only when `author_association` is
`OWNER`, `MEMBER`, or `COLLABORATOR`.

A `CHANGES_REQUESTED` becomes attention only when all of these hold:

1. its `commit_id` equals the current `head.sha`;
2. the reviewer has maintainer/reviewer authority;
3. the PR is open, not Draft, and has no active sourced Hold.

If the review's `commit_id` differs from the current head, the result is
`unknown`, not “still blocking” and not “cleared”. GitHub's stale-review
dismissal setting is unreadable in this boundary, so the code does not guess.

### Required checks / recovered Gate

OPS-036 does not reimplement required-check rules. It reuses OPS-035's
`assessWorkflowsForSha` and `requiredWorkflowFilesFor` functions with the same
`RequiredCheckEvidence` input:

- a failed/action-required workflow is attention only when that evidence marks
  the workflow required for the PR base branch;
- without that evidence, a workflow failure is `unknown` and is not promoted to
  a proven required gate;
- a same-SHA newer successful attempt is `recovered` and the old failure stays
  archive evidence;
- a running required workflow is `in_progress`, not human attention;
- required-check evidence is not supplied by the public route today, so
  `checks.requiredByGithub` is `unknown` in public responses.

Only GitHub Actions workflow runs are read. Required checks supplied by other
GitHub Apps or legacy commit statuses are outside this bounded read and are
reported as a coverage gap, not as passed.

### Draft, Hold and dependency

- Draft is intentional work-in-progress. A Draft PR stays `observed` even when a
  real conflict or current change request exists; those raw signals are retained
  with `suppressedBy: "draft"`, but they are not a maintainer todo.
- An explicit Hold/dependency is applied only when a trusted caller supplies
  `PullRequestHoldEvidence` with a repository, PR number, source, observation
  time and reason. PR descriptions, comments, labels and ordinary AI review
  strings are never parsed as Hold authority.
- Hold evidence scoped to a different head SHA is `unknown` (`hold_stale`), not
  silently applied to new code.
- No hold evidence means “no trusted hold evidence supplied”, not “no hold
  exists”. The public route states this explicitly.

## Status semantics

| Status | Meaning | Human todo? |
| --- | --- | --- |
| `needs_attention` | confirmed conflict, current-head maintainer `CHANGES_REQUESTED`, or proven required-check failure/action | yes |
| `in_progress` | pending required check, dependency wait, or other active work | no |
| `observed` | open with no proven blocker, Draft, explicit Hold, merged/closed, recovered Gate | no |
| `unknown` | mergeability not computed, stale/unverifiable review, unreadable checks/reviews, permission/rate-limit gap | not a precise todo |

Every result carries `who`, `what`, `whyNow`, `nextStep`, `evidence`,
`observedAt`, `exitCondition`, the stable PR ID, and explicit `review`, `checks`,
`hold`, `signals`, `coverage` and `warnings` blocks.

## Live read-only observations (2026-11-20T09:55–10:00Z, anonymous public API)

These are **point-in-time observations**, not permanent conclusions. The code and
this document must be re-read against current GitHub state before use.

| PR | Current facts at observation | Projection |
| --- | --- | --- |
| [mira-desktop #404](https://github.com/uichat-mira/mira-desktop/pull/404) | open, **Draft**, `head=15512daae3e9c022abbb7b7a1fa4617f0cf4b529`, `mergeable=false`, `mergeable_state=dirty`; review [#5581190588](https://github.com/uichat-mira/mira-desktop/pull/404#pullrequestreview-5581190588) is `CHANGES_REQUESTED` by a `MEMBER` on that exact head | `observed` (Draft). It is the strongest **raw** blocker candidate — real conflict plus a current-head maintainer change request — but Draft suppresses both signals. If marked ready without resolving them, the same head would become `needs_attention` P1. |
| [mira-desktop #464](https://github.com/uichat-mira/mira-desktop/pull/464) | open, **Draft**, `head=86aae82bb125894ce07ebea8af6a83c81bee1e3f`, `mergeable=false`, `mergeable_state=dirty`; title/body describe a batch hold | `observed` (Draft). The title/body string is not used as Hold authority; Draft alone is enough to keep it out of attention. |
| [mira-desktop #279](https://github.com/uichat-mira/mira-desktop/pull/279) | open, **not Draft**, `head=06d4b7ab4e4566c737146e17d33bd34d2b7db513`, `mergeable=null`, `mergeable_state=unknown`; only a bot review | `unknown`. `mergeable=null` is not a conflict and is not counted as a todo. |
| [cloud-auth #28](https://github.com/uichat-mira/cloud-auth/pull/28) | open, **not Draft**, `head=d11a03639babdf130b3fcb0d0d71bdf2b43c9e67`, `mergeable=null`, `mergeable_state=unknown`; only a bot review | `unknown`, not a conflict. |
| [cloud-auth #163](https://github.com/uichat-mira/cloud-auth/pull/163) | at 09:43Z: open non-Draft with checks in progress; at 09:55Z: `merged=true`, `state=closed`, same head `5e2c0269accbf38091d5b9567873e3c07e5d388c` | `observed` after re-read. The earlier in-progress observation was superseded; stale status is not retained as a current warning. |

At that observation time there was **no open non-Draft pilot PR with a provable
human-action blocker**. The result is not “everything is green”: #404/#464 have
real conflicts but are Draft; #279/#28 have uncomputed mergeability; required
GitHub checks remain unknown. The correct output is the explicit per-PR state
above, not an invented precise todo total.

## Verification

- `tests/github-pr-facts.test.ts` — real PR/review/workflow payload shapes,
  exactly three bounded reads, null mergeability, pagination truncation, 403/429,
  unreadable detail, pilot allowlist validation, token non-leakage.
- `tests/github-pr-qualification.test.ts` — Draft/Hold/dependency suppression,
  confirmed conflict, `mergeable=null`, current/stale/cleared CHANGES_REQUESTED,
  bot/non-maintainer authority, required-check failure with/without OPS-035
  evidence, same-SHA recovery, running checks, merged/closed, 403/429 gaps.
- `tests/worker-github-pr-route.test.ts` — GET route validation, 3/5 request
  budget headers, shared cache hit, simultaneous singleflight, cache outage
  fallback, 403/429 unknown propagation, no token leakage.
- `npm run check` includes the new `test:github-pr` entry plus typecheck and the
  production build.

## Rollback

Remove `/api/v1/github/pull`, `src/github-pr-facts.ts`,
`src/github-pr-qualification.ts`, `src/github-pr-route.ts`, their tests and the
`test:github-pr` script/check entry, plus the OpenAPI/README/doc additions. The
OPS-034/OPS-035 collectors, Overview, Engineering, Factory TV and MCP surfaces
remain unchanged.
