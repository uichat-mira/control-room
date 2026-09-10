import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  GitBranch,
  Radio,
  Server,
} from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  cloudflareLabel,
  formatCount,
  formatTime,
  type SummaryPayload,
  usePolling,
  workflowText,
  workflowTone,
} from "./data";

export default function Wall() {
  const read = usePolling<SummaryPayload>("/api/v1/summary", 60_000);
  const view = read.data;

  const chartData = useMemo(
    () => [...(view?.cloudflare.analytics24h.workers ?? [])]
      .filter((worker) => worker.requests > 0)
      .sort((a, b) => b.requests - a.requests)
      .map((worker) => ({
        name: worker.name.replace(/^uichat-mira-/, ""),
        requests: worker.requests,
      })),
    [view],
  );

  if (!view) {
    return (
      <main className="shell wall-shell">
        <section className="page-state">
          <Radio size={16} />
          <div><strong>Reading Mira System</strong><small>{read.error ?? "Loading operational snapshot."}</small></div>
        </section>
      </main>
    );
  }

  const repositories = view.repositories;
  const withRuns = repositories.filter((repo) => Boolean(repo.latestWorkflow)).length;
  const passing = repositories.filter(
    (repo) => repo.latestWorkflow?.status === "completed" && repo.latestWorkflow.conclusion === "success",
  ).length;
  const online = view.services.filter((service) => service.status === "online").length;

  return (
    <main className="shell wall-shell">
      <header className="topbar visual-topbar">
        <div className="headline">
          <p className="eyebrow">MIRA / CONTROL ROOM</p>
          <h1>Mira System</h1>
        </div>
        <a className="org-link" href={view.organization.htmlUrl} target="_blank" rel="noreferrer">
          {view.status === "connected"
            ? <CheckCircle2 className="status-icon ok" size={20} />
            : <AlertTriangle className="status-icon warn" size={20} />}
          <span>
            <strong>{view.status === "connected" ? "SYSTEM OPERATIONAL" : "ATTENTION REQUIRED"}</strong>
            <small>{view.organization.login} · {formatTime(view.generatedAt)}</small>
          </span>
        </a>
      </header>

      <section className="source-strip source-strip-icons">
        <span><GitBranch size={13} /> GitHub · {view.sources.github}</span>
        <span><Cloud size={13} /> Cloudflare · {cloudflareLabel(view.sources.cloudflare)}</span>
        <span><Radio size={13} /> Runtime · live probes</span>
        <small>refresh 60s</small>
      </section>

      <section className="metrics visual-metrics">
        <article>
          <span className="metric-label"><GitBranch size={15} /> Repositories</span>
          <strong>{repositories.length}</strong>
          <small>{repositories.filter((repo) => !repo.archived).length} active</small>
        </article>
        <article>
          <span className="metric-label"><Activity size={15} /> Builds passing</span>
          <strong>{passing}/{withRuns || "—"}</strong>
          <small>latest default-branch run</small>
        </article>
        <article>
          <span className="metric-label"><Server size={15} /> Services online</span>
          <strong>{online}/{view.services.length || "—"}</strong>
          <small>HTTP probes</small>
        </article>
        <article>
          <span className="metric-label"><Cloud size={15} /> Requests · 24h</span>
          <strong>{view.cloudflare.analytics24h.status === "connected" ? formatCount(view.cloudflare.analytics24h.requests) : "—"}</strong>
          <small>{view.cloudflare.analytics24h.status}</small>
        </article>
      </section>

      <section className="ops-section">
        <div className="ops-grid compact-ops-grid">
          <article className="ops-panel">
            <div className="ops-title icon-panel-title"><strong><Activity size={16} /> Builds</strong></div>
            <div className="ops-list">
              {repositories.map((repo) => (
                <a className="ops-row" key={repo.fullName} href={repo.latestWorkflow?.htmlUrl ?? repo.htmlUrl} target="_blank" rel="noreferrer">
                  <span className="ops-name">
                    <strong>{repo.name}</strong>
                    <small>{repo.latestWorkflow ? formatTime(repo.latestWorkflow.updatedAt) : repo.defaultBranch}</small>
                  </span>
                  <span className={`status-pill icon-pill ${workflowTone(repo.latestWorkflow)}`}>
                    {workflowText(repo.latestWorkflow)}
                  </span>
                </a>
              ))}
            </div>
          </article>

          <article className="ops-panel">
            <div className="ops-title icon-panel-title"><strong><Server size={16} /> Services</strong></div>
            <div className="ops-list">
              {view.services.map((service) => (
                <a className="ops-row" key={service.id} href={service.url} target="_blank" rel="noreferrer">
                  <span className="ops-name"><strong>{service.label}</strong><small>{service.detail}</small></span>
                  <span className={`service-state icon-service-state ${service.status}`}>
                    {service.latencyMs === null ? service.status : `${service.latencyMs} ms`}
                  </span>
                </a>
              ))}
            </div>
          </article>
        </div>
      </section>

      {view.cloudflare.analytics24h.status === "connected" && (
        <section className="cloudflare-section">
          <div className="traffic-panel">
            <div className="traffic-summary">
              <div className="traffic-title"><Cloud size={17} /><strong>Workers · last 24h</strong></div>
              <div className="traffic-numbers">
                <div><span>Requests</span><strong>{formatCount(view.cloudflare.analytics24h.requests)}</strong></div>
                <div><span>Errors</span><strong>{formatCount(view.cloudflare.analytics24h.errors)}</strong></div>
                <div><span>Error rate</span><strong>{view.cloudflare.analytics24h.errorRate.toFixed(3)}%</strong></div>
              </div>
            </div>
            {chartData.length > 0 && (
              <div className="traffic-chart">
                <ResponsiveContainer width="100%" height={Math.max(150, chartData.length * 34)}>
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 10, bottom: 4, left: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} tick={{ fill: "var(--text-soft)", fontSize: 11 }} />
                    <Tooltip
                      cursor={{ fill: "var(--surface-soft)" }}
                      contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--text)", fontSize: 12 }}
                      formatter={(value: unknown) => [formatCount(Number(value)), "Requests"]}
                    />
                    <Bar dataKey="requests" fill="var(--accent)" radius={[0, 4, 4, 0]} barSize={8} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
