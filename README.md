# Mira Control Room

Mira organization observability cockpit, public read API, and remote MCP surface.

Control Room is a **read-only projection** of existing sources of truth. It must not become a second task ledger, release ledger, deployment state store, or MCP-specific data store.

Canonical production domain: `https://control.mira.tomz.io`

## V0.2

- React + Vite cockpit UI
- Shallow domain navigation for Overview, Engineering, Runtime, and Governance
- Cloudflare Worker API + Workers Static Assets
- Live GitHub organization repository data
- Latest default-branch GitHub Actions run per repository (raw archive fact, not Gate health)
- Latest GitHub Release per repository
- Live HTTP probes for Mira Website, Relay, and Control Room
- Cloudflare Workers / Pages deployment read model
- Cloudflare Workers 24h requests/errors analytics
- Public repository governance and public GitHub Projects projection
- Versioned Public API v1 + OpenAPI 3.1 contract
- Remote read-only MCP endpoint
- Human-readable API/MCP docs at `/docs`
- Cache-friendly GitHub Organization overview SVG at `/embed/github-overview.svg`
- `/wall` large-screen mode with 60-second refresh

GitHub, Cloudflare, governance, and runtime health are intentionally separate read paths. Focused Public API, MCP, and domain UI reads do not trigger unrelated service probes. Overview is an entrance dashboard: it shows a small set of qualified, bounded cross-domain signals and links to the actual business areas. Detailed PR/Worker evidence workflows live at /attention; the homepage does not duplicate those inspections.

## Public API v1

Control Room exposes a versioned, read-only, public-safe API. It only projects public GitHub resources and Mira-named Cloudflare resources; runtime credentials are never returned.

- `GET /api/v1` — API discovery
- `GET /api/v1/health` — Control Room process health
- `GET /api/v1/summary` — organization operational snapshot
- `GET /api/v1/repos` — public repositories
- `GET /api/v1/builds` — latest default-branch builds and releases
- `GET /api/v1/services` — HTTP service probes
- `GET /api/v1/deployments` — Cloudflare Workers / Pages deployments
- `GET /api/v1/analytics` — Workers last-24h requests and errors
- `GET /api/v1/governance` — Issues / PR / branch protection / rulesets / Projects
- `GET /api/v1/projects` — public GitHub Projects
- `GET /api/v1/github/facts` — bounded six-repository raw branch / workflow-run / open-PR facts with explicit coverage, freshness, rate-limit and per-round request-budget evidence
- `GET /api/v1/github/gates` — evidence-anchored Gate / release / production-version qualification derived from the same cached facts round with no extra GitHub reads
- `GET /api/v1/github/pull?repository=...&number=...` — on-demand single-PR merge-blocker qualification with Draft/Hold suppression, current-head review checks, real mergeability and bounded head workflow runs
- `GET /api/v1/factory/runs` — bounded, cached real External Worker discovery across public organization repositories (GitHub Actions only; no Workers Logs scan)
- `GET /api/v1/factory/run?repository=...&runId=...` — sanitized real External Worker lifecycle projection; `includeReporter=false` avoids Workers Logs for GitHub-only details
- `GET /api/v1/factory/attention?repository=...&runId=...` — read-only Worker escalation attention qualification; GitHub-only by default, with a trusted escalated/blocked state, verified Issue and readable open Issue required before it becomes `needs_attention`
- `GET /openapi.json` — OpenAPI 3.1 contract
- `GET /docs` — human-readable API/MCP documentation

The v1 API allows cross-origin `GET` requests with `Access-Control-Allow-Origin: *`. Responses are cache-friendly and carry `x-mira-api-version: v1`.

Factory lifecycle reads remain public-safe: only public `uichat-mira/*` repositories and genuine Mira External Worker runs are accepted. GitHub is the lifecycle/evidence source; 号脉 is an optional short-lived observation source. The server narrows Reporter queries to the lifecycle tail, skips runs that cannot produce Reporter evidence, and edge-caches repeated projections so a page refresh does not become an unbounded Workers Logs scan.

Legacy `GET /api/health`, `/api/summary`, `/api/organization`, and `/api/governance` remain temporarily available and return deprecation/successor headers. New clients should use `/api/v1/*`.

## GitHub Organization embed

Control Room exposes a compact SVG projection intended for the Mira GitHub Organization profile and other read-only status surfaces:

```text
https://control.mira.tomz.io/embed/github-overview.svg
```

The image reuses the existing `/api/v1/summary` read model. It does not introduce a second collector or status store. It currently projects organization status, repository count, the latest Run records (not necessary-Gate or production health), service health, GitHub/Cloudflare source state, and snapshot time.

The embed is public and cacheable. It deliberately stays outside the per-client Public API rate-limit bucket because GitHub may fetch external images through shared proxy addresses; a short Worker edge cache prevents repeated organization and service probes from direct image requests.

## Remote MCP

Control Room also exposes a stateless remote MCP server:

```text
https://control.mira.tomz.io/mcp
```

It targets MCP `2026-07-28` with the official TypeScript server SDK v2 and keeps the SDK's stateless compatibility path for 2025-era clients.

The MCP surface is deliberately small and task-oriented:

- `get_overview`
- `inspect_engineering` — repositories / builds / deployments
- `inspect_runtime` — services / analytics
- `inspect_governance` — governance / projects

MCP reuses the Public API read model internally; it does not query GitHub or Cloudflare through a second implementation. See [`docs/MCP.md`](docs/MCP.md), or open `/docs` on the deployed Control Room.

## Abuse protection

Cloudflare Worker Rate Limiting protects the public dynamic surfaces:

- health: `120 requests / 60s / source IP`
- all other Public API + MCP reads: `30 requests / 60s / source IP`, sharing one `public-read` bucket

Exceeding the limit returns HTTP `429` with `Retry-After: 60`.

Static `/openapi.json` is served as an asset and does not consume the Worker API limit. The GitHub Organization SVG embed is separately edge-cached and does not consume the per-client Public API limit. The MCP route additionally checks its request host and any supplied `Origin` header before protocol handling.

## Cloudflare read model

CI/CD currently reuses the organization-wide Cloudflare credentials:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The deploy workflow also installs the same shared token into the Worker runtime under the legacy internal binding name `CLOUDFLARE_READ_TOKEN`. The application uses it only for bounded reads and the Workers Observability query endpoint; Cloudflare classifies that query permission under Workers Observability Write/Edit even though Control Room does not expose a Cloudflare mutation API. The credential stays server-side and is never serialized into the public projection.

The effective data scope still depends on the permissions granted to the shared token. If a Cloudflare API family is not permitted, Control Room keeps the available data and reports that source as partial/degraded instead of failing the whole API.

Only Cloudflare resources whose names contain `mira` or `uichat` are exposed by the public Control Room read model.

## GitHub read model

The organization Actions secret is named `ORG_GITHUB_TOKEN`. CI maps it into the Worker runtime as the internal binding `GITHUB_READ_TOKEN`. The public API deliberately requests only public repositories even if the credential itself can read more.

`/api/v1/github/facts` is the bounded raw-fact input for the OPS-033 pilot repositories (`mira-desktop`, `mira-mobile`, `cloud-auth`, `mira-cloud`, `cloud-pi`, `control-room`). One shared snapshot reads branch refs, explicit workflow runs, and open PRs from a six-repository allowlist, then reports observed / missing / inaccessible / rate-limited / timed-out / truncated / budget-skipped sources separately. Repositories outside the allowlist are explicitly unknown, not healthy. The Worker keeps one shared snapshot for an hour and does not change the existing overview, Factory TV, or MCP semantics. See [`docs/github-attention-facts.md`](docs/github-attention-facts.md).

`/api/v1/github/gates` derives Gate/release qualification from that exact snapshot. It evaluates applicability by repository, current branch/SHA, workflow identity, event and run attempt; excludes `issue_comment` Worker dispatch Runs; distinguishes retries, old SHAs, neutral/cancelled/skipped, `action_required`, and truncated windows; and keeps a deploy workflow success separate from a verified production SHA/smoke. GitHub required checks are currently unreadable, so `required_by_github` is `unknown` rather than invented. These reads add no GitHub requests; see [`docs/github-attention-gate-status.md`](docs/github-attention-gate-status.md).

`/api/v1/github/pull` is a separate on-demand single-PR read, not a homepage fan-out. It makes three bounded public reads (PR detail, reviews, head workflow runs), caches the result for 60 seconds, and reuses the OPS-035 workflow assessment instead of inventing a second required-check rule set. Draft and explicitly sourced Hold/dependency evidence stay out of human attention; `mergeable=null` is `unknown`, not a conflict; a `CHANGES_REQUESTED` is attention only on the current head by a maintainer reviewer. Labels, comments and ordinary AI review strings never grant hold or review authority. See [`docs/github-attention-pr-status.md`](docs/github-attention-pr-status.md).

`/api/v1/factory/attention` reuses the canonical OPS-032 Factory projection. A trusted terminal Worker event is promoted to human attention only when the owning Issue is verifiably open and a bounded, authentic latest same-Issue Recovery Pointer proves that exact Run/attempt remains current. Later same-Issue pointers clear old alerts; missing, truncated or forged evidence remains unknown. The default is GitHub-only with no Reporter log query. Explicit Reporter inspection may add cached, bounded Issue and comment-page reads; there is no automatic organization-wide Worker scan. See [Worker attention contract](docs/github-attention-worker-status.md).

## Views

**Homepage design contract:** Entrance first, status second, details on their own routes. The Central Office dashboard is a compact map to departments and specialized consoles, not an elongated report or an independent source of eligibility truth. Every indicator links to its owning view; unknown sources must never be rendered as global zero-risk claims.

- `/` — Central Office: entry dashboard with bounded signals and direct links to Engineering, Runtime, Governance, Attention, Factory TV and System Wall; no global exact todo count.
- `/attention` — Attention & Evidence: qualified need-attention / in-progress / observation / unknown records, source coverage and deliberate single-PR / Worker inspections (OPS-038).
- `/engineering` — GitHub engineering entry dashboard: repository, build, Release
- `/engineering/repos` — searchable repository archive with GitHub Run / Release links
- `/engineering/builds` — one most recent default-branch Run per repository, not build history
- `/engineering/releases` — one latest discovered GitHub Release per repository, not version history
- `/runtime` — live service probes, Workers, Pages, and 24-hour traffic/error analytics
- `/governance` — Issues, pull requests, default-branch protection, rulesets, and public Projects
- `/wall` — large-screen operations view; forced dark theme and 60-second refresh
- `/factory` — real GitHub External Worker status wall; discovers recent non-skipped Runs and refreshes every 60 seconds without Workers Logs queries
- `/factory?mode=real&repository=uichat-mira/<repo>&runId=<run>` — real, sanitized External Worker lifecycle projection
- `/factory/broadcast` — explicitly shows 功能开发中 until trustworthy broadcasting events are connected
- `/docs` — public API and MCP documentation

The UI is intentionally split by operational question rather than by raw data table. Engineering, Runtime, and Governance use focused `/api/v1/*` reads; only Overview and Wall use the cross-domain summary.

**Factory TV scope:** Factory TV is an independent presentation mode beside Wall, not a fifth business domain. The default wall discovers real public Worker Runs through a bounded GitHub-only read (24-repository cap, 14-day window, 12 displayed Runs); a partial source or no Runs is explicit. Synthetic stations have been removed and legacy paths redirect to the real Factory TV. The selected workstation is GitHub-only; optional Reporter inspection is an explicit detail action, not part of wall polling. No raw Worker logs, Cloudflare credentials, prompts, model output, or invented heartbeat reach the browser. GitHub remains authoritative for lifecycle evidence.

## Local development

```bash
npm install
npm run dev
```

For local Cloudflare reads, put `CLOUDFLARE_ACCOUNT_ID` and a compatible token in an uncommitted `.dev.vars` or `.env` file as `CLOUDFLARE_READ_TOKEN`.

For authenticated GitHub reads, set `GITHUB_READ_TOKEN` locally. Never commit either credential.

## Verify

```bash
npm run check
npm run test:github-overview
```

`npm run check` covers type checking, targeted Factory TV lifecycle tests, and the production build.

## Deploy

Control Room keeps `dev` and `test` as source/CI promotion gates but does not maintain dedicated shared Cloudflare runtimes for them. Only `prod` deploys the production Worker; see [`docs/environment.md`](docs/environment.md) for the repository-level environment exception.

Production deployment is owned by `.github/workflows/deploy.yml` on the `prod` branch.

Worker: `uichat-mira-control-room`
