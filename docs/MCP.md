# Mira Control Room MCP

Mira Control Room exposes a remote, read-only MCP endpoint over the same production Worker as the public API.

**Endpoint**

```text
https://uichat-mira-control-room.dangjingtao.workers.dev/mcp
```

The MCP server is an adapter over the existing Control Room Public API v1. It does not implement a separate GitHub, Cloudflare, service-probe, cache, or governance data plane.

## Protocol

The primary protocol target is MCP `2026-07-28` over stateless HTTP, implemented with the official TypeScript server SDK v2. The official handler also keeps stateless compatibility for 2025-era MCP clients.

Control Room has no MCP session store. Every modern request is self-contained at the protocol layer. A `2026-07-28` request carries its protocol version and client capabilities in `params._meta`; the HTTP transport also carries `MCP-Protocol-Version` and `Mcp-Method` headers. Methods such as `tools/call` that identify a named object additionally use `Mcp-Name`.

## Tools

### `get_overview`

Returns the broad Mira organization operational snapshot.

Use this when the question is genuinely system-wide, for example:

- Is Mira operational right now?
- What is broken across the organization?
- Give me the current Control Room overview.

This tool includes live service probes. Do not use it when a focused tool can answer the question.

### `inspect_engineering`

Input:

```json
{
  "view": "repositories | builds | deployments"
}
```

Use it for repository inventory, default-branch build/release state, or Cloudflare deployment state. These focused reads do not trigger unrelated service probes.

### `inspect_runtime`

Input:

```json
{
  "view": "services | analytics"
}
```

`services` performs live HTTP probes. `analytics` reads the cached Cloudflare 24-hour requests/errors projection.

### `inspect_governance`

Input:

```json
{
  "view": "governance | projects"
}
```

Use it for public Issues/PR counts, default-branch protection, rulesets, or public organization Projects. Governance is intentionally a slower cached read model.

## Read-only contract

Every MCP tool is declared read-only and idempotent. There are no write tools.

The server only exposes the same public-safe projection as `/api/v1/*`:

- public GitHub repositories only;
- public organization Projects only;
- Mira/uichat-named Cloudflare resources only;
- no API keys, tokens, secrets, private repository metadata, or private Project metadata.

If Control Room later gains a private control plane, it must use a separate authenticated surface. Do not silently widen this MCP endpoint.

## Rate limiting and abuse protection

`/mcp` shares the same Cloudflare Worker Rate Limiting binding and per-IP public-read bucket as the regular Public API:

```text
30 requests / 60 seconds / source IP
```

`/api/v1/health` keeps its separate 120/minute health allowance.

A client cannot bypass the public API quota by alternating between `/api/v1/*` and `/mcp`; both consume the same `public-read` bucket. A rejected request returns HTTP `429` with `Retry-After: 60`.

The MCP entry also validates the request host and, when an `Origin` header is present, rejects origins outside the explicit Control Room allowlist. This is intentionally stricter than the anonymous REST CORS policy.

## Cache and freshness semantics

MCP preserves the Public API's existing freshness model instead of inventing its own:

- GitHub engineering facts are edge-cached;
- Cloudflare deployment/analytics facts are independently cached;
- governance is independently cached and may lag the live repository roster briefly;
- service health is live when `get_overview` or `inspect_runtime { view: "services" }` is called;
- stale successful snapshots may be returned during upstream degradation where the Public API already supports that behavior.

Agents should preserve source status such as `connected`, `degraded`, `partial`, or `unavailable` instead of turning those states into guessed facts.

## Modern HTTP example

A `2026-07-28` client can list tools with a single self-contained request:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  --data '{"jsonrpc":"2.0","id":"demo","method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"demo-client","version":"1.0.0"}}}}' \
  https://uichat-mira-control-room.dangjingtao.workers.dev/mcp
```

For a named operation such as `tools/call`, clients must also send the matching `Mcp-Name` header. The official SDK handles these protocol headers and `_meta` fields automatically; hand-written HTTP clients must keep the headers and JSON-RPC body consistent.

For an MCP host that accepts remote HTTP servers, configure the endpoint URL above. The exact configuration shape is host-specific.

## Agent usage guidance

Prefer the narrowest capability that answers the question:

1. repository/build/deployment question → `inspect_engineering`;
2. service-health/traffic question → `inspect_runtime`;
3. Issue/PR/policy/Project question → `inspect_governance`;
4. genuinely cross-system question → `get_overview`.

Do not repeatedly poll `get_overview` when a cached focused view is sufficient. Respect `429` and `Retry-After`, and do not retry degraded/partial upstream states as if they were transport failures.

## Design rule for future tools

Do not expose one MCP tool per low-level REST route merely because the route exists. Add a tool only when it represents a stable task/intent that helps an Agent decide what to inspect.

The Public API is the data contract. MCP is the Agent-facing capability contract.
