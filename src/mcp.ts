import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import controlRoom from "./worker";

type Env = Parameters<typeof controlRoom.fetch>[1];

type EngineeringInput = {
  view: "repositories" | "builds" | "deployments";
};

type RuntimeInput = {
  view: "services" | "analytics";
};

type GovernanceInput = {
  view: "governance" | "projects";
};

const emptyInput = fromJsonSchema<Record<string, never>>({
  type: "object",
  properties: {},
  additionalProperties: false,
});

const engineeringInput = fromJsonSchema<EngineeringInput>({
  type: "object",
  properties: {
    view: {
      type: "string",
      enum: ["repositories", "builds", "deployments"],
      description: "Focused engineering view to inspect.",
    },
  },
  required: ["view"],
  additionalProperties: false,
});

const runtimeInput = fromJsonSchema<RuntimeInput>({
  type: "object",
  properties: {
    view: {
      type: "string",
      enum: ["services", "analytics"],
      description: "Runtime view: live service probes or cached 24h Cloudflare traffic.",
    },
  },
  required: ["view"],
  additionalProperties: false,
});

const governanceInput = fromJsonSchema<GovernanceInput>({
  type: "object",
  properties: {
    view: {
      type: "string",
      enum: ["governance", "projects"],
      description: "Governance policy state or public GitHub Projects.",
    },
  },
  required: ["view"],
  additionalProperties: false,
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function asToolResult(payload: unknown, ok: boolean) {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: payload,
    ...(ok ? {} : { isError: true }),
  };
}

async function readPublicApi(env: Env, origin: string, path: string) {
  const response = await controlRoom.fetch(
    new Request(`${origin}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
    }),
    env,
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = {
      error: "invalid_upstream_response",
      message: `Control Room returned a non-JSON response for ${path}`,
    };
  }

  return asToolResult(payload, response.ok);
}

function createControlRoomMcpServer(env: Env, origin: string) {
  const server = new McpServer({
    name: "mira-control-room",
    version: "1.0.0",
  });

  server.registerTool(
    "get_overview",
    {
      title: "Mira operational overview",
      description:
        "Get the broad Mira organization operational snapshot. Use this when you need a whole-system answer; it includes live service probes. Prefer the focused inspect_* tools for narrower questions.",
      inputSchema: emptyInput,
      annotations: readOnlyAnnotations,
    },
    async () => readPublicApi(env, origin, "/api/v1/summary"),
  );

  server.registerTool(
    "inspect_engineering",
    {
      title: "Inspect engineering state",
      description:
        "Inspect a focused engineering view without unrelated live service probes: public repositories, default-branch builds/releases, or Cloudflare deployments.",
      inputSchema: engineeringInput,
      annotations: readOnlyAnnotations,
    },
    async ({ view }) => {
      const paths: Record<EngineeringInput["view"], string> = {
        repositories: "/api/v1/repos",
        builds: "/api/v1/builds",
        deployments: "/api/v1/deployments",
      };
      return readPublicApi(env, origin, paths[view]);
    },
  );

  server.registerTool(
    "inspect_runtime",
    {
      title: "Inspect runtime state",
      description:
        "Inspect runtime health or traffic. The services view performs live HTTP probes; analytics reads the cached Cloudflare 24-hour requests/errors view.",
      inputSchema: runtimeInput,
      annotations: readOnlyAnnotations,
    },
    async ({ view }) =>
      readPublicApi(
        env,
        origin,
        view === "services" ? "/api/v1/services" : "/api/v1/analytics",
      ),
  );

  server.registerTool(
    "inspect_governance",
    {
      title: "Inspect governance state",
      description:
        "Inspect cached public GitHub governance facts (Issues, PRs, default-branch protection, rulesets) or public organization Projects.",
      inputSchema: governanceInput,
      annotations: readOnlyAnnotations,
    },
    async ({ view }) =>
      readPublicApi(
        env,
        origin,
        view === "governance" ? "/api/v1/governance" : "/api/v1/projects",
      ),
  );

  return server;
}

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;
  const handler = createMcpHandler(() => createControlRoomMcpServer(env, origin));
  return handler.fetch(request);
}
