import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Cloud,
  GitBranch,
  Radio,
  Server,
  ShieldAlert,
} from "lucide-react";
import {
  buildIsFailure,
  cloudflareLabel,
  formatTime,
  type GovernancePayload,
  type SummaryPayload,
  usePolling,
  workflowText,
} from "./data";

type ExceptionRow = {
  key: string;
  kind: string;
  title: string;
  detail: string;
  href?: string;
  tone: "failure" | "running" | "warning";
};

export default function Overview() {
  const summary = usePolling<SummaryPayload>("/api/v1/summary", 60_000);
  const governance = usePolling<GovernancePayload>("/api/v1/governance", 5 * 60_000);
  const view = summary.data;

  const stats = useMemo(() => {
    const repositories = view?.repositories ?? [];
    const services = view?.services ?? [];
    const governanceRows = governance.data?.repositories ?? [];
    const buildsWithRuns = repositories.filter((repo) => Boolean(repo.latestWorkflow)).length;
    const healthyBuilds = repositories.filter(
      (repo) => repo.latestWorkflow?.status === "completed" && repo.latestWorkflow.conclusion === "success",
    ).length;
    const failedBuilds = repositories.filter((repo) => buildIsFailure(repo.latestWorkflow)).length;
    const runningBuilds = repositories.filter(
      (repo) => repo.latestWorkflow && repo.latestWorkflow.status !== "completed",
    ).length;
    const onlineServices = services.filter((service) => service.status === "online").length;
    const unhealthyServices = services.filter((service) => service.status !== "online").length;
    const policyKnown = governanceRows.filter(
      (repo) => repo.governance.defaultBranchProtected !== null,
    ).length;
    const unprotectedRepos = governanceRows.filter(
      (repo) => repo.governance.defaultBranchProtected === false,
    ).length;

    return {
      repositories,
      services,
      buildsWithRuns,
      healthyBuilds,
      failedBuilds,
      runningBuilds,
      onlineServices,
      unhealthyServices,
      policyKnown,
      unprotectedRepos,
      activeRepos: repositories.filter((repo) => !repo.archived).length,
      cloudflareAssets: (view?.cloudflare.workers.length ?? 0) + (view?.cloudflare.pages.length ?? 0),
    };
  }, [governance.data, view]);

  const exceptions = useMemo<ExceptionRow[]>(() => {
    if (!view) return [];
    const rows: ExceptionRow[] = [];

    for (const repo of view.repositories) {
      if (buildIsFailure(repo.latestWorkflow)) {
        rows.push({
          key: `build-${repo.fullName}`,
          kind: "Build",
          title: repo.name,
          detail: `${workflowText(repo.latestWorkflow)} · ${formatTime(repo.latestWorkflow?.updatedAt)}`,
          href: repo.latestWorkflow?.htmlUrl ?? repo.htmlUrl,
          tone: "failure",
        });
      } else if (repo.latestWorkflow && repo.latestWorkflow.status !== "completed") {
        rows.push({
          key: `build-${repo.fullName}`,
          kind: "Build",
          title: repo.name,
          detail: `${workflowText(repo.latestWorkflow)} · ${formatTime(repo.latestWorkflow.updatedAt)}`,
          href: repo.latestWorkflow.htmlUrl,
          tone: "running",
        });
      }
    }

    for (const service of view.services) {
      if (service.status === "online") continue;
      rows.push({
        key: `service-${service.id}`,
        kind: "Service",
        title: service.label,
        detail: `${service.status} · ${service.detail}`,
        href: service.url,
        tone: service.status === "offline" ? "failure" : "warning",
      });
    }

    for (const repo of governance.data?.repositories ?? []) {
      if (repo.governance.defaultBranchProtected !== false) continue;
      rows.push({
        key: `policy-${repo.fullName}`,
        kind: "Policy",
        title: repo.name,
        detail: `${repo.defaultBranch} default branch is open`,
        href: repo.htmlUrl,
        tone: "warning",
      });
    }

    return rows;
  }, [governance.data, view]);

  if (!view) {
    return (
      <section className="page-state">
        <CircleDot size={16} />
        <div>
          <strong>Reading the organization snapshot</strong>
          <small>{summary.error ?? "GitHub, Cloudflare, and runtime probes are loading."}</small>
        </div>
      </section>
    );
  }

  const projects = governance.data?.github.projects.status === "connected"
    ? governance.data.github.projects.items
    : [];
  const activeProject = projects.find((project) => !project.closed) ?? projects[0] ?? null;
  const attentionCount = stats.failedBuilds + stats.unhealthyServices + stats.unprotectedRepos;

  return (
    <>
      <section className="source-strip source-strip-icons" aria-label="Control Room data sources">
        <span><GitBranch size={13} /> GitHub · {view.sources.github}</span>
        <span><Cloud size={13} /> Cloudflare · {cloudflareLabel(view.sources.cloudflare)}</span>
        <span><Radio size={13} /> Runtime · live probes</span>
        <small>{formatTime(view.generatedAt)}</small>
      </section>

      <section className={`attention-bar ${attentionCount === 0 ? "quiet" : "active"}`} aria-label="Attention summary">
        <div className="attention-title">
          {attentionCount === 0 ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          <strong>{attentionCount === 0 ? "No active operational warnings" : `${attentionCount} things need a look`}</strong>
        </div>
        <div className="attention-facts">
          <span><Activity size={14} /> {stats.failedBuilds} failed{stats.runningBuilds ? ` · ${stats.runningBuilds} running` : ""}</span>
          <span><Server size={14} /> {stats.unhealthyServices} unhealthy services</span>
          <span><ShieldAlert size={14} /> {stats.policyKnown ? `${stats.unprotectedRepos} open defaults` : "policy loading"}</span>
        </div>
      </section>

      <section className="metrics visual-metrics" aria-label="System metrics">
        <article>
          <span className="metric-label"><GitBranch size={15} /> Repositories</span>
          <strong>{stats.repositories.length}</strong>
          <small>{stats.activeRepos} active</small>
        </article>
        <article>
          <span className="metric-label"><Activity size={15} /> Builds passing</span>
          <strong>{stats.healthyBuilds}/{stats.buildsWithRuns || "—"}</strong>
          <small>latest default-branch run</small>
        </article>
        <article>
          <span className="metric-label"><Server size={15} /> Services online</span>
          <strong>{stats.onlineServices}/{stats.services.length || "—"}</strong>
          <small>HTTP probes</small>
        </article>
        <article>
          <span className="metric-label"><Cloud size={15} /> Edge assets</span>
          <strong>{stats.cloudflareAssets || "—"}</strong>
          <small>{view.cloudflare.workers.length} Workers · {view.cloudflare.pages.length} Pages</small>
        </article>
      </section>

      {activeProject && (
        <section className="now-strip">
          <div className="now-label">
            <CircleDot size={16} />
            <span>NOW / PROJECT</span>
          </div>
          <a href={activeProject.url} target="_blank" rel="noreferrer" className="now-project">
            <strong>{activeProject.title}</strong>
            <span>{activeProject.itemCount} items · {activeProject.closed ? "closed" : "active"} · updated {formatTime(activeProject.updatedAt)}</span>
          </a>
        </section>
      )}

      <section className="overview-exceptions">
        <div className="section-heading visual-heading">
          <div>
            <p className="eyebrow">NOW / ATTENTION</p>
            <h2>Current exceptions</h2>
          </div>
          <small>details live in Engineering, Runtime, and Governance</small>
        </div>

        {exceptions.length === 0 ? (
          <div className="overview-quiet">
            <CheckCircle2 size={18} />
            <div>
              <strong>Nothing exceptional in the current snapshot.</strong>
              <small>Healthy state stays quiet here; use the domain pages for full inventories.</small>
            </div>
          </div>
        ) : (
          <div className="exception-list">
            {exceptions.map((item) => {
              const content = (
                <>
                  <span className={`exception-kind ${item.tone}`}>
                    {item.tone === "failure" ? <AlertTriangle size={13} /> : item.tone === "running" ? <Activity size={13} /> : <ShieldAlert size={13} />}
                    {item.kind}
                  </span>
                  <span className="exception-name">
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                </>
              );
              return item.href ? (
                <a key={item.key} className="exception-row" href={item.href} target="_blank" rel="noreferrer">
                  {content}
                </a>
              ) : (
                <div key={item.key} className="exception-row">{content}</div>
              );
            })}
          </div>
        )}
      </section>

      {(summary.error || governance.error) && (
        <div className="page-warning">
          {[summary.error, governance.error].filter(Boolean).join(" · ")}
        </div>
      )}
    </>
  );
}
