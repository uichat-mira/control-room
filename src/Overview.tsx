import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, CircleDot,
  Clapperboard, Cloud, ExternalLink, GitBranch, Radio, Server, ShieldAlert,
} from "lucide-react";
import type { FactoryFeed } from "./factory-feed";
import {
  collectAttention, isFactoryFeed, workerIsActive, workerRunLabel,
} from "./overview-facts";
import {
  cloudflareLabel, formatTime, type GovernancePayload,
  type SummaryPayload, usePolling,
} from "./data";
import "./control-overview.css";

export default function Overview() {
  const summary = usePolling<SummaryPayload>("/api/v1/summary", 60_000);
  const governance = usePolling<GovernancePayload>("/api/v1/governance", 5 * 60_000);
  const workers = usePolling<FactoryFeed>("/api/v1/factory/runs", 60_000);
  const [showAllAttention, setShowAllAttention] = useState(false);

  const snapshot = summary.data;
  const feed = isFactoryFeed(workers.data) ? workers.data : null;
  const attention = useMemo(
    () => collectAttention(
      snapshot?.repositories ?? [],
      snapshot?.services ?? [],
      governance.data?.repositories ?? [],
    ),
    [snapshot, governance.data],
  );
  const ongoingBuilds = useMemo(
    () => (snapshot?.repositories ?? []).filter((repo) =>
      repo.latestWorkflow && repo.latestWorkflow.status !== "completed",
    ),
    [snapshot],
  );

  if (!snapshot) {
    return (
      <section className="page-state control-home-loading" role="status">
        <CircleDot size={18} />
        <div>
          <strong>{summary.error ? "厂务室暂时读不到快照" : "正在核对真实厂务记录"}</strong>
          <small>{summary.error ?? "GitHub / Cloudflare / Runtime · 不使用演示记录"}</small>
        </div>
      </section>
    );
  }

  const projectsReady = governance.data?.github.projects.status === "connected";
  const projects = projectsReady ? governance.data!.github.projects.items : [];
  const activeProject = projects.find((project) => !project.closed) ?? projects[0] ?? null;
  const failedBuilds = snapshot.repositories.filter((repo) =>
    repo.latestWorkflow?.status === "completed" &&
    ["failure", "timed_out", "startup_failure"].includes(repo.latestWorkflow.conclusion ?? ""),
  ).length;
  const buildsWithRuns = snapshot.repositories.filter((repo) => Boolean(repo.latestWorkflow)).length;
  const passingBuilds = snapshot.repositories.filter((repo) =>
    repo.latestWorkflow?.status === "completed" && repo.latestWorkflow.conclusion === "success",
  ).length;
  const onlineServices = snapshot.services.filter((service) => service.status === "online").length;
  const failedOperations = attention.filter((row) => row.category !== "policy").length;
  const policyReviews = attention.filter((row) => row.category === "policy").length;
  const shownAttention = showAllAttention ? attention : attention.slice(0, 3);
  const activeWorkers = feed?.items.filter(workerIsActive) ?? [];
  const shownWorkers = activeWorkers.length ? activeWorkers.slice(0, 3) : feed?.items.slice(0, 2) ?? [];
  const sourcePartial =
    snapshot.status !== "connected" ||
    snapshot.sources.github !== "connected" ||
    snapshot.sources.cloudflare !== "connected" ||
    Boolean(summary.error) ||
    Boolean(governance.error) ||
    Boolean(workers.error) ||
    governance.data?.status === "degraded" ||
    (feed !== null && feed.status !== "connected") ||
    (!feed && Boolean(workers.data));
  const sourceUnknown = !governance.data || !feed;
  const briefTone = failedOperations ? "attention" : sourcePartial || sourceUnknown ? "uncertain" : "quiet";
  const currentLine = failedOperations
    ? failedOperations + " 项需要关注"
    : sourcePartial || sourceUnknown
      ? "已有快照，仍有观测缺口"
      : "当前快照未见运行异常";
  const briefDescription = failedOperations
    ? "按服务探针与已读治理记录统计。仓库最近 Run 保留为工程档案，不等于当前必要 Gate 或生产事故。"
    : "这表示当前已覆盖的数据范围没有检出异常，不代表所有业务链路均完成验收。";
  const workCoverage = feed
    ? "近 " + feed.historyDays + " 天 · 最近 " + feed.items.length + " 条已发现 Run" +
      (feed.status === "partial" ? " · 部分仓库不可读" : "")
    : "尚未取得真实 Worker 记录";
  const warningTexts = [
    summary.error ? "组织快照刷新失败，当前为上次成功记录" : null,
    governance.error ? "组织治理数据刷新失败" : null,
    workers.error ? "Worker 发现失败，当前为上次成功记录或未知" : null,
    governance.data?.status === "degraded" ? "组织治理来源部分可用" : null,
    feed?.status === "partial" ? "Worker 记录覆盖范围不完整" : null,
  ].filter(Boolean);

  return (
    <div className="control-home">
      <section className={"home-brief " + briefTone} aria-label="今日厂务简报">
        <div className="home-topline">
          <span>01 / SHIFT BRIEFING</span>
          <span>采集 {formatTime(snapshot.generatedAt)}</span>
        </div>
        <div className="home-brief-body">
          <div className="home-brief-caption">
            <span className="home-brief-signal" aria-hidden="true" />
            {briefTone === "attention" ? "ATTENTION / 已有异常证据" :
              briefTone === "uncertain" ? "PARTIAL / 观测未完整" : "OBSERVED / 当前快照"}
          </div>
          <h2>{currentLine}</h2>
          <p>{briefDescription}</p>
        </div>
        <div className="home-sources" aria-label="厂务数据来源">
          <span><GitBranch size={13} /> GitHub {snapshot.sources.github}</span>
          <span><Cloud size={13} /> Cloudflare {cloudflareLabel(snapshot.sources.cloudflare)}</span>
          <span><Radio size={13} /> HTTP 探针 {snapshot.services.length} 项</span>
          <span><Clapperboard size={13} /> Worker {feed?.status ?? "未就绪"}</span>
        </div>
      </section>

      {warningTexts.length > 0 && (
        <div className="home-observation-note" role="status">
          <ShieldAlert size={15} aria-hidden="true"/>
          <div>{warningTexts.map((line, i) => <p key={i}>{line}</p>)}</div>
        </div>
      )}

      <div className="home-primary-grid">
        <section className="home-panel home-attention" aria-labelledby="home-attention-title">
          <div className="home-section-title">
            <div><small>02 / EXCEPTION DESK</small><h2 id="home-attention-title">需要关注</h2></div>
            <strong>{failedOperations} 异常 · {policyReviews} 待核查</strong>
          </div>
          {attention.length === 0 ? (
            <div className="home-empty">
              <CheckCircle2 size={20} aria-hidden="true" />
              <div>
                <strong>{governance.data && !sourcePartial ? "当前快照未发现已知异常" : "已读取范围内暂无异常记录"}</strong>
                <p>{!governance.data ? "治理信息尚未就绪，不能推断全部合规。" :
                  "只反映最新构建、服务探针和已读治理记录；不是系统健康认证。"}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="home-fact-list">
                {shownAttention.map((entry) => (
                  <a className={"home-fact-row " + entry.severity} key={entry.key}
                    href={entry.href} target="_blank" rel="noreferrer">
                    <span className="home-fact-flag" aria-hidden="true" />
                    <div className="home-fact-main">
                      <span className="home-fact-category">
                        {entry.category === "service" ? "服务探针" : entry.category === "build" ? "默认分支构建" : "规则待核查"}
                        {entry.observedAt && <time> · {formatTime(entry.observedAt)}</time>}
                      </span>
                      <strong>{entry.name}</strong>
                      <p>{entry.explanation}</p>
                    </div>
                    <ExternalLink size={14} aria-label="原始证据" />
                  </a>
                ))}
              </div>
              {attention.length > 3 && (
                <button type="button" className="home-action"
                  aria-expanded={showAllAttention} onClick={() => setShowAllAttention(!showAllAttention)}>
                  {showAllAttention ? "收起记录" : "查看全部 " + attention.length + " 项"} <ArrowRight size={14}/>
                </button>
              )}
            </>
          )}
          <div className="home-panel-foot">
            <Link to="/engineering">工程记录 <ArrowRight size={12}/></Link>
            <Link to="/runtime">服务工况 <ArrowRight size={12}/></Link>
            <Link to="/governance">治理记录 <ArrowRight size={12}/></Link>
          </div>
        </section>

        <section className="home-panel home-work" aria-labelledby="home-work-title">
          <div className="home-section-title">
            <div><small>03 / PRODUCTION FLOOR</small><h2 id="home-work-title">正在进行</h2></div>
            <strong>{feed ? activeWorkers.length + " 条执行中 Run" : "等待来源"}</strong>
          </div>
          <div className="home-work-subline">{workCoverage} · 仅 GitHub Actions 状态</div>
          {workers.error && !feed && <div className="home-inline-warning">无法读取 Worker Run，不能推断车间空闲。</div>}
          {feed && !activeWorkers.length && (
            <div className="home-work-quiet">
              <span>当前所见记录里没有执行中的 External Worker Run。</span>
              <small>以下展示最近记录，GitHub Run 结论不等于 Candidate 验证或产品交付。</small>
            </div>
          )}
          {shownWorkers.map((run) => (
            <a key={run.repository + "/" + run.id} className="home-work-row"
              href={run.htmlUrl} target="_blank" rel="noreferrer">
              <span className={"home-worker-symbol " + (workerIsActive(run) ? "active" : "closed")}>
                <Activity size={15} aria-hidden="true"/>
              </span>
              <div>
                <strong>{run.repository.split("/").at(-1)}</strong>
                <small>Run #{run.id} · {formatTime(run.updatedAt)} · {workerRunLabel(run)}</small>
              </div>
              <ExternalLink size={14} aria-label="GitHub Run 原始证据"/>
            </a>
          ))}
          {!feed && !workers.error && <div className="home-inline-warning">正在查找真实 Worker Run…</div>}
          <Link to="/factory" className="home-factory-entrance">
            <span><Clapperboard size={19} /> 进入原版血汗工厂 TV</span>
            <ArrowRight size={17} />
          </Link>
          {ongoingBuilds.length > 0 && (
            <div className="home-build-activity">
              <strong>另外有 {ongoingBuilds.length} 个仓库的最近默认分支构建仍未完成</strong>
              {ongoingBuilds.slice(0, 2).map((repo) =>
                <a key={repo.fullName} href={repo.latestWorkflow?.htmlUrl ?? repo.htmlUrl} target="_blank" rel="noreferrer">
                  <span>{repo.name}</span>
                  <small>{repo.latestWorkflow?.status} <ArrowRight size={12}/></small>
                </a>
              )}
              {ongoingBuilds.length > 2 && <Link to="/engineering">其余请查看工程车间</Link>}
            </div>
          )}
        </section>
      </div>

      <section className="home-stat-section" aria-labelledby="home-stat-title">
        <div className="home-section-title">
          <div><small>04 / MACHINE & CODE</small><h2 id="home-stat-title">系统工况</h2></div>
          <span className="home-subtle">各项统计各有口径</span>
        </div>
        <div className="home-facts-grid">
          <Link to="/engineering" className="home-stat">
            <span>公开仓库</span>
            <strong>{snapshot.repositories.length}</strong>
            <small>{snapshot.repositories.filter((repo) => !repo.archived).length} 个非归档仓库</small>
          </Link>
          <Link to="/engineering" className="home-stat">
            <span>最近 Run 成功</span>
            <strong>{passingBuilds}<i>/ {buildsWithRuns || "—"}</i></strong>
            <small>{failedBuilds} 个最近 Run 失败记录 · 非必要 Gate/生产状态</small>
          </Link>
          <Link to="/runtime" className="home-stat">
            <span>服务探针在线</span>
            <strong>{onlineServices}<i>/ {snapshot.services.length || "—"}</i></strong>
            <small>HTTP 响应 · 不等于完整业务可用</small>
          </Link>
          <Link to="/runtime" className="home-stat">
            <span>Cloudflare 资源</span>
            <strong>{snapshot.sources.cloudflare === "unconfigured" ? "—" :
              snapshot.cloudflare.workers.length + snapshot.cloudflare.pages.length}</strong>
            <small>{snapshot.cloudflare.workers.length} Workers / {snapshot.cloudflare.pages.length} Pages
              {snapshot.sources.cloudflare === "degraded" ? " · 部分覆盖" : ""}</small>
          </Link>
        </div>
      </section>

      <section className="home-projects" aria-labelledby="home-projects-title">
        <div className="home-section-title">
          <div><small>05 / PROJECT REGISTER</small><h2 id="home-projects-title">组织项目</h2></div>
          <Link to="/governance">前往监察委员会 <ArrowRight size={13}/></Link>
        </div>
        {activeProject ? (
          <a href={activeProject.url} target="_blank" rel="noreferrer" className="home-project-row">
            <span className="home-project-state">{activeProject.closed ? "已关闭" : "活跃 Project"}</span>
            <strong>{activeProject.title}</strong>
            <span>{activeProject.itemCount} 项 · 更新 {formatTime(activeProject.updatedAt)}</span>
            <ArrowRight size={17}/>
          </a>
        ) : (
          <div className="home-project-missing">
            {projectsReady ? "当前公开数据源未提供可展示的组织 Project。" :
              governance.data ? "公开 Projects 不可读取；不视为没有项目。" : "正在读取公开组织 Projects…"}
          </div>
        )}
      </section>

      <aside className="home-editorial" aria-label="厂务公报，非运行事实">
        <div><span>06 / EDITORIAL BULLETIN</span><strong>厂务公报</strong></div>
        <p>本厂反对一切无意义加班。<br/>尤其反对 CI 全绿之后宣布天下太平。</p>
        <small>反讽文案 · 与数据状态、事件严重性和验收结论无关</small>
      </aside>

      <p className="home-provenance">
        <ShieldAlert size={13} aria-hidden="true" />
        当前页面仅使用公共只读快照：组织数据约 60 秒刷新、治理约 5 分钟、Worker Run 约 60 秒。
        Worker 记录最多显示近期 12 条，不代表全组织施工总量；页面不会自动查询昂贵的 Workers Logs。
        {sourcePartial && " 部分来源不可用或快照刷新失败，请结合原始证据判断。"}
      </p>
    </div>
  );
}
