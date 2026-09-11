# Mira AI Review Gateway

Status: `v0 — trusted package + unpublished execution`

The Mira AI Review Gateway is a logical subsystem inside the existing `uichat-mira/control-room` Cloudflare Worker. V1 does not use a separate Review Gateway service.

Organization policy and normalized output contracts are owned by `uichat-mira/.github/ai-review`.

## Responsibility split

```text
uichat-mira/.github
  └─ ai-review/
     ├─ POLICY.md
     ├─ OUTPUT-CONTRACT.md
     └─ REPO-PROFILE-TEMPLATE.md
          ↓ trusted Organization controls

repository PR + base-side repository controls
          ↓
Control Room / AI Review Gateway
  ├─ rebuild trusted package
  ├─ bind exact base/head/control identities
  ├─ select configured provider slot
  ├─ call provider adapter
  ├─ normalize Mira review result
  ├─ compare freshness / render deterministic output
  └─ GitHub publication                (not enabled yet)
```

A provider is an execution backend. It does not own Mira's policy, verdict vocabulary, trust boundary, or publication semantics.

## Endpoints

### `GET /api/v1/ai-review/health`

Public-safe capability status. It exposes caller/provider slot state but never credential values.

### `POST /api/v1/ai-review/package`

Private trusted-package inspection endpoint.

### `POST /api/v1/ai-review/review`

Private unpublished execution endpoint. It rebuilds the same trusted package, executes configured Primary/Fallback providers, normalizes the result, and returns execution metadata. It does not write to GitHub.

Private callers send:

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

The caller cannot supply authoritative head/base SHA, diff, policy text, repository controls, provider, model, endpoint, or provider credential.

## Caller credential boundary

`AI_REVIEW_GATEWAY_TOKEN` is a purpose-specific internal bearer. It is deliberately separate from GitHub credentials.

Production uses:

- `AI_REVIEW_GATEWAY_TOKEN` — authenticates trusted calls to private AI Review routes;
- `GITHUB_READ_TOKEN` — lets Control Room reconstruct trusted package data from GitHub;
- future GitHub publication credential — not implemented yet and must remain Worker-only and separate from both values above.

Repository callers that receive the Gateway bearer must remain thin trusted callers. They must not checkout PR head code, execute PR-controlled scripts/packages/configuration, expose the token to model input, or write it to logs/artifacts.

## Trust model

The PR head is untrusted review content.

The Gateway therefore:

- accepts only repositories under `uichat-mira`;
- currently accepts same-repository PRs;
- re-fetches PR metadata from GitHub and freezes exact base/head SHAs;
- fetches the compare diff from that immutable pair;
- resolves Organization policy to one immutable commit before reading policy/output contracts;
- fetches repository profile/root controls from the exact PR base SHA;
- does not checkout or execute PR code;
- records trusted-control blob identities and exact PR identity;
- keeps runtime review mode, deterministic gaps, and trusted contract identity in trusted system context;
- keeps PR title/body/diff in untrusted review evidence;
- represents missing trusted evidence as typed validation gaps rather than inventing defects.

## Review modes

Supported branch transitions are deterministic and fail closed:

```text
feat/* -> dev   CODE_REVIEW
dev -> test     PROMOTION_REVIEW
test -> prod    RELEASE_REVIEW
```

Unsupported transitions are rejected rather than guessed.

## Provider slots

V1 exposes two runtime slots:

```text
Primary
Fallback
```

`reserve` and `judge` remain architectural extension points and are not current V1 delivery requirements.

A slot is one configured provider instance. The generic OpenAI-compatible adapter is a protocol implementation, not a vendor decision.

Slot health states are:

```text
unconfigured
configured
partial
invalid
```

Production deployment must accept only `unconfigured` or `configured`. A partial or invalid provider slot fails deployment before Worker mutation.

## Provider deployment configuration

Provider API keys are GitHub Actions **Secrets**. Provider metadata/capability settings are GitHub Actions **Variables**. The deploy workflow transfers non-empty values into trusted Worker runtime secret bindings; values are never supplied by a PR request.

### Primary

Secret:

```text
AI_REVIEW_PRIMARY_API_KEY
```

Variables:

```text
AI_REVIEW_PRIMARY_ID
AI_REVIEW_PRIMARY_ENDPOINT
AI_REVIEW_PRIMARY_MODEL
AI_REVIEW_PRIMARY_RESPONSE_FORMAT
AI_REVIEW_PRIMARY_MAX_PROMPT_CHARACTERS
AI_REVIEW_PRIMARY_MAX_OUTPUT_TOKENS
AI_REVIEW_PRIMARY_OUTPUT_TOKEN_PARAMETER
```

### Fallback

Secret:

```text
AI_REVIEW_FALLBACK_API_KEY
```

Variables:

```text
AI_REVIEW_FALLBACK_ID
AI_REVIEW_FALLBACK_ENDPOINT
AI_REVIEW_FALLBACK_MODEL
AI_REVIEW_FALLBACK_RESPONSE_FORMAT
AI_REVIEW_FALLBACK_MAX_PROMPT_CHARACTERS
AI_REVIEW_FALLBACK_MAX_OUTPUT_TOKENS
AI_REVIEW_FALLBACK_OUTPUT_TOKEN_PARAMETER
```

Required fields for a configured slot are `ID`, `ENDPOINT`, `API_KEY`, and `MODEL`.

`RESPONSE_FORMAT` accepts `json_object` or `none` and defaults to `json_object` when omitted.

`MAX_PROMPT_CHARACTERS` is an optional conservative pre-request capacity guard. It is not a tokenizer or a claim about the provider's exact token context window.

`MAX_OUTPUT_TOKENS` and `OUTPUT_TOKEN_PARAMETER` are optional but must be configured together. `OUTPUT_TOKEN_PARAMETER` accepts:

```text
max_tokens
max_completion_tokens
```

The output budget is sent to the provider before generation. The existing Worker response-size bound remains a separate transport safety limit.

## Provider failure semantics

Provider technical failures do not become review verdicts. Stable classes include:

```text
input_limit
quota
rate_limit
timeout
provider_auth
provider_unavailable
malformed_response
unknown
```

A failed Primary may fall through to an eligible Fallback. When no provider is configured, or all eligible providers fail, execution returns `REVIEW_UNAVAILABLE`; it never manufactures `NO_BLOCKING_FINDINGS`.

## Current production state

At the time of this document update:

```text
mode      review-execution-unpublished
caller    configured
Primary   unconfigured
Fallback  unconfigured
```

No provider/model has been selected by Organization policy. Historical Mobile provider/model configuration is not automatically the Organization choice.

## Publication boundary

The deterministic renderer and stale comparator already exist, but GitHub comment mutation is not enabled.

Before publication is enabled, V1 still requires:

- a separate Worker-only, least-privilege GitHub write credential limited to the Mobile pilot surface;
- immediate trusted-identity re-check before each write;
- deterministic create/update ownership using the Mira review marker;
- explicit stale/unavailable behavior so an obsolete clean review cannot remain current.

## Capacity rule

Control Room remains the runtime carrier for Review Gateway V1. Do not split a standalone Review Gateway merely because provider calls can be slow.

The complete real-provider path must still be measured on the actual Cloudflare plan before claiming CPU/resource headroom. Provider network wait and Worker CPU are different costs; package-only/no-provider smoke is not sufficient evidence for the full path.