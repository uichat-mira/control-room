# Mira AI Review Gateway

Status: `v0 — trusted review package`

The Mira AI Review Gateway lives in `uichat-mira/control-room`.

Organization policy and normalized output contracts remain owned by `uichat-mira/.github/ai-review`.

## Responsibility split

```text
uichat-mira/.github
  └─ ai-review/
     ├─ POLICY.md
     ├─ OUTPUT-CONTRACT.md
     └─ REPO-PROFILE-TEMPLATE.md
          ↓ trusted Organization controls

repository PR + base-side .ai/review-profile.md
          ↓
control-room AI Review Gateway
  ├─ reconstruct trusted review package
  ├─ bind base/head/control identities
  ├─ provider routing            (next phase)
  ├─ output normalization        (next phase)
  └─ deterministic publishing    (next phase)
```

A review provider is an execution backend. It does not own Mira's review policy or verdict contract.

## v0 endpoints

### `GET /api/v1/ai-review/health`

Public-safe capability status. It exposes configuration state, never credential values.

### `POST /api/v1/ai-review/package`

Private endpoint. Organization repository callers use the shared Organization GitHub token:

```text
Authorization: Bearer <ORG_GITHUB_TOKEN>
Content-Type: application/json
```

Request body:

```json
{
  "repository": "uichat-mira/mira-mobile",
  "pullRequest": 123
}
```

The caller is intentionally not allowed to supply head SHA, base SHA, diff, policy text, or repository review controls as authoritative input.

The Gateway re-fetches those facts from GitHub using the same Organization credential.

## Shared-token boundary

`ORG_GITHUB_TOKEN` is intentionally reused for both:

- repository caller authentication to the AI Review Gateway;
- Control Room authenticated reads from GitHub.

Control Room deploys that Organization secret as `GITHUB_READ_TOKEN`. The outer Gateway maps the same runtime value into the AI Review Gateway caller-auth slot, so there is no second Review Gateway secret to provision or rotate.

Because this token has GitHub authority, any repository workflow that receives it must remain a thin trusted caller. While `ORG_GITHUB_TOKEN` is present, the caller must not:

- checkout the PR head;
- execute PR-controlled scripts, packages, Actions, configuration, or generated commands;
- pass the token to model/provider input;
- echo the token or include it in artifacts/logs;
- expose it to a job whose behavior can be changed by the PR being reviewed.

The intended caller gathers only trusted GitHub event metadata and calls Control Room. Review content is reconstructed by Control Room itself.

## Trust model

The PR head is untrusted review content.

Gateway v0 therefore:

- accepts only repositories under `uichat-mira`;
- accepts only same-repository PRs, matching the current Mobile review baseline;
- fetches PR metadata directly from GitHub and freezes the observed base/head commit SHAs;
- fetches the diff from GitHub's compare endpoint using that exact immutable base/head pair, so a concurrent push cannot silently change the packaged diff;
- resolves the configured Organization policy ref to one immutable commit SHA before reading any policy file;
- fetches Organization `POLICY.md` and `OUTPUT-CONTRACT.md` from that same policy commit;
- fetches `.ai/review-profile.md` and `AGENTS.md` from the exact PR base SHA;
- does not checkout or execute PR code;
- records the policy commit SHA and blob SHA of every trusted control included in the package;
- records exact PR head and base SHA;
- reports diff truncation and missing repo profile as explicit package gaps.

PR-controlled agent/model/plugin configuration may later be included as reviewable code, but it is never loaded as trusted reviewer instruction by this package builder.

## Configuration

Worker runtime bindings:

```text
GITHUB_READ_TOKEN
AI_REVIEW_POLICY_REF   optional, default: main
```

The current Control Room deployment maps the Organization Actions secret `ORG_GITHUB_TOKEN` to `GITHUB_READ_TOKEN`.

No separate `AI_REVIEW_GATEWAY_TOKEN` is required. The Gateway intentionally reuses the same runtime credential for caller authentication.

## Review package identity

The v0 response includes:

```text
packageVersion
runtimeVersion
repository + PR number
base ref + base SHA
head ref + head SHA
resolved Organization policy commit SHA
Organization policy blob SHA
Output contract blob SHA
Repo profile blob SHA (when present)
Root AGENTS.md blob SHA (when present)
exact compare-diff source pair
diff truncation state
package gaps
```

This identity is the input boundary for later provider execution and stale-review detection.

## Deliberately not in v0

The first slice does not yet:

- call OpenCode, CodeRabbit, Codex, OpenAI, or another model/provider;
- publish or update PR comments;
- create GitHub review states;
- create Issues or task cards;
- parse repository-specific context selectors from the profile;
- reproduce Mobile's local `review:pull` handoff;
- claim review equivalence with the historical Mobile OpenCode runtime.

Those capabilities are added only after the trusted package contract is verified.

## Next slice

The next implementation slice should add provider abstraction and normalized review execution on top of the immutable package boundary, without allowing a provider to redefine policy, verdicts, or publication semantics.
