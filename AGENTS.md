# AGENTS.md — OPS-035 isolated Worker dispatch

This is a **temporary GitHub-native Issue-linked execution base** for Control Room Issue #106. It does not establish repository-wide policy; do not merge this file or its dispatch workflow into `dev`.

## Current authority and facts
- Canonical Organization instructions: `uichat-mira/.github/AGENTS.md@main`; execute-work-item Skill (current main).
- Assigned work item: https://github.com/uichat-mira/control-room/issues/106 and its trusted maintainer amendments.
- Prerequisites: `docs/github-attention-qualification-contract.md`, `docs/github-attention-pilot-gates.md` (OPS-033), `docs/github-attention-facts.md` / `src/github-facts.ts` / `src/github-facts-route.ts` (OPS-034).
- Relevant implementation: `src/github.ts` (`latestWorkflow`), `src/worker.ts` (`summary`/`buildFailed`), `src/overview-facts.ts`, `src/engineering-facts.ts`, `src/shared.ts`, `src/openapi.ts`, `README.md`, `docs/environment.md` and nearby tests.
- Base code is `dev@a1642f118fe8c836f235cc70668557e54cead993`; do not infer current production behavior from this dev snapshot.

## Task scope
Implement **OPS-035** only: evidence-anchored, read-only Actions *necessary Gate* and deployment/release status projection for current applicable repository/channel/commit SHA, not naive latest-Run status.
- Distinguish the *current target* from historical/unrelated Run; include exact workflow identity, event, SHA, run attempt; skipped/neutral/cancelled/null/queued/in_progress/action_required/failed/recovered are not interchangeable.
- Require **actual evidence of applicable necessary checks**. The OPS-033 matrix shows per-repo differences; it does **not** establish what GitHub actually requires. GitHub branch-protection/ruleset required checks 403/unknown => `required_by_github=unknown`, never invent required checks, "green", a red blockage, or P0 from workflow name alone. Distinguish repository-owned workflow Gate semantics from externally enforced requirements.
- Verified production deployment version and smoke are separate facts. If production SHA, manual deployment input, R2 manifest or runtime health cannot be read, report `unverified` rather than claiming production failure/success or P0.
- Expose action-oriented candidate / in-progress / archive / coverage-gap facts with `who/what/why_now/next_step/evidence/observedAt/exit_condition`. Correct old false "last workflow failure means current running outage" summary semantics in smallest possible safe change; do not overwrite actual historical Run records.
- Respect OPS-034 six pilot allowlist, fixed bounded GitHub fact collection (36 REST baseline/40 per-round, concurrency 4, isolate-local singleflight) and current credential/security boundary. Any extra reads must be measured, bounded and shared. A fixed 5-Run candidate window that misses SHA/branch must result in `unknown/truncated`, not presumed missing/healthy.
- Do not implement OPS-036 PR reviews, OPS-037 Worker escalation or OPS-038 Overview redesign. Do not create another Issue/PR/deployment ledger or notifications. No modifications to other repositories, CI policy, permissions, secrets, production versions or Cloudflare deploy.

## Delivery
- Add reliable T1/T2/T3 tests around same-SHA rerun recovery, old SHA, unrelated workflows, issue_comment skipped, action_required, neutral/cancelled, missing required check config, partial/truncated coverage, deploy SHA/healthy smoke evidence and pure read-only Worker API with bounded upstream.
- Record at least one **live, traceable GitHub case** separated into observed fact, limited inference and unresolved proof. Do not inflate CI or release confidence.
- Execute `npm install --no-audit --no-fund` then `npm run check`; state exact pass/fail evidence, measured query cost, rollback. Deliver Draft PR **to this temporary execution base** for maintainer review; do not merge, accept, close, promote or deploy.
