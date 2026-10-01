# CodeRabbit organization governance

Mira Organization AI Review policy and normalized output contracts are owned by
`uichat-mira/.github/ai-review/POLICY.md` and
`uichat-mira/.github/ai-review/OUTPUT-CONTRACT.md`.

The CodeRabbit-specific integration boundary is owned by
`uichat-mira/.github/ai-review/providers/coderabbit.md`.

Control Room owns only the operational CodeRabbit organization defaults and the process
for projecting those defaults into CodeRabbit Organization Settings.

## Authority

Use one owner per concern:

- `uichat-mira/.github/ai-review/POLICY.md` and
  `uichat-mira/.github/ai-review/OUTPUT-CONTRACT.md` own Mira review policy,
  trust/authority rules, verdict vocabulary, and normalized output semantics.
- `uichat-mira/.github/ai-review/providers/coderabbit.md` owns only the
  CodeRabbit-specific integration boundary: its role as an independent side reviewer,
  provider-native authority limits, configuration layering, and Mira's non-gating
  posture toward that provider.
- `config/coderabbit/organization-defaults.yaml` owns the current soft operational
  defaults that should normally be projected into CodeRabbit Organization Settings.
- CodeRabbit Organization Settings are a runtime projection of those defaults, not an
  independent source of policy.
- Repository-level `.coderabbit.yaml` files own only genuine repository-specific
  CodeRabbit behavior.

Do not restate Organization AI Review policy or CodeRabbit authority rules in Control
Room defaults merely to keep this repository self-contained.

## Initial scope

Organization defaults are deliberately soft:

- review language and review profile;
- automatic review of non-draft pull requests;
- incremental review;
- high-level summaries;
- request-changes workflow behavior;
- chat auto-reply behavior.

Repositories may override these defaults where their actual engineering context
requires a difference.

## What does not belong in organization defaults

Do not add organization-wide rules that make ordinary engineering work depend
on a specific GitHub interaction or repository topology. In particular, keep
the following out of the organization defaults unless a future explicit
governance decision says otherwise:

- base-branch allowlists;
- Issue-linking or branch-creation requirements;
- Project/Issue lifecycle transitions;
- requirements to use a particular GitHub UI action;
- repository-specific path instructions;
- Electron, Android, iOS, server, UI, Agent-runtime, or release rules;
- acceptance/merge/close authority;
- mandatory Global Overrides.

Those concerns belong to the repository's own engineering contract, deterministic
CI/policy checks, or its local CodeRabbit override when CodeRabbit context is
actually useful.

## Repository overrides

A repository may keep `.coderabbit.yaml` for genuine local context such as:

- path-specific review instructions;
- repository-specific generated/build files;
- framework-specific review guidance;
- repository-specific base-branch behavior when genuinely required.

Prefer the smallest override that expresses the difference from organization
defaults.

A repository override must never become a second organization constitution.

## Projection

Until CodeRabbit exposes organization-setting mutation through an automation
interface we operate, updates follow this path:

1. change and review the operational defaults in Control Room when the runtime
   default itself needs to change;
2. if the desired behavior changes Mira Review policy, trust, authority, verdicts,
   or normalized output, update `uichat-mira/.github/ai-review`;
3. if it changes only CodeRabbit-specific role, authority limits, configuration
   layering, or gating posture, update
   `uichat-mira/.github/ai-review/providers/coderabbit.md`;
4. apply the reviewed operational values in CodeRabbit Organization Settings;
5. leave repository overrides untouched unless the change intentionally removes
   a duplicate or changes repository-specific behavior;
6. verify the projection on a controlled pull request.

Do not create a separate `uichat-mira/coderabbit` repository solely to host a
second copy of these defaults.

## Global Overrides

Global Overrides are not part of the initial Mira mechanism.

If they are introduced later, use them only for a narrowly scoped rule that must
be impossible for a repository to override, and require an explicit governance
decision before enabling it.
