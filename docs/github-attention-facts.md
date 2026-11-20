# GitHub attention pilot facts (#105)

> Status: implementation slice for OPS-034. This document describes a raw-fact
> collector, not attention eligibility. OPS-035 Gate/Release qualification now
> derives from this snapshot at `GET /api/v1/github/gates` with zero additional
> GitHub reads (see [`github-attention-gate-status.md`](github-attention-gate-status.md));
> PR / Worker judgment stays with OPS-036–037, and the Overview redesign stays
> with OPS-038.

## Scope

`src/github-facts.ts` collects public-safe GitHub facts for the six OPS-033
pilot repositories:

| Repository | Channels read | Explicit workflows read |
| --- | --- | --- |
| `mira-desktop` | dev, test, prod | Build Desktop Apps, Branch Policy |
| `mira-mobile` | dev, test, prod | Mobile CI, R2 Release Truth |
| `cloud-auth` | dev, test, prod | Cloud Auth CI, Deploy Cloud Auth Production |
| `mira-cloud` | dev, test, prod | Mira Cloud Gate, Tencent Production Deploy |
| `cloud-pi` | dev, test, prod | Validate, Validate Cloud Pi Container |
| `control-room` | dev, test, prod | Control Room CI / Deploy |

For each repository the collector reads:

- branch refs for the channels (current SHA, protection boolean when GitHub
  reports it);
- recent runs for each explicit workflow identity (`per_page=5`, no
  `per_page=1` shortcut; runs keep workflow/event/branch/head SHA/attempt);
- open pull requests (`per_page=5`, raw candidate index only).

It does not classify required checks, Gate outcomes, Draft/hold semantics,
release provenance, or Worker escalation. Those decisions need repository-owned
evidence and are deliberately absent. The workflow identities are a bounded
slice of the OPS-033 matrix, not every path-triggered workflow in each
repository; adding more requires recalculating the round budget, and an
unlisted workflow is not implied healthy.

## Output semantics

The response is `GET /api/v1/github/facts` (public, read-only, CORS GET). Each
repository carries branch/workflow/PR facts plus a `coverage` block. Each query
carries:

- `status`: `ok`, `not_modified`, `missing`, `inaccessible`, `rate_limited`,
  `timeout`, `unavailable`, or `skipped`;
- `observedAt` and `fetchedAt` (a 304 keeps the older `observedAt`);
- `cache`: `upstream`, `not_modified`, or `none`;
- `truncated`, `retryAfterSeconds`, `skipReason`, and a public-safe error string.

Key distinctions:

- A verified empty list (`ok` with `items: []`) means zero open PRs were
  observed. An unavailable PR query also has `items: []`, but its `state` is
  `unavailable`; callers must not read that as zero.
- A 404 branch/ref is `missing` at observation time. It is not proof the branch
  never existed and it is not "healthy".
- A 403 without exhausted rate-limit headers is `inaccessible` (read scope).
  A 429, or a 403 with `x-ratelimit-remaining: 0`, is `rate_limited`.
- `budget_exhausted` and halt-after-rate-limit are `skipped` with
  `skipReason`; remaining targets stay unknown.
- `partial` is a coverage statement, not a health verdict. A bounded candidate
  window (`5` recent runs/PRs), a missing target branch, a failed query, or a
  truncation can make the snapshot `partial` even when every attempted request
  succeeded.
- `authentication` reports only `authenticated` / `anonymous` and whether the
  server-side credential is present. A missing credential is explicit; the
  token value is never serialized.
- Repositories outside the six-repository allowlist are counted but not
  assessed. They are not healthy by omission.
- `defaultBranch` is the branch observed in the current organization listing;
  it is `null` when the listing is unavailable. The OPS-033 matrix is only an
  allowlist hint, not a substitute for the observed value.

## Bounds and measured cost

One deterministic round is:

```text
1 repository listing
+ 6 repositories x 3 channel refs = 18
+ 11 explicit workflow-run reads
+ 6 open-PR lists
= 36 REST requests
```

The allocator enforces `maxRequests: 40` per round, `concurrency: 4`,
`timeoutMs: 8000`, and at most one `429`/rate-limit retry when `Retry-After`
is within a 2-second window. Callers may narrow, not widen, these caps. Exhausting the round budget stops incremental
collection; it never retries forever and never turns the gap into zero.

The Worker caches one shared snapshot for both visitors (auth/anonymous cache
keys are separate) for `refreshSeconds: 3600`. Concurrent cold-cache
requests within the same isolate share a single in-flight collection, with a
24-hour stale copy used
only as a conditional-request baseline. Re-visits do not scan GitHub again. If
the Workers cache API itself is unavailable, an isolate-local snapshot absorbs
repeated reads for the same window rather than scanning per visitor.

### Measured probe (implementation runner, 2026-11-20)

One anonymous read-only probe from the implementation runner completed in
3.9 s with exactly **36 used / 40 max** requests and no retries. GitHub returned
`x-ratelimit-remaining: 24` for a 60-request anonymous window. All 18 branch
refs, 11 explicit workflow histories, and 6 open-PR lists were readable; every
workflow history and the desktop PR list were explicitly truncated by the
bounded candidate window, so the snapshot was `partial` rather than claiming
full history. `cloud-auth/test` was observable at that moment (same SHA as
dev/prod), which is why a missing 404 is never presented as a permanent fact.

This probe is a runner measurement, not a production or global measurement. It
also shows that 36 anonymous requests consume most of GitHub's 60/hour
unauthenticated allowance; an authenticated server-side token remains the
expected production configuration.

**Unproven global bound:** `≤ 60 REST/hour` remains a design target. The
collector reports the measured per-round count and `globalBoundProven: false`.
Cloudflare edge cache is per cache location/isolate; multiple isolates, cache
misses, or separate auth states can each refresh, so the code does not claim a
global hourly hard limit. The singleflight guarantee is isolate-local; it
is not a globally distributed lock. `304` responses are counted and keep their older
`observedAt`; ETag conditional requests reduce payload and normally do not
consume GitHub's REST primary quota, but they still consume Worker subrequests.

## Reuse

```ts
import { collectGitHubFacts, PILOT_REPOSITORIES } from "./github-facts";

const snapshot = await collectGitHubFacts(env, {
  previous,          // optional stale snapshot for ETag / 304 reuse
  limits: {          // optional, validated and hard-capped
    maxRequests: 40,
    concurrency: 4,
  },
});
```

The module only uses the existing read-only `GitHubEnv` token and public REST
reads. It never serializes credentials, private repositories, server
credentials, or private security data. It does not create a second
Issue/PR/release ledger.

## Compatibility and rollback

The route, OpenAPI entry, and README note are additive. `/api/v1/summary`,
`/api/v1/governance`, `/api/v1/factory/*`, `/api/v1/builds`, the Overview
attention logic, Factory TV lifecycle, and MCP tools are unchanged. To roll
back, remove the route/OpenAPI/README additions and `src/github-facts.ts` (and
its test/check entry); the existing read model is untouched.
