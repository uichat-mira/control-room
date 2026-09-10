# Mira Control Room

Mira organization observability cockpit.

Control Room is a **read-only projection** of existing sources of truth. It must not become a second task ledger, release ledger, or deployment state store.

## V0.2

- React + Vite cockpit UI
- Cloudflare Worker API + Workers Static Assets
- Live GitHub organization repository data
- Latest default-branch GitHub Actions run per repository
- Latest GitHub Release per repository
- Live HTTP probes for Mira Website, Relay, and Control Room
- Cloudflare Workers / Pages deployment read model
- `/wall` large-screen mode with 60-second refresh
- `GET /api/health`
- `GET /api/summary`

GitHub / Cloudflare core metadata is edge-cached to protect upstream rate limits. Runtime health probes refresh on every summary request.

## Cloudflare read model

CI/CD reuses the organization-wide Cloudflare credentials:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The deploy workflow also installs the same shared token into the Worker runtime under the internal binding name `CLOUDFLARE_READ_TOKEN`. Control Room only performs read requests with that runtime binding; no Cloudflare mutation endpoints are implemented in the application.

The effective data scope still depends on the permissions granted to the shared token. If a Cloudflare API family is not permitted, Control Room keeps the available data and reports that source as partial/degraded instead of failing the whole API.

Only Cloudflare resources whose names contain `mira` or `uichat` are exposed by the public Control Room read model.

## Views

- `/` — full Control Room
- `/wall` — large-screen operations view; forced dark theme and no repository detail table

## Local development

```bash
npm install
npm run dev
```

For local Cloudflare reads, put `CLOUDFLARE_ACCOUNT_ID` and a compatible token in an uncommitted `.dev.vars` or `.env` file as `CLOUDFLARE_READ_TOKEN`.

## Verify

```bash
npm run typecheck
npm run build
```

## Deploy

Production deployment is owned by `.github/workflows/deploy.yml` on the `prod` branch.

Worker: `uichat-mira-control-room`
