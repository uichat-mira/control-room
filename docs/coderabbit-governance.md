# CodeRabbit organization governance

Control Room owns Mira organization-level review governance.

## Authority

The canonical organization-level CodeRabbit defaults live at:

`config/coderabbit/organization-defaults.yaml`

CodeRabbit Organization Settings are a runtime projection of that file, not an
independent source of policy.

Repository-level `.coderabbit.yaml` files are allowed only for
repository-specific differences. They must not duplicate the full organization
configuration merely to keep a repository self-contained.

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

1. change and review the canonical defaults in Control Room;
2. apply the same values in CodeRabbit Organization Settings;
3. leave repository overrides untouched unless the change intentionally removes
   a duplicate or changes repository-specific behavior;
4. verify on a controlled pull request.

Do not create a separate `uichat-mira/coderabbit` repository solely to host a
second copy of these defaults.

## Global Overrides

Global Overrides are not part of the initial Mira mechanism.

If they are introduced later, use them only for a narrowly scoped rule that must
be impossible for a repository to override, and require an explicit governance
decision before enabling it.
