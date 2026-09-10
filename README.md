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
- Optional Cloudflare Workers / Pages deployment read model
- `/wall` large-screen mode with 60-second refresh
- `GET /api/health`
- `GET /api/summary`

GitHub / Cloudflare core metadata is edge-cached to protect upstream rate limits. Runtime health probes refresh on every summary request.

## Cloudflare read model

CI/CD uses the organization-wide deployment credentials:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The deployment token is **not** injected into the Worker runtime.

To enable Cloudflare observability, add a separate GitHub Actions secret named:

- `CLOUDFLARE_READ_TOKEN`

Recommended account permissions:

- Workers Scripts: Read
- Pages: Read

The deploy workflow automatically uploads this optional secret to the Worker runtime using Wrangler's secrets-file mechanism. The account ID and deployed Git commit are injected as non-secret runtime variables.

Only Cloudflare resources whose names contain `mira` or `uichat` are exposed by the public Control Room read model.

## Views

- `/` — full Control Room
- `/wall` — large-screen operations view; forced dark theme and no repository detail table

## Local development

```bash
npm install
npm run dev
```

For local Cloudflare reads, put `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_READ_TOKEN` in an uncommitted `.dev.vars` or `.env` file.

## Verify

```bash
npm run typecheck
npm run build
```

## Deploy

Production deployment is owned by `.github/workflows/deploy.yml` on the `prod` branch.

Worker: `uichat-mira-control-room`
