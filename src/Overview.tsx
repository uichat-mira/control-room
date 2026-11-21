import { useMemo } from "react";
import { Link } from "react-router";
import { TuiSpinner } from "./TuiLoading";
import {
  Activity, ArrowUpRight, BookOpen, Clapperboard,
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
  title: string;
  status: string;
  tone?: "ordinary" | "priority";
};

function EntranceTile({
  to, icon: Icon, title, status, tone = "ordinary",
}: EntranceTileProps) {
  return (
    <Link to={to} className={"dashboard-entrance " + tone}>
      <div className="dashboard-entrance-top">
        <span className="dashboard-entrance-icon"><Icon size={22} strokeWidth={1.7} aria-hidden="true" /></span>
        <ArrowUpRight size={17} className="dashboard-entrance-arrow" aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <div className="dashboard-entrance-meta">{status}</div>
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

  return (
    <div className="control-dashboard">
      <div className="dashboard-readonly" role="status">
        {initialCollectionPending ? <TuiSpinner /> : <span className="dashboard-live-dot" aria-hidden="true" />}
        {refreshFailed ? "部分来源不可用" :
          initialCollectionPending ? "采集中" :
            lastObserved ? "采集 " + formatTime(lastObserved) : "采集时间未知"}
      </div>

      <nav className="dashboard-signals" aria-label="厂务状态速览">
        <Link to="/attention" className={signals.confirmedAttention && signals.confirmedAttention > 0
          ? "dashboard-signal important" : "dashboard-signal"}>
          <span className="dashboard-signal-name">人工接手</span>
          <strong>{signals.confirmedAttention ?? "—"}</strong>
        </Link>
        <Link to="/factory" className="dashboard-signal">
          <span className="dashboard-signal-name">牛马在途</span>
          <strong>{signals.activeWorkers ?? "—"}</strong>
        </Link>
        <Link to="/runtime" className="dashboard-signal">
          <span className="dashboard-signal-name">HTTP 探针</span>
          <strong>{signals.onlineProbes ?? "—"}<em> / {signals.probeTotal ?? "—"}</em></strong>
        </Link>
        <Link to="/attention" className="dashboard-signal">
          <span className="dashboard-signal-name">数据覆盖</span>
          <strong className="dashboard-signal-word">{signals.coverage}</strong>
        </Link>
      </nav>

      <section className="dashboard-section" aria-labelledby="dashboard-departments">
        <div className="dashboard-section-head">
          <div><h2 id="dashboard-departments">业务部门</h2></div>
        </div>
        <div className="dashboard-entrances dashboard-departments">
          <EntranceTile
            to="/engineering" icon={Wrench} title="工程车间"
            status={repos === null ? "仓库未知" : repos + " 个仓库"}
          />
          <EntranceTile
            to="/runtime" icon={Radio} title="设备科"
            status={cloudResources === null ? "资源未知" : cloudResources + " 个云资源"}
          />
          <EntranceTile
            to="/governance" icon={ShieldCheck} title="监察委员会"
            status={facts ? desk.unreviewedPulls + " 个试点 PR 待核验" : "PR 未知"}
          />
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-consoles">
        <div className="dashboard-section-head">
          <div><h2 id="dashboard-consoles">专用控制台</h2></div>
        </div>
        <div className="dashboard-entrances dashboard-consoles">
          <EntranceTile
            to="/attention" icon={Activity} title="关注与证据"
            status={signals.confirmedAttention === null ? "资格未知" : signals.confirmedAttention + " 项已证实"}
            tone={signals.confirmedAttention !== null && signals.confirmedAttention > 0
              ? "priority" : "ordinary"}
          />
          <EntranceTile
            to="/factory" icon={Clapperboard} title="血汗工厂 TV"
            status={signals.activeWorkers === null ? "运行未知" : signals.activeWorkers + " 条活动 Run（有界）"}
          />
          <EntranceTile
            to="/wall" icon={Monitor} title="System Wall"
            status={snapshot && !summary.error ? "快照 " + formatTime(snapshot.generatedAt) : "快照未知"}
          />
        </div>
      </section>

      {(signals.activeRunSamples.length > 0 || observedBuilds.length > 0) && (
      <section className="dashboard-activity" aria-label="近期动态">
        <div className="dashboard-section-head">
          <div><h2>当前动向</h2></div>
        </div>
        {signals.activeRunSamples.length > 0 ? (
          <div className="dashboard-activity-list">
            {signals.activeRunSamples.map(run => (
              <Link key={run.repository + "/" + run.id} to="/factory" className="dashboard-activity-item">
                <span className="dashboard-activity-mark" aria-hidden="true" />
                <div><strong>{run.repository.replace("uichat-mira/", "")} · Run #{run.id}</strong>
                  <small>{workerRunLabel(run)} · {formatTime(run.updatedAt)}</small></div>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : observedBuilds.length > 0 ? (
          <div className="dashboard-activity-list">
            {observedBuilds.map(repo => (
              <Link key={repo.fullName} to="/engineering" className="dashboard-activity-item">
                <span className="dashboard-activity-mark" aria-hidden="true" />
                <div><strong>{repo.name} · CI 运行中</strong></div>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      )}

      <div className="dashboard-utility">
        <div><Link to="/docs"><BookOpen size={14} /> API / MCP Docs <ArrowUpRight size={13}/></Link>
          <a href="https://github.com/uichat-mira" target="_blank" rel="noreferrer">
            GitHub 组织 <ExternalLink size={13} /></a></div>
      </div>
    </div>
  );
}
