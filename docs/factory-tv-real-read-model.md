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
   - Reporter PASS never overrides a later GitHub Verify failure or missing durable evidence.
   - Workers Logs are queried only for Runs where GitHub proves that `trusted_reporter` completed successfully.
3. The Control Room API is a projection, not a second lifecycle database.

## Real mode

Factory TV defaults to real GitHub evidence at /factory. Historical synthetic stations are removed from the product; old /factory/demo-* links redirect to the real wall and mode=demo no longer activates fixtures.

The wall calls `GET /api/v1/factory/runs` every 60 seconds while visible. The server lists up to 24 current public organization repositories, checks their default branches for the Worker caller in one GitHub GraphQL request (bounded REST fallback), then fetches up to 20 latest External Worker workflow runs from each caller. It excludes skipped and foreign workflow references and shows up to 12 Runs from the last 14 days (active first). The feed has a shared edge cache (up to 120 seconds); partial repository failures are explicitly reported. It never calls Workers Observability.

Selecting a wall station calls `/api/v1/factory/run?...&includeReporter=false` to view GitHub Jobs/Artifacts/PR evidence without Workers Logs. The explicit detail link opts into the existing trusted Reporter read. This avoids repeating costly Cloudflare scans every time the wall refreshes.

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

The Reporter query is fixed to the `cloudflare-workers` dataset, `how-am-i` service, trusted Reporter identity, and exact GitHub Run ID. Browser input cannot choose the dataset, script name, filters, or time range. The time range is derived from the trusted Reporter GitHub Job.

Workers Logs queries can scan a large internal volume even for a short time window. Therefore the public endpoint first proves a successful `trusted_reporter` Job in GitHub, skips all other Runs, and edge-caches terminal Reporter projections. Reporter queries are never used for active-run polling.

GitHub Actions Run/Job/Artifact APIs are read-only operations here. Private repositories are rejected before Actions data is returned; only public `uichat-mira/*` repositories are eligible for this public read model.

## Freshness

GitHub freshness and Reporter freshness are reported separately.

- `fresh`: recent evidence
- `stale`: older but still retained
- `expired`: Reporter retention has elapsed
- `unavailable`: the expected observation source could not be read
- `not_expected`: GitHub proves that this Run should not have Reporter output

Reporter retention currently follows the documented seven-day Workers Logs window. Historical GitHub Run/PR provenance remains visible even when Reporter logs expire.

## Production-only real-data policy

No synthetic station or scripted broadcast remains in the production UI. Legacy demo links redirect to the real wall; mode=demo is ignored. If reliable evidence or an integration does not exist, the feature explicitly says 功能开发中. Currently this applies to the independent broadcast channel and tool-level live streaming; GitHub Run/Job/Artifact/PR evidence remains available.
