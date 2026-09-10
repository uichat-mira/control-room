import { useEffect, useMemo, useState } from "react";
import type { OrganizationSnapshot } from "./shared";

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
  repositories: [],
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
    fetch("/api/organization")
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
  const prodRepos = useMemo(
    () => view.repositories.filter((repo) => repo.defaultBranch === "prod").length,
    [view.repositories],
  );
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
              <small>{view.status === "connected" ? "GitHub connected" : "GitHub degraded"}</small>
            </span>
          </a>
        </div>
      </header>

      <section className="metrics" aria-label="Organization metrics">
        <article>
          <span>Repositories</span>
          <strong>{view.repositories.length}</strong>
          <small>{activeRepos} active</small>
        </article>
        <article>
          <span>Prod default</span>
          <strong>{prodRepos}</strong>
          <small>repositories</small>
        </article>
        <article>
          <span>Public repos</span>
          <strong>{view.organization.publicRepos}</strong>
          <small>GitHub organization</small>
        </article>
        <article>
          <span>Latest push</span>
          <strong className="metric-time">{formatTime(lastPush)}</strong>
          <small>across visible repos</small>
        </article>
      </section>

      <section className="repo-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE / GITHUB</p>
            <h2>Repositories</h2>
          </div>
          <small>updated {formatTime(view.generatedAt)}</small>
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
              <span>Language</span>
              <span>Issues</span>
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
                  <small>{repo.description || repo.fullName}</small>
                </span>
                <span data-label="Default"><code>{repo.defaultBranch}</code></span>
                <span data-label="Language">{repo.language || "—"}</span>
                <span data-label="Issues">{repo.openIssuesCount}</span>
                <span data-label="Last push">{formatTime(repo.pushedAt)}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>Source of truth: GitHub Organization</span>
        <span>Cloudflare data intentionally disconnected</span>
      </footer>
    </main>
  );
}
