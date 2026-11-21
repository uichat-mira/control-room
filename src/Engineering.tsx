import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, ChevronDown,
  ExternalLink, GitBranch, Search, ShieldAlert, Tag, X,
} from "lucide-react";
import { TuiLoading } from "./TuiLoading";
import {
  buildLabel, buildState, filterFleet, latestBuildRows, latestReleaseRows, summarizeFleet,
  type FleetFilter,
} from "./engineering-facts";
import { formatTime, type RepositoriesPayload, usePolling } from "./data";
import type { OrganizationRepository } from "./shared";
import "./engineering-workshop.css";

export type EngineeringView = "home" | "repos" | "builds" | "releases";

const filters: { id: FleetFilter; text: string }[] = [
  { id: "all", text: "全部" },
  { id: "attention", text: "Run 异常" },
  { id: "running", text: "执行中" },
  { id: "archived", text: "已归档" },
];

const directory = [
  { to: "/engineering/repos", title: "仓库档案", icon: GitBranch },
  { to: "/engineering/builds", title: "近期构建", icon: Activity },
  { to: "/engineering/releases", title: "Release", icon: Tag },
] as const;

function RepositoryRecord({ repo }: { repo: OrganizationRepository }) {
  const state = buildState(repo.latestWorkflow);
  return (
    <details className={"ew-record ew-" + state}>
      <summary>
        <span className="ew-record-signal" aria-hidden="true" />
        <span className="ew-record-main">
          <strong>{repo.name}</strong>
          <small>{repo.defaultBranch} · {repo.archived ? "已归档" : repo.fork ? "Fork" : "公开仓库"}
            {repo.language ? " · " + repo.language : ""}</small>
        </span>
        <span className={"ew-build-state ew-" + state}>{buildLabel(repo.latestWorkflow)}</span>
        <ChevronDown size={16} className="ew-chevron" aria-hidden="true" />
      </summary>
      <div className="ew-record-detail">
        {repo.description && <p className="ew-repo-description">{repo.description}</p>}
        <dl>
          <div>
            <dt>默认分支 · 最近 Run</dt>
            <dd>{repo.latestWorkflow
              ? <><strong>{repo.latestWorkflow.name}</strong><span>{buildLabel(repo.latestWorkflow)} · {formatTime(repo.latestWorkflow.updatedAt)}</span></>
              : <span>尚未取得 Run</span>}
            </dd>
            {repo.latestWorkflow?.htmlUrl && <a href={repo.latestWorkflow.htmlUrl} target="_blank" rel="noreferrer">
              GitHub Actions <ExternalLink size={12} />
            </a>}
          </div>
          <div>
            <dt>最新 Release</dt>
            <dd>{repo.latestRelease
              ? <><strong>{repo.latestRelease.tagName}</strong><span>{repo.latestRelease.name ?? "已发布版本"} · {formatTime(repo.latestRelease.publishedAt)}</span></>
              : <span>尚未取得 Release</span>}
            </dd>
            {repo.latestRelease?.htmlUrl && <a href={repo.latestRelease.htmlUrl} target="_blank" rel="noreferrer">
              GitHub Release <ExternalLink size={12} />
            </a>}
          </div>
          <div>
            <dt>仓库</dt>
            <dd><strong>{repo.archived ? "已归档" : "非归档"} · {repo.fork ? "Fork" : "原生"}</strong>
              <span>Push：{formatTime(repo.pushedAt)} · 更新：{formatTime(repo.updatedAt)}</span>
            </dd>
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer">GitHub 仓库 <ExternalLink size={12}/></a>
          </div>
        </dl>
      </div>
    </details>
  );
}

export default function Engineering({ view = "home" }: { view?: EngineeringView }) {
  // The engineering area only reads GitHub repository facts.
  // Runtime owns Cloudflare deployments, Workers/Pages assets and traffic.
  const read = usePolling<RepositoriesPayload>("/api/v1/repos", 60_000);
  const repos = useMemo(() => read.data?.items ?? [], [read.data]);
  const stats = useMemo(() => summarizeFleet(repos), [repos]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FleetFilter>("all");
  const [buildFilter, setBuildFilter] = useState<"all" | "running" | "failed" | "passed">("all");

  const filtered = useMemo(() => filterFleet(repos, search, filter), [repos, search, filter]);
  const buildRows = useMemo(() => latestBuildRows(repos, buildFilter), [repos, buildFilter]);
  const releaseRows = useMemo(() => latestReleaseRows(repos), [repos]);
  const noCurrentRead = Boolean(read.error);
  const degraded = read.data?.status === "degraded";

  if (!read.data && !read.error) return (
    <section className="page-state">
      <TuiLoading title="正在查阅 GitHub 工程档案" command="WORKSHOP / GITHUB" />
    </section>
  );

  if (!read.data) return (
    <section className="page-state" role="status">
      <ShieldAlert size={17} aria-hidden="true" />
      <div><strong>工程档案暂时不可读取</strong><small>{read.error}</small></div>
    </section>
  );

  return (
    <div className="engineering-workshop">
      <div className="ew-source-line" role="status">
        <span>GITHUB / READ ONLY</span>
        <span>{noCurrentRead ? "刷新失败 · 上次快照" :
          degraded ? "部分覆盖" : "采集 " + formatTime(read.data.generatedAt)}</span>
      </div>
      {(noCurrentRead || degraded) && (
        <p className="ew-warning" role="status">
          <ShieldAlert size={15} aria-hidden="true" />
          {read.error ? "GitHub 刷新失败，当前展示缓存快照；状态未重新确认。" :
            "仓库来源部分覆盖，列表和计数不代表全组织完整数据。"}
        </p>
      )}

      {view === "home" ? (
        <>
          <div className="ew-stats" aria-label="工程概况">
            <div><span>公开仓库</span><strong>{repos.length}</strong></div>
            <div><span>最近 Run 已发现</span><strong>{stats.withRuns}</strong></div>
            <div><span>进行中</span><strong>{stats.counts.running}</strong></div>
            <div><span>有 Release 的仓库</span><strong>{stats.released}</strong></div>
          </div>
          <nav className="ew-entry-grid" aria-label="工程档案入口">
            {directory.map(({ to, title, icon: Icon }) => (
              <Link to={to} key={to} className="ew-entry">
                <div className="ew-entry-top">
                  <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
                  <ArrowUpRight size={17} aria-hidden="true" />
                </div>
                <h2>{title}</h2>
                <span>{to.endsWith("/repos") ? repos.length + " 个仓库" :
                  to.endsWith("/builds") ? stats.withRuns + " 条最近 Run" :
                    stats.released + " 个仓库有 Release"}</span>
              </Link>
            ))}
          </nav>
          <p className="ew-fineprint">最近 Run / Release 均为每仓库已发现的最新记录，不是完整历史。</p>
        </>
      ) : (
        <>
          <div className="ew-detail-header">
            <Link className="ew-back" to="/engineering">← 工程车间</Link>
          </div>

          {view === "repos" && (
            <section className="ew-section" aria-label="仓库列表">
              <div className="ew-filterbar">
                <label className="ew-search">
                  <Search size={15} aria-hidden="true" />
                  <input type="search" value={search} onChange={event => setSearch(event.target.value)}
                    aria-label="搜索仓库名称、语言或分支" placeholder="搜索仓库、语言、分支" />
                  {search && <button type="button" onClick={() => setSearch("")} aria-label="清空搜索"><X size={15} /></button>}
                </label>
                <div className="ew-filters" role="group" aria-label="仓库状态筛选">
                  {filters.map(item => (
                    <button type="button" key={item.id} aria-pressed={filter === item.id}
                      onClick={() => setFilter(item.id)}>{item.text}</button>
                  ))}
                </div>
              </div>
              <div className="ew-result-count">{filtered.length} / {repos.length} 个仓库</div>
              {filtered.length ? (
                <div className="ew-repository-list">
                  {filtered.map(repo => <RepositoryRecord key={repo.fullName} repo={repo}/>)}
                </div>
              ) : <p className="ew-empty">当前筛选没有匹配的仓库。</p>}
            </section>
          )}

          {view === "builds" && (
            <section className="ew-section" aria-label="最近构建">
              <div className="ew-build-controls" role="group" aria-label="构建状态筛选">
                {([
                  ["all", "全部"], ["running", "执行中"], ["failed", "Run 异常"], ["passed", "已通过"],
                ] as const).map(([key, label]) =>
                  <button type="button" key={key} aria-pressed={buildFilter === key}
                    onClick={() => setBuildFilter(key)}>{label}</button>)}
              </div>
              <div className="ew-result-count">{buildRows.length} / {stats.withRuns} 条最近 Run</div>
              {buildRows.length ? <div className="ew-build-list">
                {buildRows.map(repo => <a className={"ew-build-row ew-" + buildState(repo.latestWorkflow)}
                  key={repo.fullName} href={repo.latestWorkflow!.htmlUrl} target="_blank" rel="noreferrer">
                  <span className="ew-build-main"><strong>{repo.name}</strong>
                    <small>{repo.latestWorkflow!.name} · {repo.defaultBranch} · {formatTime(repo.latestWorkflow!.updatedAt)}</small></span>
                  <span className={"ew-build-state ew-" + buildState(repo.latestWorkflow)}>{buildLabel(repo.latestWorkflow)}</span>
                  <ExternalLink size={14} aria-hidden="true" />
                </a>)}
              </div> : <p className="ew-empty">本次已取得的快照没有匹配的最新 Run。</p>}
              <p className="ew-fineprint">每仓库仅显示默认分支的最近一条 Run。历史记录请进入 GitHub Actions；失败不自动等于需要人工接手。</p>
            </section>
          )}

          {view === "releases" && (
            <section className="ew-section" aria-label="最新 Release">
              <div className="ew-result-count">{releaseRows.length} 个仓库有已发现的 Release</div>
              {releaseRows.length ? <div className="ew-release-list">
                {releaseRows.map(repo => <a key={repo.fullName} className="ew-release-row"
                  href={repo.latestRelease!.htmlUrl} target="_blank" rel="noreferrer">
                  <span className="ew-release-main"><strong>{repo.name}</strong>
                    <small>{repo.latestRelease!.name ?? "Release"} · {formatTime(repo.latestRelease!.publishedAt)}</small></span>
                  <span className="ew-release-tag">{repo.latestRelease!.tagName}</span>
                  <ExternalLink size={14} aria-hidden="true" />
                </a>)}
              </div> : <p className="ew-empty">尚未取得 Release 记录。</p>}
              <p className="ew-fineprint">每仓库仅展示最近已发现的一条 Release；完整版本历史请进入 GitHub。</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
