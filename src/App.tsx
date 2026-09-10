import { useEffect, useMemo, useState } from "react";
import type { OrganizationSnapshot, RepositoryWorkflow } from "./shared";

type ThemeMode = "system" | "light" | "dark";

const emptyCloudflare = {
  status: "unconfigured" as const,
  workers: [],
  pages: [],
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

const shortSha = (value: string | null) => (value ? value.slice(0, 7) : "—");

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

const cloudflareLabel = (status: OrganizationSnapshot["sources"]["cloudflare"]) => {
  if (status === "connected") return "connected";
  if (status === "degraded") return "partial";
  return "read token not configured";
};

export default function App() {
  const isWall = window.location.pathname === "/wall";
  const [data, setData] = useState<OrganizationSnapshot | null>(null);
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
          } else if (!data) {
            setData(fallback);
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
  const buildsWithRuns = useMemo(
    () => view.repositories.filter((repo) => Boolean(repo.latestWorkflow)).length,
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
  const cloudflareAssets = view.cloudflare.workers.length + view.cloudflare.pages.length;

  return (
    <main className={isWall ? "shell wall-shell" : "shell"}>
      <header className="topbar">
        <div className="headline">
          <p className="eyebrow">MIRA / CONTROL ROOM</p>
          <h1>{isWall ? "Mira System" : "Control Room"}</h1>
          {!isWall && <p className="deck">Build, deploy and runtime state across the Mira organization.</p>}
        </div>
        <div className="header-actions">
          {!isWall && (
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setTheme(nextTheme[theme])}
              aria-label={`Theme: ${theme}. Switch to ${nextTheme[theme]}.`}
              title={`Theme: ${theme}`}
            >
              {theme}
            </button>
          )}
          <a className="org-link" href={view.organization.htmlUrl} target="_blank" rel="noreferrer">
            <span className={"beacon " + view.status} />
            <span>
              <strong>{view.status === "connected" ? "SYSTEM OPERATIONAL" : "ATTENTION REQUIRED"}</strong>
              <small>{view.organization.login} · {formatTime(view.generatedAt)}</small>
            </span>
          </a>
        </div>
      </header>

      <section className="source-strip" aria-label="Control Room data sources">
        <span><i className={"source-dot " + view.sources.github} /> GitHub · {view.sources.github}</span>
        <span><i className={"source-dot " + view.sources.cloudflare} /> Cloudflare · {cloudflareLabel(view.sources.cloudflare)}</span>
        <span><i className="source-dot connected" /> Runtime · live probes</span>
        <small>refresh 60s · core cache 15m</small>
      </section>

      <section className="metrics" aria-label="System metrics">
        <article>
          <span>Repositories</span>
          <strong>{view.repositories.length}</strong>
          <small>{activeRepos} active</small>
        </article>
        <article>
          <span>Builds passing</span>
          <strong>{healthyBuilds}/{buildsWithRuns || "—"}</strong>
          <small>latest default-branch run</small>
        </article>
        <article>
          <span>Services online</span>
          <strong>{onlineServices}/{view.services.length || "—"}</strong>
          <small>HTTP probes refresh live</small>
        </article>
        <article>
          <span>{view.sources.cloudflare === "unconfigured" ? "Latest push" : "Cloudflare assets"}</span>
          <strong className={view.sources.cloudflare === "unconfigured" ? "metric-time" : undefined}>
            {view.sources.cloudflare === "unconfigured" ? formatTime(lastPush) : cloudflareAssets}
          </strong>
          <small>{view.sources.cloudflare === "unconfigured" ? "across visible repos" : "Mira Workers + Pages"}</small>
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

      <section className="cloudflare-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">EDGE / CLOUDFLARE</p>
            <h2>Deployments</h2>
          </div>
          <small>{cloudflareLabel(view.sources.cloudflare)}</small>
        </div>

        {view.sources.cloudflare === "unconfigured" ? (
          <div className="setup-row">
            <span className="setup-mark">CF</span>
            <div>
              <strong>Cloudflare read model is ready</strong>
              <p>Add the optional <code>CLOUDFLARE_READ_TOKEN</code> GitHub Actions secret. CI will sync it into the Worker runtime on the next deploy.</p>
            </div>
            <small>Workers Scripts: Read · Pages: Read</small>
          </div>
        ) : (
          <>
            {view.cloudflare.errors.length > 0 && (
              <div className="cf-warning">{view.cloudflare.errors.join(" · ")}</div>
            )}
            <div className="cf-grid">
              <article className="cf-panel">
                <div className="ops-title">
                  <strong>Workers</strong>
                  <small>{view.cloudflare.workers.length} Mira scripts</small>
                </div>
                <div className="ops-list">
                  {view.cloudflare.workers.length === 0 ? (
                    <div className="empty-row">No Mira Workers visible to this token.</div>
                  ) : view.cloudflare.workers.map((worker) => (
                    <div className="cf-row" key={worker.name}>
                      <span className="ops-name">
                        <strong>{worker.name}</strong>
                        <small>{worker.source || "deployment"} · {formatTime(worker.deployedAt || worker.modifiedAt)}</small>
                      </span>
                      <span className="mono-value" title={worker.versionId || undefined}>{shortSha(worker.versionId)}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="cf-panel">
                <div className="ops-title">
                  <strong>Pages</strong>
                  <small>{view.cloudflare.pages.length} Mira projects</small>
                </div>
                <div className="ops-list">
                  {view.cloudflare.pages.length === 0 ? (
                    <div className="empty-row">No Mira Pages projects visible to this token.</div>
                  ) : view.cloudflare.pages.map((page) => (
                    <a
                      className="cf-row"
                      key={page.name}
                      href={page.url || "#"}
                      target={page.url ? "_blank" : undefined}
                      rel={page.url ? "noreferrer" : undefined}
                    >
                      <span className="ops-name">
                        <strong>{page.name}</strong>
                        <small>{page.productionBranch || "production"} · {formatTime(page.deployedAt)}</small>
                      </span>
                      <span className="mono-value">{page.status || shortSha(page.commitHash)}</span>
                    </a>
                  ))}
                </div>
              </article>
            </div>
          </>
        )}
      </section>

      {!isWall && (
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
      )}

      {!isWall && (
        <footer>
          <span>GitHub + runtime live · Cloudflare read adapter ready</span>
          <span>{view.deployedCommit ? `build ${shortSha(view.deployedCommit)}` : "public read model"} · core cache 15m</span>
        </footer>
      )}
    </main>
  );
}
