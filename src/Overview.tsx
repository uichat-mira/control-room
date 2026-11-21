import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { TuiLoading } from "./TuiLoading";
import {
  Activity, ArrowRight, CheckCircle2, Clock3,
  Clapperboard, Cloud, ExternalLink, GitBranch, Radio, ShieldAlert, Eye, RefreshCw,
} from "lucide-react";
import type { FactoryFeed } from "./factory-feed";
import { isFactoryFeed, workerIsActive, workerRunLabel } from "./overview-facts";
import type { FactoryFeedItem } from "./factory-feed";
import type { GitHubGateQualificationSnapshot } from "./github-gate-facts";
import type { GitHubFactsSnapshot } from "./github-facts";
import type { PullRequestQualification } from "./github-pr-qualification";
import type { WorkerAttentionCandidate } from "./factory-attention";
import {
  isGateSnapshot, isGitHubFactsSnapshot, isPullQualification,
  isWorkerQualification, listedNonDraftPulls, projectAttentionDesk,
  type AttentionRecord,
} from "./attention-center";
import {
  cloudflareLabel, formatTime, type GovernancePayload,
  type SummaryPayload, usePolling,
} from "./data";
import "./control-overview.css";

type Selection =
  | { kind: "pr"; repository: string; number: number; headSha: string }
  | { kind: "worker"; repository: string; runId: number; attempt: number };

type Inspection = {
  key: string;
  loading: boolean;
  checkedAt: number;
  error: string | null;
  data: PullRequestQualification | WorkerAttentionCandidate | null;
};

function selectionKey(value: Selection) {
  return value.kind === "pr"
    ? "pr:" + value.repository + ":" + value.number
    : "worker:" + value.repository + ":" + value.runId + ":" + value.attempt;
}

function sourceLabel(value: AttentionRecord) {
  return value.source === "pull_request" ? "PR / 合并阻塞" :
    value.source === "worker" ? "WORKER / 人工接手" :
      value.category === "deployment" ? "RELEASE / 发布链路" : "GATE / CI 资格";
}

function statusLabel(value: AttentionRecord) {
  if (value.classification === "attention") return "已证实需要人处理";
  if (value.classification === "in_progress") return "系统正在推进";
  if (value.classification === "unknown") return "证据不足";
  return "历史 / 观察";
}

function AttentionCard({ item, compact = false }: { item: AttentionRecord; compact?: boolean }) {
  const evidence = item.evidence.filter(entry => entry.url);
  return (
    <article className={"home-decision " + item.classification + (compact ? " compact" : "")}>
      <div className="home-decision-head">
        <span>{sourceLabel(item)}</span>
        <small>{statusLabel(item)}{item.priority ? " · " + item.priority : ""}</small>
      </div>
      <h3>{item.subject}</h3>
      {compact ? (
        <p>{item.classification === "unknown" ? "当前资料无法确认这是需要人工接手的阻塞。" : item.what}</p>
      ) : (
        <div className="home-decision-details">
          <p><b>发生了什么</b>{item.what}</p>
          <p><b>为什么现在</b>{item.whyNow}</p>
          <p><b>系统已处理</b>{item.whatSystemTried}</p>
          <p><b>下一步</b>{item.nextStep}</p>
          <p><b>解除条件</b>{item.exitCondition}</p>
        </div>
      )}
      <div className="home-decision-foot">
        <span><Clock3 size={12} aria-hidden="true"/> {item.observedAt ? "观察 " + formatTime(item.observedAt) : "观察时间未知"}</span>
        <span>{item.coverage}</span>
        {item.relatedCandidates > 1 && <span>已合并 {item.relatedCandidates} 条相关证据</span>}
      </div>
      {evidence.length > 0 ? (
        <div className="home-decision-links">
          {evidence.slice(0, compact ? 1 : 3).map((source, index) => (
            <a key={source.url + ":" + index} href={source.url!} target="_blank" rel="noreferrer">
              {compact ? "查看 GitHub 证据" : source.label} <ExternalLink size={12} aria-hidden="true"/>
            </a>
          ))}
        </div>
      ) : (
        <div className="home-decision-no-evidence">暂无可核验的 GitHub 原始链接 · 不能视为已证实待办</div>
      )}
      {compact && <details className="home-decision-raw"><summary>查看来源判定</summary><p>{item.what}</p><p>{item.whyNow}</p><p>{item.nextStep}</p></details>}
    </article>
  );
}

export default function Overview() {
  const summary = usePolling<SummaryPayload>("/api/v1/summary", 60_000);
  const governance = usePolling<GovernancePayload>("/api/v1/governance", 5 * 60_000);
  const workers = usePolling<FactoryFeed>("/api/v1/factory/runs", 60_000);
  // The two new routes reuse OPS-034's hour-cached GitHub snapshot and
  // OPS-035's pure qualification. These polls add no upstream GitHub fan-out.
  const gatesRead = usePolling<GitHubGateQualificationSnapshot>("/api/v1/github/gates", 60_000);
  const factsRead = usePolling<GitHubFactsSnapshot>("/api/v1/github/facts", 60_000);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [showAllUnknown, setShowAllUnknown] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selection) return;
    const key = selectionKey(selection);
    let active = true;
    const verify = async () => {
      setInspection({ key, loading: true, checkedAt: 0, error: null, data: null });
      try {
        const uri = selection.kind === "pr"
          ? "/api/v1/github/pull?repository=" + encodeURIComponent(selection.repository) + "&number=" + selection.number
          : "/api/v1/factory/attention?repository=" + encodeURIComponent(selection.repository) +
            "&runId=" + selection.runId + "&includeReporter=true";
        const response = await fetch(uri, { cache: "no-store" });
        if (!response.ok) throw new Error("资格来源 HTTP " + response.status);
        const data: unknown = await response.json();
        if (selection.kind === "pr" ? !isPullQualification(data) : !isWorkerQualification(data)) {
          throw new Error("资格来源返回了无法验证的结构");
        }
        if (!active) return;
        const result = data as PullRequestQualification | WorkerAttentionCandidate;
        if (selection.kind === "pr" &&
            (result.source !== "github-pr-derivation" ||
              result.repository !== selection.repository || result.number !== selection.number)) {
          throw new Error("PR 身份与请求不一致");
        }
        if (selection.kind === "worker" &&
            (result.source !== "factory-attention-derivation" ||
              result.identity.repository !== selection.repository ||
              result.identity.runId !== selection.runId ||
              result.identity.attempt !== selection.attempt)) {
          throw new Error("Worker Run 身份与请求不一致");
        }
        setInspection({ key, loading: false, checkedAt: Date.now(), error: null, data: result });
      } catch (reason) {
        if (!active) return;
        setInspection({
          key, loading: false, checkedAt: Date.now(), data: null,
          error: reason instanceof Error ? reason.message : "资格来源不可读",
        });
      }
    };
    void verify();
    // After explicit PR selection, recheck that ONE PR on a bounded interval.
    // Trusted Worker Reporter is only queried by a deliberate click, never by a timer.
    const timer = selection.kind === "pr" ? window.setInterval(() => void verify(), 10 * 60_000) : null;
    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [selection]);

  const snapshot = summary.data;
  const feed = isFactoryFeed(workers.data) ? workers.data : null;
  const gates = isGateSnapshot(gatesRead.data) ? gatesRead.data : null;
  const facts = isGitHubFactsSnapshot(factsRead.data) ? factsRead.data : null;
  const selectedFresh = selection && inspection?.key === selectionKey(selection) &&
    !inspection.loading && !inspection.error &&
    clock - inspection.checkedAt < (selection.kind === "pr" ? 10 * 60_000 : 90_000);
  const verified = selectedFresh ? inspection?.data ?? null : null;
  const prQualified = verified?.source === "github-pr-derivation" ? verified : null;
  const workerQualified = verified?.source === "factory-attention-derivation" ? verified : null;
  const desk = useMemo(() => projectAttentionDesk({
    gates, facts, pr: prQualified, worker: workerQualified,
    gatesCurrent: !gatesRead.error && !factsRead.error && !!facts,
  }), [gates, facts, prQualified, workerQualified, gatesRead.error, factsRead.error]);
  const nonDraftPulls = useMemo(() => listedNonDraftPulls(facts).slice(0, 5), [facts]);
  const ongoingBuilds = useMemo(
    () => (snapshot?.repositories ?? []).filter(repo =>
      repo.latestWorkflow && repo.latestWorkflow.status !== "completed"),
    [snapshot],
  );
  if (!snapshot) {
    return (
      <section className="page-state control-home-loading">
        {summary.error ? (
          <div role="status">
            <strong>厂务室暂时读不到快照</strong>
            <small>{summary.error}</small>
          </div>
        ) : (
          <TuiLoading
            title="正在核对真实厂务记录"
            detail="GitHub / Cloudflare / Runtime · 不使用演示记录"
            command="MIRA / VERIFY FACTS"
          />
        )}
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
  const onlineServices = snapshot.services.filter(service => service.status === "online").length;
  const serviceIssues = snapshot.services.filter(service => service.status !== "online");
  const activeWorkers = feed?.items.filter(workerIsActive) ?? [];
  const shownWorkers = activeWorkers.length ? activeWorkers.slice(0, 3) : feed?.items.slice(0, 2) ?? [];
  const sourcePartial = snapshot.status !== "connected" || snapshot.sources.github !== "connected" ||
    snapshot.sources.cloudflare !== "connected" || !!summary.error || !!governance.error ||
    !!workers.error || !!gatesRead.error || !!factsRead.error ||
    governance.data?.status === "degraded" || feed?.status === "partial" ||
    !!feed?.coverageLimited || !feed || !gates || !facts ||
    desk.gateCoverage !== "complete" || desk.factsCoverage !== "complete";
  const briefTone = desk.attention.length ? "attention" : sourcePartial ? "uncertain" : "quiet";
  const currentLine = desk.attention.length
    ? "已证实 " + desk.attention.length + " 项需要接手"
    : "当前可确认待接手 0 项";
  const briefDescription = desk.attention.length
    ? "只计算有当前目标、人工动作和可追溯 GitHub 证据的事项。"
    : "这不是“全部正常”：未核实的 PR、Worker 和试点外仓库不计入，也不当成零风险。";
  const workCoverage = feed
    ? "近 " + feed.historyDays + " 天 · 已发现 " + feed.items.length +
      " 条近期 Run · " + (feed.coverageLimited || feed.status === "partial" ? "部分覆盖" : "有界样本")
    : "尚未取得真实 Worker 记录";
  const warningTexts = [
    ...desk.disclosure,
    summary.error ? "组织快照刷新失败 · 可能使用上次成功的状态" : null,
    governance.error ? "组织治理数据刷新失败" : null,
    workers.error ? "Worker 发现失败，无法证明没有在途任务" : null,
    gatesRead.error ? "Gate 资格读取失败，已有快照可能过期" : null,
    factsRead.error ? "GitHub PR 列表读取失败，已有快照可能过期" : null,
    feed?.coverageLimited ? "Factory Feed 有界截断，不能代表全部 Worker" : null,
    snapshot.sources.cloudflare !== "connected" ? "Cloudflare 来源状态：" + snapshot.sources.cloudflare : null,
  ].filter((line): line is string => !!line);
  const unknownRows = showAllUnknown ? desk.unknown : desk.unknown.slice(0, 3);
  const observedRows = desk.observed.slice(0, 3);
  const currentInspection = selection && inspection?.key === selectionKey(selection) ? inspection : null;

  return (
    <div className="control-home">
      <section className={"home-brief " + briefTone} aria-label="今日厂务简报">
        <div className="home-topline">
          <span>01 / SHIFT BRIEFING</span>
          <span>采集 {formatTime(gates?.factsGeneratedAt ?? snapshot.generatedAt)}</span>
        </div>
        <div className="home-brief-body">
          <div className="home-brief-caption">
            <span className="home-brief-signal" aria-hidden="true"/>
            {briefTone === "attention" ? "ACTIONABLE / 需要人工" :
              briefTone === "uncertain" ? "PARTIAL / 有观察缺口" : "OBSERVED / 可确认范围"}
          </div>
          <h2>{currentLine}</h2>
          <p>{briefDescription}</p>
        </div>
        <div className="home-sources" aria-label="厂务数据来源">
          <span><GitBranch size={13}/> Gate {desk.gateCoverage}</span>
          <span><Cloud size={13}/> Cloudflare {cloudflareLabel(snapshot.sources.cloudflare)}</span>
          <span><Radio size={13}/> HTTP 探针 {onlineServices}/{snapshot.services.length}</span>
          <span><Clapperboard size={13}/> Worker {feed?.status ?? "未就绪"}</span>
        </div>
      </section>

      <div className="home-attention-context" role="status">
        <div><strong>{desk.attention.length}</strong><span>有证据需接手</span></div>
        <div><strong>{desk.inProgress.length + activeWorkers.length}</strong><span>有记录正在推进*</span></div>
        <div><strong>{desk.unknown.length}</strong><span>资格未知候选</span></div>
        <div><strong>{desk.pilotCount}</strong><span>GitHub 试点仓库</span></div>
      </div>
      <p className="home-count-caveat">* 正在推进为两种有界来源的记录数，不是去重后的任务数；未知来源不会计为健康。</p>

      <div className="home-primary-grid">
        <section className="home-panel home-attention" aria-labelledby="home-attention-title">
          <div className="home-section-title">
            <div><small>02 / ACTION DESK</small><h2 id="home-attention-title">需要关注</h2></div>
            <span>已证实 {desk.attention.length} · 非全组织总数</span>
          </div>
          {desk.attention.length ? (
            <div className="home-decision-list">{desk.attention.slice(0, 6).map(item =>
              <AttentionCard key={item.objectKey} item={item}/>)}</div>
          ) : (
            <div className="home-empty">
              <CheckCircle2 size={20} aria-hidden="true"/>
              <div>
                <strong>当前可确认的人工待办为 0</strong>
                <p>不是「一切正常」。必要 Gate、单 PR 审查和 Worker Reporter 的未知范围，独立列在下方。</p>
              </div>
            </div>
          )}
          <div className="home-panel-foot">
            <Link to="/engineering">工程证据 <ArrowRight size={12}/></Link>
            <Link to="/governance">PR / 治理 <ArrowRight size={12}/></Link>
            <Link to="/factory">Worker 现场 <ArrowRight size={12}/></Link>
          </div>
        </section>

        <section className="home-panel home-work" aria-labelledby="home-work-title">
          <div className="home-section-title">
            <div><small>03 / IN PROGRESS</small><h2 id="home-work-title">正在推进</h2></div>
            <span>{activeWorkers.length} 条活动 Run · 有界发现</span>
          </div>
          <div className="home-work-subline">{workCoverage}</div>
          {desk.inProgress.slice(0, 3).map(item =>
            <AttentionCard key={item.objectKey} item={item} compact/>)}
          {workers.error && !feed && <div className="home-inline-warning">无法读取 Worker 状态，不能推断车间空闲。</div>}
          {feed && !activeWorkers.length && (
            <div className="home-work-quiet">
              <span>当前已发现的记录里没有执行中的 External Worker。</span>
              <small>以下是最近 Run，成功不等于功能验收，失败不等于人工接手。</small>
            </div>
          )}
          {shownWorkers.map((run: FactoryFeedItem) => (
            <div key={run.repository + "/" + run.id} className="home-work-row">
              <span className={"home-worker-symbol " + (workerIsActive(run) ? "active" : "closed")}>
                <Activity size={15} aria-hidden="true"/>
              </span>
              <div>
                <a href={run.htmlUrl} target="_blank" rel="noreferrer" className="home-worker-source">
                  <strong>{run.repository.replace("uichat-mira/", "")}</strong>
                  <ExternalLink size={12} aria-hidden="true"/>
                </a>
                <small>Run #{run.id} · {formatTime(run.updatedAt)} · {workerRunLabel(run)}</small>
                <button type="button" className="home-inspect-link" onClick={() =>
                  setSelection({ kind: "worker", repository: run.repository, runId: run.id, attempt: run.attempt })
                }>核实是否需要人工接手 <Eye size={12}/></button>
              </div>
            </div>
          ))}
          {!feed && !workers.error && (
            <div className="home-inline-warning">
              <TuiLoading compact title="正在读取有界 Worker 列表" command="WORKER / DISCOVER" />
            </div>
          )}
          <Link to="/factory" className="home-factory-entrance">
            <span><Clapperboard size={19}/> 进入血汗工厂 TV</span><ArrowRight size={17}/>
          </Link>
          {ongoingBuilds.length > 0 && (
            <div className="home-build-activity">
              <strong>另外有 {ongoingBuilds.length} 个仓库的最近默认分支 Run 未完成 · 原始工程事实</strong>
              {ongoingBuilds.slice(0, 2).map(repo =>
                <a key={repo.fullName} href={repo.latestWorkflow?.htmlUrl ?? repo.htmlUrl}
                   target="_blank" rel="noreferrer">
                  <span>{repo.name}</span>
                  <small>查看 Run <ArrowRight size={12}/></small>
                </a>)}
            </div>
          )}
        </section>
      </div>

      <div className="home-evidence-grid">
        <section className="home-panel home-coverage" aria-labelledby="home-coverage-title">
          <div className="home-section-title">
            <div><small>04 / COVERAGE GAPS</small><h2 id="home-coverage-title">数据不足</h2></div>
            <span>{desk.unknown.length} 条资格未知候选</span>
          </div>
          <div className="home-coverage-summary">
            <ShieldAlert size={16} aria-hidden="true"/>
            <div>
              <strong>看不见，不等于不存在。</strong>
              <p>Gate {desk.gateCoverage} · GitHub Facts {desk.factsCoverage} ·
                {desk.outsidePilot === null ? " 试点外数量未知" : " " + desk.outsidePilot + " 个试点外公开仓库"}
              </p>
            </div>
          </div>
          {warningTexts.length > 0 && (
            <div className="home-coverage-notes">
              {warningTexts.slice(0, 5).map((text, index) => <p key={index}>{text}</p>)}
              {warningTexts.length > 5 && <details><summary>另有 {warningTexts.length - 5} 条来源说明</summary>
                {warningTexts.slice(5).map((text, index) => <p key={index}>{text}</p>)}</details>}
            </div>
          )}
          {unknownRows.map(item => <AttentionCard key={item.objectKey} item={item} compact/>)}
          {desk.unknown.length > 3 && (
            <button className="home-action" type="button" onClick={() => setShowAllUnknown(!showAllUnknown)}>
              {showAllUnknown ? "收起未确认记录" : "查看所有 " + desk.unknown.length + " 条资格未知记录"}
              <ArrowRight size={12}/>
            </button>
          )}
          <div className="home-panel-foot">
            <a href="https://github.com/uichat-mira" target="_blank" rel="noreferrer">GitHub 组织 <ExternalLink size={12}/></a>
          </div>
        </section>

        <section className="home-panel home-history" aria-labelledby="home-history-title">
          <div className="home-section-title">
            <div><small>05 / OBSERVATIONS</small><h2 id="home-history-title">历史观察</h2></div>
            <span>不计入人工待办</span>
          </div>
          {observedRows.map(item => <AttentionCard key={item.objectKey} item={item} compact/>)}
          {observedRows.length === 0 && <p className="home-work-quiet">当前资格投影没有历史观察事项；原始 Run、普通 Draft 和分支治理仍保留在各部门。</p>}
          {serviceIssues.length > 0 && (
            <div className="home-service-issues">
              <strong>服务探针异常 · 独立监测</strong>
              <small>HTTP 不在线不自动等同生产事故。</small>
              {serviceIssues.map(service =>
                <a href={service.url} key={service.id} target="_blank" rel="noreferrer">
                  <span>{service.label} · {service.status}</span><ExternalLink size={12}/>
                </a>)}
            </div>
          )}
          <div className="home-panel-foot">
            <Link to="/engineering">旧 CI 记录 <ArrowRight size={12}/></Link>
            <Link to="/governance">Draft / 分支治理 <ArrowRight size={12}/></Link>
            <Link to="/runtime">服务探针 <ArrowRight size={12}/></Link>
          </div>
        </section>
      </div>

      <section className="home-pr-check" aria-labelledby="home-pr-title">
        <div className="home-section-title">
          <div><small>06 / ON-DEMAND VERIFICATION</small><h2 id="home-pr-title">单项核验</h2></div>
          <span>主动查询 · 默认不遍历 Reviews / Reporter</span>
        </div>
        <p className="home-work-subline">试点 PR 最多读取每仓库最近 5 条；普通 Draft 不列为待办。
          点开某一项才额外读取它的合并资格，Worker 需主动点开才查 Reporter。</p>
        <div className="home-pr-grid">
          {nonDraftPulls.length ? nonDraftPulls.map(pr => (
            <div className="home-pr-row" key={pr.repository + ":" + pr.number}>
              <div><strong>{pr.repository.replace("uichat-mira/", "")} · PR #{pr.number}</strong>
                <small>{pr.title} · 更新 {formatTime(pr.updatedAt)}</small></div>
              <button type="button" onClick={() =>
                setSelection({ kind: "pr", repository: pr.repository, number: pr.number, headSha: pr.headSha })
              }><Eye size={13}/> 核实</button>
            </div>
          )) : <p className="home-work-quiet">当前有界 PR 列表未发现非 Draft 项，或列表暂不可读；不代表全组织没有阻塞。</p>}
        </div>
        {selection && (
          <div className="home-inspection" aria-live="polite">
            <div className="home-inspection-top">
              <strong>{selection.kind === "pr" ? "PR 合并资格" : "Worker 人工接手"} ·
                {selection.repository.replace("uichat-mira/", "")} ·
                {selection.kind === "pr" ? "#" + selection.number : "Run #" + selection.runId}</strong>
              <div><button type="button" onClick={() => setSelection({ ...selection })}><RefreshCw size={13}/> 重新核实</button>
                <button type="button" onClick={() => { setSelection(null); setInspection(null); }}>关闭</button></div>
            </div>
            {currentInspection?.loading ? (
              <TuiLoading compact title="正在读取这一项的可信资格" command="EVIDENCE / VERIFY" />
            ) :
              currentInspection?.error ? <p role="status">暂无法核实：{currentInspection.error}。不计入人工待办。</p> :
              currentInspection?.data && selectedFresh ? (
                <div>
                  {currentInspection.data.source === "github-pr-derivation" && (
                    <p>当前 PR：{currentInspection.data.status} ·
                      {currentInspection.data.draft ? " Draft，不计待办" : " 非 Draft"} ·
                      Head {currentInspection.data.headSha?.slice(0, 8) ?? "未知"} ·
                      覆盖 {currentInspection.data.coverage.status}</p>
                  )}
                  {currentInspection.data.source === "factory-attention-derivation" && (
                    <p>当前 Worker：{currentInspection.data.status} ·
                      Reporter {currentInspection.data.reporter.status} ·
                      Issue {currentInspection.data.issue.number ?? "未知"} ·
                      覆盖 {currentInspection.data.coverage.status}</p>
                  )}
                  <p>资格观察 {formatTime(currentInspection.data.observedAt)} · 读取于 {formatTime(new Date(currentInspection.checkedAt).toISOString())}</p>
                </div>
              ) : <p>未取得有效的当前资格，或本次人工核验已过期。旧结果不会永久保留为待办。</p>
            }
          </div>
        )}
      </section>

      <section className="home-stat-section" aria-labelledby="home-stat-title">
        <div className="home-section-title">
          <div><small>07 / MACHINE & CODE</small><h2 id="home-stat-title">系统工况</h2></div>
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
          <div><small>08 / PROJECT REGISTER</small><h2 id="home-projects-title">组织项目</h2></div>
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
              governance.data ? "公开 Projects 不可读取；不视为没有项目。" :
                <TuiLoading compact title="正在读取公开组织 Projects" command="PROJECTS / FETCH" />}
          </div>
        )}
      </section>

      <aside className="home-editorial" aria-label="厂务公报，非运行事实">
        <div><span>09 / EDITORIAL BULLETIN</span><strong>厂务公报</strong></div>
        <p>本厂反对一切无意义加班。<br/>尤其反对 CI 全绿之后宣布天下太平。</p>
        <small>反讽文案 · 与数据状态、事件严重性和验收结论无关</small>
      </aside>

      <p className="home-provenance">
        <ShieldAlert size={13} aria-hidden="true" />
        首页使用公共只读快照：GitHub 资格与事实复用约一小时的上游缓存；
        Worker 列表为近 14 天最多 12 条的有界样本。普通访问不会触发 Reviews/Reporter 深度查询；
        PR 深度核验仅对主动选中的单项有界刷新，Worker Reporter 仅在点击时读取。
        {sourcePartial && " 监测存在覆盖缺口，不能把未观测判成健康。"}
      </p>
    </div>
  );
}
