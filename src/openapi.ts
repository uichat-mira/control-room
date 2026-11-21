export function openApiDocument(origin: string) {
  const nullableString = { type: ["string", "null"] };
  const status = { type: "string" };

  return {
    openapi: "3.1.0",
    info: {
      title: "Mira Organization Observability API",
      version: "1.0.0",
      description:
        "Read-only, public-safe observability projection for the uichat-mira GitHub organization and Mira runtime infrastructure.",
    },
    servers: [{ url: origin }],
    tags: [
      { name: "system", description: "API and system health" },
      { name: "github", description: "Public GitHub organization projections" },
      { name: "runtime", description: "Runtime probes and deployments" },
      { name: "governance", description: "Public repository governance and Projects" },
    ],
    paths: {
      "/api/v1": {
        get: {
          tags: ["system"],
          summary: "API discovery",
          responses: { "200": { description: "API metadata" } },
        },
      },
      "/api/v1/health": {
        get: {
          tags: ["system"],
          summary: "Control Room health",
          responses: {
            "200": {
              description: "Healthy API process",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
            },
          },
        },
      },
      "/api/v1/summary": {
        get: {
          tags: ["system"],
          summary: "Organization operational summary",
          description: "Primary public snapshot used by the Control Room UI. Upstream data is cached and may be stale during partial outages.",
          responses: {
            "200": {
              description: "Operational snapshot",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Summary" } } },
            },
          },
        },
      },
      "/api/v1/repos": {
        get: {
          tags: ["github"],
          summary: "Public repositories",
          responses: {
            "200": {
              description: "Repository projection",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RepositoryList" } } },
            },
          },
        },
      },
      "/api/v1/builds": {
        get: {
          tags: ["github"],
          summary: "Latest default-branch build per public repository",
          responses: { "200": { description: "Build projection" } },
        },
      },
      "/api/v1/services": {
        get: {
          tags: ["runtime"],
          summary: "Mira HTTP service probes",
          responses: {
            "200": {
              description: "Service probes",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ServiceList" } } },
            },
          },
        },
      },
      "/api/v1/deployments": {
        get: {
          tags: ["runtime"],
          summary: "Cloudflare Workers and Pages deployments",
          responses: { "200": { description: "Deployment projection" } },
        },
      },
      "/api/v1/analytics": {
        get: {
          tags: ["runtime"],
          summary: "Cloudflare Workers last-24h analytics",
          responses: { "200": { description: "24-hour requests and errors" } },
        },
      },
      "/api/v1/github/facts": {
        get: {
          tags: ["github"],
          summary: "Bounded six-repository GitHub raw fact collection",
          description:
            "Public-safe raw branch, workflow-run, and open-PR facts for the OPS-033 pilot allowlist. Includes coverage, freshness, rate-limit and per-round request-budget evidence. It does not decide attention or required Gate eligibility.",
          responses: {
            "200": {
              description: "Pilot fact snapshot with explicit coverage gaps",
              content: { "application/json": { schema: { $ref: "#/components/schemas/GitHubFacts" } } },
            },
          },
        },
      },
      "/api/v1/github/gates": {
        get: {
          tags: ["github"],
          summary: "Evidence-anchored Actions Gate and release qualification",
          description:
            "Read-only derivation over the exact shared /api/v1/github/facts snapshot. It evaluates applicability by repository, target branch, head SHA, workflow identity, event and run attempt. GitHub required-check configuration is unreadable in this boundary, so required_by_github stays unknown and a workflow outcome is a candidate, not an invented required Gate. Production SHA/smoke stays unverified unless explicit trusted evidence is supplied; a deployment workflow success is not production proof.",
          responses: {
            "200": {
              description: "Gate/release qualification with explicit coverage gaps",
              content: { "application/json": { schema: { $ref: "#/components/schemas/GitHubGates" } } },
            },
          },
        },
      },
      "/api/v1/github/pull": {
        get: {
          tags: ["github"],
          summary: "Single-PR merge-blocker qualification",
          description:
            "On-demand, bounded read-only projection of one public pilot PR. It reads the PR detail, its reviews and the workflow runs for the exact head SHA, then classifies needs_attention/in_progress/observed/unknown. Draft and explicitly sourced Hold/dependency evidence stay out of attention. mergeable=null is unknown, not a conflict. Only a current-head maintainer CHANGES_REQUESTED or a proven required-check failure becomes attention; GitHub required-check configuration remains unknown unless trusted evidence is supplied. Labels, comments and ordinary AI review strings are never parsed as hold or review authority.",
          parameters: [
            {
              name: "repository",
              in: "query",
              required: true,
              schema: {
                type: "string",
                pattern: "^uichat-mira/(mira-desktop|mira-mobile|cloud-auth|mira-cloud|cloud-pi|control-room)$",
              },
            },
            {
              name: "number",
              in: "query",
              required: true,
              schema: { type: "integer", minimum: 1 },
            },
          ],
          responses: {
            "200": {
              description: "Single-PR qualification with explicit coverage and evidence",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/GitHubPullRequest" },
                },
              },
            },
            "400": { description: "Invalid repository or PR number" },
            "404": { description: "Repository is outside the six-repository pilot allowlist" },
          },
        },
      },
      "/api/v1/governance": {
        get: {
          tags: ["governance"],
          summary: "Public repository governance projection",
          description: "Issues, pull requests, default-branch protection, rulesets, and public Projects. This is cached separately from live operational data.",
          responses: { "200": { description: "Governance snapshot" } },
        },
      },
      "/api/v1/factory/runs": {
        get: {
          tags: ["runtime"],
          summary: "Recent real External Worker runs across public organization repositories",
          description: "GitHub Actions only; bounded, cached discovery. Excludes skipped callers and never queries Cloudflare logs.",
          responses: { "200": { description: "Real-run feed and source coverage" }, "503": { description: "GitHub discovery unavailable" } },
        },
      },
      "/api/v1/factory/run": {
        get: {
          tags: ["runtime"],
          summary: "Real External Worker lifecycle projection",
          description:
            "Read-only, sanitized projection of one public GitHub Actions run and optional trusted Reporter events. GitHub remains the lifecycle/evidence source; Reporter is observation-only.",
          parameters: [
            {
              name: "repository",
              in: "query",
              required: true,
              schema: { type: "string", pattern: "^uichat-mira/[A-Za-z0-9_.-]+$" },
            },
            {
              name: "runId",
              in: "query",
              required: true,
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "includeReporter",
              in: "query",
              required: false,
              schema: { type: "boolean", default: true },
              description: "Set false for GitHub-only inspection without a Cloudflare Workers Logs scan.",
            },
          ],
          responses: {
            "200": {
              description: "Real Worker lifecycle projection",
              content: { "application/json": { schema: { $ref: "#/components/schemas/FactoryRun" } } },
            },
            "400": { description: "Invalid query" },
            "404": { description: "Run is not a public Mira External Worker run" },
            "503": { description: "Upstream lifecycle source unavailable" },
          },
        },
      },
      "/api/v1/factory/attention": {
        get: {
          tags: ["runtime"],
          summary: "Worker escalation attention qualification",
          description:
            "Read-only, public-safe qualification of one real External Worker Run. Default is GitHub-only and never queries Workers Observability. A trusted escalated/blocked state needs a verified Issue link plus a readable open Issue to become needs_attention; a closed Issue or a newer same-Issue Run clears it. Missing Reporter/Artifact/Issue evidence is unknown, not a Worker failure. Run success and Draft PR delivery are never acceptance or Issue closure. This is an on-demand single-Run read, not an organization-wide outstanding-Worker count.",
          parameters: [
            {
              name: "repository",
              in: "query",
              required: true,
              schema: { type: "string", pattern: "^uichat-mira/[A-Za-z0-9_.-]+$" },
            },
            {
              name: "runId",
              in: "query",
              required: true,
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "includeReporter",
              in: "query",
              required: false,
              schema: { type: "boolean", default: false },
              description:
                "Explicit trusted-Reporter opt-in. Default false stays GitHub-only and cannot prove escalated/blocked terminal states.",
            },
          ],
          responses: {
            "200": {
              description: "Worker attention candidate with explicit coverage and evidence",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/FactoryAttention" } },
              },
            },
            "400": { description: "Invalid repository or runId" },
            "404": { description: "Run is not a public Mira External Worker run" },
            "503": { description: "Upstream lifecycle or Issue source unavailable" },
          },
        },
      },
      "/api/v1/projects": {
        get: {
          tags: ["governance"],
          summary: "Public GitHub Projects",
          responses: { "200": { description: "Public Project projection" } },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["system"],
          summary: "OpenAPI 3.1 document",
          responses: { "200": { description: "OpenAPI document" } },
        },
      },
    },
    components: {
      schemas: {
        Health: {
          type: "object",
          required: ["apiVersion", "ok", "service", "version", "commit", "githubAuth", "now"],
          properties: {
            apiVersion: { const: "v1" },
            ok: { type: "boolean" },
            service: { type: "string" },
            version: { type: "string" },
            commit: nullableString,
            githubAuth: { enum: ["authenticated", "anonymous"] },
            now: { type: "string", format: "date-time" },
          },
        },
        Workflow: {
          type: ["object", "null"],
          properties: {
            name: { type: "string" },
            status,
            conclusion: nullableString,
            htmlUrl: { type: "string", format: "uri" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Release: {
          type: ["object", "null"],
          properties: {
            tagName: { type: "string" },
            name: nullableString,
            htmlUrl: { type: "string", format: "uri" },
            publishedAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        Repository: {
          type: "object",
          required: ["name", "fullName", "htmlUrl", "visibility", "defaultBranch", "archived", "fork", "updatedAt", "openIssuesCount", "stars"],
          properties: {
            name: { type: "string" },
            fullName: { type: "string" },
            htmlUrl: { type: "string", format: "uri" },
            description: nullableString,
            visibility: { const: "public" },
            defaultBranch: { type: "string" },
            archived: { type: "boolean" },
            fork: { type: "boolean" },
            language: nullableString,
            pushedAt: { type: ["string", "null"], format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            openIssuesCount: { type: "integer", minimum: 0 },
            stars: { type: "integer", minimum: 0 },
            latestWorkflow: { $ref: "#/components/schemas/Workflow" },
            latestRelease: { $ref: "#/components/schemas/Release" },
          },
        },
        FactoryEvidence: {
          type: "object",
          required: ["source", "id", "url", "observedAt"],
          properties: {
            source: { enum: ["github-run", "github-job", "github-artifact", "github-pr", "haomai-event"] },
            id: { type: "string" },
            url: nullableString,
            observedAt: { type: "string", format: "date-time" },
          },
        },
        FactoryEvent: {
          type: "object",
          required: ["occurredAt", "kind", "stage", "outcome", "level", "errorCode", "issueNumber", "evidence"],
          properties: {
            occurredAt: { type: "string", format: "date-time" },
            kind: { type: "string" },
            stage: { type: "string" },
            outcome: { type: "string" },
            level: { type: "string" },
            errorCode: nullableString,
            issueNumber: { type: ["integer", "null"] },
            evidence: { anyOf: [{ $ref: "#/components/schemas/FactoryEvidence" }, { type: "null" }] },
          },
        },
        FactoryJob: {
          type: "object",
          required: ["id", "name", "status", "conclusion", "startedAt", "completedAt", "evidence"],
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            status: { type: "string" },
            conclusion: nullableString,
            startedAt: { type: ["string", "null"], format: "date-time" },
            completedAt: { type: ["string", "null"], format: "date-time" },
            evidence: { $ref: "#/components/schemas/FactoryEvidence" },
          },
        },
        FactoryArtifact: {
          type: "object",
          required: ["id", "name", "expired", "createdAt", "expiresAt", "url", "evidence"],
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            expired: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            expiresAt: { type: ["string", "null"], format: "date-time" },
            url: { type: "string", format: "uri" },
            evidence: { $ref: "#/components/schemas/FactoryEvidence" },
          },
        },
        FactoryPullRequest: {
          type: "object",
          required: ["number", "htmlUrl", "draft", "title", "evidence"],
          properties: {
            number: { type: "integer" },
            htmlUrl: { type: "string", format: "uri" },
            draft: { type: ["boolean", "null"] },
            title: { type: "string" },
            evidence: { $ref: "#/components/schemas/FactoryEvidence" },
          },
        },
        FactoryRun: {
          type: "object",
          required: [
            "apiVersion", "mode", "generatedAt", "repository", "issueNumber", "run",
            "state", "repairRound", "freshness", "provenance", "jobs", "artifacts",
            "pullRequests", "reporter", "warnings",
          ],
          properties: {
            apiVersion: { const: "v1" },
            mode: { const: "real" },
            generatedAt: { type: "string", format: "date-time" },
            repository: { type: "string" },
            issueNumber: { type: ["integer", "null"] },
            run: {
              type: "object",
              required: [
                "id", "attempt", "name", "path", "status", "conclusion", "event",
                "branch", "headSha", "displayTitle", "htmlUrl", "createdAt", "updatedAt",
                "runStartedAt", "referencedExternalWorker",
              ],
              properties: {
                id: { type: "integer" },
                attempt: { type: "integer", minimum: 1 },
                name: { type: "string" },
                path: nullableString,
                status: { type: "string" },
                conclusion: nullableString,
                event: nullableString,
                branch: nullableString,
                headSha: { type: "string" },
                displayTitle: { type: "string" },
                htmlUrl: { type: "string", format: "uri" },
                createdAt: { type: "string", format: "date-time" },
                updatedAt: { type: "string", format: "date-time" },
                runStartedAt: { type: ["string", "null"], format: "date-time" },
                referencedExternalWorker: { type: "boolean", const: true },
              },
            },
            state: { enum: ["queued", "working", "candidate_captured", "validating", "repairing", "validation_gap", "blocked", "verified", "delivery_retry", "delivered", "escalated", "worker_failed", "observation_gap", "logs_expired", "artifact_unavailable", "unknown"] },
            repairRound: { type: ["integer", "null"], minimum: 1, maximum: 2 },
            freshness: { enum: ["fresh", "stale", "expired", "unavailable"] },
            provenance: { type: "array", items: { $ref: "#/components/schemas/FactoryEvidence" } },
            jobs: { type: "array", items: { $ref: "#/components/schemas/FactoryJob" } },
            artifacts: { type: "array", items: { $ref: "#/components/schemas/FactoryArtifact" } },
            pullRequests: { type: "array", items: { $ref: "#/components/schemas/FactoryPullRequest" } },
            reporter: {
              type: "object",
              required: ["status", "freshness", "events", "observedAt"],
              properties: {
                status: { enum: ["available", "unavailable", "expired", "not_configured", "not_expected"] },
                freshness: { enum: ["fresh", "stale", "expired", "unavailable"] },
                events: { type: "array", items: { $ref: "#/components/schemas/FactoryEvent" } },
                observedAt: { type: ["string", "null"], format: "date-time" },
              },
            },
            warnings: { type: "array", items: { type: "string" } },
          },
        },
        Service: {
          type: "object",
          required: ["id", "label", "url", "status", "httpStatus", "latencyMs", "detail"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            url: { type: "string", format: "uri" },
            status: { enum: ["online", "degraded", "offline"] },
            httpStatus: { type: ["integer", "null"] },
            latencyMs: { type: ["integer", "null"] },
            detail: { type: "string" },
          },
        },
        Summary: {
          type: "object",
          required: ["apiVersion", "status", "generatedAt", "organization", "sources", "repositories", "services", "cloudflare", "deployedCommit"],
          properties: {
            apiVersion: { const: "v1" },
            status: { enum: ["connected", "degraded"] },
            generatedAt: { type: "string", format: "date-time" },
            organization: { type: "object", additionalProperties: true },
            sources: { type: "object", additionalProperties: true },
            repositories: { type: "array", items: { $ref: "#/components/schemas/Repository" } },
            services: { type: "array", items: { $ref: "#/components/schemas/Service" } },
            cloudflare: { type: "object", additionalProperties: true },
            deployedCommit: nullableString,
            error: { type: "string" },
          },
        },
        GitHubFacts: {
          type: "object",
          required: [
            "apiVersion", "source", "generatedAt", "status", "authentication",
            "freshness", "scope", "budget", "coverage", "rateLimit", "repositories",
            "warnings",
          ],
          properties: {
            apiVersion: { const: "v1" },
            source: { const: "github-rest" },
            generatedAt: { type: "string", format: "date-time" },
            status: { enum: ["complete", "partial", "unavailable"] },
            authentication: {
              type: "object",
              required: ["mode", "credentialPresent", "note"],
              properties: {
                mode: { enum: ["authenticated", "anonymous"] },
                credentialPresent: { type: "boolean" },
                note: { type: "string" },
              },
            },
            freshness: {
              type: "object",
              required: ["observedAt", "maxAgeSeconds", "ageSeconds", "state"],
              properties: {
                observedAt: { type: "string", format: "date-time" },
                maxAgeSeconds: { type: "integer", minimum: 1 },
                ageSeconds: { type: "integer", minimum: 0 },
                state: { enum: ["fresh", "stale"] },
              },
            },
            scope: { type: "object", additionalProperties: true },
            budget: { type: "object", additionalProperties: true },
            coverage: { type: "object", additionalProperties: true },
            rateLimit: { type: "object", additionalProperties: true },
            repositories: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
            warnings: { type: "array", items: { type: "string" } },
            error: { type: "string" },
          },
        },
        GitHubGates: {
          type: "object",
          required: [
            "apiVersion", "source", "generatedAt", "factsGeneratedAt", "factsStatus",
            "requiredCheckEvidence", "productionEvidence", "coverage", "repositories",
            "candidates", "warnings",
          ],
          properties: {
            apiVersion: { const: "v1" },
            source: { const: "github-facts-derivation" },
            generatedAt: { type: "string", format: "date-time" },
            factsGeneratedAt: { type: "string", format: "date-time" },
            factsStatus: { enum: ["complete", "partial", "unavailable"] },
            requiredCheckEvidence: { enum: ["unavailable", "supplied"] },
            productionEvidence: { enum: ["unavailable", "supplied", "partial"] },
            coverage: { type: "object", additionalProperties: true },
            repositories: { type: "array", items: { type: "object", additionalProperties: true } },
            candidates: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id", "category", "classification", "priority", "who", "what",
                  "whyNow", "nextStep", "evidence", "observedAt", "exitCondition",
                ],
                properties: {
                  id: { type: "string" },
                  category: { enum: ["actions_gate", "deployment"] },
                  classification: { enum: ["attention", "in_progress", "unknown", "observation"] },
                  priority: { enum: ["P0", "P1", "P2", "P3", null] },
                  who: { type: "string" },
                  what: { type: "string" },
                  whyNow: { type: "string" },
                  nextStep: { type: "string" },
                  evidence: { type: "array", items: { type: "object", additionalProperties: true } },
                  observedAt: { type: ["string", "null"], format: "date-time" },
                  exitCondition: { type: "string" },
                },
              },
            },
            warnings: { type: "array", items: { type: "string" } },
          },
        },
        GitHubPullRequest: {
          type: "object",
          required: [
            "apiVersion", "source", "generatedAt", "factsGeneratedAt", "factsStatus",
            "id", "repository", "number", "status", "classification", "priority",
            "who", "what", "whyNow", "nextStep", "evidence", "observedAt",
            "exitCondition", "review", "checks", "hold", "signals", "coverage",
            "warnings",
          ],
          properties: {
            apiVersion: { const: "v1" },
            source: { const: "github-pr-derivation" },
            generatedAt: { type: "string", format: "date-time" },
            factsGeneratedAt: { type: "string", format: "date-time" },
            factsStatus: { enum: ["complete", "partial", "unavailable"] },
            id: { type: "string", pattern: "^pr:uichat-mira/[A-Za-z0-9_.-]+#[0-9]+$" },
            repository: { type: "string" },
            number: { type: "integer", minimum: 1 },
            status: { enum: ["needs_attention", "in_progress", "observed", "unknown"] },
            classification: { enum: ["attention", "in_progress", "unknown", "observation"] },
            priority: { enum: ["P0", "P1", "P2", "P3", null] },
            who: { type: "string" },
            what: { type: "string" },
            whyNow: { type: "string" },
            nextStep: { type: "string" },
            evidence: { type: "array", items: { type: "object", additionalProperties: true } },
            observedAt: { type: ["string", "null"], format: "date-time" },
            exitCondition: { type: "string" },
            state: { type: ["string", "null"] },
            draft: { type: ["boolean", "null"] },
            merged: { type: ["boolean", "null"] },
            baseRef: { type: ["string", "null"] },
            headSha: { type: ["string", "null"] },
            mergeable: { type: ["boolean", "null"] },
            mergeableState: { type: ["string", "null"] },
            review: { type: "object", additionalProperties: true },
            checks: { type: "object", additionalProperties: true },
            hold: { type: "object", additionalProperties: true },
            signals: { type: "array", items: { type: "object", additionalProperties: true } },
            coverage: { type: "object", additionalProperties: true },
            warnings: { type: "array", items: { type: "string" } },
          },
        },
        FactoryAttention: {
          type: "object",
          required: [
            "apiVersion", "source", "id", "category", "status", "classification",
            "priority", "who", "what", "whyNow", "whatSystemTried", "nextStep",
            "evidence", "observedAt", "exitCondition", "identity", "state",
            "repairRound", "freshness", "reporter", "issue", "signals", "coverage",
            "warnings",
          ],
          properties: {
            apiVersion: { const: "v1" },
            source: { const: "factory-attention-derivation" },
            id: { type: "string", pattern: "^worker:uichat-mira/" },
            category: { const: "worker_escalation" },
            status: { enum: ["needs_attention", "in_progress", "observed", "unknown"] },
            classification: { enum: ["attention", "in_progress", "observation", "unknown"] },
            priority: { enum: ["P0", "P1", "P2", "P3", null] },
            who: { type: "string" },
            what: { type: "string" },
            whyNow: { type: "string" },
            whatSystemTried: { type: "string" },
            nextStep: { type: "string" },
            evidence: { type: "array", items: { type: "object", additionalProperties: true } },
            observedAt: { type: ["string", "null"], format: "date-time" },
            exitCondition: { type: "string" },
            identity: {
              type: "object",
              required: [
                "repository", "issueNumber", "issueUrl", "issueLinkSource",
                "runId", "attempt", "runUrl", "candidateArtifact",
              ],
              properties: {
                repository: { type: "string" },
                issueNumber: { type: ["integer", "null"], minimum: 1 },
                issueUrl: { type: ["string", "null"] },
                issueLinkSource: { enum: ["trusted-reporter", "trusted-issue-evidence", null] },
                runId: { type: "integer", minimum: 1 },
                attempt: { type: "integer", minimum: 1 },
                runUrl: { type: "string" },
                candidateArtifact: { type: ["object", "null"], additionalProperties: true },
              },
            },
            state: { type: "string" },
            repairRound: { type: ["integer", "null"] },
            freshness: { enum: ["fresh", "stale", "expired", "unavailable"] },
            reporter: { type: "object", additionalProperties: true },
            issue: { type: "object", additionalProperties: true },
            signals: { type: "array", items: { type: "object", additionalProperties: true } },
            coverage: { type: "object", additionalProperties: true },
            warnings: { type: "array", items: { type: "string" } },
            scope: { type: "object", additionalProperties: true },
            budget: { type: "object", additionalProperties: true },
          },
        },
        RepositoryList: {
          type: "object",
          required: ["apiVersion", "generatedAt", "status", "items"],
          properties: {
            apiVersion: { const: "v1" },
            generatedAt: { type: "string", format: "date-time" },
            status: { enum: ["connected", "degraded"] },
            items: { type: "array", items: { $ref: "#/components/schemas/Repository" } },
          },
        },
        ServiceList: {
          type: "object",
          required: ["apiVersion", "generatedAt", "status", "items"],
          properties: {
            apiVersion: { const: "v1" },
            generatedAt: { type: "string", format: "date-time" },
            status: { enum: ["connected", "degraded"] },
            items: { type: "array", items: { $ref: "#/components/schemas/Service" } },
          },
        },
      },
    },
  };
}
