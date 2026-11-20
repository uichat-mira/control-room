# AGENTS.md — OPS-034 isolated Worker dispatch

This is a **temporary linked-branch execution base** for Control Room Issue #105. It is not a new repository-wide policy or a production release branch.

## Authoritative contracts
- Current Organization policy: `uichat-mira/.github/AGENTS.md@main`.
- Work item: https://github.com/uichat-mira/control-room/issues/105 and eligible trusted maintainer amendments.
- Prior evidence: `docs/github-attention-pilot-gates.md` (#104), `docs/github-attention-qualification-contract.md` (#103).
- Repository architecture/runtime: `README.md`, `docs/environment.md`, current `src/github.ts`, `src/worker.ts`, `src/factory-feed.ts`, adjacent tests and cache helpers.

## Scope and constraints
- Implement only **bounded, shared, public-safe GitHub raw fact collection** for the six OPS-033 pilot repositories, including freshness, coverage, query/cost evidence, limits, and failure paths specified by #105.
- Reuse existing Cloudflare Worker cache/read model. Never create a second Issue/PR/release ledger or separately fetch unbounded data per viewer.
- Keep `unknown / missing / inaccessible / truncated` distinct from real zero and verified healthy. Rate limits and 60 REST/h are **unverified**; count calls and report what is actually enforced.
- No eligibility or attention judgment (OPS-035/036/037), no Overview redesign (OPS-038), no Factory TV state machine rewrite.
- Preserve existing public API/MCP semantics, credentials isolation, source-specific data paths and deployment behavior. No production secrets, admin rule edits, prod deployment or cross-repo mutations.
- Add proportionate T1/T2/T3 tests for 200, 304 if implemented, 403/429, timeout, truncation, cache reuse and bounded fan-out. Run `npm run check` after dependencies are installed; report exact executed checks and observed request measurements.
- Deliver a **Draft PR** to this execution base with evidence and any unproven global bound explicitly stated. Do not merge, promote, accept or close the Issue.
