import { lazy, Suspense, useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router";
import {
  BookOpen,
  CircleDot,
  Gauge,
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
const DocsPage = lazy(() => import("./DocsPage"));

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

function pageKeyForPath(pathname: string): PageKey {
  const normalized = pathname !== "/" ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === routes.engineering.path) return "engineering";
  if (normalized === routes.runtime.path) return "runtime";
  if (normalized === routes.governance.path) return "governance";
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

function ControlLayout() {
  const { pathname } = useLocation();
  const page = pageKeyForPath(pathname);
  const meta = routes[page];
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("mira-control-room-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });

  useEffect(() => {
    delete document.documentElement.dataset.wall;
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("mira-control-room-theme");
    } else {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("mira-control-room-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    document.title = `${meta.title} · Mira Control Room`;
  }, [meta.title]);

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
            <NavLink
              key={key}
              to={routes[key].path}
              end={key === "overview"}
              className={({ isActive }) => isActive ? "active" : undefined}
            >
              <Icon size={14} />
              {label}
            </NavLink>
          ))}
        </div>
        <div className="control-nav-meta">
          <NavLink to="/docs"><BookOpen size={14} /> Docs</NavLink>
          <NavLink to="/wall"><Monitor size={14} /> Wall</NavLink>
        </div>
      </nav>

      <Suspense fallback={<LoadingPage />}>
        <Outlet />
      </Suspense>

      <footer>
        <span>GitHub + Cloudflare + runtime · focused public reads</span>
        <span>API v1 · MCP · read-only</span>
      </footer>
    </main>
  );
}

function WallRoute() {
  useEffect(() => {
    document.documentElement.dataset.wall = "true";
    document.title = "Mira System · Control Room";
    return () => {
      delete document.documentElement.dataset.wall;
    };
  }, []);

  return (
    <Suspense fallback={<main className="shell wall-shell"><LoadingPage /></main>}>
      <Wall />
    </Suspense>
  );
}

function DocsRoute() {
  useEffect(() => {
    delete document.documentElement.dataset.wall;
  }, []);

  return (
    <Suspense fallback={<main className="shell"><LoadingPage /></main>}>
      <DocsPage />
    </Suspense>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<ControlLayout />}>
        <Route index element={<Overview />} />
        <Route path="engineering" element={<Engineering />} />
        <Route path="runtime" element={<Runtime />} />
        <Route path="governance" element={<Governance />} />
      </Route>
      <Route path="docs" element={<DocsRoute />} />
      <Route path="wall" element={<WallRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
