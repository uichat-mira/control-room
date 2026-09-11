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
  ├─ resolve ReviewMode -> Review Route
  ├─ resolve Provider Account -> Model -> Transport
  ├─ call the transport driver
  ├─ normalize Mira review result
  ├─ compare freshness / render deterministic output
  └─ GitHub publication                (not enabled yet)
```

A provider account is an execution source. It does not own Mira's policy, verdict vocabulary, trust boundary, review routing, or publication semantics.

## Endpoints

### `GET /api/v1/ai-review/health`

Public-safe capability status. It exposes caller state and mode-specific provider route state, but never credentials, endpoints, or secret values.

### `POST /api/v1/ai-review/package`

Private trusted-package inspection endpoint.

### `POST /api/v1/ai-review/review`

Private unpublished execution endpoint. It rebuilds the trusted package, resolves the route for the package's ReviewMode, executes Routine and technical Fallback when eligible, normalizes the result, and returns execution metadata. It does not write to GitHub.

Private callers send:

```text
Authorization: Bearer <AI_REVIEW_GATEWAY_TOKEN>
Content-Type: application/json
```

The caller cannot supply authoritative head/base SHA, diff, policy text, repository controls, provider, model, endpoint, route, or provider credential.

## Caller credential boundary

`AI_REVIEW_GATEWAY_TOKEN` is a purpose-specific internal bearer. It is deliberately separate from GitHub credentials.

Production uses:

- `AI_REVIEW_GATEWAY_TOKEN` — authenticates trusted calls to private AI Review routes;
- `GITHUB_READ_TOKEN` — lets Control Room reconstruct trusted package data from GitHub;
- provider-account secrets — authenticate Control Room to model suppliers;
- future GitHub publication credential — not implemented yet and must remain Worker-only and separate from all values above.

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

## Provider configuration model

Provider configuration is intentionally not modeled as `PRIMARY_*` / `FALLBACK_*` environment variables.

The trusted model is:

```text
Provider Account
  └─ Transport
      └─ Model

ReviewMode
  └─ Review Route
      ├─ Routine
      ├─ Fallback
      └─ Escalation
```

The source of truth is version controlled:

```text
config/ai-review/providers.json
config/ai-review/routing.json
```

### Provider Account

A Provider Account represents one supplier account or subscription, not one model.

V1 models these accounts:

```text
minimax-cn-codeplan
volcengine-coding-plan
opencode-go
```

Each account declares:

- vendor / plan / region metadata;
- one credential `secretRef`;
- one or more protocol transports;
- models available through that account.

Provider credentials never appear in JSON. The JSON contains only a secret reference such as:

```text
AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY
```

### Transport

Transport is a protocol surface, not a vendor name.

The schema recognizes:

```text
openai-chat
openai-responses
anthropic-messages
```

V1 execution currently implements `openai-chat`. Other transports can be modeled without URL heuristics, but a routed target on an unsupported transport must fail closed instead of silently changing protocol.

This is important because one supplier account can expose multiple protocols, and one aggregator can expose different models through different protocols.

### Model

A model belongs to a Provider Account and selects one declared transport.

Model configuration owns model-level capabilities and conservative review defaults, for example:

- reasoning behavior;
- response-format capability;
- maximum review prompt characters;
- provider-side output token budget;
- the concrete output-token parameter supported by that model/transport.

These values are reviewed as code. They are not copied into GitHub Actions Variables.

### Review Route

Routing is separate from Provider configuration.

For each ReviewMode, the route may contain:

```text
Routine
Fallback
Escalation
```

`Routine` is the normal reviewer.

`Fallback` is technical continuity after a Routine provider failure and must use a different Provider Account from Routine. Changing models inside the same supplier account is not considered provider redundancy.

`Escalation` is a quality/risk upgrade path, not a technical fallback. It is modeled in V1 but is not automatically executed by the current runtime. A later policy slice must define deterministic escalation triggers before it is enabled.

Current routing intent is:

```text
CODE_REVIEW
  Routine     minimax-cn-codeplan / m3
  Fallback    opencode-go / deepseek-v4-flash
  Escalation  opencode-go / deepseek-v4-pro

PROMOTION_REVIEW
  Routine     minimax-cn-codeplan / m3
  Fallback    opencode-go / deepseek-v4-flash
  Escalation  opencode-go / deepseek-v4-pro

RELEASE_REVIEW
  Routine     opencode-go / deepseek-v4-pro
  Fallback    minimax-cn-codeplan / m3
  Escalation  opencode-go / glm-5.3
```

This is routing configuration, not Organization Review Policy. Policy still defines what constitutes a valid Mira review.

## Provider deployment configuration

GitHub Actions only provides provider-account credentials. Non-secret provider metadata does not live in repository settings.

Managed provider secrets are:

```text
AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY
AI_PROVIDER_VOLCENGINE_CODING_PLAN_KEY
AI_PROVIDER_OPENCODE_GO_KEY
```

The deploy workflow:

1. loads and validates the version-controlled provider catalog and routing;
2. rejects routed states that are invalid or use an unsupported transport when credentialed;
3. reconciles managed Worker secrets against GitHub Actions Secrets;
4. injects only non-empty provider account credentials as encrypted Worker secrets;
5. deploys no model/endpoint/budget Actions Variables;
6. verifies post-deploy route state through public-safe health.

Wrangler does not delete an encrypted secret merely because it is omitted from a later deployment. The workflow therefore explicitly removes stale managed provider-account secrets when their desired GitHub Secret is absent. This prevents a disabled account from surviving as a hidden or ghost credential.

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

A failed Routine provider may fall through to its configured cross-account Fallback. When no executable Routine/Fallback provider is configured, or all eligible providers fail, execution returns `REVIEW_UNAVAILABLE`; it never manufactures `NO_BLOCKING_FINDINGS`.

Escalation is not part of this technical fallback loop.

## Current production state

Until a provider-account key is deliberately provisioned, production remains:

```text
mode        review-execution-unpublished
caller      configured
CODE_REVIEW Routine/Fallback unconfigured
```

The catalog and routing may already name intended providers while runtime remains unconfigured because credentials are intentionally absent.

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
