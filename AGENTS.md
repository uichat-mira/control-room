# AGENTS.md — research dispatch scope

This branch exists only to execute Control Room Issue #73.

Rules:
- Treat Issue #73 as the authoritative work-item contract.
- Modify only research/evaluation surfaces needed for the #243 progressive-disclosure closeout matrix.
- Prefer extending `src/research/progressive-agent-eval.ts` and its research workflow rather than creating parallel production machinery.
- Do not change Control Room product UI, deployment behavior, provider credentials, or Mira Desktop production code.
- Do not fabricate live-model evidence. Worker-side responsibility is implementation plus static verification; trusted GitHub Actions owns live-model execution.
- Keep the comparison thin: common model/task/catalog/gold boundary; visibility/disclosure backend is the variable under test.
