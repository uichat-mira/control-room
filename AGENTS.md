# OPS-037 · one-time External Worker dispatch branch

This AGENTS.md is temporary branch-local execution context. It is not a product artifact and MUST NOT be included in the OPS-037 functional PR or merged into dev.

## Authority and sources
- Current `uichat-mira/.github/AGENTS.md@main`, policy revision `2026-09-16.2`.
- Current `uichat-mira/.github/skills/execute-work-item/SKILL.md@main`.
- [Issue #108](https://github.com/uichat-mira/control-room/issues/108) and eligible explicit trusted maintainer amendments to its contract.
- `docs/github-attention-qualification-contract.md@dev`.
- `dev@05d4b710714aaa0603804fb13cb60ca23e203396`; actual `src/factory-read-model.ts`, `src/factory-feed.ts`, `src/worker.ts` and adjacent tests.
- The verified dev base contains no root `AGENTS.md`; this branch-only execution file must remain out of dev.

## Outcome and boundaries
- Derive read-only public-safe **Worker escalation attention qualification** without copying the canonical Factory TV lifecycle state machine.
- Initial failure with viable retry / repair is `in_progress`; only proven current terminal `blocked/escalated` with no available automatic recovery and concrete maintainer action is `needs_attention`.
- Later valid recovery / delivery for the **same actual Issue and candidate/attempt** or a legally closed Issue clears old attention; an unrelated successful Run cannot clear it. Run success is not product acceptance.
- Bind Issue identity to verified GitHub/Reporter artifact/PR/Issue facts; do not trust Issue numbers guessed from free text. `FactoryRunProjection.issueNumber` can be null without Reporter: handle this as an observation gap, not a fake exact ID.
- Reporter `not_requested`, unreadable/expired logs, expired artifacts, missing jobs, and truncated 14-day/12-item Factory Feed are **unknown / coverage gaps**, never a Worker failure or an exact outstanding organization-wide count.
- Reuse `getFactoryRunProjection` and `getFactoryFeed` with **GitHub-only / includeReporter=false** by default; never trigger Cloudflare Observability queries from home. Any extra GitHub reads must be explicitly bounded, cached, and tested for 403/429.
- No Factory TV UI rewrite, no new Worker dispatch/recovery algorithm, no other repositories, persistent second ledger, polling, alerting, notifications, PR/Issue/Project writes, or production deployment.

## Verification and delivery
- `npm install --no-audit --no-fund`, `npm run check`.
- T1: failed→repairing→escalated→recovered, same Issue multiple runs/attempts, unrelated success, Issue closure, missing/expired Reporter/Artifact, feed truncation; T2: real GitHub contract shapes and request budget; T3: read-only route and credential boundary.
- At least one fresh real run evidence chain, observation time, and explicit validation gaps.
- Deliver a single Draft PR. Do NOT merge, accept, close #108, promote test/prod or claim production acceptance.
- Exclude this `AGENTS.md` and `.github/workflows/issue-108-worker-dispatch.yml` from the functional PR.
