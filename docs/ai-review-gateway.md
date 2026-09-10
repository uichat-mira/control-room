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

Private endpoint. Requires:

```text
Authorization: Bearer <AI_REVIEW_GATEWAY_TOKEN>
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

The Gateway re-fetches those facts from GitHub using its own read credential.

## Trust model

The PR head is untrusted review content.

Gateway v0 therefore:

- accepts only repositories under `uichat-mira`;
- accepts only same-repository PRs, matching the current Mobile review baseline;
- fetches PR metadata directly from GitHub;
- fetches the PR diff directly from GitHub;
- fetches Organization `POLICY.md` and `OUTPUT-CONTRACT.md` from the configured trusted Organization policy ref;
- fetches `.ai/review-profile.md` and `AGENTS.md` from the exact PR base SHA;
- does not checkout or execute PR code;
- records the blob SHA of every trusted control included in the package;
- records exact PR head and base SHA;
- reports diff truncation and missing repo profile as explicit package gaps.

PR-controlled agent/model/plugin configuration may later be included as reviewable code, but it is never loaded as trusted reviewer instruction by this package builder.

## Configuration

Worker runtime bindings:

```text
GITHUB_READ_TOKEN
AI_REVIEW_GATEWAY_TOKEN
AI_REVIEW_POLICY_REF   optional, default: main
```

`GITHUB_READ_TOKEN` already exists in Control Room's current deployment path through the Organization GitHub read token.

`AI_REVIEW_GATEWAY_TOKEN` is a separate caller credential. A GitHub credential must not be reused as the bearer token sent to the Gateway.

## Review package identity

The v0 response includes:

```text
packageVersion
runtimeVersion
repository + PR number
base ref + base SHA
head ref + head SHA
Organization policy blob SHA
Output contract blob SHA
Repo profile blob SHA (when present)
Root AGENTS.md blob SHA (when present)
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
