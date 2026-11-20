# OPS-036 · one-time External Worker dispatch branch

This AGENTS.md is branch-local trusted dispatch context only. It must never be included in the OPS-036 functional patch or merged into dev.

## Authoritative instructions
- Current uichat-mira/.github/AGENTS.md@main, policy 2026-09-16.2.
- Current uichat-mira/.github/skills/execute-work-item/SKILL.md@main.
- GitHub Issue https://github.com/uichat-mira/control-room/issues/107, plus eligible maintainer contract amendment/comment in that Issue.
- Repository dev source docs/github-attention-qualification-contract.md and docs/github-attention-pilot-gates.md.
- dev baseline 3b68817d91d6413696c5148929841d15012386b7, containing OPS-034 cached GitHub Facts and OPS-035 Gate/Release qualification.
- This repository had no AGENTS.md on the verified dev baseline. This file is a temporary branch-only execution context.

## Outcome, truth and boundaries
- Implement OPS-036 PR qualification only: current PR base/head SHA, draft/hold/dependencies, real merge conflicts, current effective reviews, applicable required checks, actionable maintainer step and original evidence.
- Never infer blocking status from PR age, ordinary Draft, an unverified Hold, stale CHANGES_REQUESTED, mergeable=null, or GitHub required checks that cannot be authenticated.
- Reuse OPS-035 Gate qualification and OPS-034 bounded GitHub facts. No extra per-homepage unbounded polling; optional per-PR details must have bounded request count, cache and honest error/unknown handling.
- Readonly/public-safe API plus T1/T2/T3 fixture and real current PR examples. Preserve existing app UI and Factory TV. Never auto-review, merge, deploy, label, notify, close Issue or update other repos.
- Worker can implement, test and deliver Draft PR only. It must not accept or close the Issue, merge code, or promote test/prod.
- If code change becomes blocked by untrusted metadata or inaccessible GH API, report exact gap rather than inventing completeness.
- Do not include this branch-only AGENTS.md or .github/workflows/issue-107-worker-dispatch.yml in functional changes.

## Verification
npm install --no-audit --no-fund
npm run check
