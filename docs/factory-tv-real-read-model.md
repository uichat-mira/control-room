# Factory TV — Real Read Model

OPS-032 adds a public-safe, read-only projection for one real Mira External Worker GitHub Actions run.

## Source hierarchy

1. **GitHub Actions** is the lifecycle and evidence source.
   - Run
   - Job
   - Artifact metadata
   - associated PR metadata
2. **号脉 / Trusted Reporter** is an observation layer only.
   - It can refine a state to Candidate, Verify, Repair, Delivery, or Escalated.
   - Reporter absence, query failure, or retention expiry never becomes Worker failure.
   - Reporter PASS never overrides GitHub Verify failure or missing evidence.
3. The Control Room API is a projection, not a second lifecycle database.

## Real mode

Factory TV remains an explicit design fixture by default.

To inspect a real run:

`/factory?mode=real&repository=uichat-mira/mira-mobile&runId=<RUN_ID>`

The browser calls only:

`GET /api/v1/factory/run?repository=uichat-mira/mira-mobile&runId=<RUN_ID>`

The response contains only an allowlisted lifecycle projection. It never contains GitHub tokens, Cloudflare tokens, raw Worker logs, or arbitrary Cloudflare query responses.

## State rules

A trusted Reporter event may produce:

- `verified`
- `repairing`
- `blocked`
- `escalated`
- `delivery_retry`
- `delivered`
- `candidate_captured`
- `validation_gap`

Without trusted Reporter evidence, GitHub-only observations are deliberately weaker:

- queued / working when GitHub Jobs prove execution;
- worker_failed when the Worker run itself failed;
- observation_gap when GitHub says success but no trusted Verify/Delivery event exists;
- artifact_unavailable when expected evidence artifacts are absent or expired.

A successful GitHub Run is **never** projected as product Verify PASS by itself.

## Credential boundary

The Cloudflare Workers Observability query endpoint requires a token with Workers Observability Write permission for ad-hoc queries. The existing Control Room runtime secret is used only on the Worker server boundary. The browser receives sanitized results, never the credential or raw query response.

GitHub Actions Run/Job/Artifact APIs are read-only operations here. Private repositories are rejected before Actions data is returned; only public `uichat-mira/*` repositories are eligible for this public read model.

## Freshness

GitHub freshness and Reporter freshness are reported separately.

- `fresh`: recent evidence
- `stale`: older but still retained
- `expired`: Reporter retention has elapsed
- `unavailable`: the observation source could not be read

Reporter retention currently follows the documented seven-day Workers Logs window. Historical GitHub Run/PR provenance remains visible even when Reporter logs expire.

## Demo boundary

The existing synthetic Factory TV stations remain available at `/factory`.

Synthetic stations are explicitly marked `DESIGN DEMO · NON-LIVE`. They must never be presented as real Worker activity.
