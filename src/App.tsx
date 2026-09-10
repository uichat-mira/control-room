import { lazy, Suspense, useEffect, useState } from "react";
import {
  BookOpen,
  CircleDot,
  Gauge,
  GitBranch,
  Monitor,
  Moon,
  Radio,
  ShieldCheck,
  Sun,
  Wrench,
} from "lucide-react";

type ThemeMode = "system" | "light" | "dark";
type PageKey = "overview" | "engineering" | "runtime" | "governance";

const Overview = lazy(() => import("./Overview"));
const Engineering = lazy(() => import("./Engineering"));
const Runtime = lazy(() => import("./Runtime"));
const Governance = lazy(() => import("./Governance"));
const Wall = lazy(() => import("./Wall"));

const nextTheme: Record<ThemeMode, ThemeMode> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const routes: Record<PageKey, {
  path: string;
  title: string;
  eyebrow: string;
  deck: string;
}> = {
  overview: {
    path: "/",
    title: "Control Room",
    eyebrow: "MIRA / CONTROL ROOM",
    deck: "What Mira is building, what is alive, and what needs attention right now.",
  },
  engineering: {
    path: "/engineering",
    title: "Engineering",
    eyebrow: "BUILD / DELIVERY",
    deck: "Repositories, default-branch builds, releases, and deployment delivery.",
  },
  runtime: {
    path: "/runtime",
    title: "Runtime",
    eyebrow: "LIVE / EDGE",
    deck: "Service probes, Workers, Pages, and the last 24 hours of edge traffic.",
  },
  governance: {
    path: "/governance",
    title: "Governance",
    eyebrow: "WORK / POLICY",
    deck: "Issues, pull requests, branch policy, rulesets, and public organization Projects.",
  },
};

const nav = [
  ["overview", "Overview", Gauge],
  ["engineering", "Engineering", Wrench],
  ["runtime", "Runtime", Radio],
  ["governance", "Governance", ShieldCheck],
] as const;

function pageFor(pathname: string): PageKey {
  const normalized = pathname !== "/" ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/engineering") return "engineering";
  if (normalized === "/runtime") return "runtime";
  if (normalized === "/governance") return "governance";
  return "overview";
}

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === "light") return <Sun size={15} strokeWidth={1.8} />;
  if (mode === "dark") return <Moon size={15} strokeWidth={1.8} />;
  return <Monitor size={15} strokeWidth={1.8} />;
}

function LoadingPage() {
  return (
    <section className="page-loading" aria-live="polite">
      <CircleDot size={15} />
      Reading Control Room…
    </section>
  );
}

export default function App() {
  const pathname = window.location.pathname;
  const isWall = pathname === "/wall";
  const page = pageFor(pathname);
  const meta = routes[page];
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
    const previous = document.title;
    document.title = isWall ? "Mira System · Control Room" : `${meta.title} · Mira Control Room`;
    return () => {
      document.title = previous;
    };
  }, [isWall, meta.title]);

  if (isWall) {
    return (
      <Suspense fallback={<main className="shell wall-shell"><LoadingPage /></main>}>
        <Wall />
      </Suspense>
    );
  }

  const Page = page === "engineering"
    ? Engineering
    : page === "runtime"
      ? Runtime
      : page === "governance"
        ? Governance
        : Overview;

  return (
    <main className="shell">
      <header className="topbar visual-topbar">
        <div className="headline">
          <p className="eyebrow">{meta.eyebrow}</p>
          <h1>{meta.title}</h1>
          <p className="deck">{meta.deck}</p>
        </div>
        <div className="header-actions">
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
          <a className="org-link" href="https://github.com/uichat-mira" target="_blank" rel="noreferrer">
            <CircleDot className="status-icon ok" size={20} />
            <span>
              <strong>PUBLIC READ MODEL</strong>
              <small>uichat-mira · API v1</small>
            </span>
          </a>
        </div>
      </header>

      <nav className="control-nav" aria-label="Control Room sections">
        <div className="control-nav-main">
          {nav.map(([key, label, Icon]) => (
            <a key={key} href={routes[key].path} className={page === key ? "active" : undefined}>
              <Icon size={14} />
              {label}
            </a>
          ))}
        </div>
        <div className="control-nav-meta">
          <a href="/docs"><BookOpen size={14} /> Docs</a>
          <a href="/wall"><Monitor size={14} /> Wall</a>
        </div>
      </nav>

      <Suspense fallback={<LoadingPage />}>
        <Page />
      </Suspense>

      <footer>
        <span>GitHub + Cloudflare + runtime · focused public reads</span>
        <span>API v1 · MCP · read-only</span>
      </footer>
    </main>
  );
}
