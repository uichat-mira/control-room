import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Package,
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
  shortSha,
  type AnalyticsPayload,
  type DeploymentsPayload,
  type ServicesPayload,
  usePolling,
} from "./data";

export default function Runtime() {
  const servicesRead = usePolling<ServicesPayload>("/api/v1/services", 60_000);
  const analyticsRead = usePolling<AnalyticsPayload>("/api/v1/analytics", 60_000);
  const deployRead = usePolling<DeploymentsPayload>("/api/v1/deployments", 60_000);

  const services = servicesRead.data?.items ?? [];
  const analytics = analyticsRead.data;
  const deployments = deployRead.data;
  const onlineServices = services.filter((service) => service.status === "online").length;
  const workerAnalytics = useMemo(
    () => new Map((analytics?.workers ?? []).map((worker) => [worker.name, worker])),
    [analytics],
  );
  const chartData = useMemo(
    () => [...(analytics?.workers ?? [])]
      .filter((worker) => worker.requests > 0)
      .sort((a, b) => b.requests - a.requests)
      .map((worker) => ({
        name: worker.name.replace(/^uichat-mira-/, ""),
        requests: worker.requests,
      })),
    [analytics],
  );

  if (!servicesRead.data && !analytics && !deployments) {
    return (
      <section className="page-state">
        <Radio size={16} />
        <div>
          <strong>Reading runtime facts</strong>
          <small>{servicesRead.error ?? analyticsRead.error ?? deployRead.error ?? "Runtime surfaces are loading."}</small>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="source-strip source-strip-icons" aria-label="Runtime data sources">
        <span><Radio size={13} /> Probes · {servicesRead.data?.status ?? "loading"}</span>
        <span><Cloud size={13} /> Cloudflare · {cloudflareLabel(deployments?.status)}</span>
        <span><Activity size={13} /> Analytics · {analytics?.status ?? "loading"}</span>
        <small>{formatTime(servicesRead.data?.generatedAt ?? analytics?.generatedAt ?? deployments?.generatedAt)}</small>
      </section>

      <section className="metrics visual-metrics" aria-label="Runtime metrics">
        <article>
          <span className="metric-label"><Server size={15} /> Services online</span>
          <strong>{onlineServices}/{services.length || "—"}</strong>
          <small>live HTTP probes</small>
        </article>
        <article>
          <span className="metric-label"><Cloud size={15} /> Workers</span>
          <strong>{deployments?.workers.length || "—"}</strong>
          <small>latest deployment inventory</small>
        </article>
        <article>
          <span className="metric-label"><Package size={15} /> Pages</span>
          <strong>{deployments?.pages.length || "—"}</strong>
          <small>production projects</small>
        </article>
        <article>
          <span className="metric-label"><Activity size={15} /> Requests · 24h</span>
          <strong>{analytics?.status === "connected" ? formatCount(analytics.requests) : "—"}</strong>
          <small>{analytics?.status === "connected" ? `${formatCount(analytics.errors)} errors · ${analytics.errorRate.toFixed(3)}%` : "analytics unavailable"}</small>
        </article>
      </section>

      <section className="ops-section">
        <div className="section-heading visual-heading">
          <div>
            <p className="eyebrow">LIVE / RUNTIME</p>
            <h2>Services & Workers</h2>
          </div>
          <small>service health is live; deployment metadata is cached</small>
        </div>

        <div className="ops-grid compact-ops-grid">
          <article className="ops-panel">
            <div className="ops-title icon-panel-title">
              <strong><Server size={16} /> Services</strong>
              <small>{onlineServices} online</small>
            </div>
            <div className="ops-list">
              {services.map((service) => (
                <a className="ops-row" key={service.id} href={service.url} target="_blank" rel="noreferrer">
                  <span className="ops-name">
                    <strong>{service.label}</strong>
                    <small>{service.detail}</small>
                  </span>
                  <span className={`service-state icon-service-state ${service.status}`}>
                    {service.status === "online" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {service.latencyMs === null ? service.status : `${service.latencyMs} ms`}
                  </span>
                </a>
              ))}
              {!services.length && <div className="empty-row">No service probe data.</div>}
            </div>
          </article>

          <article className="ops-panel">
            <div className="ops-title icon-panel-title">
              <strong><Cloud size={16} /> Workers</strong>
              <small>{deployments?.workers.length ?? 0}</small>
            </div>
            <div className="ops-list">
              {(deployments?.workers ?? []).map((worker) => {
                const workerTraffic = workerAnalytics.get(worker.name);
                return (
                  <div className="ops-row" key={worker.name}>
                    <span className="ops-name">
                      <strong>{worker.name}</strong>
                      <small>{formatTime(worker.deployedAt ?? worker.modifiedAt)}{workerTraffic ? ` · ${formatCount(workerTraffic.requests)} req` : ""}</small>
                    </span>
                    <span className="mono-value">{shortSha(worker.versionId)}</span>
                  </div>
                );
              })}
              {!deployments?.workers.length && <div className="empty-row">No Worker data.</div>}
            </div>
          </article>
        </div>
      </section>

      <section className="cloudflare-section">
        <div className="section-heading visual-heading">
          <div>
            <p className="eyebrow">EDGE / 24 HOURS</p>
            <h2>Traffic</h2>
          </div>
          <small>{analytics?.status ?? "loading"}</small>
        </div>

        {analytics?.status === "connected" ? (
          <div className="traffic-panel">
            <div className="traffic-summary">
              <div className="traffic-title"><Cloud size={17} /><strong>Workers · last 24h</strong></div>
              <div className="traffic-numbers">
                <div><span>Requests</span><strong>{formatCount(analytics.requests)}</strong></div>
                <div><span>Errors</span><strong>{formatCount(analytics.errors)}</strong></div>
                <div><span>Error rate</span><strong>{analytics.errorRate.toFixed(3)}%</strong></div>
              </div>
            </div>
            {chartData.length ? (
              <div className="traffic-chart" aria-label="Worker request distribution in the last 24 hours">
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
            ) : (
              <div className="traffic-empty">No Worker requests recorded in this 24-hour window.</div>
            )}
          </div>
        ) : (
          <div className="cf-analytics-unavailable">
            <strong>24h Workers analytics unavailable</strong>
            <small>{analytics?.error ?? analyticsRead.error ?? "Analytics permission is unavailable."}</small>
          </div>
        )}
      </section>

      <section className="runtime-pages">
        <div className="section-heading visual-heading">
          <div>
            <p className="eyebrow">EDGE / PAGES</p>
            <h2>Pages</h2>
          </div>
          <small>{deployments?.pages.length ?? 0} visible</small>
        </div>
        <div className="ops-list runtime-page-list">
          {(deployments?.pages ?? []).map((page) => page.url ? (
            <a className="cf-row" key={page.name} href={page.url} target="_blank" rel="noreferrer">
              <span className="ops-name">
                <strong>{page.name}</strong>
                <small>{page.productionBranch ?? "production"} · {formatTime(page.deployedAt)}</small>
              </span>
              <span className="mono-value">{page.status ?? shortSha(page.commitHash)}</span>
            </a>
          ) : (
            <div className="cf-row" key={page.name}>
              <span className="ops-name">
                <strong>{page.name}</strong>
                <small>{page.productionBranch ?? "production"} · {formatTime(page.deployedAt)}</small>
              </span>
              <span className="mono-value">{page.status ?? shortSha(page.commitHash)}</span>
            </div>
          ))}
          {!deployments?.pages.length && <div className="empty-row">No Pages data.</div>}
        </div>
      </section>

      {(servicesRead.error || analyticsRead.error || deployRead.error) && (
        <div className="page-warning">
          {[servicesRead.error, analyticsRead.error, deployRead.error].filter(Boolean).join(" · ")}
        </div>
      )}
    </>
  );
}
