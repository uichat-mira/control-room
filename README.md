# Mira Control Room

Mira organization observability cockpit and public read API.

Control Room is a **read-only projection** of existing sources of truth. It must not become a second task ledger, release ledger, or deployment state store.

## V0.2

- React + Vite cockpit UI
- Cloudflare Worker API + Workers Static Assets
- Live GitHub organization repository data
- Latest default-branch GitHub Actions run per repository
- Latest GitHub Release per repository
- Live HTTP probes for Mira Website, Relay, and Control Room
- Cloudflare Workers / Pages deployment read model
- Cloudflare Workers 24h requests/errors analytics
- Public repository governance and public GitHub Projects projection
- `/wall` large-screen mode with 60-second refresh

GitHub / Cloudflare core metadata is edge-cached to protect upstream rate limits. Runtime health probes refresh on every summary request. Governance is fetched and cached separately so the live summary remains below Cloudflare Workers external-subrequest limits.

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

The v1 API allows cross-origin `GET` requests with `Access-Control-Allow-Origin: *`. Responses are cache-friendly and carry `x-mira-api-version: v1`.

Legacy `GET /api/health`, `/api/summary`, `/api/organization`, and `/api/governance` remain temporarily available and return deprecation/successor headers. New clients should use `/api/v1/*`.

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

- `/` — full Control Room
- `/wall` — large-screen operations view; forced dark theme and no repository detail table

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
```

## Deploy

Production deployment is owned by `.github/workflows/deploy.yml` on the `prod` branch.

Worker: `uichat-mira-control-room`
