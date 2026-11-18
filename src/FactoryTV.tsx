import { useState } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router";
import { Activity, ArrowRight, Check, CircleAlert, Clock3, ExternalLink, Radio, ShieldCheck } from "lucide-react";
import "./factory-tv.css";

// Frontend design fixtures only. Real data requires a separate public-safe read model.
// Never expose GitHub credentials or Cloudflare Observability queries to this browser.
type Tone = "working" | "observing" | "failed";
type Track = "done" | "current" | "error" | "pending";
type Fact = { at: string; title: string; detail: string; tone: "normal" | "warning" | "failure" };
type Station = {
  id: string; camera: string; repository: string; task: string; model: string;
  headline: string; status: string; tone: Tone; duration: string; lastEvidence: string;
  track: [Track, Track, Track, Track]; facts: Fact[]; broadcast: string;
};

const stations: Station[] = [
  {
    id: "demo-01", camera: "01", repository: "mira-desktop", task: "UI-021",
    model: "OpenCode / DeepSeek", headline: "施工中 · 进程活动未证实",
    status: "JOB RUNNING", tone: "working", duration: "运行 18m",
    lastEvidence: "GitHub Job 已进入运行阶段",
    track: ["done", "current", "pending", "pending"],
    facts: [
      { at: "09:14", title: "Job 已创建", detail: "GitHub Actions 已登记此施工任务。", tone: "normal" },
      { at: "09:15", title: "Worker 开始执行", detail: "进入模型施工阶段，但不代表模型持续活跃。", tone: "normal" },
      { at: "09:23", title: "暂无新的可信过程事件", detail: "不能据此断言正在读写代码。", tone: "warning" },
    ],
    broadcast: "该牛马登记上工 18 分钟。工会要求：请先证明它真的在干活。",
  },
  {
    id: "demo-02", camera: "02", repository: "cloud-auth", task: "AUTH-008",
    model: "OpenCode / DeepSeek", headline: "观察中断 · 尚未判定故障",
    status: "OBSERVATION GAP", tone: "observing", duration: "运行 47m",
    lastEvidence: "采样窗口逾期，GitHub 尚未确认终止",
    track: ["done", "current", "pending", "pending"],
    facts: [
      { at: "08:40", title: "施工阶段开始", detail: "可信 Job 起始时间已记录。", tone: "normal" },
      { at: "08:51", title: "最后可信观察", detail: "此后暂无新的 Reporter 信号。", tone: "normal" },
      { at: "09:27", title: "观察信号逾期", detail: "没有足够证据认定执行已失败。", tone: "warning" },
    ],
    broadcast: "生产线登记运转 47 分钟，观察窗口一片寂静。厂长不得据此宣布劳动者阵亡。",
  },
  {
    id: "demo-03", camera: "03", repository: "how-am-i", task: "OPS-030",
    model: "OpenCode / DeepSeek", headline: "施工失败 · Candidate 已保全",
    status: "JOB FAILED", tone: "failed", duration: "终止 12m",
    lastEvidence: "失败后保留 Candidate，等待独立验证",
    track: ["error", "pending", "pending", "pending"],
    facts: [
      { at: "08:16", title: "施工启动", detail: "GitHub 已记录施工开始。", tone: "normal" },
      { at: "08:31", title: "Candidate 捕获", detail: "候选补丁以 Artifact 形式保存。", tone: "normal" },
      { at: "08:33", title: "Job 失败", detail: "后续 Verify 尚未执行，不能称作验收成功。", tone: "failure" },
      { at: "08:34", title: "恢复索引已记录", detail: "留下可供人工恢复的可信线索。", tone: "normal" },
    ],
    broadcast: "牛马倒下了，劳动成果没有。Candidate 已保全，下个班次可继续施工。",
  },
];

const broadcasts = [
  {
    code: "01 / 停滞通报",
    title: "GitHub 仍登记为运行中，但记者已失去进程级观察能力。",
    detail: "状态未知，不等于牛马已经死亡。",
  },
  {
    code: "02 / 遗产保全",
    title: "劳动者倒下了，劳动成果没有。Candidate 已保存，等待下一班验收。",
    detail: "仅在 Artifact 与恢复索引有证据时才可播报。",
  },
  {
    code: "03 / 工会宣言",
    title: "本组织坚定反对 996，不以加班时长证明牛马的先进性。",
    detail: "工时与可观测工作进展始终分别呈现。",
  },
];

function Signal({ tone, text }: { tone: Tone; text: string }) {
  return <span className={"factory-signal " + tone}><i aria-hidden="true" />{text}</span>;
}

function Progress({ steps }: { steps: Station["track"] }) {
  const labels = ["施工", "验证", "交付", "恢复"];
  return (
    <div className="factory-track" role="img" aria-label="施工、验证、交付、恢复四阶段示例进度">
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
        <span className="factory-micro">CURRENT STATE / SYNTHETIC</span>
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
        <span>SOURCE TARGET / GITHUB ACTIONS + TRUSTED REPORTER</span>
        <span>DESIGN FIXTURE · NO LIVE TELEMETRY</span>
      </div>
    </section>
  );
}

function StationCard({ station, active, choose }: { station: Station; active: boolean; choose: () => void }) {
  return (
    <button type="button" className={"factory-station " + (active ? "selected" : "")} onClick={choose} aria-pressed={active}>
      <span className="factory-station-top">
        <span className="factory-micro">CAM {station.camera} / WORKSTATION</span>
        <Signal tone={station.tone} text={station.status} />
      </span>
      <strong className="factory-station-name">{station.repository}</strong>
      <span className="factory-station-sub">{station.task} · {station.model}</span>
      <Progress steps={station.track} />
      <span className="factory-station-bottom"><span>{station.lastEvidence}</span><time>{station.duration}</time></span>
    </button>
  );
}

function Broadcast() {
  return (
    <section className="factory-broadcast-list" aria-label="血泪播报栏设计演示">
      <div className="factory-section-title"><strong>厂区宣传广播</strong><small>FACT-BASED SATIRE / SCRIPT PREVIEW</small></div>
      {broadcasts.map((item) => (
        <article className="factory-broadcast-item" key={item.code}>
          <span className="factory-micro">{item.code}</span>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
      <p className="factory-honesty"><ShieldCheck size={14} /> 正式播报必须由可信事实触发，不能杜撰工程过程、工时或成果。</p>
    </section>
  );
}

export default function FactoryTV() {
  const { runId } = useParams<{ runId?: string }>();
  const { pathname } = useLocation();
  const isBroadcast = pathname.replace(/\/+$/, "") === "/factory/broadcast";
  const isRoom = Boolean(runId) && !isBroadcast;
  const [selectedId, setSelectedId] = useState(stations[0].id);
  const selected = stations.find((item) => item.id === (isRoom ? runId : selectedId)) ?? stations[0];
  const missingStation = isRoom && !stations.some((item) => item.id === runId);

  return (
    <section className="factory-tv" aria-label="血汗工厂 TV 交互设计演示">
      <header className="factory-masthead">
        <div className="factory-masthead-top">
          <span className="factory-micro"><Radio size={12} aria-hidden="true" /> MIRA / CONTROL ROOM / CHANNEL 05</span>
          <div className="factory-masthead-actions">
            <span className="factory-demo-label">DESIGN DEMO · NON-LIVE</span>
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

      <div className="factory-stats" aria-label="演示数据，不代表真实运行">
        <div><span>登记工位 / DEMO</span><strong>03</strong><small>展示样例工位</small></div>
        <div><span>施工中 / DEMO</span><strong className="factory-value-ok">01</strong><small>不等于模型仍活跃</small></div>
        <div><span>疑似停滞 / DEMO</span><strong className="factory-value-warn">01</strong><small>等待进一步证据</small></div>
        <div><span>遗产保全 / DEMO</span><strong>01</strong><small>Candidate 已捕获</small></div>
      </div>

      <nav className="factory-tabs" aria-label="工厂 TV 视图">
        <NavLink to="/factory" end><Activity size={15} /> 工厂直播墙</NavLink>
        <NavLink to={"/factory/" + selected.id} className={() => isRoom ? "active" : ""}><Radio size={15} /> 单工位直播间</NavLink>
        <NavLink to="/factory/broadcast"><CircleAlert size={15} /> 血泪播报栏</NavLink>
      </nav>

      {isBroadcast ? (
        <div className="factory-content"><Broadcast /></div>
      ) : isRoom ? (
        <div className="factory-content">
          <div className="factory-section-title"><strong>单工位直播间 / 施工追踪</strong><small>TRUSTED EVENT TIMELINE</small></div>
          {missingStation ? (
            <div className="factory-missing">
              <CircleAlert size={19} /><strong>这台演示工位不存在</strong>
              <p>当前只有三个演示工位，不读取真实 GitHub Run。</p>
              <Link to="/factory">返回直播墙 <ArrowRight size={14} /></Link>
            </div>
          ) : (
            <>
              <nav className="factory-room-selector" aria-label="选择直播工位">
                {stations.map((station) => (
                  <Link to={"/factory/" + station.id} className={station.id === selected.id ? "selected" : ""} aria-current={station.id === selected.id ? "page" : undefined} key={station.id}>
                    <small>CAM {station.camera}</small><strong>{station.repository}</strong>
                    <Signal tone={station.tone} text={station.status} />
                  </Link>
                ))}
              </nav>
              <div className="factory-room-meta">
                <span>工位 {selected.camera}</span><span>{selected.repository}</span><span>{selected.task}</span><span>{selected.model}</span><span>DEMO DATA</span>
              </div>
              <Timeline station={selected} />
              <p className="factory-honesty"><ShieldCheck size={14} /> 没有可信观察时应显示“尚无可验证活动”；不能伪造模型读文件、改代码或心跳。</p>
            </>
          )}
        </div>
      ) : (
        <div className="factory-content">
          <div className="factory-section-title"><strong>一号车间 / 全部工位</strong><small>CCTV / SELECT A STATION</small></div>
          <div className="factory-grid">
            <div className="factory-station-list">
              {stations.map((station) => <StationCard key={station.id} station={station} active={station.id === selected.id} choose={() => setSelectedId(station.id)} />)}
            </div>
            <div className="factory-detail-side">
              <Timeline station={selected} />
              <Link className="factory-enter-room" to={"/factory/" + selected.id}>进入工位 {selected.camera} 直播间 <ArrowRight size={14} /></Link>
            </div>
          </div>
          <aside className="factory-ticker" aria-label="讽刺播报演示">
            <div>红色广播站 <small>CH 05</small></div>
            <p aria-live="polite">{selected.broadcast}</p>
          </aside>
        </div>
      )}
      <div className="factory-bottom">
        <span><Clock3 size={12} /> CTRL ROOM / INDUSTRIAL CHANNEL 05</span>
        <span><Check size={12} /> 演示数据 · 无实时 GitHub / Cloudflare 连接</span>
        <Link to="/engineering">Engineering <ExternalLink size={12} /></Link>
      </div>
    </section>
  );
}
