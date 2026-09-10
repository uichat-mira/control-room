import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Clipboard,
  ExternalLink,
  Network,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import "./docs-page.css";

const BASE = "https://control.mira.tomz.io";
const MCP_URL = `${BASE}/mcp`;

const endpoints = [
  ["/api/v1/health", "Control Room process health", "live"],
  ["/api/v1/summary", "Cross-system operational snapshot", "live + cached"],
  ["/api/v1/repos", "Public repository inventory", "cached"],
  ["/api/v1/builds", "Latest default-branch builds and releases", "cached"],
  ["/api/v1/services", "Mira HTTP service probes", "live"],
  ["/api/v1/deployments", "Cloudflare Workers and Pages deployments", "cached"],
  ["/api/v1/analytics", "Workers requests and errors over the last 24h", "cached"],
  ["/api/v1/governance", "Issues, PRs, branch policy, rulesets and Projects", "slow cache"],
  ["/api/v1/projects", "Public GitHub Projects", "slow cache"],
] as const;

const tools = [
  ["get_overview", "Whole-system operational question. Includes live service probes."],
  ["inspect_engineering", "Repositories, builds/releases, or deployments."],
  ["inspect_runtime", "Live services or cached 24h traffic."],
  ["inspect_governance", "Issues/PRs/policy or public Projects."],
] as const;

const apiExample = `curl ${BASE}/api/v1/summary`;
const mcpExample = `curl -X POST \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -H 'MCP-Protocol-Version: 2026-07-28' \\
  -H 'Mcp-Method: tools/list' \\
  --data '{"jsonrpc":"2.0","id":"demo","method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}' \\
  ${MCP_URL}`;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button className="docs-copy" type="button" onClick={copy} aria-label="Copy example">
      {copied ? <Check size={14} /> : <Clipboard size={14} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeSample({ value }: { value: string }) {
  return (
    <div className="docs-code-wrap">
      <CopyButton value={value} />
      <pre className="docs-code"><code>{value}</code></pre>
    </div>
  );
}

export default function DocsPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Control Room · API & MCP";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <main className="docs-shell">
      <header className="docs-topbar">
        <Link className="docs-back" to="/">
          <ArrowLeft size={15} /> Control Room
        </Link>
        <span className="docs-kicker">MIRA / OPEN INTERFACE</span>
        <a className="docs-github" href="https://github.com/uichat-mira/control-room" target="_blank" rel="noreferrer">
          GitHub <ExternalLink size={13} />
        </a>
      </header>

      <section className="docs-hero">
        <div>
          <p className="docs-eyebrow">PUBLIC OBSERVABILITY</p>
          <h1>One read model.<br />Two interfaces.</h1>
          <p className="docs-lead">
            Mira Control Room exposes the same public-safe organization facts to humans, software and agents through a versioned REST API and a small task-oriented MCP surface.
          </p>
        </div>
        <div className="docs-status-grid">
          <article>
            <BookOpen size={18} />
            <div><strong>Public API v1</strong><span>OpenAPI 3.1 · anonymous GET</span></div>
          </article>
          <article>
            <Network size={18} />
            <div><strong>Remote MCP</strong><span>2026-07-28 · stateless HTTP</span></div>
          </article>
          <article>
            <ShieldCheck size={18} />
            <div><strong>Read only</strong><span>Public repos and Projects only</span></div>
          </article>
        </div>
      </section>

      <nav className="docs-nav" aria-label="Documentation sections">
        <a href="#api">API</a>
        <a href="#mcp">MCP</a>
        <a href="#agent">Agent guidance</a>
        <a href="#safety">Limits & safety</a>
        <a href="/openapi.json" target="_blank" rel="noreferrer">OpenAPI ↗</a>
      </nav>

      <section className="docs-section" id="api">
        <div className="docs-section-head">
          <div><span>01</span><h2>Public API v1</h2></div>
          <p>Stable data contract. Focused endpoints avoid unrelated probes and preserve each source's own cache/freshness model.</p>
        </div>
        <div className="docs-table" role="table" aria-label="Public API endpoints">
          <div className="docs-row docs-row-head" role="row"><span>Endpoint</span><span>Returns</span><span>Freshness</span><span /></div>
          {endpoints.map(([path, description, freshness]) => (
            <div className="docs-row" role="row" key={path}>
              <code>{path}</code>
              <span>{description}</span>
              <span className="docs-freshness">{freshness}</span>
              <a href={path} target="_blank" rel="noreferrer" aria-label={`Open ${path}`}><ExternalLink size={14} /></a>
            </div>
          ))}
        </div>
        <h3>Quick request</h3>
        <CodeSample value={apiExample} />
      </section>

      <section className="docs-section" id="mcp">
        <div className="docs-section-head">
          <div><span>02</span><h2>Remote MCP</h2></div>
          <p>Agent-facing capability contract. The MCP adapter reuses Public API reads in-process; it does not create another GitHub or Cloudflare implementation.</p>
        </div>

        <div className="docs-endpoint">
          <span>Endpoint</span>
          <code>{MCP_URL}</code>
          <CopyButton value={MCP_URL} />
        </div>

        <div className="docs-tools">
          {tools.map(([name, description]) => (
            <article key={name}>
              <TerminalSquare size={17} />
              <div><code>{name}</code><p>{description}</p></div>
            </article>
          ))}
        </div>

        <h3>Modern protocol discovery</h3>
        <CodeSample value={mcpExample} />
        <p className="docs-note">
          A conforming MCP client normally supplies the protocol headers and request metadata automatically. The raw request above is mainly useful for diagnostics.
        </p>
      </section>

      <section className="docs-section docs-two-column" id="agent">
        <div>
          <div className="docs-section-head compact"><div><span>03</span><h2>Agent guidance</h2></div></div>
          <p>Prefer the narrowest capability that can answer the question. This keeps latency, external reads and live probes bounded.</p>
          <div className="docs-rule-list">
            <div><b>Engineering</b><span>repository · build · release · deploy</span></div>
            <div><b>Runtime</b><span>service health · traffic · errors</span></div>
            <div><b>Governance</b><span>Issue · PR · policy · Project</span></div>
            <div><b>Overview</b><span>only for genuinely cross-system questions</span></div>
          </div>
        </div>
        <div id="safety">
          <div className="docs-section-head compact"><div><span>04</span><h2>Limits & safety</h2></div></div>
          <p>Control Room is deliberately an observation surface, not a control plane.</p>
          <div className="docs-rule-list">
            <div><b>30 / min / IP</b><span>REST + MCP share one public-read bucket</span></div>
            <div><b>120 / min / IP</b><span>health endpoint only</span></div>
            <div><b>Public-safe</b><span>no secrets or private repo/Project metadata</span></div>
            <div><b>Source-aware</b><span>preserve degraded · partial · unavailable</span></div>
          </div>
        </div>
      </section>

      <footer className="docs-footer">
        <span>Mira Control Room · open observability surface</span>
        <Link to="/">Back to cockpit</Link>
      </footer>
    </main>
  );
}
