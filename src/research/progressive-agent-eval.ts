import fs from "node:fs";
import path from "node:path";

import { PROVIDER_CATALOG } from "../ai-review-provider-config.ts";

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

type EvalCase = {
  id: string;
  prompt: string;
  goldToolId: string;
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

const DEFAULT_BUDGET = 8;
const MAX_AGENT_TURNS = 10;
const SEARCH_LIMIT = 3;
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
    ["github", "pull-request", "create", "branch"],
  ),
);

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

const cases: EvalCase[] = [
  { id: "workspace-read", prompt: "Read the workspace README file.", goldToolId: "read" },
  { id: "workspace-edit", prompt: "Replace the text 'alpha' with 'beta' in a workspace file.", goldToolId: "edit" },
  { id: "github-pr", prompt: "Create a GitHub pull request for the current repository branch.", goldToolId: "mcp:github:tool:create-pull-request" },
  { id: "attached-browser", prompt: "Inspect my current authenticated Chrome page without navigating away.", goldToolId: "browser_attached_look" },
  { id: "codebase", prompt: "Explore the codebase architecture and dependency impact.", goldToolId: "codebase_explore" },
  { id: "web-current", prompt: "Search the public web for current information about this topic.", goldToolId: "web_search" },
  { id: "notion-create", prompt: "Create a new Notion page document in the workspace.", goldToolId: "mcp:notion:tool:create-page" },
  { id: "patch", prompt: "Apply this unified diff patch to the workspace files.", goldToolId: "apply_patch" },
];

function compactCatalog() {
  return capabilities.map((capability) => ({
    capabilityId: capability.id,
    title: capability.title,
    description: capability.description,
    toolCount: capability.toolIds.length,
  }));
}

function toolSummary(tool: Tool) {
  return {
    toolId: tool.id,
    title: tool.title,
    description: tool.description,
    capabilityId: tool.capabilityId,
    tags: tool.tags,
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
  const fenced = /^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i.exec(trimmed);
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

  const maxOutput = role === "resolver" ? 900 : 1200;
  const body: Record<string, unknown> = {
    model: target.modelId,
    messages,
  };
  if (target.outputTokenParameter) {
    body[target.outputTokenParameter] = Math.min(
      maxOutput,
      target.maxOutputTokens ?? maxOutput,
    );
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

class ResolutionSession {
  readonly resolutionBudget: number;
  readonly disclosedCapabilities = new Set<string>();
  readonly disclosedTools = new Set<string>();
  readonly declaredTools = new Set<string>();
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

  resolveCapability(capabilityId: string) {
    const capability = capabilityMap.get(capabilityId);
    if (!capability) {
      return { outcome: "not_found", consumed: false, reason: "Unknown capability " + capabilityId };
    }
    if (this.disclosedCapabilities.has(capabilityId)) {
      return {
        outcome: "already_disclosed",
        consumed: false,
        reason: capabilityId + " is already disclosed.",
        capability,
        tools: capability.toolIds.map((id) => toolSummary(tools.find((tool) => tool.id === id)!)),
      };
    }
    if (!this.canExpand()) {
      return { outcome: "budget_exhausted", consumed: false, reason: "Resolution budget exhausted." };
    }

    this.stepsUsed += 1;
    this.disclosedCapabilities.add(capabilityId);
    for (const toolId of capability.toolIds) this.disclosedTools.add(toolId);
    return {
      outcome: "disclosed",
      consumed: true,
      reason: "Disclosed tool metadata for " + capabilityId + ".",
      capability,
      tools: capability.toolIds.map((id) => toolSummary(tools.find((tool) => tool.id === id)!)),
    };
  }

  searchTools(query: string, capabilityId?: string) {
    if (!query.trim()) {
      return { outcome: "not_found", consumed: false, reason: "Search query is empty." };
    }
    const pool = capabilityId
      ? tools.filter((tool) => tool.capabilityId === capabilityId)
      : tools;
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
    for (const item of newTools) this.disclosedTools.add(item.tool.id);
    return {
      outcome: "disclosed",
      consumed: true,
      reason: "Tool Search disclosed candidate metadata.",
      searchCandidates: ranked.map((item) => ({ ...toolSummary(item.tool), score: item.score })),
    };
  }

  declareToolSchema(toolId: string) {
    const tool = tools.find((candidate) => candidate.id === toolId);
    if (!tool) {
      return { outcome: "not_found", consumed: false, reason: "Unknown tool " + toolId };
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
    return {
      outcome: "disclosed",
      consumed: true,
      reason: "Declared schema for " + toolId + ".",
      schemaDeclaredTool: { ...toolSummary(tool), inputSchema: tool.inputSchema, declarationOnly: true },
    };
  }
}

function agentMessages(input: {
  testCase: EvalCase;
  session: ResolutionSession;
  lastResolution: unknown;
}) : ChatMessage[] {
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
        "Use only capability IDs from compactCapabilityCatalog and Tool IDs from disclosedToolMetadata when declaring schemas.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: input.testCase.prompt,
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

function stringField(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? (record[key] as string).trim() : "";
}

async function runCase(input: {
  testCase: EvalCase;
  agentTarget: ModelTarget;
  resolverTarget: ModelTarget;
  topology: "single-model" | "dual-model";
  allowSearch: boolean;
}) {
  const session = new ResolutionSession();
  const trace: TraceEntry[] = [];
  let lastResolution: unknown = null;
  let finalToolId: string | null = null;
  let status: "success" | "wrong_tool" | "stopped" | "max_turns" | "error" = "max_turns";
  let error: string | undefined;
  let step = 0;

  try {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
      const agent = await callJson(
        input.agentTarget,
        "agent",
        agentMessages({ testCase: input.testCase, session, lastResolution }),
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
        finalToolId = toolId;
        status = toolId === input.testCase.goldToolId ? "success" : "wrong_tool";
        break;
      }

      if (agentAction === "stop") {
        status = "stopped";
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
        trace.push({
          step: ++step,
          role: "harness",
          action: "budget_exhausted",
          detail: lastResolution,
        });
        continue;
      }

      const resolver = await callJson(
        input.resolverTarget,
        "resolver",
        resolverMessages({
          testCase: input.testCase,
          session,
          agentRequest: agent.json,
          allowSearch: input.allowSearch,
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
      } else if (resolverAction === "search_tools" && input.allowSearch) {
        lastResolution = session.searchTools(
          stringField(resolver.json, "query") || input.testCase.prompt,
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
        action: "apply_" + resolverAction,
        detail: { result: lastResolution, state: session.state },
      });
    }
  } catch (caught) {
    status = "error";
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const modelEntries = trace.filter((entry) => entry.role !== "harness");
  const sum = (key: keyof Usage) =>
    modelEntries.reduce((total, entry) => total + (entry.usage?.[key] ?? 0), 0);
  const measuredUsage = modelEntries.some((entry) => Boolean(entry.usage));

  return {
    caseId: input.testCase.id,
    prompt: input.testCase.prompt,
    goldToolId: input.testCase.goldToolId,
    topology: input.topology,
    agentModel: input.agentTarget.key,
    resolverModel: input.resolverTarget.key,
    allowSearch: input.allowSearch,
    status,
    finalToolId,
    resolutionState: session.state,
    modelCalls: modelEntries.length,
    totalLatencyMs: modelEntries.reduce((total, entry) => total + (entry.latencyMs ?? 0), 0),
    usage: measuredUsage
      ? {
          inputTokens: sum("inputTokens"),
          outputTokens: sum("outputTokens"),
          totalTokens: sum("totalTokens"),
        }
      : "not_measured",
    usedToolSearch: trace.some((entry) => entry.role === "resolver" && entry.action === "search_tools"),
    ...(error ? { error } : {}),
    trace,
  };
}

function summarize(results: Awaited<ReturnType<typeof runCase>>[]) {
  const byTopology = new Map<string, typeof results>();
  for (const result of results) {
    const current = byTopology.get(result.topology) ?? [];
    current.push(result);
    byTopology.set(result.topology, current);
  }

  return [...byTopology.entries()].map(([topology, entries]) => ({
    topology,
    cases: entries.length,
    success: entries.filter((entry) => entry.status === "success").length,
    wrongTool: entries.filter((entry) => entry.status === "wrong_tool").length,
    stopped: entries.filter((entry) => entry.status === "stopped").length,
    errors: entries.filter((entry) => entry.status === "error").length,
    toolSearchCases: entries.filter((entry) => entry.usedToolSearch).length,
    modelCalls: entries.reduce((total, entry) => total + entry.modelCalls, 0),
    totalLatencyMs: entries.reduce((total, entry) => total + entry.totalLatencyMs, 0),
    totalTokens: entries.reduce(
      (total, entry) =>
        total + (typeof entry.usage === "object" ? entry.usage.totalTokens : 0),
      0,
    ),
  }));
}

function markdownReport(input: {
  agentTarget: string;
  resolverTarget: string;
  results: Awaited<ReturnType<typeof runCase>>[];
  summary: ReturnType<typeof summarize>;
}) {
  const lines = [
    "# #243 Progressive Agent Gateway Probe",
    "",
    "- Agent model: \`" + input.agentTarget + "\`",
    "- Resolver model: \`" + input.resolverTarget + "\`",
    "- Resolution budget: \`" + DEFAULT_BUDGET + "\`",
    "- Catalog: " + capabilities.length + " capabilities / " + tools.length + " tools",
    "",
    "## Summary",
    "",
    "| Topology | Success | Wrong | Stopped | Errors | Tool Search cases | Model calls | Total tokens | Total latency ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const item of input.summary) {
    lines.push(
      "| " +
        item.topology +
        " | " +
        item.success +
        "/" +
        item.cases +
        " | " +
        item.wrongTool +
        " | " +
        item.stopped +
        " | " +
        item.errors +
        " | " +
        item.toolSearchCases +
        " | " +
        item.modelCalls +
        " | " +
        item.totalTokens +
        " | " +
        item.totalLatencyMs +
        " |",
    );
  }

  lines.push("", "## Cases", "");
  for (const result of input.results) {
    lines.push(
      "- **" +
        result.caseId +
        " / " +
        result.topology +
        "** — " +
        result.status +
        "; selected=\`" +
        (result.finalToolId ?? "none") +
        "\`; gold=\`" +
        result.goldToolId +
        "\`; resolution=" +
        result.resolutionState.resolutionStepsUsed +
        "/" +
        result.resolutionState.resolutionBudget +
        "; calls=" +
        result.modelCalls +
        "; search=" +
        String(result.usedToolSearch),
    );
  }

  lines.push(
    "",
    "This is research evidence only. It does not switch the production Planner, grant Tool authority, or satisfy #243 acceptance by itself.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const agentTarget = parseTarget(
    process.env.MIRA_AGENT_TARGET?.trim() || "opencode-go/deepseek-v4-pro",
  );
  const resolverTarget = parseTarget(
    process.env.MIRA_RESOLVER_TARGET?.trim() || "opencode-go/deepseek-v4.1-flash",
  );
  const caseLimit = Math.max(
    1,
    Math.min(cases.length, Number.parseInt(process.env.MIRA_CASE_LIMIT || "4", 10) || 4),
  );
  const selectedCases = cases.slice(0, caseLimit);

  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  for (const testCase of selectedCases) {
    results.push(
      await runCase({
        testCase,
        agentTarget,
        resolverTarget: agentTarget,
        topology: "single-model",
        allowSearch: true,
      }),
    );
    results.push(
      await runCase({
        testCase,
        agentTarget,
        resolverTarget,
        topology: "dual-model",
        allowSearch: true,
      }),
    );
  }

  const summary = summarize(results);
  const outputDir = path.resolve(process.env.MIRA_RESEARCH_OUTPUT_DIR || "research-results");
  fs.mkdirSync(outputDir, { recursive: true });

  const payload = {
    experiment: "mira-issue-243-progressive-agent-gateway-probe/v1",
    generatedAt: new Date().toISOString(),
    agentTarget: agentTarget.key,
    resolverTarget: resolverTarget.key,
    resolutionBudget: DEFAULT_BUDGET,
    catalog: {
      capabilities: capabilities.length,
      tools: tools.length,
      structuralBaseline: {
        first20ContainsGoldByCase: selectedCases.map((testCase) => ({
          caseId: testCase.id,
          goldToolId: testCase.goldToolId,
          visible: tools.slice(0, 20).some((tool) => tool.id === testCase.goldToolId),
        })),
      },
    },
    summary,
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
      results,
      summary,
    }),
  );

  console.log(JSON.stringify(summary, null, 2));
  console.log("Research JSON: " + jsonPath);
  console.log("Research Markdown: " + mdPath);

  if (results.every((result) => result.status === "error")) {
    process.exitCode = 1;
  }
}

await main();
