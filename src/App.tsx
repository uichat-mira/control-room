import { lazy, Suspense, useEffect, useState } from "react";
import { TuiLoading } from "./TuiLoading";
import {
  Link,
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
  Clapperboard,
  Gauge,
  Ellipsis,
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
const FactoryTV = lazy(() => import("./FactoryTV"));
const DocsPage = lazy(() => import("./DocsPage"));

const themeLabel: Record<ThemeMode, string> = { system: "跟随系统", light: "亮色", dark: "深色" };

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
    title: "中央厂务室",
    eyebrow: "MIRA / CENTRAL OFFICE",
    deck: "今天的生产秩序，由事实与证据负责。",
  },
  engineering: {
    path: "/engineering",
    title: "工程车间",
    eyebrow: "BUILD / DELIVERY",
    deck: "仓库、构建、发布和交付。代码不是靠喊口号上线的。",
  },
  runtime: {
    path: "/runtime",
    title: "设备科",
    eyebrow: "RUNTIME / EDGE",
    deck: "服务、边缘运行与流量。探针正常不等于用户无事。",
  },
  governance: {
    path: "/governance",
    title: "监察委员会",
    eyebrow: "GOVERNANCE / POLICY",
    deck: "Issues、PR、分支规则与项目。没有证据就没有结案。",
  },
};

const nav = [
  ["overview", "厂务", Gauge],
  ["engineering", "工程", Wrench],
  ["runtime", "设备", Radio],
  ["governance", "监察", ShieldCheck],
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
    <section className="page-loading">
      <TuiLoading title="正在装载 Control Room 界面" detail="正在读取页面模块，不代表后台任务已完成" command="MIRA / LOAD MODULE" />
    </section>
  );
}

function ControlLayout() {
  const { pathname } = useLocation();
  const page = pageKeyForPath(pathname);
  const meta = routes[page];
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("mira-control-room-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
  });

  useEffect(() => {
    delete document.documentElement.dataset.wall;
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("mira-control-room-theme", theme);
    } else {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("mira-control-room-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    document.title = `${meta.title} · Mira Control Room`;
  }, [meta.title]);

  return (
    <main className="shell control-shell">
      <header className="topbar visual-topbar control-masthead">
        <div className="control-masthead-title">
          <Link className="control-factory-mark" to="/" aria-label="中央厂务室首页">厂</Link>
          <div className="headline">
            <p className="eyebrow">{meta.eyebrow} / PUBLIC READ</p>
            <h1>{meta.title}</h1>
            <p className="deck">{meta.deck}</p>
          </div>
        </div>
        <div className="control-masthead-actions">
          <NavLink to="/factory" className="control-channel-link" aria-label="进入原版血汗工厂 TV" title="原版血汗工厂 TV">
            <Clapperboard size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>血汗 TV</span>
          </NavLink>
          <NavLink to="/wall" className="control-channel-link" aria-label="进入原版 Mira System 大屏" title="原版 Mira System 大屏">
            <Monitor size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>System</span>
          </NavLink>
          <details className="control-more">
            <summary aria-label="更多入口和主题设置" title="更多入口和主题设置">
              <Ellipsis size={19} aria-hidden="true" />
            </summary>
            <div className="control-more-menu">
              <Link to="/docs"><BookOpen size={15} aria-hidden="true" /> API / MCP 文档</Link>
              <a href="https://github.com/uichat-mira" target="_blank" rel="noreferrer">
                <CircleDot size={15} aria-hidden="true" /> GitHub 组织
              </a>
              <button type="button" onClick={() => setTheme(nextTheme[theme])}>
                <ThemeIcon mode={theme} /> 主题：{themeLabel[theme]} · 切换
              </button>
              <p>公共只读 · 不提供派工或发布操作</p>
            </div>
          </details>
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
          <NavLink to="/factory"><Clapperboard size={14} /> Factory TV</NavLink>
        </div>
      </nav>

      <nav className="control-mobile-nav" aria-label="主要业务部门">
        {nav.map(([key, label, Icon]) => (
          <NavLink
            key={key}
            to={routes[key].path}
            end={key === "overview"}
            className={({ isActive }) => isActive ? "active" : undefined}
          >
            <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <Suspense fallback={<LoadingPage />}>
        <Outlet />
      </Suspense>

      <footer>
        <span>反对 996，也反对拿 CI 绿灯冒充验收胜利。</span>
        <span>GitHub + Cloudflare · 公共只读 · API v1</span>
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

function FactoryRoute() {
  useEffect(() => {
    document.documentElement.dataset.wall = "true";
    document.title = "Factory TV · Mira Control Room";
    return () => {
      delete document.documentElement.dataset.wall;
    };
  }, []);

  return (
    <Suspense fallback={<main className="shell wall-shell"><LoadingPage /></main>}>
      <main className="shell wall-shell factory-screen">
        <FactoryTV />
      </main>
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
      <Route path="factory" element={<FactoryRoute />} />
      <Route path="factory/broadcast" element={<FactoryRoute />} />
      <Route path="factory/:runId" element={<Navigate to="/factory" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
