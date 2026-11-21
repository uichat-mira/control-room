import { useMemo } from "react";
import { Link } from "react-router";
import { TuiSpinner } from "./TuiLoading";
import {
  Activity, ArrowRight, ArrowUpRight, BookOpen, Clapperboard,
  ExternalLink, Monitor, Radio, ShieldCheck, Wrench,
  type LucideIcon,
} from "lucide-react";
import { projectAttentionDesk, isGateSnapshot, isGitHubFactsSnapshot } from "./attention-center";
import { dashboardSignals } from "./dashboard-model";
import type { FactoryFeed } from "./factory-feed";
import type { GitHubGateQualificationSnapshot } from "./github-gate-facts";
import type { GitHubFactsSnapshot } from "./github-facts";
import { isFactoryFeed, workerRunLabel } from "./overview-facts";
import { formatTime, type SummaryPayload, usePolling } from "./data";
import "./control-dashboard.css";

type EntranceTileProps = {
  to: string;
  icon: LucideIcon;
  code: string;
  title: string;
  description: string;
  meta: string;
  tone?: "ordinary" | "priority";
};

function EntranceTile({
  to, icon: Icon, code, title, description, meta, tone = "ordinary",
}: EntranceTileProps) {
  return (
    <Link to={to} className={"dashboard-entrance " + tone}>
      <div className="dashboard-entrance-top">
        <span className="dashboard-entrance-icon"><Icon size={22} strokeWidth={1.7} aria-hidden="true" /></span>
        <span className="dashboard-entrance-code">{code}</span>
        <ArrowUpRight size={17} className="dashboard-entrance-arrow" aria-hidden="true" />
      </div>
      <div className="dashboard-entrance-text">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="dashboard-entrance-meta">{meta}</div>
    </Link>
  );
}

/**
 * The entrance dashboard deliberately does NOT render PR, Worker or coverage
 * records in full. Their evidence workflows live at /attention and the owner
 * departments. This surface only displays source-qualified summary signals.
 */
export default function Overview() {
  const summary = usePolling<SummaryPayload>("/api/v1/summary", 60_000);
  const workers = usePolling<FactoryFeed>("/api/v1/factory/runs", 60_000);
  const gatesRead = usePolling<GitHubGateQualificationSnapshot>("/api/v1/github/gates", 60_000);
  const factsRead = usePolling<GitHubFactsSnapshot>("/api/v1/github/facts", 60_000);

  const snapshot = summary.data;
  const feed = isFactoryFeed(workers.data) ? workers.data : null;
  const gates = isGateSnapshot(gatesRead.data) ? gatesRead.data : null;
  const facts = isGitHubFactsSnapshot(factsRead.data) ? factsRead.data : null;
  const desk = useMemo(() => projectAttentionDesk({
    gates, facts,
    gatesCurrent: !gatesRead.error && !factsRead.error && !!facts,
  }), [gates, facts, gatesRead.error, factsRead.error]);
  const signals = dashboardSignals({
    summary: snapshot,
    feed,
    desk,
    gatesReady: !!gates && !!facts,
    summaryFailed: !!summary.error,
    workersFailed: !!workers.error,
    gatesFailed: !!gatesRead.error,
    factsFailed: !!factsRead.error,
  });
  const observedBuilds = snapshot && !summary.error
    ? snapshot.repositories.filter(repo =>
      repo.latestWorkflow && repo.latestWorkflow.status !== "completed").slice(0, 2)
    : [];
  const repos = snapshot && !summary.error ? snapshot.repositories.length : null;
  const cloudflareReady = snapshot && !summary.error &&
    snapshot.sources.cloudflare === "connected";
  const cloudResources = cloudflareReady
    ? snapshot.cloudflare.workers.length + snapshot.cloudflare.pages.length : null;
  const lastObserved = gates?.factsGeneratedAt ?? snapshot?.generatedAt ?? null;
  const initialCollectionPending =
    (!summary.data && !summary.error) ||
    (!workers.data && !workers.error) ||
    (!gatesRead.data && !gatesRead.error) ||
    (!factsRead.data && !factsRead.error);
  const refreshFailed = !!(summary.error || workers.error || gatesRead.error || factsRead.error);
  const activeNote = signals.activeWorkers === null
    ? "Worker 状态待核实"
    : signals.activeWorkers === 0 ? "本次有界发现没有执行中的 Run" : "本次有界发现有正在执行的 Run";
  const attentionNote = signals.confirmedAttention === null
    ? "资格来源不可用，需重新核实"
    : signals.confirmedAttention > 0 ? "已有证实需要人工处理的事项" : "目前没有已证实的人工事项，不代表全部正常";
  const probesNote = signals.onlineProbes === null
    ? "探针数据不可用"
    : "HTTP 探针响应，非完整业务健康证明";

  return (
    <div className="control-dashboard">
      <header className="dashboard-intro">
        <div>
          <span className="dashboard-kicker">CENTRAL OFFICE / CONTROL PANEL</span>
          <h2>从这里进入</h2>
          <p>一个入口，一项职责。状态只做提示，详情交给各部门与专用控制台。</p>
        </div>
        <span className="dashboard-readonly" role="status">
          {initialCollectionPending ? <TuiSpinner /> : <span className="dashboard-live-dot" aria-hidden="true" />}
          公开只读 · {refreshFailed ? "部分来源刷新失败" :
            initialCollectionPending ? "正在核对只读快照" :
              lastObserved ? "采集 " + formatTime(lastObserved) : "来源未提供观察时间"}
        </span>
      </header>

      <nav className="dashboard-signals" aria-label="厂务状态速览">
        <Link to="/attention" className={signals.confirmedAttention && signals.confirmedAttention > 0
          ? "dashboard-signal important" : "dashboard-signal"}>
          <span className="dashboard-signal-name">人工接手</span>
          <strong>{signals.confirmedAttention ?? "—"}</strong>
          <span>已证实的试点事项 <ArrowRight size={12} aria-hidden="true" /></span>
        </Link>
        <Link to="/factory" className="dashboard-signal">
          <span className="dashboard-signal-name">牛马在途</span>
          <strong>{signals.activeWorkers ?? "—"}</strong>
          <span>有界 Run 发现 <ArrowRight size={12} aria-hidden="true" /></span>
        </Link>
        <Link to="/runtime" className="dashboard-signal">
          <span className="dashboard-signal-name">HTTP 探针</span>
          <strong>{signals.onlineProbes ?? "—"}<em> / {signals.probeTotal ?? "—"}</em></strong>
          <span>响应数 / 总数 <ArrowRight size={12} aria-hidden="true" /></span>
        </Link>
        <Link to="/attention" className="dashboard-signal">
          <span className="dashboard-signal-name">数据覆盖</span>
          <strong className="dashboard-signal-word">{signals.coverage}</strong>
          <span>试点观察 · 非全组织 <ArrowRight size={12} aria-hidden="true" /></span>
        </Link>
      </nav>

      <section className="dashboard-section" aria-labelledby="dashboard-departments">
        <div className="dashboard-section-head">
          <div><span>DEPARTMENTS</span><h2 id="dashboard-departments">业务部门</h2></div>
          <p>去该办事的地方办事</p>
        </div>
        <div className="dashboard-entrances dashboard-departments">
          <EntranceTile
            to="/engineering" icon={Wrench} code="01 / BUILD" title="工程车间"
            description="仓库、构建、交付与部署"
            meta={repos === null ? "仓库数据待读取" : repos + " 个公开仓库 · 详情与 Run 在工程页"}
          />
          <EntranceTile
            to="/runtime" icon={Radio} code="02 / RUNTIME" title="设备科"
            description="服务探针、边缘资源与流量"
            meta={cloudResources === null ? probesNote :
              cloudResources + " 个 Cloudflare 资源 · " + probesNote}
          />
          <EntranceTile
            to="/governance" icon={ShieldCheck} code="03 / GOVERNANCE" title="监察委员会"
            description="PR、Issue、分支规则与项目"
            meta={facts ? desk.unreviewedPulls + " 个试点非 Draft PR · 尚须逐项核验" :
              "PR 试点目录待读取 · 不推断无阻塞"}
          />
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-consoles">
        <div className="dashboard-section-head">
          <div><span>SPECIAL CONSOLES</span><h2 id="dashboard-consoles">专用控制台</h2></div>
          <p>一键进入独立工作现场</p>
        </div>
        <div className="dashboard-entrances dashboard-consoles">
          <EntranceTile
            to="/attention" icon={Activity} code="04 / ACTION DESK" title="关注与证据"
            description="人工阻塞、资格未知和单项核验"
            meta={attentionNote}
            tone={signals.confirmedAttention !== null && signals.confirmedAttention > 0
              ? "priority" : "ordinary"}
          />
          <EntranceTile
            to="/factory" icon={Clapperboard} code="05 / FACTORY TV" title="血汗工厂 TV"
            description="Worker 生命周期与真实 Run 现场"
            meta={activeNote}
          />
          <EntranceTile
            to="/wall" icon={Monitor} code="06 / SYSTEM WALL" title="System Wall"
            description="系统全景与集中展示大屏"
            meta={snapshot && !summary.error ? "最近快照 " + formatTime(snapshot.generatedAt) : "系统快照待读取"}
          />
        </div>
      </section>

      <section className="dashboard-activity" aria-label="近期动态">
        <div className="dashboard-section-head">
          <div><span>SHIFT ACTIVITY</span><h2>当前动向</h2></div>
          <p>最多两条 · 不是告警总数</p>
        </div>
        {signals.activeRunSamples.length > 0 ? (
          <div className="dashboard-activity-list">
            {signals.activeRunSamples.map(run => (
              <Link key={run.repository + "/" + run.id} to="/factory" className="dashboard-activity-item">
                <span className="dashboard-activity-mark" aria-hidden="true" />
                <div><strong>{run.repository.replace("uichat-mira/", "")} · Run #{run.id}</strong>
                  <small>{workerRunLabel(run)} · {formatTime(run.updatedAt)} · {signals.workersCaveat}</small></div>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : observedBuilds.length > 0 ? (
          <div className="dashboard-activity-list">
            {observedBuilds.map(repo => (
              <Link key={repo.fullName} to="/engineering" className="dashboard-activity-item">
                <span className="dashboard-activity-mark" aria-hidden="true" />
                <div><strong>{repo.name} · 最近默认分支 Run 尚未结束</strong>
                  <small>仅表示 GitHub 工作流运行状态，不代表功能验收或人工接手</small></div>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="dashboard-activity-empty">
            <span className="dashboard-activity-mark" aria-hidden="true" />
            <p>{activeNote}。历史记录在 <Link to="/factory">血汗工厂</Link>，观测缺口在
              <Link to="/attention">关注与证据</Link>。</p>
          </div>
        )}
      </section>

      <div className="dashboard-utility">
        <span>本页只给入口和有界状态；待办资格、PR 详情与 Reporter 不在首页逐条扫描。</span>
        <div><Link to="/docs"><BookOpen size={14} /> API / MCP Docs <ArrowUpRight size={13}/></Link>
          <a href="https://github.com/uichat-mira" target="_blank" rel="noreferrer">
            GitHub 组织 <ExternalLink size={13} /></a></div>
      </div>
    </div>
  );
}
