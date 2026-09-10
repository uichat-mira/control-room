import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Cloud,
  GitBranch,
  GitPullRequest,
  Monitor,
  Moon,
  Package,
  Radio,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  GitHubOrganizationObservability,
  OrganizationSnapshot,
  RepositoryGovernance,
  RepositoryWorkflow,
} from "./shared";

type ThemeMode = "system" | "light" | "dark";

interface GovernancePayload {
  generatedAt: string;
  status?: "connected" | "degraded";
  error?: string;
  github?: GitHubOrganizationObservability;
  repositories: Array<{
    fullName: string;
    governance?: RepositoryGovernance;
  }>;
}

const now = new Date().toISOString();
const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const emptyCloudflare = {
  status: "unconfigured" as const,
  workers: [],
  pages: [],
  analytics24h: {
    status: "unavailable" as const,
    from: dayAgo,
    to: now,
    requests: 0,
    errors: 0,
    errorRate: 0,
    workers: [],
  },
  errors: [],
};

const fallback: OrganizationSnapshot = {
  status: "degraded",
  generatedAt: new Date().toISOString(),
  organization: {
    login: "uichat-mira",
    name: null,
    htmlUrl: "https://github.com/uichat-mira",
    avatarUrl: "",
    description: null,
    publicRepos: 0,
    followers: 0,
  },
  sources: { github: "degraded", cloudflare: "unconfigured" },
  repositories: [],
  services: [],
  cloudflare: emptyCloudflare,
  deployedCommit: null,
  error: "Control Room data unavailable",
};

const formatTime = (value: string | null) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatCount = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);

const shortSha = (value: string | null) => (value ? value.slice(0, 7) : "—");

const nextTheme: Record<ThemeMode, ThemeMode> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const ThemeIcon = ({ mode }: { mode: ThemeMode }) => {
  if (mode === "light") return <Sun size={15} strokeWidth={1.8} />;
  if (mode === "dark") return <Moon size={15} strokeWidth={1.8} />;
  return <Monitor size={15} strokeWidth={1.8} />;
};

const workflowText = (run: RepositoryWorkflow | null) => {
  if (!run) return "No runs";
  if (run.status !== "completed") return run.status === "in_progress" ? "Running" : "Queued";
  if (run.conclusion === "success") return "Passed";
  if (run.conclusion === "cancelled") return "Cancelled";
  if (run.conclusion === "skipped" || run.conclusion === "neutral") return "Neutral";
  return run.conclusion ? run.conclusion.replaceAll("_", " ") : "Completed";
};

const workflowTone = (run: RepositoryWorkflow | null) => {
  if (!run) return "muted";
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "cancelled" || run.conclusion === "skipped" || run.conclusion === "neutral") return "muted";
  return "failure";
};

const cloudflareLabel = (status: OrganizationSnapshot["sources"]["cloudflare"]) => {
  if (status === "connected") return "connected";
  if (status === "degraded") return "partial";
  return "unconfigured";
};

const buildIsFailure = (run: RepositoryWorkflow | null) => {
  if (!run || run.status !== "completed") return false;
  return !["success", "cancelled", "skipped", "neutral"].includes(run.conclusion ?? "");
};

export default function App() {
  const isWall = window.location.pathname === "/wall";
  const [data, setData] = useState<OrganizationSnapshot | null>(null);
  const [governanceData, setGovernanceData] = useState<GovernancePayload | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("mira-control-room-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });

  useEffect(() => {
    if (isWall) {
      document.documentElement.dataset.wall = "true";
      return () => {
        delete document.documentElement.dataset.wall;
      };
    }

    delete document.documentElement.dataset.wall;
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("mira-control-room-theme");
    } else {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("mira-control-room-theme", theme);
    }
  }, [isWall, theme]);

  useEffect(() => {
    let active = true;

    const refresh = () => {
      fetch("/api/summary", { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as OrganizationSnapshot;
          if (!response.ok) throw body;
          return body;
        })
        .then((body) => {
          if (active) setData(body);
        })
        .catch((error) => {
          if (!active) return;
          if (error && typeof error === "object" && "organization" in error) {
            setData(error as OrganizationSnapshot);
          } else {
            setData((current) => current ?? fallback);
          }
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (isWall) return;
    let active = true;

    const refreshGovernance = () => {
      fetch("/api/governance", { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as GovernancePayload;
          if (!response.ok) throw new Error(`Governance API ${response.status}`);
          return body;
        })
        .then((body) => {
          if (active) setGovernanceData(body);
        })
        .catch(() => {
          // Keep the previous governance projection if a refresh fails.
        });
    };

    refreshGovernance();
    const timer = window.setInterval(refreshGovernance, 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isWall]);

  const view = data ?? fallback;
  const governanceByRepo = useMemo(
    () => new Map((governanceData?.repositories ?? []).map((repo) => [repo.fullName, repo.governance])),
    [governanceData],
  );
  const repositories = useMemo(
    () => view.repositories.map((repo) => ({ ...repo, governance: governanceByRepo.get(repo.fullName) ?? repo.governance })),
    [view.repositories, governanceByRepo],
  );
  const activeRepos = useMemo(() => repositories.filter((repo) => !repo.archived).length, [repositories]);
  const buildsWithRuns = useMemo(() => repositories.filter((repo) => Boolean(repo.latestWorkflow)).length, [repositories]);
  const healthyBuilds = useMemo(
    () => repositories.filter((repo) => repo.latestWorkflow?.status === "completed" && repo.latestWorkflow.conclusion === "success").length,
    [repositories],
  );
  const failedBuilds = useMemo(() => repositories.filter((repo) => buildIsFailure(repo.latestWorkflow)).length, [repositories]);
  const runningBuilds = useMemo(() => repositories.filter((repo) => repo.latestWorkflow && repo.latestWorkflow.status !== "completed").length, [repositories]);
  const onlineServices = useMemo(() => view.services.filter((service) => service.status === "online").length, [view.services]);
  const unhealthyServices = useMemo(() => view.services.filter((service) => service.status !== "online").length, [view.services]);
  const unprotectedRepos = useMemo(
    () => repositories.filter((repo) => repo.governance?.defaultBranchProtected === false).length,
    [repositories],
  );
  const policyKnown = useMemo(
    () => repositories.filter((repo) => repo.governance?.defaultBranchProtected !== undefined && repo.governance?.defaultBranchProtected !== null).length,
    [repositories],
  );
  const openIssues = useMemo(
    () => repositories.reduce((sum, repo) => sum + (repo.governance?.openIssues ?? 0), 0),
    [repositories],
  );
  const openPrs = useMemo(
    () => repositories.reduce((sum, repo) => sum + (repo.governance?.openPullRequests ?? 0), 0),
    [repositories],
  );
  const workerAnalytics = useMemo(
    () => new Map(view.cloudflare.analytics24h.workers.map((worker) => [worker.name, worker])),
    [view.cloudflare.analytics24h.workers],
  );
  const chartData = useMemo(
    () => [...view.cloudflare.analytics24h.workers]
      .filter((worker) => worker.requests > 0)
      .sort((a, b) => b.requests - a.requests)
      .map((worker) => ({ name: worker.name.replace(/^uichat-mira-/, ""), requests: worker.requests })),
    [view.cloudflare.analytics24h.workers],
  );
  const cloudflareAssets = view.cloudflare.workers.length + view.cloudflare.pages.length;
  const projects = governanceData?.github?.projects.status === "connected" ? governanceData.github.projects.items : [];
  const activeProject = projects.find((project) => !project.closed) ?? projects[0] ?? null;
  const attentionCount = failedBuilds + unhealthyServices + unprotectedRepos;

  return (
    <main className={isWall ? "shell wall-shell" : "shell"}>
      <header className="topbar visual-topbar">
        <div className="headline">
          <p className="eyebrow">MIRA / CONTROL ROOM</p>
          <h1>{isWall ? "Mira System" : "Control Room"}</h1>
          {!isWall && <p className="deck">One glance at what Mira is building, what is alive, and what needs attention.</p>}
        </div>
        <div className="header-actions">
          {!isWall && (
            <button
              className="theme-toggle icon-button"
              type="button"
              onClick={() => setTheme(nextTheme[theme])}
              aria-label={`Theme: ${theme}. Switch to ${nextTheme[theme]}.`}
              title={`Theme: ${theme}`}
            >
              <ThemeIcon mode={theme} />
              <span>{theme}</span>
            </button>
          )}
          <a className="org-link" href={view.organization.htmlUrl} target="_blank" rel="noreferrer">
            {view.status === "connected" ? <CheckCircle2 className="status-icon ok" size={20} /> : <AlertTriangle className="status-icon warn" size={20} />}
            <span>
              <strong>{view.status === "connected" ? "SYSTEM OPERATIONAL" : "ATTENTION REQUIRED"}</strong>
              <small>{view.organization.login} · {formatTime(view.generatedAt)}</small>
            </span>
          </a>
        </div>
      </header>

      <section className="source-strip source-strip-icons" aria-label="Control Room data sources">
        <span><GitBranch size={13} /> GitHub · {view.sources.github}</span>
        <span><Cloud size={13} /> Cloudflare · {cloudflareLabel(view.sources.cloudflare)}</span>
        <span><Radio size={13} /> Runtime · live probes</span>
        <small>refresh 60s</small>
      </section>

      {!isWall && (
        <section className={"attention-bar " + (attentionCount === 0 ? "quiet" : "active")} aria-label="Attention summary">
          <div className="attention-title">
            {attentionCount === 0 ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
            <strong>{attentionCount === 0 ? "No active operational warnings" : `${attentionCount} things need a look`}</strong>
          </div>
          <div className="attention-facts">
            <span><Activity size={14} /> {failedBuilds} failed builds{runningBuilds ? ` · ${runningBuilds} running` : ""}</span>
            <span><Server size={14} /> {unhealthyServices} unhealthy services</span>
            <span><ShieldAlert size={14} /> {policyKnown ? `${unprotectedRepos} open default branches` : "policy loading"}</span>
          </div>
        </section>
      )}

      <section className="metrics visual-metrics" aria-label="System metrics">
        <article>
          <span className="metric-label"><GitBranch size={15} /> Repositories</span>
          <strong>{repositories.length}</strong>
          <small>{activeRepos} active</small>
        </article>
        <article>
          <span className="metric-label"><Activity size={15} /> Builds passing</span>
          <strong>{healthyBuilds}/{buildsWithRuns || "—"}</strong>
          <small>latest default-branch run</small>
        </article>
        <article>
          <span className="metric-label"><Server size={15} /> Services online</span>
          <strong>{onlineServices}/{view.services.length || "—"}</strong>
          <small>HTTP probes</small>
        </article>
        <article>
          <span className="metric-label"><Cloud size={15} /> Cloudflare assets</span>
          <strong>{cloudflareAssets || "—"}</strong>
          <small>{view.cloudflare.workers.length} Workers · {view.cloudflare.pages.length} Pages</small>
        </article>
      </section>

      {!isWall && activeProject && (
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

      <section className="ops-section">
        <div className="section-heading visual-heading">
          <div>
            <p className="eyebrow">NOW / OPERATIONS</p>
            <h2>Live systems</h2>
          </div>
          <small>healthy state stays quiet; exceptions stay visible</small>
        </div>

        <div className="ops-grid compact-ops-grid">
          <article className="ops-panel">
            <div className="ops-title icon-panel-title">
              <strong><Activity size={16} /> Builds</strong>
              <small>{healthyBuilds} passing</small>
            </div>
            <div className="ops-list">
              {repositories.map((repo) => (
                <a className="ops-row" key={repo.fullName} href={repo.latestWorkflow?.htmlUrl || repo.htmlUrl} target="_blank" rel="noreferrer">
                  <span className="ops-name">
                    <strong>{repo.name}</strong>
                    <small>{repo.latestWorkflow ? formatTime(repo.latestWorkflow.updatedAt) : repo.defaultBranch}</small>
                  </span>
                  <span className={"status-pill icon-pill " + workflowTone(repo.latestWorkflow)}>
                    {workflowTone(repo.latestWorkflow) === "success" ? <CheckCircle2 size={13} /> : workflowTone(repo.latestWorkflow) === "failure" ? <AlertTriangle size={13} /> : <Activity size={13} />}
                    {workflowText(repo.latestWorkflow)}
                  </span>
                </a>
              ))}
            </div>
          </article>

          <article className="ops-panel">
            <div className="ops-title icon-panel-title">
              <strong><Server size={16} /> Services</strong>
              <small>{onlineServices} online</small>
            </div>
            <div className="ops-list">
              {view.services.map((service) => (
                <a className="ops-row" key={service.id} href={service.url} target="_blank" rel="noreferrer">
                  <span className="ops-name">
                    <strong>{service.label}</strong>
                    <small>{service.detail}</small>
                  </span>
                  <span className={"service-state icon-service-state " + service.status}>
                    {service.status === "online" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {service.latencyMs === null ? service.status : `${service.latencyMs} ms`}
                  </span>
                </a>
              ))}
            </div>
          </article>
        </div>
      </section>

      {view.sources.cloudflare !== "unconfigured" && (
        <section className="cloudflare-section">
          <div className="section-heading visual-heading">
            <div>
              <p className="eyebrow">EDGE / CLOUDFLARE</p>
              <h2>Traffic & deployments</h2>
            </div>
            <small>{cloudflareLabel(view.sources.cloudflare)}</small>
          </div>

          {view.cloudflare.errors.length > 0 && <div className="cf-warning">{view.cloudflare.errors.join(" · ")}</div>}

          {view.cloudflare.analytics24h.status === "connected" ? (
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
                <div className="traffic-chart" aria-label="Worker request distribution in the last 24 hours">
                  <ResponsiveContainer width="100%" height={Math.max(150, chartData.length * 34)}>
                    <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 10, bottom: 4, left: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} tick={{ fill: "var(--text-soft)", fontSize: 11 }} />
                      <Tooltip cursor={{ fill: "var(--surface-soft)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--text)", fontSize: 12 }} formatter={(value) => [formatCount(Number(value)), "Requests"]} />
                      <Bar dataKey="requests" fill="var(--accent)" radius={[0, 4, 4, 0]} barSize={8} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ) : (
            <div className="cf-analytics-unavailable">
              <strong>24h Workers analytics unavailable</strong>
              <small>{view.cloudflare.analytics24h.error || "Analytics permission is unavailable."}</small>
            </div>
          )}

          {!isWall && (
            <div className="cf-grid">
              <article className="cf-panel">
                <div className="ops-title icon-panel-title"><strong><Server size={16} /> Workers</strong><small>{view.cloudflare.workers.length}</small></div>
                <div className="ops-list">
                  {view.cloudflare.workers.map((worker) => {
                    const analytics = workerAnalytics.get(worker.name);
                    return (
                      <div className="cf-row" key={worker.name}>
                        <span className="ops-name">
                          <strong>{worker.name}</strong>
                          <small>{worker.source || "deployment"} · {formatTime(worker.deployedAt || worker.modifiedAt)}{analytics ? ` · ${formatCount(analytics.requests)} req` : ""}</small>
                        </span>
                        <span className="mono-value">{shortSha(worker.versionId)}</span>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="cf-panel">
                <div className="ops-title icon-panel-title"><strong><Package size={16} /> Pages</strong><small>{view.cloudflare.pages.length}</small></div>
                <div className="ops-list">
                  {view.cloudflare.pages.map((page) => page.url ? (
                    <a className="cf-row" key={page.name} href={page.url} target="_blank" rel="noreferrer">
                      <span className="ops-name"><strong>{page.name}</strong><small>{page.productionBranch || "production"} · {formatTime(page.deployedAt)}</small></span>
                      <span className="mono-value">{page.status || shortSha(page.commitHash)}</span>
                    </a>
                  ) : (
                    <div className="cf-row" key={page.name}>
                      <span className="ops-name"><strong>{page.name}</strong><small>{page.productionBranch || "production"} · {formatTime(page.deployedAt)}</small></span>
                      <span className="mono-value">{page.status || shortSha(page.commitHash)}</span>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          )}
        </section>
      )}

      {!isWall && (
        <section className="repo-section fleet-section">
          <div className="section-heading visual-heading">
            <div>
              <p className="eyebrow">FLEET / GITHUB</p>
              <h2>Repositories</h2>
            </div>
            <small>{governanceData ? `${openIssues} issues · ${openPrs} PRs · ${unprotectedRepos} open defaults` : "loading work & policy"}</small>
          </div>

          {view.error && <div className="error-state"><strong>GitHub data is temporarily degraded</strong><span>{view.error}</span></div>}
          {governanceData?.error && <div className="cf-warning">Governance: {governanceData.error}</div>}

          {repositories.length > 0 ? (
            <div className="fleet-table" role="table" aria-label="Mira repository fleet">
              <div className="fleet-row fleet-head" role="row">
                <span>Repository</span><span>Build</span><span>Work</span><span>Policy</span><span>Release</span><span>Updated</span>
              </div>
              {repositories.map((repo) => {
                const protectedBranch = repo.governance?.defaultBranchProtected;
                const issues = repo.governance?.openIssues;
                const prs = repo.governance?.openPullRequests;
                return (
                  <a className="fleet-row" href={repo.htmlUrl} target="_blank" rel="noreferrer" role="row" key={repo.fullName}>
                    <span className="repo-name"><strong>{repo.name}</strong><small><GitBranch size={11} /> {repo.defaultBranch}</small></span>
                    <span data-label="Build" className={"fleet-status " + workflowTone(repo.latestWorkflow)}>
                      {workflowTone(repo.latestWorkflow) === "success" ? <CheckCircle2 size={14} /> : workflowTone(repo.latestWorkflow) === "failure" ? <AlertTriangle size={14} /> : <Activity size={14} />}
                      {workflowText(repo.latestWorkflow)}
                    </span>
                    <span data-label="Work" className="fleet-work"><CircleDot size={13} /> {issues ?? "—"}<GitPullRequest size={13} /> {prs ?? "—"}</span>
                    <span data-label="Policy" className={"fleet-policy " + (protectedBranch ? "protected" : protectedBranch === false ? "open" : "unknown")}>
                      {protectedBranch ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                      {protectedBranch ? "protected" : protectedBranch === false ? "open" : "pending"}
                    </span>
                    <span data-label="Release">{repo.latestRelease?.tagName || "—"}</span>
                    <span data-label="Updated">{formatTime(repo.pushedAt)}</span>
                  </a>
                );
              })}
            </div>
          ) : !view.error ? <div className="empty-row">No repository data available.</div> : null}
        </section>
      )}

      {!isWall && projects.length > 0 && (
        <section className="projects-section">
          <div className="section-heading visual-heading">
            <div><p className="eyebrow">WORK / PROJECTS</p><h2>Public projects</h2></div>
            <small>{projects.length} visible</small>
          </div>
          <div className="project-list-compact">
            {projects.map((project) => (
              <a key={project.number} href={project.url} target="_blank" rel="noreferrer" className="project-card-compact">
                <CircleDot size={16} />
                <span><strong>{project.title}</strong><small>{project.shortDescription || `Project #${project.number}`}</small></span>
                <span className="project-count">{project.itemCount} items</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {!isWall && (
        <footer>
          <span>GitHub + Cloudflare + runtime live</span>
          <span>{view.deployedCommit ? `build ${shortSha(view.deployedCommit)}` : "public read model"}</span>
        </footer>
      )}
    </main>
  );
}
