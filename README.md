# Mira Control Room

Mira organization observability cockpit, public read API, and remote MCP surface.

Control Room is a **read-only projection** of existing sources of truth. It must not become a second task ledger, release ledger, deployment state store, or MCP-specific data store.

Canonical production domain: `https://control.mira.tomz.io`

## V0.2

- React + Vite cockpit UI
- Shallow domain navigation for Overview, Engineering, Runtime, and Governance
- Cloudflare Worker API + Workers Static Assets
- Live GitHub organization repository data
- Latest default-branch GitHub Actions run per repository
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

GitHub, Cloudflare, governance, and runtime health are intentionally separate read paths. Focused Public API, MCP, and domain UI reads do not trigger unrelated service probes. Overview is the deliberate cross-domain exception because its job is to answer what needs attention now.

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
- `GET /openapi.json` — OpenAPI 3.1 contract
- `GET /docs` — human-readable API/MCP documentation

The v1 API allows cross-origin `GET` requests with `Access-Control-Allow-Origin: *`. Responses are cache-friendly and carry `x-mira-api-version: v1`.

Legacy `GET /api/health`, `/api/summary`, `/api/organization`, and `/api/governance` remain temporarily available and return deprecation/successor headers. New clients should use `/api/v1/*`.

## GitHub Organization embed

Control Room exposes a compact SVG projection intended for the Mira GitHub Organization profile and other read-only status surfaces:

```text
https://control.mira.tomz.io/embed/github-overview.svg
```

The image reuses the existing `/api/v1/summary` read model. It does not introduce a second collector or status store. It currently projects organization status, repository count, latest CI health, service health, GitHub/Cloudflare source state, and snapshot time.

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

CI/CD reuses the organization-wide Cloudflare credentials:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The deploy workflow also installs the same shared token into the Worker runtime under the internal binding name `CLOUDFLARE_READ_TOKEN`. Control Room only performs read requests with that runtime binding; no Cloudflare mutation endpoints are implemented in the application.

The effective data scope still depends on the permissions granted to the shared token. If a Cloudflare API family is not permitted, Control Room keeps the available data and reports that source as partial/degraded instead of failing the whole API.

Only Cloudflare resources whose names contain `mira` or `uichat` are exposed by the public Control Room read model.

## GitHub read model

The organization Actions secret is named `ORG_GITHUB_TOKEN`. CI maps it into the Worker runtime as the internal binding `GITHUB_READ_TOKEN`. The public API deliberately requests only public repositories even if the credential itself can read more.

## Views

- `/` — Overview: cross-domain summary, current exceptions, and the active public Project
- `/engineering` — repositories, latest default-branch builds, releases, Workers, and Pages delivery
- `/runtime` — live service probes, Workers, Pages, and 24-hour traffic/error analytics
- `/governance` — Issues, pull requests, default-branch protection, rulesets, and public Projects
- `/wall` — large-screen operations view; forced dark theme and 60-second refresh
- `/docs` — public API and MCP documentation

The UI is intentionally split by operational question rather than by raw data table. Engineering, Runtime, and Governance use focused `/api/v1/*` reads; only Overview and Wall use the cross-domain summary.

## Local development

```bash
npm install
npm run dev
```

For local Cloudflare reads, put `CLOUDFLARE_ACCOUNT_ID` and a compatible token in an uncommitted `.dev.vars` or `.env` file as `CLOUDFLARE_READ_TOKEN`.

For authenticated GitHub reads, set `GITHUB_READ_TOKEN` locally. Never commit either credential.

## Verify

```bash
npm run typecheck
npm run build
npm run test:github-overview
```

## Deploy

Production deployment is owned by `.github/workflows/deploy.yml` on the `prod` branch.

Worker: `uichat-mira-control-room`
