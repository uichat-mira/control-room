import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router";
import { Activity, ArrowRight, CircleAlert, Clock3, ExternalLink, Radio, ShieldCheck } from "lucide-react";
import type { FactoryRunProjection, FactoryState } from "./factory-read-model";
import type { FactoryFeed, FactoryFeedItem } from "./factory-feed";
import "./factory-tv.css";

// Only real GitHub-owned evidence is displayed. Unimplemented capabilities are explicitly labelled.
// Privileged Cloudflare Observability queries remain server-only and on-demand.
type Tone = "working" | "observing" | "failed";
type Track = "done" | "current" | "error" | "pending";
type Fact = { at: string; title: string; detail: string; tone: "normal" | "warning" | "failure" };
type Station = {
  id: string; camera: string; repository: string; task: string; model: string;
  headline: string; status: string; tone: Tone; duration: string; lastEvidence: string;
  track: [Track, Track, Track, Track]; facts: Fact[]; broadcast: string;
};

const stateTone = (state: FactoryState): Tone =>
  ["working", "validating", "candidate_captured", "repairing", "queued", "verified", "delivered"].includes(state)
    ? "working"
    : ["worker_failed", "blocked", "escalated", "delivery_retry"].includes(state)
      ? "failed"
      : "observing";

const stateHeadline = (state: FactoryState) => {
  const labels: Record<FactoryState, string> = {
    queued: "已排队 · 等待 Worker",
    working: "施工中 · GitHub 有执行证据",
    candidate_captured: "Candidate 已捕获 · 等待验证",
    validating: "验证中 · 独立 Validation 正在工作",
    repairing: "返工中 · 正在消费结构化打回",
    validation_gap: "验证未通过 · 等待下一决策",
    blocked: "已阻断 · 不允许继续派 Worker",
    verified: "已验证 · 等待交付",
    delivery_retry: "交付失败 · 只允许无模型重试",
    delivered: "Draft PR 已交付",
    escalated: "已升级 · 自动返工预算耗尽",
    worker_failed: "Worker 失败 · 结果未自动视为验收成功",
    observation_gap: "观察缺口 · 不能把 Run 成功当作产品成功",
    logs_expired: "日志已过期 · GitHub 事实仍可追溯",
    artifact_unavailable: "Artifact 不可用 · 证据链不完整",
    unknown: "状态未知 · 等待更多可信证据",
  };
  return labels[state];
};

const trackForState = (state: FactoryState): [Track, Track, Track, Track] => {
  if (["working", "queued"].includes(state)) return ["current", "pending", "pending", "pending"];
  if (["candidate_captured", "validating", "validation_gap"].includes(state)) {
    return ["done", state === "validation_gap" ? "error" : "current", "pending", "pending"];
  }
  if (state === "repairing") return ["done", "error", "pending", "current"];
  if (["verified", "delivery_retry"].includes(state)) {
    return ["done", "done", state === "delivery_retry" ? "error" : "current", "pending"];
  }
  if (state === "delivered") return ["done", "done", "done", "pending"];
  if (state === "escalated") return ["done", "error", "pending", "error"];
  if (["blocked", "worker_failed", "artifact_unavailable"].includes(state)) {
    return ["done", "error", "pending", "pending"];
  }
  return ["done", "current", "pending", "pending"];
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";
};

const liveStation = (projection: FactoryRunProjection): Station => {
  const repo = projection.repository.split("/").at(-1) ?? projection.repository;
  const facts: Fact[] = projection.reporter.events.length
    ? projection.reporter.events.slice(-8).map((event) => ({
        at: formatTime(event.occurredAt),
        title: ({
          "worker.started": "Worker 开始执行",
          "candidate.captured": "Candidate 已捕获",
          "verify.failed": "Validation 未通过",
          "verify.passed": "Verify PASS",
          "delivery.failed": "Delivery 失败",
          "delivery.draft_pr_created": "Draft PR 已创建",
          "recovery.detected": "Recovery 已记录",
        } as Record<string, string>)[event.kind] ?? `${event.stage} / ${event.outcome}`,
        detail: event.errorCode ? `可信事件：${event.outcome} · ${event.errorCode}` : `可信事件：${event.outcome}${event.issueNumber ? ` · Issue #${event.issueNumber}` : ""}`,
        tone: ["failed", "blocked", "escalated"].includes(event.outcome) ? "failure" : "normal",
      }))
    : projection.jobs.slice(-6).map((job) => ({
        at: formatTime(job.startedAt ?? projection.run.createdAt),
        title: job.name,
        detail: `GitHub Job：${job.status}${job.conclusion ? ` · ${job.conclusion}` : ""}`,
        tone: job.conclusion === "failure" ? "failure" : job.status === "in_progress" ? "warning" : "normal",
      }));

  if (!facts.length) {
    facts.push({
      at: formatTime(projection.run.updatedAt),
      title: "暂无可验证过程事件",
      detail: "GitHub Run 仍可追溯；没有 Reporter 信号时，不猜测模型正在做什么。",
      tone: "warning",
    });
  }

  const lastEvidence =
    projection.reporter.status === "available" ? `Trusted Reporter · ${projection.reporter.events.length} events` :
    projection.reporter.status === "expired" ? "Reporter 日志已过期 · GitHub 仍可追溯" :
    projection.reporter.status === "not_configured" ? "Reporter 未配置 · 仅显示 GitHub 事实" :
    projection.reporter.status === "not_expected" ? "Reporter 当前不应产生事件 · 仅显示 GitHub 事实" :
    projection.reporter.status === "not_requested" ? "GitHub-only · 尚未请求号脉日志" :
    "Reporter unavailable · 不视为 Worker failure";

  return {
    id: `real-${projection.run.id}`,
    camera: "LIVE",
    repository: repo,
    task: projection.issueNumber ? `#${projection.issueNumber}` : `RUN ${projection.run.id}`,
    model: "External Worker",
    headline: stateHeadline(projection.state),
    status: projection.state.replaceAll("_", " ").toUpperCase(),
    tone: stateTone(projection.state),
    duration: `Run ${projection.run.id}`,
    lastEvidence,
    track: trackForState(projection.state),
    facts,
    broadcast: projection.warnings[0] ?? `Run #${projection.run.id}：${stateHeadline(projection.state)}。一切判断以 GitHub / Trusted Reporter 证据为准。`,
  };
};


function Signal({ tone, text }: { tone: Tone; text: string }) {
  return <span className={"factory-signal " + tone}><i aria-hidden="true" />{text}</span>;
}

function Progress({ steps }: { steps: Station["track"] }) {
  const labels = ["施工", "验证", "交付", "恢复"];
  return (
    <div className="factory-track" role="img" aria-label="施工、验证、交付、恢复四阶段证据摘要；未执行步骤不代表已完成">
      {steps.map((step, i) => <span key={labels[i]} title={labels[i] + "：" + step} className={step} />)}
    </div>
  );
}

function Timeline({ station }: { station: Station }) {
  return (
    <section className="factory-timeline" aria-label={"工位 " + station.camera + " 事件时间线"}>
      <header className="factory-timeline-header">
        <strong>工位 {station.camera} / 事件观察</strong>
        <Signal tone={station.tone} text={station.status} />
      </header>
      <div className="factory-timeline-title">
        <span className="factory-micro">CURRENT STATE / {"REAL"}</span>
        <strong>{station.headline}</strong>
        <small>{station.repository} · {station.task} · 可信事件按时序排列，不是模型原文。</small>
      </div>
      <ol className="factory-events">
        {station.facts.map((fact, i) => (
          <li key={fact.at + "-" + i} className={"factory-event " + fact.tone}>
            <time>{fact.at}</time><i aria-hidden="true" />
            <div><strong>{fact.title}</strong><p>{fact.detail}</p></div>
          </li>
        ))}
      </ol>
      <div className="factory-timeline-foot">
        <span>{"SOURCE / GITHUB ACTIONS + TRUSTED REPORTER"}</span>
        <span>{"REAL READ MODEL · SANITIZED SERVER PROJECTION"}</span>
      </div>
    </section>
  );
}

function StationCard({ station, active, choose }: { station: Station; active: boolean; choose: () => void }) {
  return (
    <button type="button" className={"factory-station " + (active ? "selected" : "")} onClick={choose} aria-pressed={active}>
      <span className="factory-station-top">
        <span className="factory-micro">{"GITHUB / WORKSTATION"}</span>
        <Signal tone={station.tone} text={station.status} />
      </span>
      <strong className="factory-station-name">{station.repository}</strong>
      <span className="factory-station-sub">{station.task} · {station.model}</span>
      <Progress steps={station.track} />
      <span className="factory-station-bottom"><span>{station.lastEvidence}</span><time>{station.duration}</time></span>
    </button>
  );
}

function stationFromFeed(item: FactoryFeedItem, camera: string): Station {
  const active = item.status === "in_progress" || item.status === "queued";
  const failed = ["failure", "timed_out", "startup_failure"].includes(item.conclusion ?? "");
  const tone: Tone = active ? "working" : failed ? "failed" : "observing";
  const outcome = item.conclusion ?? item.status;
  return {
    id: "real-" + item.id,
    camera,
    repository: item.repository.split("/").at(-1) ?? item.repository,
    task: "RUN " + item.id,
    model: "GitHub Actions",
    headline: active
      ? "GitHub 执行中 · 不等于模型持续活动"
      : "GitHub Run 已结束 · " + outcome + "（不是 Verify 结论）",
    status: (active ? item.status : outcome).toUpperCase(),
    tone,
    duration: formatTime(item.updatedAt) + " 更新",
    lastEvidence: "GitHub Run #" + item.id,
    track: active ? ["current", "pending", "pending", "pending"]
      : failed ? ["error", "pending", "pending", "pending"]
      : ["done", "pending", "pending", "pending"],
    facts: [
      { at: formatTime(item.createdAt), title: "GitHub Run 创建", detail: item.repository + " · " + item.title, tone: "normal" },
      { at: formatTime(item.updatedAt), title: "GitHub Actions 最新状态",
        detail: item.status + " / " + outcome + " · 仅为 GitHub 运行结果",
        tone: failed ? "failure" : active ? "warning" : "normal" },
    ],
    broadcast: "Run #" + item.id + " 来自 GitHub Actions。" +
      " 运行状态不等于模型正在操作；验证和交付须查看独立证据。",
  };
}

function FactoryLiveWall() {
  const [feed, setFeed] = useState<FactoryFeed | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FactoryRunProjection | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/v1/factory/runs", { signal: controller.signal, cache: "no-cache" });
        if (!response.ok) throw new Error("GitHub 施工记录暂时无法读取（HTTP " + response.status + "）");
        const value = await response.json() as FactoryFeed;
        if (value.source !== "github-actions" || !Array.isArray(value.items)) {
          throw new Error("GitHub 施工记录格式不正确");
        }
        if (!controller.signal.aborted) {
          setFeed(value);
          setFeedError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFeedError(error instanceof Error ? error.message : "GitHub 施工记录暂时不可读");
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const items = feed?.items ?? [];
  const selectedItem = items.find((item) => item.id === chosenId) ?? items[0] ?? null;
  useEffect(() => {
    if (!selectedItem) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    const url = new URL("/api/v1/factory/run", window.location.origin);
    url.searchParams.set("repository", selectedItem.repository);
    url.searchParams.set("runId", String(selectedItem.id));
    url.searchParams.set("includeReporter", "false");
    fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("工位的 GitHub 详细记录暂时不可读");
      return await response.json() as FactoryRunProjection;
    }).then((value) => {
      if (!controller.signal.aborted) setDetail(value);
    }).catch(() => {
      if (!controller.signal.aborted) setDetailError("详细记录不可用，仍可从 GitHub 查看原始 Run");
    });
    return () => controller.abort();
  }, [selectedItem?.repository, selectedItem?.id]);

  const stationsReal = items.map((item, index) =>
    stationFromFeed(item, String(index + 1).padStart(2, "0")));
  const selected = selectedItem ? (
    detail?.run.id === selectedItem.id
      ? { ...liveStation(detail), camera: String(items.indexOf(selectedItem) + 1).padStart(2, "0") }
      : stationsReal.find((station) => station.id === "real-" + selectedItem.id) ?? null
  ) : null;
  const activeCount = items.filter((item) => item.status === "queued" || item.status === "in_progress").length;
  const failedCount = items.filter((item) => ["failure", "timed_out", "startup_failure"].includes(item.conclusion ?? "")).length;

  return (
    <>
      <div className="factory-stats" aria-label="GitHub 真实施工记录">
        <div><span>发现工位 / GITHUB</span><strong>{feed ? items.length : "—"}</strong><small>近 {feed?.historyDays ?? 14} 天，跳过未执行 Run</small></div>
        <div><span>执行中 / ACTIONS</span><strong className="factory-value-ok">{feed ? activeCount : "—"}</strong><small>不推断模型持续活动</small></div>
        <div><span>失败 / ACTIONS</span><strong className="factory-value-failed">{feed ? failedCount : "—"}</strong><small>失败不等于 Candidate 丢失</small></div>
        <div><span>数据来源</span><strong className="factory-feed-source">{feed?.status === "partial" ? "部分可用" : feed ? "GITHUB" : "—"}</strong>
          <small>{feed ? "扫描 " + feed.scannedRepositories + " 个公开仓库" : "正在发现工位"}</small></div>
      </div>
      <div className="factory-content">
        <div className="factory-section-title"><strong>一号车间 / 真实施工记录</strong><small>GITHUB ACTIONS · 60S REFRESH</small></div>
        {feedError && <p className="factory-feed-alert" role="alert">{feedError}。{feed ? "以下为上次成功取得的快照。" : "没有使用演示数据填充。"}</p>}
        {feed?.status === "partial" &&
          <p className="factory-feed-alert">当前只读取部分公开仓库：{feed.failedRepositories} 个来源失败
            {feed.coverageLimited ? "，超出当次扫描上限" : ""}。这些数字不是组织总量。</p>}
        {!feed && !feedError ? (
          <div className="factory-missing"><Activity size={19}/><strong>正在寻找真实施工记录</strong>
            <p>只查询 GitHub Actions，不扫描 Cloudflare Logs。</p></div>
        ) : items.length === 0 ? (
          <div className="factory-missing"><ShieldCheck size={19}/><strong>{feedError ? "暂无可读取的真实工位" : "当前没有可显示的施工记录"}</strong>
            <p>{feedError ? "GitHub 不可用，不能判断是否空闲。" : "最近 " + feed?.historyDays + " 天内未发现实际执行的 External Worker Run；不会用假工位填充。"}</p>
            <Link to="/factory">返回真实施工墙 <ArrowRight size={14}/></Link></div>
        ) : (
          <>
            <div className="factory-grid">
              <div className="factory-station-list">
                {stationsReal.map((station) =>
                  <StationCard key={station.id} station={station}
                    active={selected?.id === station.id}
                    choose={() => setChosenId(Number(station.id.slice("real-".length)))} />)}
              </div>
              {selected && selectedItem && (
                <div className="factory-detail-side">
                  <Timeline station={selected}/>
                  {detailError && <p className="factory-feed-alert">{detailError}</p>}
                  <div className="factory-live-evidence">
                    <a href={selectedItem.htmlUrl} target="_blank" rel="noreferrer">GitHub 原始 Run <ExternalLink size={12}/></a>
                    {detail && <span>Jobs: {detail.jobs.length} · Artifacts: {detail.artifacts.length} · PRs: {detail.pullRequests.length}</span>}
                  </div>
                  <Link className="factory-enter-room"
                    to={"/factory?mode=real&repository=" + encodeURIComponent(selectedItem.repository) + "&runId=" + selectedItem.id}>
                    查看工位完整证据（按需读取号脉） <ArrowRight size={14}/>
                  </Link>
                </div>
              )}
            </div>
            <aside className="factory-ticker" aria-label="真实工程状态播报">
              <div>红色广播站 <small>CH 05</small></div>
              <p>{selected?.broadcast ?? "所有施工状态以 GitHub 为准。"}</p>
            </aside>
          </>
        )}
        <p className="factory-honesty"><ShieldCheck size={14}/> 最近一次 GitHub 快照：
          {feed ? new Date(feed.generatedAt).toLocaleString() : "尚未取得"}。
          只有 GitHub 运行状态；逐工具实时直播功能开发中。</p>
      </div>
    </>
  );
}

function stationFromFeed(item: FactoryFeedItem, camera: string): Station {
  const active = item.status === "in_progress" || item.status === "queued";
  const failed = ["failure", "timed_out", "startup_failure"].includes(item.conclusion ?? "");
  const tone: Tone = active ? "working" : failed ? "failed" : "observing";
  const outcome = item.conclusion ?? item.status;
  return {
    id: "real-" + item.id,
    camera,
    repository: item.repository.split("/").at(-1) ?? item.repository,
    task: "RUN " + item.id,
    model: "GitHub Actions",
    headline: active
      ? "GitHub 执行中 · 不等于模型持续活动"
      : "GitHub Run 已结束 · " + outcome + "（不是 Verify 结论）",
    status: (active ? item.status : outcome).toUpperCase(),
    tone,
    duration: formatTime(item.updatedAt) + " 更新",
    lastEvidence: "GitHub Run #" + item.id,
    track: active ? ["current", "pending", "pending", "pending"]
      : failed ? ["error", "pending", "pending", "pending"]
      : ["done", "pending", "pending", "pending"],
    facts: [
      { at: formatTime(item.createdAt), title: "GitHub Run 创建", detail: item.repository + " · " + item.title, tone: "normal" },
      { at: formatTime(item.updatedAt), title: "GitHub Actions 最新状态",
        detail: item.status + " / " + outcome + " · 仅为 GitHub 运行结果",
        tone: failed ? "failure" : active ? "warning" : "normal" },
    ],
    broadcast: "Run #" + item.id + " 来自 GitHub Actions。" +
      " 运行状态不等于模型正在操作；验证和交付须查看独立证据。",
    mode: "real",
  };
}

function FactoryLiveWall() {
  const [feed, setFeed] = useState<FactoryFeed | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FactoryRunProjection | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/v1/factory/runs", { signal: controller.signal, cache: "no-cache" });
        if (!response.ok) throw new Error("GitHub 施工记录暂时无法读取（HTTP " + response.status + "）");
        const value = await response.json() as FactoryFeed;
        if (value.source !== "github-actions" || !Array.isArray(value.items)) {
          throw new Error("GitHub 施工记录格式不正确");
        }
        if (!controller.signal.aborted) {
          setFeed(value);
          setFeedError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFeedError(error instanceof Error ? error.message : "GitHub 施工记录暂时不可读");
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const items = feed?.items ?? [];
  const selectedItem = items.find((item) => item.id === chosenId) ?? items[0] ?? null;
  useEffect(() => {
    if (!selectedItem) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    const url = new URL("/api/v1/factory/run", window.location.origin);
    url.searchParams.set("repository", selectedItem.repository);
    url.searchParams.set("runId", String(selectedItem.id));
    url.searchParams.set("includeReporter", "false");
    fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("工位的 GitHub 详细记录暂时不可读");
      return await response.json() as FactoryRunProjection;
    }).then((value) => {
      if (!controller.signal.aborted) setDetail(value);
    }).catch(() => {
      if (!controller.signal.aborted) setDetailError("详细记录不可用，仍可从 GitHub 查看原始 Run");
    });
    return () => controller.abort();
  }, [selectedItem?.repository, selectedItem?.id]);

  const stationsReal = items.map((item, index) =>
    stationFromFeed(item, String(index + 1).padStart(2, "0")));
  const selected = selectedItem ? (
    detail?.run.id === selectedItem.id
      ? { ...liveStation(detail), camera: String(items.indexOf(selectedItem) + 1).padStart(2, "0") }
      : stationsReal.find((station) => station.id === "real-" + selectedItem.id) ?? null
  ) : null;
  const activeCount = items.filter((item) => item.status === "queued" || item.status === "in_progress").length;
  const failedCount = items.filter((item) => ["failure", "timed_out", "startup_failure"].includes(item.conclusion ?? "")).length;

  return (
    <>
      <div className="factory-stats" aria-label="GitHub 真实施工记录">
        <div><span>发现工位 / GITHUB</span><strong>{feed ? items.length : "—"}</strong><small>近 {feed?.historyDays ?? 14} 天，跳过未执行 Run</small></div>
        <div><span>执行中 / ACTIONS</span><strong className="factory-value-ok">{feed ? activeCount : "—"}</strong><small>不推断模型持续活动</small></div>
        <div><span>失败 / ACTIONS</span><strong className="factory-value-failed">{feed ? failedCount : "—"}</strong><small>失败不等于 Candidate 丢失</small></div>
        <div><span>数据来源</span><strong className="factory-feed-source">{feed?.status === "partial" ? "部分可用" : feed ? "GITHUB" : "—"}</strong>
          <small>{feed ? "扫描 " + feed.scannedRepositories + " 个公开仓库" : "正在发现工位"}</small></div>
      </div>
      <div className="factory-content">
        <div className="factory-section-title"><strong>一号车间 / 真实施工记录</strong><small>GITHUB ACTIONS · 60S REFRESH</small></div>
        {feedError && <p className="factory-feed-alert" role="alert">{feedError}。{feed ? "以下为上次成功取得的快照。" : "没有使用演示数据填充。"}</p>}
        {feed?.status === "partial" &&
          <p className="factory-feed-alert">当前只读取部分公开仓库：{feed.failedRepositories} 个来源失败
            {feed.coverageLimited ? "，超出当次扫描上限" : ""}。这些数字不是组织总量。</p>}
        {!feed && !feedError ? (
          <div className="factory-missing"><Activity size={19}/><strong>正在寻找真实施工记录</strong>
            <p>只查询 GitHub Actions，不扫描 Cloudflare Logs。</p></div>
        ) : items.length === 0 ? (
          <div className="factory-missing"><ShieldCheck size={19}/><strong>{feedError ? "暂无可读取的真实工位" : "当前没有可显示的施工记录"}</strong>
            <p>{feedError ? "GitHub 不可用，不能判断是否空闲。" : "最近 " + feed?.historyDays + " 天内未发现实际执行的 External Worker Run；不会用假工位填充。"}</p>
            <Link to="/factory?mode=demo">查看设计演示 <ArrowRight size={14}/></Link></div>
        ) : (
          <>
            <div className="factory-grid">
              <div className="factory-station-list">
                {stationsReal.map((station) =>
                  <StationCard key={station.id} station={station}
                    active={selected?.id === station.id}
                    choose={() => setChosenId(Number(station.id.slice("real-".length)))} />)}
              </div>
              {selected && selectedItem && (
                <div className="factory-detail-side">
                  <Timeline station={selected}/>
                  {detailError && <p className="factory-feed-alert">{detailError}</p>}
                  <div className="factory-live-evidence">
                    <a href={selectedItem.htmlUrl} target="_blank" rel="noreferrer">GitHub 原始 Run <ExternalLink size={12}/></a>
                    {detail && <span>Jobs: {detail.jobs.length} · Artifacts: {detail.artifacts.length} · PRs: {detail.pullRequests.length}</span>}
                  </div>
                  <Link className="factory-enter-room"
                    to={"/factory?mode=real&repository=" + encodeURIComponent(selectedItem.repository) + "&runId=" + selectedItem.id}>
                    查看工位完整证据（按需读取号脉） <ArrowRight size={14}/>
                  </Link>
                </div>
              )}
            </div>
            <aside className="factory-ticker" aria-label="真实工程状态播报">
              <div>红色广播站 <small>CH 05</small></div>
              <p>{selected?.broadcast ?? "所有施工状态以 GitHub 为准。"}</p>
            </aside>
          </>
        )}
        <p className="factory-honesty"><ShieldCheck size={14}/> 最近一次 GitHub 快照：
          {feed ? new Date(feed.generatedAt).toLocaleString() : "尚未取得"}。
          只有 GitHub 运行状态，不冒充逐工具实时直播。演示模式在 <Link to="/factory?mode=demo">Demo</Link>。</p>
      </div>
    </>
  );
}

export default function FactoryTV() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const isBroadcast = pathname.replace(/\/+$/, "") === "/factory/broadcast";
  const realRepository = searchParams.get("repository");
  const realRunId = searchParams.get("runId");
  const realRequested = searchParams.get("mode") === "real" || Boolean(realRepository && realRunId);
  const realConfigValid = Boolean(realRepository && realRunId);
  const [realProjection, setRealProjection] = useState<FactoryRunProjection | null>(null);
  const [realError, setRealError] = useState<string | null>(null);

  useEffect(() => {
    if (!realRequested || !realRepository || !realRunId) return;
    const controller = new AbortController();
    setRealProjection(null);
    setRealError(null);
    const url = new URL("/api/v1/factory/run", window.location.origin);
    url.searchParams.set("repository", realRepository);
    url.searchParams.set("runId", realRunId);

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as FactoryRunProjection & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "factory_run_unavailable");
        return body;
      })
      .then(setRealProjection)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRealError(error instanceof Error ? error.message : "factory_run_unavailable");
      });

    return () => controller.abort();
  }, [realRequested, realRepository, realRunId]);

  const live = useMemo(() => realProjection ? liveStation(realProjection) : null, [realProjection]);

  return (
    <section className="factory-tv" aria-label="血汗工厂 TV">
      <header className="factory-masthead">
        <div className="factory-masthead-top">
          <span className="factory-micro"><Radio size={12} aria-hidden="true" /> MIRA / CONTROL ROOM / CHANNEL 05</span>
          <div className="factory-masthead-actions">
            <span className="factory-source-label">{isBroadcast ? "FEATURE IN DEVELOPMENT" : "GITHUB ACTIONS · REAL"}</span>
            <nav className="factory-display-switch" aria-label="展示模式与控制台入口">
              <Link to="/">返回控制台</Link>
              <Link to="/wall">Mira System 大屏 <ExternalLink size={12} aria-hidden="true" /></Link>
            </nav>
          </div>
        </div>
        <div className="factory-masthead-main">
          <div><h2>血汗工厂 <em>TV</em></h2><div className="factory-red-rule" /></div>
          <p>控诉资本主义灭绝人性的血泪剥削<br />一切生产活动，以 GitHub 证据为准。</p>
        </div>
      </header>


      {realRequested && !isBroadcast && <div className="factory-stats" aria-label="真实运行状态">
        <div><span>当前 Run / REAL</span><strong>{realProjection ? "01" : "—"}</strong><small>{realProjection ? realProjection.run.id : "等待读取"}</small></div>
        <div><span>当前状态 / REAL</span><strong className={realProjection ? "factory-value-"+stateTone(realProjection.state) : ""}>{realProjection ? realProjection.state.replaceAll("_", " ") : "—"}</strong><small>GitHub 成功不等于 Verify PASS</small></div>
        <div><span>Reporter / REAL</span><strong className={realProjection?.reporter.status === "unavailable" || realProjection?.reporter.status === "expired" ? "factory-value-warn" : "factory-value-ok"}>{realProjection?.reporter.status ?? "—"}</strong><small>短期观测，不是事实源</small></div>
        <div><span>Repair / REAL</span><strong>{realProjection?.repairRound ?? "—"}</strong><small>仅来自结构化可信事件</small></div>
      </div>}

      <nav className="factory-tabs" aria-label="工厂 TV 视图">
        <NavLink to="/factory" end className={() => !realRequested && !isBroadcast ? "active" : ""}><Activity size={15} /> 真实施工墙</NavLink>
        {realRequested && !isBroadcast && <span className="factory-tab-current"><Radio size={15} /> 单工位证据</span>}
        <NavLink to="/factory/broadcast"><CircleAlert size={15} /> 血泪播报栏 · 开发中</NavLink>
      </nav>

      {isBroadcast ? (
        <div className="factory-content">
          <div className="factory-section-title"><strong>血泪播报栏</strong><small>NO TRUSTED FEED YET</small></div>
          <div className="factory-missing">
            <CircleAlert size={19} />
            <strong>功能开发中</strong>
            <p>尚未接入可验证的自动播报事件。这里不会显示预设文案、虚构事件或编造的施工结果。</p>
            <Link to="/factory">返回真实施工墙 <ArrowRight size={14} /></Link>
          </div>
        </div>
      ) : realRequested ? (
        <div className="factory-content">
          <div className="factory-section-title"><strong>真实 Run / 受控投影</strong><small>GITHUB FACTS + TRUSTED REPORTER</small></div>
          {!realConfigValid ? (
            <div className="factory-missing"><CircleAlert size={19} /><strong>真实模式缺少 Run 定位</strong><p>需要同时提供 repository 与 runId；不会生成虚构数据。</p><Link to="/factory">返回真实施工墙 <ArrowRight size={14} /></Link></div>
          ) : realError ? (
            <div className="factory-missing"><CircleAlert size={19} /><strong>真实 Run 暂时不可读</strong><p>{realError}</p><p>不会退回显示为真实数据。</p><Link to="/factory">返回真实施工墙 <ArrowRight size={14} /></Link></div>
          ) : !live ? (
            <div className="factory-missing"><Activity size={19} /><strong>正在读取真实 Run</strong><p>服务器只返回脱敏后的生命周期投影，不向浏览器提供 GitHub / Cloudflare 凭据。</p></div>
          ) : (
            <>
              <div className="factory-room-meta">
                <span>{live.repository}</span><span>Run {realProjection?.run.id}</span><span>Attempt {realProjection?.run.attempt}</span>
                <span>{realProjection?.freshness}</span><span>Reporter {realProjection?.reporter.status}</span>
              </div>
              <Timeline station={live} />
              <div className="factory-live-evidence">
                <span><strong>GitHub:</strong> <a href={realProjection?.run.htmlUrl} target="_blank" rel="noreferrer">Run evidence</a></span>
                <span><strong>Provenance:</strong> {realProjection?.provenance.length ?? 0} refs</span>
                <span><strong>Artifacts:</strong> {realProjection?.artifacts.length ?? 0}</span>
                <span><strong>PRs:</strong> {realProjection?.pullRequests.length ?? 0}</span>
              </div>
              <p className="factory-honesty"><ShieldCheck size={14} /> 逐工具实时直播功能开发中；当前只显示可追溯的真实运行证据。</p>
            </>
          )}
        </div>
      ) : (
        <FactoryLiveWall />
      )}
      <div className="factory-bottom">
        <span><Clock3 size={12} /> CTRL ROOM / INDUSTRIAL CHANNEL 05</span>
        <span>{isBroadcast ? "功能开发中 · 无虚构播报" : "真实数据 · GitHub Actions · 无默认号脉扫描"}</span>
        <Link to="/engineering">Engineering <ExternalLink size={12} /></Link>
      </div>
    </section>
  );
}
