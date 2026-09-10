import { useEffect, useMemo, useState } from "react";
import type { OrganizationSnapshot, RepositoryWorkflow } from "./shared";

type ThemeMode = "system" | "light" | "dark";

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
  sources: { github: "degraded", cloudflare: "pending" },
  repositories: [],
  services: [],
  error: "GitHub organization data unavailable",
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

const nextTheme: Record<ThemeMode, ThemeMode> = {
  system: "light",
  light: "dark",
  dark: "system",
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
  if (run.conclusion === "cancelled" || run.conclusion === "skipped" || run.conclusion === "neutral") {
    return "muted";
  }
  return "failure";
};

export default function App() {
  const [data, setData] = useState<OrganizationSnapshot | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("mira-control-room-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("mira-control-room-theme");
      return;
    }

    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mira-control-room-theme", theme);
  }, [theme]);

  useEffect(() => {
    fetch("/api/summary")
      .then(async (response) => {
        const body = (await response.json()) as OrganizationSnapshot;
        if (!response.ok) throw body;
        return body;
      })
      .then(setData)
      .catch((error) => {
        if (error && typeof error === "object" && "organization" in error) {
          setData(error as OrganizationSnapshot);
          return;
        }
        setData(fallback);
      });
  }, []);

  const view = data ?? fallback;
  const activeRepos = useMemo(
    () => view.repositories.filter((repo) => !repo.archived).length,
    [view.repositories],
  );
  const lastPush = useMemo(
    () =>
      view.repositories
        .map((repo) => repo.pushedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
    [view.repositories],
  );
  const healthyBuilds = useMemo(
    () =>
      view.repositories.filter(
        (repo) => repo.latestWorkflow?.status === "completed" && repo.latestWorkflow.conclusion === "success",
      ).length,
    [view.repositories],
  );
  const onlineServices = useMemo(
    () => view.services.filter((service) => service.status === "online").length,
    [view.services],
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MIRA / CONTROL ROOM</p>
          <h1>Organization</h1>
        </div>
        <div className="header-actions">
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme(nextTheme[theme])}
            aria-label={`Theme: ${theme}. Switch to ${nextTheme[theme]}.`}
            title={`Theme: ${theme}`}
          >
            {theme}
          </button>
          <a className="org-link" href={view.organization.htmlUrl} target="_blank" rel="noreferrer">
            <span className={"beacon " + view.status} />
            <span>
              <strong>{view.organization.login}</strong>
              <small>{view.status === "connected" ? "System operational" : "Attention required"}</small>
            </span>
          </a>
        </div>
      </header>

      <section className="source-strip" aria-label="Control Room data sources">
        <span><i className={"source-dot " + view.sources.github} /> GitHub · {view.sources.github}</span>
        <span><i className="source-dot pending" /> Cloudflare · read token pending</span>
        <small>snapshot {formatTime(view.generatedAt)}</small>
      </section>

      <section className="metrics" aria-label="Organization metrics">
        <article>
          <span>Repositories</span>
          <strong>{view.repositories.length}</strong>
          <small>{activeRepos} active</small>
        </article>
        <article>
          <span>Builds passing</span>
          <strong>{healthyBuilds}</strong>
          <small>latest default-branch run</small>
        </article>
        <article>
          <span>Services online</span>
          <strong>{onlineServices}/{view.services.length || "—"}</strong>
          <small>live HTTP probes</small>
        </article>
        <article>
          <span>Latest push</span>
          <strong className="metric-time">{formatTime(lastPush)}</strong>
          <small>across visible repos</small>
        </article>
      </section>

      <section className="ops-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">NOW / OPERATIONS</p>
            <h2>Live state</h2>
          </div>
          <small>GitHub activity + runtime probes</small>
        </div>

        <div className="ops-grid">
          <article className="ops-panel">
            <div className="ops-title">
              <strong>Builds</strong>
              <small>default branch</small>
            </div>
            <div className="ops-list">
              {view.repositories.map((repo) => (
                <a
                  className="ops-row"
                  key={repo.fullName}
                  href={repo.latestWorkflow?.htmlUrl || repo.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="ops-name">
                    <strong>{repo.name}</strong>
                    <small>{repo.latestWorkflow ? formatTime(repo.latestWorkflow.updatedAt) : repo.defaultBranch}</small>
                  </span>
                  <span className={"status-pill " + workflowTone(repo.latestWorkflow)}>
                    {workflowText(repo.latestWorkflow)}
                  </span>
                </a>
              ))}
            </div>
          </article>

          <article className="ops-panel">
            <div className="ops-title">
              <strong>Services</strong>
              <small>HTTP probe</small>
            </div>
            <div className="ops-list">
              {view.services.map((service) => (
                <a className="ops-row" key={service.id} href={service.url} target="_blank" rel="noreferrer">
                  <span className="ops-name">
                    <strong>{service.label}</strong>
                    <small>{service.detail}</small>
                  </span>
                  <span className={"service-state " + service.status}>
                    <i />
                    {service.latencyMs === null ? service.status : `${service.latencyMs} ms`}
                  </span>
                </a>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="repo-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE / GITHUB</p>
            <h2>Repositories</h2>
          </div>
          <small>{view.organization.publicRepos} public repositories</small>
        </div>

        {view.error ? (
          <div className="error-state">
            <strong>Organization data unavailable</strong>
            <span>{view.error}</span>
          </div>
        ) : (
          <div className="repo-table" role="table" aria-label="Mira repositories">
            <div className="repo-row repo-head" role="row">
              <span>Repository</span>
              <span>Default</span>
              <span>Build</span>
              <span>Release</span>
              <span>Last push</span>
            </div>
            {view.repositories.map((repo) => (
              <a
                className="repo-row"
                href={repo.htmlUrl}
                target="_blank"
                rel="noreferrer"
                role="row"
                key={repo.fullName}
              >
                <span className="repo-name">
                  <strong>{repo.name}</strong>
                  <small>{repo.description || `${repo.openIssuesCount} open issues · ${repo.language || "—"}`}</small>
                </span>
                <span data-label="Default"><code>{repo.defaultBranch}</code></span>
                <span data-label="Build" className={"build-text " + workflowTone(repo.latestWorkflow)}>
                  {workflowText(repo.latestWorkflow)}
                </span>
                <span data-label="Release">{repo.latestRelease?.tagName || "—"}</span>
                <span data-label="Last push">{formatTime(repo.pushedAt)}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>GitHub is live · Cloudflare observability is next</span>
        <span>Public read model · 15 min edge cache</span>
      </footer>
    </main>
  );
}
