import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  GitBranch,
  Package,
  Server,
} from "lucide-react";
import {
  buildIsFailure,
  cloudflareLabel,
  formatTime,
  shortSha,
  type DeploymentsPayload,
  type RepositoriesPayload,
  usePolling,
  workflowText,
  workflowTone,
} from "./data";

export default function Engineering() {
  const reposRead = usePolling<RepositoriesPayload>("/api/v1/repos", 60_000);
  const deployRead = usePolling<DeploymentsPayload>("/api/v1/deployments", 60_000);
  const repos = reposRead.data?.items ?? [];
  const deployments = deployRead.data;

  const stats = useMemo(() => {
    const withRuns = repos.filter((repo) => Boolean(repo.latestWorkflow)).length;
    const passing = repos.filter(
      (repo) => repo.latestWorkflow?.status === "completed" && repo.latestWorkflow.conclusion === "success",
    ).length;
    const failing = repos.filter((repo) => buildIsFailure(repo.latestWorkflow)).length;
    const running = repos.filter(
      (repo) => repo.latestWorkflow && repo.latestWorkflow.status !== "completed",
    ).length;
    const releases = repos.filter((repo) => Boolean(repo.latestRelease)).length;
    return { withRuns, passing, failing, running, releases };
  }, [repos]);

  if (!reposRead.data && !deployments) {
    return (
      <section className="page-state">
        <GitBranch size={16} />
        <div>
          <strong>Reading engineering facts</strong>
          <small>{reposRead.error ?? deployRead.error ?? "Repositories and deployment delivery are loading."}</small>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="source-strip source-strip-icons" aria-label="Engineering data sources">
        <span><GitBranch size={13} /> GitHub · {reposRead.data?.status ?? "loading"}</span>
        <span><Cloud size={13} /> Cloudflare · {cloudflareLabel(deployments?.status)}</span>
        <span><Activity size={13} /> Focused reads · no live probes</span>
        <small>{formatTime(reposRead.data?.generatedAt ?? deployments?.generatedAt)}</small>
      </section>

      <section className="metrics visual-metrics" aria-label="Engineering metrics">
        <article>
          <span className="metric-label"><GitBranch size={15} /> Repositories</span>
          <strong>{repos.length || "—"}</strong>
          <small>{repos.filter((repo) => !repo.archived).length} active</small>
        </article>
        <article>
          <span className="metric-label"><Activity size={15} /> Builds passing</span>
          <strong>{stats.passing}/{stats.withRuns || "—"}</strong>
          <small>{stats.failing} failed · {stats.running} running</small>
        </article>
        <article>
          <span className="metric-label"><Package size={15} /> Releases</span>
          <strong>{stats.releases || "—"}</strong>
          <small>repos with a published release</small>
        </article>
        <article>
          <span className="metric-label"><Cloud size={15} /> Deployments</span>
          <strong>{(deployments?.workers.length ?? 0) + (deployments?.pages.length ?? 0) || "—"}</strong>
          <small>{deployments?.workers.length ?? 0} Workers · {deployments?.pages.length ?? 0} Pages</small>
        </article>
      </section>

      <section className="repo-section fleet-section">
        <div className="section-heading visual-heading">
          <div>
            <p className="eyebrow">FLEET / GITHUB</p>
            <h2>Repositories & builds</h2>
          </div>
          <small>latest default-branch run and latest release</small>
        </div>

        {reposRead.error && <div className="page-warning">{reposRead.error}</div>}

        {repos.length ? (
          <div className="engineering-table" role="table" aria-label="Mira engineering fleet">
            <div className="engineering-row engineering-head" role="row">
              <span>Repository</span>
              <span>Build</span>
              <span>Release</span>
              <span>Updated</span>
              <span>State</span>
            </div>
            {repos.map((repo) => (
              <a className="engineering-row" href={repo.htmlUrl} target="_blank" rel="noreferrer" role="row" key={repo.fullName}>
                <span className="repo-name">
                  <strong>{repo.name}</strong>
                  <small><GitBranch size={11} /> {repo.defaultBranch}</small>
                </span>
                <span data-label="Build" className={`fleet-status ${workflowTone(repo.latestWorkflow)}`}>
                  {workflowTone(repo.latestWorkflow) === "success"
                    ? <CheckCircle2 size={14} />
                    : workflowTone(repo.latestWorkflow) === "failure"
                      ? <AlertTriangle size={14} />
                      : <Activity size={14} />}
                  {workflowText(repo.latestWorkflow)}
                </span>
                <span data-label="Release">{repo.latestRelease?.tagName ?? "—"}</span>
                <span data-label="Updated">{formatTime(repo.pushedAt)}</span>
                <span data-label="State">{repo.archived ? "archived" : repo.fork ? "fork" : "active"}</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="empty-row">No repository data available.</div>
        )}
      </section>

      <section className="cloudflare-section">
        <div className="section-heading visual-heading">
          <div>
            <p className="eyebrow">DELIVERY / CLOUDFLARE</p>
            <h2>Latest deployments</h2>
          </div>
          <small>{cloudflareLabel(deployments?.status)}</small>
        </div>

        {deployRead.error && <div className="page-warning">{deployRead.error}</div>}

        <div className="cf-grid">
          <article className="cf-panel">
            <div className="ops-title icon-panel-title">
              <strong><Server size={16} /> Workers</strong>
              <small>{deployments?.workers.length ?? 0}</small>
            </div>
            <div className="ops-list">
              {(deployments?.workers ?? []).map((worker) => (
                <div className="cf-row" key={worker.name}>
                  <span className="ops-name">
                    <strong>{worker.name}</strong>
                    <small>{worker.source ?? "deployment"} · {formatTime(worker.deployedAt ?? worker.modifiedAt)}</small>
                  </span>
                  <span className="mono-value">{shortSha(worker.versionId)}</span>
                </div>
              ))}
              {!deployments?.workers.length && <div className="empty-row">No Worker deployment data.</div>}
            </div>
          </article>

          <article className="cf-panel">
            <div className="ops-title icon-panel-title">
              <strong><Package size={16} /> Pages</strong>
              <small>{deployments?.pages.length ?? 0}</small>
            </div>
            <div className="ops-list">
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
              {!deployments?.pages.length && <div className="empty-row">No Pages deployment data.</div>}
            </div>
          </article>
        </div>
      </section>
    </>
  );
}
