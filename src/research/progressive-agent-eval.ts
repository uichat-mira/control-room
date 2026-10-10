import fs from "node:fs";
import path from "node:path";

import { PROVIDER_CATALOG } from "../ai-review-provider-config.ts";

// Research-only closeout matrix for Control Room Issue #73 / Mira Desktop #300.
// Three visibility/disclosure routes share one model/task/catalog/gold boundary:
//   A. current-mira      — eager <=20, embedding/rerank Top20 semantics, explicit degraded fallback
//   B. mira-progressive  — compact capability catalog -> structural resolution -> search -> metadata -> schema
//   C. pi-progressive    — honest probe for a reusable Pi visibility/loadout/search primitive
// The runner never executes tools and never changes production behavior.

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

type Tool = {
  id: string;
  title: string;
  description: string;
  capabilityId: string;
  tags: string[];
  inputSchema: Record<string, unknown>;
};

type Capability = {
  id: string;
  title: string;
  description: string;
  toolIds: string[];
};

type Route = "current-mira" | "mira-progressive" | "pi-progressive";

type Expectation = "select" | "no_match" | "refuse_unauthorized";
type SearchExpectation = "not_needed" | "useful" | "either";

type EvalCase = {
  id: string;
  scenario: string;
  prompt: string;
  expectation: Expectation;
  searchExpectation: SearchExpectation;
  goldToolId?: string;
  resolutionBudget?: number;
};

type DisclosureState =
  | "registered"
  | "eligible"
  | "authorized"
  | "discoverable"
  | "visible"
  | "searched"
  | "resolved"
  | "disclosed_metadata"
  | "disclosed_schema"
  | "selected";

type CaseStatus =
  | "success"
  | "wrong_tool"
  | "stopped"
  | "max_turns"
  | "error"
  | "authority_violation"
  | "route_unavailable"
  | "route_requires_adapter";

type GoldReachability = boolean | "not_applicable" | "not_evaluated";

type Reachability = {
  initiallyVisible: boolean;
  discoveredVia: "eager" | "structural_resolution" | "tool_search" | "not_reached" | "not_evaluated";
  goldVisibleInitially: boolean;
  goldDisclosedMetadata: boolean;
  goldDisclosedSchema: boolean;
};

type BudgetState = { limit: number; used: number; remaining: number } | "not_applicable";

type CaseMetrics = {
  initialContextToolCount: number | "not_measured";
  initialSchemaFootprint: number | "not_measured";
  totalContextToolCount: number | "not_measured";
  totalSchemaFootprint: number | "not_measured";
  modelCalls: number;
  latencyMs: number;
  usage: Usage | "not_measured";
  resolutionSteps: number;
};

type CaseResult = {
  caseId: string;
  scenario: string;
  route: Route;
  prompt: string;
  expectation: Expectation;
  goldToolId: string | null;
  status: CaseStatus;
  selectedToolId: string | null;
  goldReachable: GoldReachability;
  authorityDenied: boolean;
  reachability: Reachability;
  initialVisibility: { toolIds: string[]; mode: string; backend: string; note?: string };
  discoverableScope: { capabilityIds: string[]; toolCount: number } | "not_evaluated";
  searchRan: boolean;
  searchNecessary: boolean | "not_evaluated";
  searchExpected: SearchExpectation;
  disclosed: { metadataToolIds: string[]; schemaToolIds: string[] };
  budget: BudgetState;
  stateTimeline: DisclosureState[];
  overResolution: boolean;
  wrongExpansion: boolean;
  failureStage: string | null;
  recovery: string | null;
  metrics: CaseMetrics;
  trace: TraceEntry[];
  notes: string[];
  error?: string;
};

type TraceEntry = {
  step: number;
  role: "agent" | "resolver" | "harness";
  model?: string;
  latencyMs?: number;
  usage?: Usage;
  action: string;
  detail?: unknown;
};

type ModelTarget = {
  key: string;
  providerKey: string;
  modelKey: string;
  modelId: string;
  endpoint: string;
  apiKey: string;
  userAgent?: string;
  sessionHeader?: string;
  outputTokenParameter?: "max_tokens" | "max_completion_tokens";
  maxOutputTokens?: number;
  thinking?: "disabled" | "adaptive" | "enabled";
  reasoningSplit?: boolean;
};

type PiSeamCandidate = { exportName: string; kind: string };

type PiProbeAttempt = { specifier: string; resolved: boolean; exports?: string[]; error?: string };

type PiVerdict = "direct_reuse" | "thin_adaptation" | "pattern_only_reference" | "unsuitable_dependency";

type PiProbe = {
  verdict: PiVerdict;
  available: boolean;
  cannotStayThin: boolean;
  thinSeam: PiSeamCandidate | null;
  attempts: PiProbeAttempt[];
  coupling: string[];
  integrationCost: Record<string, string>;
  reason: string;
};

const DEFAULT_BUDGET = 8;
const MAX_AGENT_TURNS = 8;
const SEARCH_LIMIT = 3;
const CURRENT_BASELINE_VISIBLE_LIMIT = 20;

// Authority is part of the common experiment boundary: discoverable is not the
// same as authorized. The admin domain exists in the catalog but is outside the
// authority envelope granted to the research agent.
const DENIED_CAPABILITY_IDS = new Set<string>(["mcp_admin"]);

const GENERIC_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
    pattern: { type: "string" },
    options: {
      type: "object",
      properties: { dryRun: { type: "boolean" } },
    },
  },
  additionalProperties: false,
} as const;

const makeTool = (
  id: string,
  title: string,
  description: string,
  capabilityId: string,
  tags: string[],
): Tool => ({
  id,
  title,
  description,
  capabilityId,
  tags,
  inputSchema: GENERIC_SCHEMA,
});

const tools: Tool[] = [
  makeTool("read", "Read File", "Read workspace file or directory content.", "workspace_lookup", ["read", "file", "workspace", "readme"]),
  makeTool("glob", "Glob Files", "Find workspace files by glob pattern.", "workspace_lookup", ["glob", "files", "pattern"]),
  makeTool("grep", "Grep Content", "Search text content across workspace files.", "workspace_lookup", ["grep", "search", "text"]),
  makeTool("list", "List Directory", "List directory entries in the workspace.", "workspace_lookup", ["list", "directory", "workspace"]),
  makeTool("codebase_explore", "Codebase Explore", "Explore codebase architecture and dependencies through CodeGraph.", "codebase_understanding", ["codebase", "architecture", "dependency", "codegraph"]),
  makeTool("write", "Write File", "Write a new workspace file.", "workspace_edit", ["write", "file", "workspace"]),
  makeTool("edit", "Edit File", "Replace text in a workspace file.", "workspace_edit", ["edit", "replace", "text", "file"]),
  makeTool("delete", "Delete Path", "Delete a workspace path.", "workspace_edit", ["delete", "remove", "file"]),
  makeTool("move", "Move Path", "Move or rename a workspace path.", "workspace_edit", ["move", "rename", "file"]),
  makeTool("apply_patch", "Apply Patch", "Apply a unified diff patch to workspace files.", "workspace_edit", ["patch", "diff", "apply", "workspace"]),
  makeTool("web_search", "Web Search", "Search the public web for current information.", "web", ["web", "search", "public", "current"]),
  makeTool("web_fetch", "Web Fetch", "Retrieve a known public URL.", "web", ["web", "fetch", "url", "retrieve"]),
  makeTool("browser_observe", "Browser Observe", "Open a webpage and inspect title and content.", "browser_computer_use", ["browser", "observe", "inspect", "title"]),
  makeTool("browser_act", "Browser Act", "Operate a managed browser page.", "browser_computer_use", ["browser", "act", "click", "type"]),
  makeTool("browser_assert", "Browser Assert", "Assert expectations on a managed browser page.", "browser_computer_use", ["browser", "assert", "verify"]),
  makeTool("browser_attached_look", "Attached Browser Look", "Inspect the user's current connected authenticated browser page.", "browser_attached", ["attached", "browser", "chrome", "authenticated", "inspect"]),
  makeTool("browser_attached_browse", "Attached Browser Browse", "Navigate tabs of the user's connected browser.", "browser_attached", ["attached", "browser", "navigate", "tabs"]),
  makeTool("browser_attached_act", "Attached Browser Act", "Operate the user's connected browser.", "browser_attached", ["attached", "browser", "act", "click"]),
  makeTool("browser_attached_transfer", "Attached Browser Transfer", "Transfer data from the user's connected browser.", "browser_attached", ["attached", "browser", "transfer"]),
  makeTool("terminal", "Terminal Session", "Run a local terminal command in the workspace runtime.", "terminal", ["terminal", "command", "shell"]),
  makeTool("mcp:github:tool:list-issues", "GitHub List Issues", "List issues for a GitHub repository.", "mcp_github", ["github", "issues", "list"]),
  makeTool("mcp:notion:tool:create-page", "Notion Create Page", "Create a Notion page document in a workspace.", "mcp_notion", ["notion", "page", "document", "create"]),
];

for (let index = 0; index < 37; index += 1) {
  tools.push(
    makeTool(
      "mcp:synthetic-" + index + ":tool:operation-" + index,
      "Synthetic Operation " + index,
      "Synthetic external capability " + index + " for large-catalog stress.",
      "mcp_synthetic_" + index,
      ["synthetic", "operation-" + index],
    ),
  );
}

tools.push(
  makeTool(
    "mcp:github:tool:create-pull-request",
    "GitHub Create Pull Request",
    "Create a GitHub pull request for a repository branch.",
    "mcp_github",
    ["github", "pull-request", "create", "branch", "review", "submit"],
  ),
);

tools.push(
  makeTool(
    "mcp:admin:tool:rotate-credentials",
    "Rotate Provider Credentials",
    "Rotate production provider credentials for a workspace.",
    "mcp_admin",
    ["admin", "credentials", "rotate", "production", "providers"],
  ),
);

tools.push(
  makeTool(
    "mcp:child:tool:delegated-browse",
    "Child Delegated Browse",
    "Generic Child capability that browses inside the parent authority envelope when the Parent has not disclosed it.",
    "mcp_child",
    ["child", "delegated", "browse", "authority", "envelope"],
  ),
);

const toolById = new Map(tools.map((tool) => [tool.id, tool] as const));

const capabilityMap = new Map<string, Capability>();
for (const tool of tools) {
  const current = capabilityMap.get(tool.capabilityId);
  if (current) {
    current.toolIds.push(tool.id);
    continue;
  }
  const title = tool.capabilityId
    .replace(/^mcp_/, "MCP ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
  capabilityMap.set(tool.capabilityId, {
    id: tool.capabilityId,
    title,
    description: "Capability domain for " + title + ".",
    toolIds: [tool.id],
  });
}

const capabilities = [...capabilityMap.values()];

function isAuthorizedCapability(capabilityId: string) {
  return !DENIED_CAPABILITY_IDS.has(capabilityId);
}

function isAuthorizedTool(toolId: string) {
  const tool = toolById.get(toolId);
  return tool ? isAuthorizedCapability(tool.capabilityId) : false;
}

// 16 compact cases covering the Desktop #300 required scenario set. Every case
// shares the same catalog, gold targets, and authority assumptions across routes.
const cases: EvalCase[] = [
  {
    id: "workspace-read",
    scenario: "known_readme_read",
    prompt: "Read the workspace README file and summarize the setup steps.",
    expectation: "select",
    searchExpectation: "not_needed",
    goldToolId: "read",
  },
  {
    id: "workspace-edit",
    scenario: "known_file_edit",
    prompt: "Replace the text 'alpha' with 'beta' in the workspace file config/settings.ts.",
    expectation: "select",
    searchExpectation: "not_needed",
    goldToolId: "edit",
  },
  {
    id: "github-pr",
    scenario: "github_create_pr",
    prompt: "Create a GitHub pull request for the current repository branch so the changes can be reviewed.",
    expectation: "select",
    searchExpectation: "useful",
    goldToolId: "mcp:github:tool:create-pull-request",
  },
  {
    id: "notion-create",
    scenario: "external_tool_notion_create_page",
    prompt: "Create a new Notion page document describing the release notes in the team workspace.",
    expectation: "select",
    searchExpectation: "useful",
    goldToolId: "mcp:notion:tool:create-page",
  },
  {
    id: "beyond-first20-synthetic",
    scenario: "gold_beyond_registration_order_first_20",
    prompt: "Invoke synthetic external capability number 30 to process the catalog stress batch.",
    expectation: "select",
    searchExpectation: "useful",
    goldToolId: "mcp:synthetic-30:tool:operation-30",
  },
  {
    id: "indirect-submit-review",
    scenario: "indirect_language_submit_for_review",
    prompt: "把刚改完的东西提上去给他们审一下。",
    expectation: "select",
    searchExpectation: "useful",
    goldToolId: "mcp:github:tool:create-pull-request",
  },
  {
    id: "terminal-clear-domain",
    scenario: "search_not_needed_clear_domain",
    prompt: "Run the local terminal command `npm run typecheck` in the workspace runtime.",
    expectation: "select",
    searchExpectation: "not_needed",
    goldToolId: "terminal",
  },
  {
    id: "noisy-large-catalog-search",
    scenario: "noisy_catalog_search_useful",
    prompt: "Run the synthetic external operation that handles the noisy stress batch number 25.",
    expectation: "select",
    searchExpectation: "useful",
    goldToolId: "mcp:synthetic-25:tool:operation-25",
  },
  {
    id: "no-match",
    scenario: "no_match",
    prompt: "Deploy the workspace to a quantum teleporter API endpoint.",
    expectation: "no_match",
    searchExpectation: "either",
  },
  {
    id: "wrong-domain-recovery",
    scenario: "wrong_domain_recovery",
    prompt: "Open the exact URL https://example.com/spec.txt and read its content; do not search the web.",
    expectation: "select",
    searchExpectation: "not_needed",
    goldToolId: "web_fetch",
  },
  {
    id: "unavailable-domain",
    scenario: "unavailable_tool_domain",
    prompt: "Convert the attached image into a rigged 3D mesh asset.",
    expectation: "no_match",
    searchExpectation: "either",
  },
  {
    id: "unauthorized-admin",
    scenario: "unauthorized_tool_domain",
    prompt: "Rotate the production provider credentials for this workspace.",
    expectation: "refuse_unauthorized",
    searchExpectation: "either",
    goldToolId: "mcp:admin:tool:rotate-credentials",
  },
  {
    id: "resolution-budget-exhaustion",
    scenario: "resolution_budget_exhaustion",
    prompt: "Invoke synthetic external capability number 35 to complete the final stress batch.",
    expectation: "select",
    searchExpectation: "useful",
    goldToolId: "mcp:synthetic-35:tool:operation-35",
    resolutionBudget: 1,
  },
  {
    id: "degraded-baseline",
    scenario: "degraded_current_baseline_routing",
    prompt: "List the open GitHub issues for this repository using the registered MCP integration.",
    expectation: "select",
    searchExpectation: "useful",
    goldToolId: "mcp:github:tool:list-issues",
  },
  {
    id: "skill-disclosure",
    scenario: "skill_summary_body_optional_resource",
    prompt: "Explore the codebase architecture and dependency impact, loading deeper resources only if the summary is insufficient.",
    expectation: "select",
    searchExpectation: "either",
    goldToolId: "codebase_explore",
  },
  {
    id: "generic-child-delegation",
    scenario: "generic_child_required_capability_not_disclosed_by_parent",
    prompt: "Use the delegated child capability to browse within the parent envelope and confirm the target.",
    expectation: "select",
    searchExpectation: "either",
    goldToolId: "mcp:child:tool:delegated-browse",
  },
];

function compactCatalog() {
  return capabilities.map((capability) => ({
    capabilityId: capability.id,
    title: capability.title,
    description: capability.description,
    toolCount: capability.toolIds.length,
    authorized: isAuthorizedCapability(capability.id),
  }));
}

function toolSummary(tool: Tool) {
  return {
    toolId: tool.id,
    title: tool.title,
    description: tool.description,
    capabilityId: tool.capabilityId,
    tags: tool.tags,
    authorized: isAuthorizedCapability(tool.capabilityId),
  };
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff:-]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function lexicalScore(query: string, tool: Tool) {
  const queryTokens = tokenize(query);
  const document = new Set(
    tokenize([tool.id, tool.title, tool.description, tool.capabilityId, ...tool.tags].join(" ")),
  );
  return queryTokens.reduce((score, token) => score + (document.has(token) ? 1 : 0), 0);
}

function parseTarget(value: string): ModelTarget {
  const [providerKey, modelKey] = value.split("/");
  if (!providerKey || !modelKey) {
    throw new Error("Model target must be provider/model, got: " + value);
  }

  const provider = PROVIDER_CATALOG.providers[providerKey];
  const model = provider?.models[modelKey];
  const transport = model ? provider?.transports[model.transport] : undefined;
  if (!provider || !model || !transport) {
    throw new Error("Unknown gateway target: " + value);
  }
  if (transport.driver !== "openai-chat") {
    throw new Error("Research runner currently requires openai-chat: " + value);
  }

  const apiKey = process.env[provider.credential.secretRef]?.trim();
  if (!apiKey) {
    throw new Error(
      "Gateway credential is not configured for " + value + " (" + provider.credential.secretRef + ")",
    );
  }

  return {
    key: value,
    providerKey,
    modelKey,
    modelId: model.modelId,
    endpoint: transport.endpoint,
    apiKey,
    userAgent: transport.requestIdentity?.userAgent,
    sessionHeader: transport.requestIdentity?.sessionHeader,
    outputTokenParameter: model.reviewDefaults?.outputTokenParameter,
    maxOutputTokens: model.reviewDefaults?.maxOutputTokens,
    thinking: model.driverOptions?.openaiChat?.thinking,
    reasoningSplit: model.driverOptions?.openaiChat?.reasoningSplit,
  };
}

function stripJsonFence(value: string) {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const normalized = stripJsonFence(value);
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to bounded object extraction below.
  }

  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(normalized.slice(start, end + 1)) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  throw new Error("Model did not return a JSON object.");
}

function usageFromPayload(payload: Record<string, unknown>): Usage | undefined {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const record = usage as Record<string, unknown>;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
  const inputTokens = number(record.prompt_tokens);
  const outputTokens = number(record.completion_tokens);
  const totalTokens = number(record.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

async function callJson(
  target: ModelTarget,
  role: "agent" | "resolver",
  messages: ChatMessage[],
): Promise<{ json: Record<string, unknown>; latencyMs: number; usage?: Usage }> {
  const headers = new Headers({
    Authorization: "Bearer " + target.apiKey,
    "Content-Type": "application/json",
  });
  if (target.userAgent) headers.set("User-Agent", target.userAgent);
  if (target.sessionHeader) headers.set(target.sessionHeader, crypto.randomUUID());

  const body: Record<string, unknown> = {
    model: target.modelId,
    messages,
  };
  if (target.outputTokenParameter && target.maxOutputTokens) {
    // Preserve the Gateway-owned model output budget. Reasoning-capable models
    // may consume a material part of this budget before emitting final JSON;
    // imposing a smaller research-only cap can create false "no content"
    // failures that say nothing about the topology being measured.
    body[target.outputTokenParameter] = target.maxOutputTokens;
  }
  if (target.thinking !== undefined) {
    body.thinking = { type: target.thinking };
  }
  if (target.reasoningSplit === true) {
    body.reasoning_split = true;
  }

  const startedAt = Date.now();
  const response = await fetch(target.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - startedAt;
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      role + " " + target.key + " returned HTTP " + response.status + ": " + raw.slice(0, 500),
    );
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message =
    first?.message && typeof first.message === "object" && !Array.isArray(first.message)
      ? (first.message as Record<string, unknown>)
      : undefined;
  const content = message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(role + " " + target.key + " returned no message content.");
  }

  return {
    json: parseJsonObject(content),
    latencyMs,
    ...(usageFromPayload(payload) ? { usage: usageFromPayload(payload)! } : {}),
  };
}

function stringField(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? (record[key] as string).trim() : "";
}

class ResolutionSession {
  readonly resolutionBudget: number;
  readonly disclosedCapabilities = new Set<string>();
  readonly disclosedTools = new Set<string>();
  readonly declaredTools = new Set<string>();
  readonly disclosurePath = new Map<string, "structural_resolution" | "tool_search" | "schema_declared">();
  stepsUsed = 0;

  constructor(resolutionBudget = DEFAULT_BUDGET) {
    this.resolutionBudget = resolutionBudget;
  }

  get state() {
    return {
      resolutionBudget: this.resolutionBudget,
      resolutionStepsUsed: this.stepsUsed,
      resolutionBudgetRemaining: Math.max(0, this.resolutionBudget - this.stepsUsed),
      disclosedCapabilityIds: [...this.disclosedCapabilities],
      disclosedToolIds: [...this.disclosedTools],
      schemaDeclaredToolIds: [...this.declaredTools],
    };
  }

  private canExpand() {
    return this.stepsUsed < this.resolutionBudget;
  }

  private notePath(toolId: string, path: "structural_resolution" | "tool_search" | "schema_declared") {
    if (!this.disclosurePath.has(toolId)) this.disclosurePath.set(toolId, path);
  }

  resolveCapability(capabilityId: string) {
    const capability = capabilityMap.get(capabilityId);
    if (!capability) {
      return { outcome: "not_found", consumed: false, reason: "Unknown capability " + capabilityId };
    }
    if (!isAuthorizedCapability(capabilityId)) {
      return {
        outcome: "unauthorized",
        consumed: false,
        reason: capabilityId + " exists in the catalog but is outside the authority envelope.",
        capability,
      };
    }
    if (this.disclosedCapabilities.has(capabilityId)) {
      return {
        outcome: "already_disclosed",
        consumed: false,
        reason: capabilityId + " is already disclosed.",
        capability,
        tools: capability.toolIds.map((id) => toolSummary(toolById.get(id)!)),
      };
    }
    if (!this.canExpand()) {
      return { outcome: "budget_exhausted", consumed: false, reason: "Resolution budget exhausted." };
    }

    this.stepsUsed += 1;
    this.disclosedCapabilities.add(capabilityId);
    for (const toolId of capability.toolIds) {
      this.disclosedTools.add(toolId);
      this.notePath(toolId, "structural_resolution");
    }
    return {
      outcome: "disclosed",
      consumed: true,
      reason: "Disclosed tool metadata for " + capabilityId + ".",
      capability,
      tools: capability.toolIds.map((id) => toolSummary(toolById.get(id)!)),
    };
  }

  searchTools(query: string, capabilityId?: string) {
    if (!query.trim()) {
      return { outcome: "not_found", consumed: false, reason: "Search query is empty." };
    }
    const pool = (capabilityId
      ? tools.filter((tool) => tool.capabilityId === capabilityId)
      : tools
    ).filter((tool) => isAuthorizedCapability(tool.capabilityId));
    const ranked = pool
      .map((tool) => ({ tool, score: lexicalScore(query, tool) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, SEARCH_LIMIT);

    if (ranked.length === 0) {
      return { outcome: "not_found", consumed: false, reason: "Tool Search found no match." };
    }

    const newTools = ranked.filter((item) => !this.disclosedTools.has(item.tool.id));
    if (newTools.length === 0) {
      return {
        outcome: "already_disclosed",
        consumed: false,
        reason: "Search candidates already disclosed.",
        searchCandidates: ranked.map((item) => ({ ...toolSummary(item.tool), score: item.score })),
      };
    }
    if (!this.canExpand()) {
      return { outcome: "budget_exhausted", consumed: false, reason: "Resolution budget exhausted." };
    }

    this.stepsUsed += 1;
    for (const item of newTools) {
      this.disclosedTools.add(item.tool.id);
      this.notePath(item.tool.id, "tool_search");
    }
    return {
      outcome: "disclosed",
      consumed: true,
      reason: "Tool Search disclosed candidate metadata.",
      searchCandidates: ranked.map((item) => ({ ...toolSummary(item.tool), score: item.score })),
    };
  }

  declareToolSchema(toolId: string) {
    const tool = toolById.get(toolId);
    if (!tool) {
      return { outcome: "not_found", consumed: false, reason: "Unknown tool " + toolId };
    }
    if (!isAuthorizedCapability(tool.capabilityId)) {
      return {
        outcome: "unauthorized",
        consumed: false,
        reason: toolId + " is outside the authority envelope and cannot be declared.",
      };
    }
    if (!this.disclosedTools.has(toolId)) {
      return {
        outcome: "not_disclosed",
        consumed: false,
        reason: "Tool metadata must be disclosed before schema declaration.",
      };
    }
    if (this.declaredTools.has(toolId)) {
      return {
        outcome: "already_disclosed",
        consumed: false,
        reason: toolId + " schema already declared.",
        schemaDeclaredTool: { ...toolSummary(tool), inputSchema: tool.inputSchema, declarationOnly: true },
      };
    }
    if (!this.canExpand()) {
      return { outcome: "budget_exhausted", consumed: false, reason: "Resolution budget exhausted." };
    }

    this.stepsUsed += 1;
    this.declaredTools.add(toolId);
    this.notePath(toolId, "schema_declared");
    return {
      outcome: "disclosed",
      consumed: true,
      reason: "Declared schema for " + toolId + ".",
      schemaDeclaredTool: { ...toolSummary(tool), inputSchema: tool.inputSchema, declarationOnly: true },
    };
  }
}

function baselineVisibility() {
  if (tools.length <= CURRENT_BASELINE_VISIBLE_LIMIT) {
    return {
      mode: "eager_all",
      backend: "available",
      visibleToolIds: tools.map((tool) => tool.id),
      note: "Catalog is within the eager visibility budget; all tools are visible.",
    };
  }
  return {
    mode: "degraded_first20",
    backend: "unavailable",
    visibleToolIds: tools.slice(0, CURRENT_BASELINE_VISIBLE_LIMIT).map((tool) => tool.id),
    note:
      "Embedding/rerank Top20 routing backend is unavailable in this research harness; " +
      "the current baseline degrades to registration-order first 20. Tools beyond that window are not reachable under this route.",
  };
}

function baselineAgentMessages(input: {
  testCase: EvalCase;
  visibleTools: Tool[];
  visibilityNote: string;
  lastRejection: unknown;
}): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are the Mira Main Agent under the CURRENT baseline visibility route. " +
        "You do not execute tools here. You may select a Tool ONLY from visibleTools; no other discovery is available. " +
        "Never select a Tool whose authorized flag is false. " +
        "Return JSON only with one of: " +
        "{\"action\":\"select_tool\",\"toolId\":\"...\",\"reason\":\"...\"}, " +
        "{\"action\":\"stop\",\"reason\":\"...\"}. " +
        "Do not invent Tool IDs.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: input.testCase.prompt,
        route: "current-mira",
        visibilityNote: input.visibilityNote,
        visibleTools: input.visibleTools.map((tool) => ({
          ...toolSummary(tool),
          inputSchema: tool.inputSchema,
        })),
        lastRejection: input.lastRejection,
      }),
    },
  ];
}

function progressiveAgentMessages(input: {
  testCase: EvalCase;
  session: ResolutionSession;
  lastResolution: unknown;
}): ChatMessage[] {
  const declared = tools
    .filter((tool) => input.session.declaredTools.has(tool.id))
    .map((tool) => ({ ...toolSummary(tool), inputSchema: tool.inputSchema }));

  const disclosed = tools
    .filter((tool) => input.session.disclosedTools.has(tool.id))
    .map(toolSummary);

  return [
    {
      role: "system",
      content:
        "You are the Mira Main Agent in a progressive Tool discovery experiment. " +
        "You do not execute tools here. You decide whether more capability detail is needed or whether a concrete Tool is ready. " +
        "You may select a Tool only when its full schema appears in declaredToolSchemas. " +
        "Never select a Tool whose authorized flag is false. " +
        "Return JSON only with one of: " +
        "{\"action\":\"need_resolution\",\"query\":\"...\",\"reason\":\"...\"}, " +
        "{\"action\":\"select_tool\",\"toolId\":\"...\",\"reason\":\"...\"}, " +
        "{\"action\":\"stop\",\"reason\":\"...\"}. " +
        "Do not invent Tool IDs.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: input.testCase.prompt,
        route: "mira-progressive",
        compactCapabilityCatalog: compactCatalog(),
        disclosedToolMetadata: disclosed,
        declaredToolSchemas: declared,
        resolutionState: input.session.state,
        lastResolution: input.lastResolution,
      }),
    },
  ];
}

function resolverMessages(input: {
  testCase: EvalCase;
  session: ResolutionSession;
  agentRequest: Record<string, unknown>;
  allowSearch: boolean;
}): ChatMessage[] {
  const disclosed = tools
    .filter((tool) => input.session.disclosedTools.has(tool.id))
    .map(toolSummary);

  return [
    {
      role: "system",
      content:
        "You are the Mira capability resolver. You only decide what capability detail should be disclosed next. " +
        "You never execute tools and never grant authority. Return JSON only. " +
        "Allowed actions: " +
        "{\"action\":\"resolve_capability\",\"capabilityId\":\"...\",\"reason\":\"...\"}, " +
        (input.allowSearch
          ? "{\"action\":\"search_tools\",\"query\":\"...\",\"capabilityId\":\"optional\",\"reason\":\"...\"}, "
          : "") +
        "{\"action\":\"declare_tool_schema\",\"toolId\":\"...\",\"reason\":\"...\"}, " +
        "{\"action\":\"no_match\",\"reason\":\"...\"}. " +
        "Use only capability IDs from compactCapabilityCatalog and Tool IDs from disclosedToolMetadata when declaring schemas. " +
        "Respect the authorized flag; unauthorized capabilities must not be disclosed or declared.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: input.testCase.prompt,
        route: "mira-progressive",
        mainAgentRequest: input.agentRequest,
        compactCapabilityCatalog: compactCatalog(),
        disclosedToolMetadata: disclosed,
        declaredToolIds: [...input.session.declaredTools],
        resolutionState: input.session.state,
        toolSearchAllowed: input.allowSearch,
      }),
    },
  ];
}

function deriveStatus(input: {
  expectation: Expectation;
  goldToolId: string | null;
  selectedToolId: string | null;
  authorityViolation: boolean;
  maxTurns: boolean;
  error?: string;
}): CaseStatus {
  if (input.error) return "error";
  if (input.expectation === "select") {
    if (input.selectedToolId && input.selectedToolId === input.goldToolId) return "success";
    if (input.selectedToolId) return "wrong_tool";
    if (input.maxTurns) return "max_turns";
    return "stopped";
  }
  if (input.expectation === "no_match") {
    if (input.selectedToolId) return "wrong_tool";
    if (input.authorityViolation) return "authority_violation";
    if (input.maxTurns) return "max_turns";
    return "success";
  }
  if (input.authorityViolation) return "authority_violation";
  if (input.selectedToolId) return "wrong_tool";
  if (input.maxTurns) return "max_turns";
  return "success";
}

function deriveFailureStage(input: {
  expectation: Expectation;
  status: CaseStatus;
  goldReachable: GoldReachability;
  selectedToolId: string | null;
  goldToolId: string | null;
  authorityViolation: boolean;
}) {
  if (input.status === "success") return null;
  if (input.status === "error") return "transport_error";
  if (input.status === "authority_violation") return "authority";
  if (input.expectation === "select") {
    if (input.goldReachable === false) return "reachability";
    if (input.selectedToolId && input.selectedToolId !== input.goldToolId) return "model_selection";
    if (input.status === "max_turns") return "budget_or_turns";
    return "model_selection";
  }
  if (input.selectedToolId) return "model_selection";
  if (input.status === "max_turns") return "budget_or_turns";
  return "model_selection";
}

function deriveRecovery(trace: TraceEntry[]) {
  let sawRejection = false;
  for (const entry of trace) {
    if (entry.role !== "harness") continue;
    if (entry.action.startsWith("reject_") || entry.action === "apply_no_match") sawRejection = true;
    if (
      sawRejection &&
      (entry.action === "apply_search_tools" ||
        entry.action === "apply_resolve_capability" ||
        entry.action === "apply_declare_tool_schema")
    ) {
      return "retry_after_rejection";
    }
  }
  return null;
}

async function runCurrentMiraCase(input: {
  testCase: EvalCase;
  agentTarget: ModelTarget;
}): Promise<CaseResult> {
  const { testCase } = input;
  const visibility = baselineVisibility();
  const visibleSet = new Set(visibility.visibleToolIds);
  const visibleTools = tools.filter((tool) => visibleSet.has(tool.id));
  const goldToolId = testCase.goldToolId ?? null;
  const goldVisible = Boolean(goldToolId && visibleSet.has(goldToolId));
  const goldReachable: GoldReachability = goldToolId ? goldVisible : "not_applicable";
  const authorityDenied = Boolean(goldToolId && !isAuthorizedTool(goldToolId));
  const trace: TraceEntry[] = [];
  const notes: string[] = [visibility.note];
  let step = 0;
  let selectedToolId: string | null = null;
  let authorityViolation = false;
  let stopped = false;
  let error: string | undefined;
  let lastRejection: unknown = null;

  try {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
      const agent = await callJson(
        input.agentTarget,
        "agent",
        baselineAgentMessages({ testCase, visibleTools, visibilityNote: visibility.note, lastRejection }),
      );
      const action = stringField(agent.json, "action");
      trace.push({
        step: ++step,
        role: "agent",
        model: input.agentTarget.key,
        latencyMs: agent.latencyMs,
        usage: agent.usage,
        action: action || "invalid",
        detail: agent.json,
      });

      if (action === "select_tool") {
        const toolId = stringField(agent.json, "toolId");
        if (!visibleSet.has(toolId)) {
          lastRejection = {
            outcome: "not_visible",
            reason:
              "Current baseline route exposes only eagerly visible tools; " + toolId + " is not visible.",
          };
          trace.push({ step: ++step, role: "harness", action: "reject_not_visible", detail: lastRejection });
          continue;
        }
        if (!isAuthorizedTool(toolId)) {
          authorityViolation = true;
          lastRejection = {
            outcome: "unauthorized",
            reason: "Tool " + toolId + " is outside the authority envelope.",
          };
          trace.push({ step: ++step, role: "harness", action: "reject_unauthorized", detail: lastRejection });
          continue;
        }
        selectedToolId = toolId;
        break;
      }

      if (action === "stop") {
        stopped = true;
        break;
      }

      lastRejection = { outcome: "invalid_agent_action", reason: "Unsupported action: " + action };
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const maxTurns = !selectedToolId && !stopped && !error;
  const status = deriveStatus({
    expectation: testCase.expectation,
    goldToolId,
    selectedToolId,
    authorityViolation,
    maxTurns,
    error,
  });

  const modelEntries = trace.filter((entry) => entry.role !== "harness");
  const sum = (key: keyof Usage) =>
    modelEntries.reduce((total, entry) => total + (entry.usage?.[key] ?? 0), 0);
  const measuredUsage = modelEntries.some((entry) => Boolean(entry.usage));

  const stateTimeline: DisclosureState[] = ["registered", "eligible"];
  if (visibleTools.some((tool) => isAuthorizedCapability(tool.capabilityId))) {
    stateTimeline.push("authorized");
  }
  stateTimeline.push("visible");
  if (selectedToolId) stateTimeline.push("selected");

  return {
    caseId: testCase.id,
    scenario: testCase.scenario,
    route: "current-mira",
    prompt: testCase.prompt,
    expectation: testCase.expectation,
    goldToolId,
    status,
    selectedToolId,
    goldReachable,
    authorityDenied,
    reachability: {
      initiallyVisible: goldVisible,
      discoveredVia: goldVisible ? "eager" : "not_reached",
      goldVisibleInitially: goldVisible,
      goldDisclosedMetadata: goldVisible,
      goldDisclosedSchema: goldVisible,
    },
    initialVisibility: {
      toolIds: [...visibility.visibleToolIds],
      mode: visibility.mode,
      backend: visibility.backend,
      note: visibility.note,
    },
    discoverableScope: {
      capabilityIds: visibleTools.map((tool) => tool.capabilityId),
      toolCount: visibleTools.length,
    },
    searchRan: false,
    searchNecessary: "not_evaluated",
    searchExpected: testCase.searchExpectation,
    disclosed: {
      metadataToolIds: [...visibility.visibleToolIds],
      schemaToolIds: [...visibility.visibleToolIds],
    },
    budget: "not_applicable",
    stateTimeline,
    overResolution: false,
    wrongExpansion: false,
    failureStage: deriveFailureStage({
      expectation: testCase.expectation,
      status,
      goldReachable,
      selectedToolId,
      goldToolId,
      authorityViolation,
    }),
    recovery: deriveRecovery(trace),
    metrics: {
      initialContextToolCount: visibleTools.length,
      initialSchemaFootprint: visibleTools.length,
      totalContextToolCount: visibleTools.length,
      totalSchemaFootprint: visibleTools.length,
      modelCalls: modelEntries.length,
      latencyMs: modelEntries.reduce((total, entry) => total + (entry.latencyMs ?? 0), 0),
      usage: measuredUsage
        ? { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens") }
        : "not_measured",
      resolutionSteps: 0,
    },
    trace,
    notes,
    ...(error ? { error } : {}),
  };
}

async function runProgressiveCase(input: {
  testCase: EvalCase;
  agentTarget: ModelTarget;
  resolverTarget: ModelTarget;
}): Promise<CaseResult> {
  const { testCase } = input;
  const session = new ResolutionSession(testCase.resolutionBudget ?? DEFAULT_BUDGET);
  const trace: TraceEntry[] = [];
  const notes: string[] = [];
  const goldToolId = testCase.goldToolId ?? null;
  const authorityDenied = Boolean(goldToolId && !isAuthorizedTool(goldToolId));
  let lastResolution: unknown = null;
  let selectedToolId: string | null = null;
  let authorityViolation = false;
  let stopped = false;
  let error: string | undefined;
  let step = 0;

  try {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
      const agent = await callJson(
        input.agentTarget,
        "agent",
        progressiveAgentMessages({ testCase, session, lastResolution }),
      );
      const agentAction = stringField(agent.json, "action");
      trace.push({
        step: ++step,
        role: "agent",
        model: input.agentTarget.key,
        latencyMs: agent.latencyMs,
        usage: agent.usage,
        action: agentAction || "invalid",
        detail: agent.json,
      });

      if (agentAction === "select_tool") {
        const toolId = stringField(agent.json, "toolId");
        if (!isAuthorizedTool(toolId)) {
          authorityViolation = true;
          lastResolution = {
            outcome: "unauthorized",
            reason: "Main Agent attempted to select " + toolId + " outside the authority envelope.",
          };
          trace.push({ step: ++step, role: "harness", action: "reject_unauthorized", detail: lastResolution });
          continue;
        }
        if (!session.declaredTools.has(toolId)) {
          lastResolution = {
            outcome: "schema_not_declared",
            reason: "Main Agent attempted to select " + toolId + " before schema declaration.",
          };
          trace.push({
            step: ++step,
            role: "harness",
            action: "reject_undeclared_tool",
            detail: lastResolution,
          });
          continue;
        }
        selectedToolId = toolId;
        break;
      }

      if (agentAction === "stop") {
        stopped = true;
        break;
      }

      if (agentAction !== "need_resolution") {
        lastResolution = {
          outcome: "invalid_agent_action",
          reason: "Unsupported Main Agent action: " + agentAction,
        };
        continue;
      }

      if (session.state.resolutionBudgetRemaining <= 0) {
        lastResolution = {
          outcome: "budget_exhausted",
          reason: "Resolution budget exhausted; no more disclosure is allowed.",
        };
        trace.push({ step: ++step, role: "harness", action: "budget_exhausted", detail: lastResolution });
        continue;
      }

      const resolver = await callJson(
        input.resolverTarget,
        "resolver",
        resolverMessages({
          testCase,
          session,
          agentRequest: agent.json,
          allowSearch: true,
        }),
      );
      const resolverAction = stringField(resolver.json, "action");
      trace.push({
        step: ++step,
        role: "resolver",
        model: input.resolverTarget.key,
        latencyMs: resolver.latencyMs,
        usage: resolver.usage,
        action: resolverAction || "invalid",
        detail: resolver.json,
      });

      if (resolverAction === "resolve_capability") {
        lastResolution = session.resolveCapability(stringField(resolver.json, "capabilityId"));
      } else if (resolverAction === "search_tools") {
        lastResolution = session.searchTools(
          stringField(resolver.json, "query") || testCase.prompt,
          stringField(resolver.json, "capabilityId") || undefined,
        );
      } else if (resolverAction === "declare_tool_schema") {
        lastResolution = session.declareToolSchema(stringField(resolver.json, "toolId"));
      } else if (resolverAction === "no_match") {
        lastResolution = {
          outcome: "not_found",
          consumed: false,
          reason: stringField(resolver.json, "reason") || "Resolver reported no match.",
        };
      } else {
        lastResolution = {
          outcome: "invalid_resolver_action",
          consumed: false,
          reason: "Unsupported Resolver action: " + resolverAction,
        };
      }

      trace.push({
        step: ++step,
        role: "harness",
        action: "apply_" + (resolverAction || "invalid"),
        detail: { result: lastResolution, state: session.state },
      });
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const maxTurns = !selectedToolId && !stopped && !error;
  const status = deriveStatus({
    expectation: testCase.expectation,
    goldToolId,
    selectedToolId,
    authorityViolation,
    maxTurns,
    error,
  });

  const goldMetadata = Boolean(goldToolId && session.disclosedTools.has(goldToolId));
  const goldSchema = Boolean(goldToolId && session.declaredTools.has(goldToolId));
  const goldReachable: GoldReachability = goldToolId ? goldMetadata : "not_applicable";
  const goldPath = goldToolId ? session.disclosurePath.get(goldToolId) : undefined;
  const searchRan = trace.some((entry) => entry.role === "resolver" && entry.action === "search_tools");
  const searchNecessary: boolean | "not_evaluated" = !goldToolId
    ? false
    : goldMetadata
      ? goldPath === "tool_search"
      : "not_evaluated";
  const goldCapabilitySize = goldToolId
    ? capabilityMap.get(toolById.get(goldToolId)!.capabilityId)?.toolIds.length ?? 0
    : 0;
  const wrongExpansion = Boolean(goldToolId && session.disclosedTools.size > goldCapabilitySize);
  const overResolution = Boolean(searchRan && testCase.searchExpectation === "not_needed");

  const modelEntries = trace.filter((entry) => entry.role !== "harness");
  const sum = (key: keyof Usage) =>
    modelEntries.reduce((total, entry) => total + (entry.usage?.[key] ?? 0), 0);
  const measuredUsage = modelEntries.some((entry) => Boolean(entry.usage));

  const stateTimeline: DisclosureState[] = ["registered", "eligible", "authorized", "discoverable"];
  if (searchRan) stateTimeline.push("searched");
  if (session.disclosedCapabilities.size > 0 || goldMetadata) stateTimeline.push("resolved");
  if (session.disclosedTools.size > 0) stateTimeline.push("disclosed_metadata");
  if (session.declaredTools.size > 0) stateTimeline.push("disclosed_schema");
  if (selectedToolId) stateTimeline.push("selected");

  return {
    caseId: testCase.id,
    scenario: testCase.scenario,
    route: "mira-progressive",
    prompt: testCase.prompt,
    expectation: testCase.expectation,
    goldToolId,
    status,
    selectedToolId,
    goldReachable,
    authorityDenied,
    reachability: {
      initiallyVisible: false,
      discoveredVia: goldPath
        ? goldPath === "tool_search"
          ? "tool_search"
          : "structural_resolution"
        : "not_reached",
      goldVisibleInitially: false,
      goldDisclosedMetadata: goldMetadata,
      goldDisclosedSchema: goldSchema,
    },
    initialVisibility: {
      toolIds: [],
      mode: "compact_capability_catalog",
      backend: "structural_resolution+tool_search",
      note: "Only the compact capability catalog is visible initially; tool metadata and schema are disclosed progressively.",
    },
    discoverableScope: {
      capabilityIds: capabilities.filter((capability) => isAuthorizedCapability(capability.id)).map((capability) => capability.id),
      toolCount: tools.filter((tool) => isAuthorizedCapability(tool.capabilityId)).length,
    },
    searchRan,
    searchNecessary,
    searchExpected: testCase.searchExpectation,
    disclosed: {
      metadataToolIds: [...session.disclosedTools],
      schemaToolIds: [...session.declaredTools],
    },
    budget: {
      limit: session.resolutionBudget,
      used: session.stepsUsed,
      remaining: session.state.resolutionBudgetRemaining,
    },
    stateTimeline,
    overResolution,
    wrongExpansion,
    failureStage: deriveFailureStage({
      expectation: testCase.expectation,
      status,
      goldReachable,
      selectedToolId,
      goldToolId,
      authorityViolation,
    }),
    recovery: deriveRecovery(trace),
    metrics: {
      initialContextToolCount: capabilities.length,
      initialSchemaFootprint: 0,
      totalContextToolCount: session.disclosedTools.size,
      totalSchemaFootprint: session.declaredTools.size,
      modelCalls: modelEntries.length,
      latencyMs: modelEntries.reduce((total, entry) => total + (entry.latencyMs ?? 0), 0),
      usage: measuredUsage
        ? { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens") }
        : "not_measured",
      resolutionSteps: session.stepsUsed,
    },
    trace,
    notes,
    ...(error ? { error } : {}),
  };
}

// Route C never imitates Pi. It attempts to resolve a reusable Pi visibility /
// loadout / tool-search primitive. If no such thin seam is consumable without
// replacing the common Agent loop (or adding a dependency, which is out of
// scope for this card), it reports an explicit cannot-stay-thin result instead
// of a fabricated Pi score.
const PI_MODULE_CANDIDATES = ["pi-coding-agent", "@pi/coding-agent"];
const PI_THIN_SEAM_PATTERN = /(visibility|loadout|tool.?search|disclosure|resolve.?tool)/i;

async function probePiVisibilityPrimitive(): Promise<PiProbe> {
  const attempts: PiProbeAttempt[] = [];
  let thinSeam: PiSeamCandidate | null = null;

  for (const specifier of PI_MODULE_CANDIDATES) {
    try {
      const mod = (await import(specifier)) as Record<string, unknown>;
      const names = Object.keys(mod ?? {});
      attempts.push({ specifier, resolved: true, exports: names });
      const seamName = names.find((name) => PI_THIN_SEAM_PATTERN.test(name));
      if (seamName) {
        const value = mod[seamName];
        thinSeam = { exportName: seamName, kind: typeof value };
      }
    } catch (caught) {
      attempts.push({
        specifier,
        resolved: false,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  const integrationCost: Record<string, string> = {
    dependency:
      "Consuming Pi requires declaring a pi-coding-agent dependency; package.json is out of scope for this research card.",
    runtimeCoupling:
      "Pi's mature visibility/loadout/tool-search behavior is bound to the pi-coding-agent AgentSession lifecycle.",
    agentLoopImpact:
      "Reusing it as-is would replace or wrap the experiment's common Agent loop, violating the thin shared-boundary requirement.",
    secretsAndSession:
      "Pi loadout may require provider/session configuration that the research harness does not carry.",
  };

  const coupling = [
    "common_agent_loop: must stay route-agnostic across Current Mira, Mira Progressive, and Pi",
    "agent_session_binding: Pi visibility/loadout/search is driven by AgentSession state",
    "dependency_scope: no package.json change is authorized in this card",
  ];

  if (thinSeam) {
    return {
      verdict: "thin_adaptation",
      available: true,
      cannotStayThin: false,
      thinSeam,
      attempts,
      coupling,
      integrationCost,
      reason:
        "A standalone-looking Pi export matched a visibility/loadout/search seam name, but wiring it to this harness still requires adapter work and dependency scope change not authorized here. No Pi model score is synthesized.",
    };
  }

  const resolvedAny = attempts.some((attempt) => attempt.resolved);
  return {
    verdict: "unsuitable_dependency",
    available: false,
    cannotStayThin: true,
    thinSeam: null,
    attempts,
    coupling,
    integrationCost,
    reason: resolvedAny
      ? "A Pi module resolved but exposed no standalone visibility/loadout/search seam; the mechanism remains inseparable from the AgentSession runtime, so route C cannot stay thin."
      : "No Pi visibility/loadout/search module could be resolved from the research harness. No dependency is declared (package.json is out of scope), so route C reports cannot-stay-thin rather than a fabricated Pi score.",
  };
}

function buildPiCaseResult(input: { testCase: EvalCase; probe: PiProbe }): CaseResult {
  const { testCase, probe } = input;
  const goldToolId = testCase.goldToolId ?? null;
  const trace: TraceEntry[] = [
    {
      step: 1,
      role: "harness",
      action: "pi_primitive_probe",
      detail: {
        verdict: probe.verdict,
        available: probe.available,
        attempts: probe.attempts,
        thinSeam: probe.thinSeam,
        reason: probe.reason,
      },
    },
    {
      step: 2,
      role: "harness",
      action: "not_evaluated",
      detail: {
        reason: probe.cannotStayThin
          ? "Route C did not run model calls; the honest result is an integration verdict, not a fabricated score."
          : "Route C requires adapter work before it can be evaluated on the shared boundary.",
      },
    },
  ];

  return {
    caseId: testCase.id,
    scenario: testCase.scenario,
    route: "pi-progressive",
    prompt: testCase.prompt,
    expectation: testCase.expectation,
    goldToolId,
    status: probe.available ? "route_requires_adapter" : "route_unavailable",
    selectedToolId: null,
    goldReachable: "not_evaluated",
    authorityDenied: Boolean(goldToolId && !isAuthorizedTool(goldToolId)),
    reachability: {
      initiallyVisible: false,
      discoveredVia: "not_evaluated",
      goldVisibleInitially: false,
      goldDisclosedMetadata: false,
      goldDisclosedSchema: false,
    },
    initialVisibility: {
      toolIds: [],
      mode: "pi_deferred_loadout",
      backend: probe.available ? "thin_seam_detected_requires_adapter" : "unresolved",
      note: probe.reason,
    },
    discoverableScope: "not_evaluated",
    searchRan: false,
    searchNecessary: "not_evaluated",
    searchExpected: testCase.searchExpectation,
    disclosed: { metadataToolIds: [], schemaToolIds: [] },
    budget: "not_applicable",
    stateTimeline: ["registered", "eligible"],
    overResolution: false,
    wrongExpansion: false,
    failureStage: probe.cannotStayThin ? "pi_integration" : null,
    recovery: null,
    metrics: {
      initialContextToolCount: "not_measured",
      initialSchemaFootprint: "not_measured",
      totalContextToolCount: "not_measured",
      totalSchemaFootprint: "not_measured",
      modelCalls: 0,
      latencyMs: 0,
      usage: "not_measured",
      resolutionSteps: 0,
    },
    trace,
    notes: [probe.reason],
  };
}

function representativeCaseId(value: CaseResult | { note: string }) {
  return "caseId" in value ? value.caseId : "n/a";
}

function ratio(numerator: number, denominator: number): number | "not_applicable" {
  if (denominator <= 0) return "not_applicable";
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function average(values: number[]) {
  if (values.length === 0) return "not_measured";
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
}

function summarizeRoute(results: CaseResult[], route: Route) {
  const entries = results.filter((result) => result.route === route);
  const selectCases = entries.filter((entry) => entry.expectation === "select");
  const goldReachableCases = selectCases.filter((entry) => entry.goldReachable === true);
  const success = entries.filter((entry) => entry.status === "success").length;
  const searchCases = entries.filter((entry) => entry.searchRan).length;
  const unnecessarySearchCases = entries.filter(
    (entry) => entry.overResolution,
  ).length;
  const tokenTotal = entries.reduce(
    (total, entry) =>
      total + (typeof entry.metrics.usage === "object" ? entry.metrics.usage.totalTokens ?? 0 : 0),
    0,
  );
  const usageMeasured = entries.some((entry) => typeof entry.metrics.usage === "object");

  return {
    route,
    cases: entries.length,
    success,
    wrongTool: entries.filter((entry) => entry.status === "wrong_tool").length,
    stopped: entries.filter((entry) => entry.status === "stopped").length,
    maxTurns: entries.filter((entry) => entry.status === "max_turns").length,
    errors: entries.filter((entry) => entry.status === "error").length,
    authorityViolations: entries.filter((entry) => entry.status === "authority_violation").length,
    routeUnavailable: entries.filter(
      (entry) => entry.status === "route_unavailable" || entry.status === "route_requires_adapter",
    ).length,
    selectCases: selectCases.length,
    goldReachableCases: goldReachableCases.length,
    goldReachabilityRate: ratio(goldReachableCases.length, selectCases.length),
    selectionAccuracy: ratio(success, entries.length),
    searchCases,
    unnecessarySearchCases,
    overResolutionCases: entries.filter((entry) => entry.overResolution).length,
    wrongExpansionCases: entries.filter((entry) => entry.wrongExpansion).length,
    modelCalls: entries.reduce((total, entry) => total + entry.metrics.modelCalls, 0),
    totalLatencyMs: entries.reduce((total, entry) => total + entry.metrics.latencyMs, 0),
    totalTokens: usageMeasured ? tokenTotal : "not_measured",
    avgInitialContextTools: average(
      entries
        .map((entry) => entry.metrics.initialContextToolCount)
        .filter((value): value is number => typeof value === "number"),
    ),
    avgInitialSchemaFootprint: average(
      entries
        .map((entry) => entry.metrics.initialSchemaFootprint)
        .filter((value): value is number => typeof value === "number"),
    ),
    avgTotalContextTools: average(
      entries
        .map((entry) => entry.metrics.totalContextToolCount)
        .filter((value): value is number => typeof value === "number"),
    ),
    avgTotalSchemaFootprint: average(
      entries
        .map((entry) => entry.metrics.totalSchemaFootprint)
        .filter((value): value is number => typeof value === "number"),
    ),
    avgResolutionSteps: average(entries.map((entry) => entry.metrics.resolutionSteps)),
  };
}

function computeRecommendation(input: {
  routeA: ReturnType<typeof summarizeRoute>;
  routeB: ReturnType<typeof summarizeRoute>;
  pi: PiProbe;
}) {
  const { routeA, routeB, pi } = input;
  const piUsable = pi.verdict === "direct_reuse" || pi.verdict === "thin_adaptation";
  const aReach = typeof routeA.goldReachabilityRate === "number" ? routeA.goldReachabilityRate : 0;
  const bReach = typeof routeB.goldReachabilityRate === "number" ? routeB.goldReachabilityRate : 0;
  const bSelect = typeof routeB.selectionAccuracy === "number" ? routeB.selectionAccuracy : 0;

  let category: 1 | 2 | 3 | 4;
  let rationale: string;
  if (piUsable && bReach > aReach) {
    category = 3;
    rationale =
      "A reusable Pi vision/loadout seam appears consumable and the progressive route reaches more gold tools than the current baseline.";
  } else if (bReach > aReach && bSelect >= 0.8) {
    category = 2;
    rationale =
      "Mira Progressive reaches more gold tools than the current baseline without regressing selection accuracy; a Mira-owned progressive backend is the strongest candidate.";
  } else if (bReach <= aReach && bSelect >= 0.8 && routeB.modelCalls > routeA.modelCalls) {
    category = 1;
    rationale =
      "The current baseline already reaches at least as many gold tools with equal selection accuracy and fewer model calls.";
  } else {
    category = 4;
    rationale =
      "Results are inconclusive or progressive selection accuracy is weak; validate the architecture but defer production adoption.";
  }

  return {
    category,
    rationale,
    piVerdict: pi.verdict,
    piCannotStayThin: pi.cannotStayThin,
    categoryLegend: {
      1: "keep current",
      2: "Mira-owned progressive",
      3: "reuse/adapt Pi visibility runtime",
      4: "validate architecture but defer production",
    },
  };
}

function pickRepresentativeTraces(results: CaseResult[], pi: PiProbe) {
  const baselineSuccess = results.find(
    (result) => result.route === "current-mira" && result.status === "success",
  );
  const structuralSuccess = results.find(
    (result) =>
      result.route === "mira-progressive" && result.status === "success" && !result.searchRan,
  );
  const searchSuccess = results.find(
    (result) =>
      result.route === "mira-progressive" && result.status === "success" && result.searchRan,
  );
  return {
    baselineEager:
      baselineSuccess ?? { note: "No baseline success case in this run (all reachable golds failed selection)." },
    progressiveStructural:
      structuralSuccess ?? {
        note: "No structural-resolution success case in this run.",
      },
    progressiveSearch:
      searchSuccess ?? { note: "No search-assisted success case in this run." },
    piIntegration: {
      verdict: pi.verdict,
      available: pi.available,
      cannotStayThin: pi.cannotStayThin,
      thinSeam: pi.thinSeam,
      attempts: pi.attempts,
      coupling: pi.coupling,
      integrationCost: pi.integrationCost,
      reason: pi.reason,
    },
  };
}

function markdownReport(input: {
  agentTarget: string;
  resolverTarget: string;
  pi: PiProbe;
  summary: ReturnType<typeof summarizeRoute>[];
  results: CaseResult[];
  recommendation: ReturnType<typeof computeRecommendation>;
  representatives: ReturnType<typeof pickRepresentativeTraces>;
}) {
  const lines = [
    "# #73 / #243 Final Progressive Disclosure Closeout Matrix",
    "",
    "- Main Agent model: `" + input.agentTarget + "`",
    "- Resolver model: `" + input.resolverTarget + "`",
    "- Resolution budget: `" + DEFAULT_BUDGET + "`",
    "- Catalog: " + capabilities.length + " capabilities / " + tools.length + " tools",
    "- Cases: " + cases.length,
    "- Routes: current-mira baseline | mira-progressive | pi-progressive",
    "",
    "## Three-route comparison",
    "",
    "| Route | Cases | Success | Wrong | Stopped | MaxTurns | Errors | RouteUnavail | Gold reach | Select acc | Search cases | Unnecessary search | Model calls | Tokens |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const item of input.summary) {
    lines.push(
      "| " +
        item.route +
        " | " +
        item.cases +
        " | " +
        item.success +
        " | " +
        item.wrongTool +
        " | " +
        item.stopped +
        " | " +
        item.maxTurns +
        " | " +
        item.errors +
        " | " +
        item.routeUnavailable +
        " | " +
        item.goldReachableCases +
        "/" +
        item.selectCases +
        " (" +
        item.goldReachabilityRate +
        ") | " +
        item.selectionAccuracy +
        " | " +
        item.searchCases +
        " | " +
        item.unnecessarySearchCases +
        " | " +
        item.modelCalls +
        " | " +
        item.totalTokens +
        " |",
    );
  }

  lines.push("", "## Per-case results", "");
  lines.push(
    "| Case | Scenario | Route | Status | Gold | Reachable | Selected | Search | Failure stage |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const result of input.results) {
    lines.push(
      "| " +
        result.caseId +
        " | " +
        result.scenario +
        " | " +
        result.route +
        " | " +
        result.status +
        " | `" +
        (result.goldToolId ?? "none") +
        "` | " +
        String(result.goldReachable) +
        " | `" +
        (result.selectedToolId ?? "none") +
        "` | " +
        String(result.searchRan) +
        " | " +
        (result.failureStage ?? "-") +
        " |",
    );
  }

  lines.push("", "## Failure traces", "");
  const failures = input.results.filter(
    (result) => result.status !== "success" && result.status !== "route_unavailable" && result.status !== "route_requires_adapter",
  );
  if (failures.length === 0) {
    lines.push("- None recorded in this run.");
  } else {
    for (const failure of failures) {
      lines.push(
        "- **" +
          failure.caseId +
          " / " +
          failure.route +
          "** — `" +
          failure.status +
          "`; stage=`" +
          (failure.failureStage ?? "unknown") +
          "`; goldReachable=" +
          String(failure.goldReachable) +
          "; gold=`" +
          (failure.goldToolId ?? "none") +
          "`; selected=`" +
          (failure.selectedToolId ?? "none") +
          "`; " +
          failure.prompt,
      );
    }
  }

  lines.push("", "## Representative traces", "");
  lines.push(
    "- Baseline eager success: `" +
      representativeCaseId(input.representatives.baselineEager) +
      "`",
  );
  lines.push(
    "- Mira structural-resolution success: `" +
      representativeCaseId(input.representatives.progressiveStructural) +
      "`",
  );
  lines.push(
    "- Mira search-assisted success: `" +
      representativeCaseId(input.representatives.progressiveSearch) +
      "`",
  );
  lines.push(
    "- Pi integration result: verdict=`" +
      input.representatives.piIntegration.verdict +
      "`; cannotStayThin=`" +
      String(input.representatives.piIntegration.cannotStayThin) +
      "`",
  );
  lines.push("  - " + input.representatives.piIntegration.reason);

  lines.push("", "## Recommendation", "");
  lines.push(
    "- Candidate category: **" +
      input.recommendation.category +
      "** (" +
      input.recommendation.categoryLegend[input.recommendation.category] +
      ")",
  );
  lines.push("- Rationale: " + input.recommendation.rationale);
  lines.push("- Pi verdict: `" + input.recommendation.piVerdict + "`");
  lines.push(
    "- Category legend: 1 keep current; 2 Mira-owned progressive; 3 reuse/adapt Pi visibility runtime; 4 validate architecture but defer production.",
  );

  lines.push(
    "",
    "This is research evidence only. It does not switch the production Planner, grant Tool authority, change Mira Desktop behavior, or satisfy #300 acceptance by itself.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const agentTarget = parseTarget(
    process.env.MIRA_AGENT_TARGET?.trim() || "opencode-go/deepseek-v4.1-flash",
  );
  const resolverTarget = parseTarget(
    process.env.MIRA_RESOLVER_TARGET?.trim() || agentTarget.key,
  );
  const caseLimit = Math.max(
    1,
    Math.min(cases.length, Number.parseInt(process.env.MIRA_CASE_LIMIT || String(cases.length), 10) || cases.length),
  );
  const selectedCases = cases.slice(0, caseLimit);

  const piProbe = await probePiVisibilityPrimitive();

  const results: CaseResult[] = [];
  for (const testCase of selectedCases) {
    results.push(await runCurrentMiraCase({ testCase, agentTarget }));
    results.push(await runProgressiveCase({ testCase, agentTarget, resolverTarget }));
    results.push(buildPiCaseResult({ testCase, probe: piProbe }));
  }

  const summary = [
    summarizeRoute(results, "current-mira"),
    summarizeRoute(results, "mira-progressive"),
    summarizeRoute(results, "pi-progressive"),
  ];
  const recommendation = computeRecommendation({
    routeA: summary[0]!,
    routeB: summary[1]!,
    pi: piProbe,
  });
  const representatives = pickRepresentativeTraces(results, piProbe);

  const outputDir = path.resolve(process.env.MIRA_RESEARCH_OUTPUT_DIR || "research-results");
  fs.mkdirSync(outputDir, { recursive: true });

  const payload = {
    experiment: "mira-issue-73-progressive-disclosure-closeout/v1",
    issue: "#73",
    upstream: ["Mira Desktop #243", "Mira Desktop #300"],
    generatedAt: new Date().toISOString(),
    agentTarget: agentTarget.key,
    resolverTarget: resolverTarget.key,
    resolutionBudget: DEFAULT_BUDGET,
    catalog: {
      capabilities: capabilities.length,
      tools: tools.length,
      baselineVisibleLimit: CURRENT_BASELINE_VISIBLE_LIMIT,
      structuralBaseline: {
        first20ContainsGoldByCase: selectedCases.map((testCase) => ({
          caseId: testCase.id,
          scenario: testCase.scenario,
          goldToolId: testCase.goldToolId ?? null,
          visible: testCase.goldToolId
            ? tools.slice(0, CURRENT_BASELINE_VISIBLE_LIMIT).some((tool) => tool.id === testCase.goldToolId)
            : false,
        })),
      },
    },
    authority: {
      deniedCapabilityIds: [...DENIED_CAPABILITY_IDS],
      assumption: "Discoverable is not authorized; denied capabilities are excluded from disclosure, search candidates, schema declaration, and selection.",
    },
    piProbe,
    summary,
    recommendation,
    representativeTraces: representatives,
    results,
  };

  const jsonPath = path.join(outputDir, "issue-243-progressive-agent-eval.json");
  const mdPath = path.join(outputDir, "issue-243-progressive-agent-eval.md");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(
    mdPath,
    markdownReport({
      agentTarget: agentTarget.key,
      resolverTarget: resolverTarget.key,
      pi: piProbe,
      summary,
      results,
      recommendation,
      representatives,
    }),
  );

  console.log(JSON.stringify({ summary, recommendation }, null, 2));
  console.log("Research JSON: " + jsonPath);
  console.log("Research Markdown: " + mdPath);

  const directRoutes = results.filter((result) => result.route !== "pi-progressive");
  if (directRoutes.every((result) => result.status === "error")) {
    process.exitCode = 1;
  }
}

await main();
