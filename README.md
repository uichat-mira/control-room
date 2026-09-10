# Mira Control Room

Mira organization observability cockpit.

Control Room is a **read-only projection** of existing sources of truth. It must not become a second task ledger, release ledger, or deployment state store.

## V0.1

- React + Vite cockpit UI
- Cloudflare Worker API
- Workers Static Assets
- `GET /api/health`
- `GET /api/summary`
- GitHub / Cloudflare adapters are intentionally pending until runtime read credentials are defined
- GitHub Actions deploys with the organization's existing Cloudflare deployment secrets

## Security boundary

The organization-wide Cloudflare deployment token is used **only by CI/CD**. It must not be injected into the Worker runtime for observability reads.

When Cloudflare account data is connected, Control Room should use a separate least-privilege, read-only token.

## Local development

```bash
npm install
npm run dev
```

## Verify

```bash
npm run typecheck
npm run build
```

## Deploy

```bash
npm run deploy
```

Worker: `uichat-mira-control-room`
