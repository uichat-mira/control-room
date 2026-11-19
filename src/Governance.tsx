import { useMemo, useState } from "react";
import {
  Activity, ArrowRight, ChevronDown, CircleAlert, ExternalLink,
  GitBranch, GitPullRequest, ListTodo, Search, ShieldAlert,
  ShieldCheck, X,
} from "lucide-react";
import { formatTime, type GovernancePayload, type GovernanceRepository, usePolling } from "./data";
import {
  filterGovernance, governanceSourcePartial, requiresPolicyReview,
  summarizeGovernance, type GovernanceFilter,
} from "./governance-facts";
import "./governance-department.css";

const filters: { key: GovernanceFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "activity", label: "有事项" },
  { key: "review", label: "待核查" },
  { key: "unknown", label: "数据缺失" },
];

function count(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : String(n);
}

function PolicyRecord({ repo }: { repo: GovernanceRepository }) {
  const policy = repo.governance;
  const protection = policy.defaultBranchProtected;
  return (
    <details className={"gc-repo " + (requiresPolicyReview(repo) ? "gc-review" : "gc-other")}>
      <summary>
        <span className="gc-record-signal" aria-hidden="true" />
        <span className="gc-repo-title">
          <strong>{repo.name}</strong>
          <small>{repo.defaultBranch} · {policy.openIssues === null ? "Issues 未知" : policy.openIssues + " Issues"} · {policy.openPullRequests === null ? "PR 未知" : policy.openPullRequests + " PR"}</small>
        </span>
        <span className={"gc-policy-label " + (protection === true ? "ok" : protection === false ? "review" : "unknown")}>
          {protection === true ? "已保护" : protection === false ? "未报告保护" : "未知"}
        </span>
        <ChevronDown size={16} aria-hidden="true"/>
      </summary>
      <div className="gc-repo-detail">
        <dl>
          <div><dt>开放 Issues</dt><dd>{count(policy.openIssues)}</dd></div>
          <div><dt>开放 Pull Requests</dt><dd>{count(policy.openPullRequests)}</dd></div>
          <div><dt>默认分支保护</dt><dd>{protection === true ? "已报告保护" : protection === false ? "未报告保护 · 需按仓库契约核查" : "未取得"}</dd></div>
          <div><dt>活动 Rulesets</dt><dd>{count(policy.activeRulesets)}</dd></div>
          <div><dt>读取覆盖</dt><dd>{policy.status === "partial" ? "部分数据可读" : "读取已连接"}</dd></div>
        </dl>
        <div className="gc-repo-links">
          <a href={repo.htmlUrl} target="_blank" rel="noreferrer">GitHub 仓库 <ExternalLink size={12}/></a>
          <a href={repo.htmlUrl + "/issues"} target="_blank" rel="noreferrer">Issues 原始列表 <ExternalLink size={12}/></a>
          <a href={repo.htmlUrl + "/pulls"} target="_blank" rel="noreferrer">PR 原始列表 <ExternalLink size={12}/></a>
        </div>
      </div>
    </details>
  );
}

export default function Governance() {
  const read = usePolling<GovernancePayload>("/api/v1/governance", 5 * 60_000);
  const data = read.data;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<GovernanceFilter>("all");

  const rows = data?.repositories ?? [];
  const totals = useMemo(() => summarizeGovernance(data?.repositories ?? null), [data]);
  const filtered = useMemo(() => filterGovernance(rows, search, filter), [rows, search, filter]);
  const missing = governanceSourcePartial(data, read.error);
  const projects = data?.github.projects;
  const projectsReady = projects?.status === "connected";

  if (!data) {
    return (
      <section className="page-state" role="status">
        <ShieldCheck size={16}/>
        <div><strong>{read.error ? "监察记录暂时无法读取" : "正在获取真实治理记录"}</strong>
          <small>{read.error ?? "GitHub Issues、PR、分支规则与组织 Project 正在读取中。"}</small>
        </div>
      </section>
    );
  }

  return (
    <section className="governance-department" aria-label="监察委员会公共治理记录">
      <section className={"gc-brief " + (missing ? "partial" : "connected")}>
        <div className="gc-topline"><span>01 / GOVERNANCE DESK</span><span>采集 {formatTime(data.generatedAt)}</span></div>
        <div className="gc-brief-body">
          <small>PUBLIC READ / EVIDENCE FIRST</small>
          <h2>{missing ? "治理记录有观测缺口" : "本厂只承认有出处的记录"}</h2>
          <p>统计公开仓库的 Issue、PR 和分支治理观察结果。未报告保护不自动构成违规；规则适用与否应依据仓库契约判断。</p>
        </div>
        <div className="gc-sources">
          <span><ShieldCheck size={13}/> GitHub {data.github.governanceStatus}</span>
          <span><GitPullRequest size={13}/> 凭据 {data.github.authenticated ? "已连接" : "未认证"}</span>
          <span><ListTodo size={13}/> Projects {projects?.status ?? "未就绪"}</span>
        </div>
      </section>

      {(missing || data.error) && (
        <div className="gc-notice" role="status">
          <ShieldAlert size={16}/>
          <span>{read.error ? "刷新失败，当前展示先前成功获取的记录；" : ""}
            {data.error ?? (missing ? "部分仓库或 Projects 的治理结果不可用，未知数量不可视作零。" : "治理源状态请以 GitHub 为准。")}
          </span>
        </div>
      )}

      <section className="gc-attention" aria-labelledby="gc-attention-title">
        <div className="gc-heading"><div><small>02 / REVIEW DESK</small><h2 id="gc-attention-title">需要核查</h2></div>
          <span>{totals ? totals.unprotected + " 条保护观察" : "未知"}</span>
        </div>
        <div className="gc-attention-copy">
          <CircleAlert size={17}/>
          <div>
            <strong>{totals?.unprotected ? totals.unprotected + " 个仓库默认分支未报告保护" : "当前没有已知待核查保护记录"}</strong>
            <p>这是 GitHub 读取事实，不是安全事故、违规结论或整改工单。公开权限不完整时也不能推断规则缺失。</p>
          </div>
        </div>
        <button type="button" className="gc-action" onClick={() => {setFilter("review");document.getElementById("gc-repository-list")?.scrollIntoView({block:"start",behavior:"smooth"});}}>
          查看待核查仓库 <ArrowRight size={14}/>
        </button>
      </section>

      <section className="gc-metrics" aria-label="治理统计口径">
        <div className="gc-metric">
          <span><ListTodo size={13}/> Open Issues</span>
          <strong>{count(totals?.issues)}</strong>
          <small>{totals?.issuesKnown ?? "—"} / {totals?.repositories ?? "—"} 个仓库有已读数量</small>
        </div>
        <div className="gc-metric">
          <span><GitPullRequest size={13}/> Open PR</span>
          <strong>{count(totals?.prs)}</strong>
          <small>{totals?.prsKnown ?? "—"} / {totals?.repositories ?? "—"} 个仓库有已读数量</small>
        </div>
        <div className="gc-metric">
          <span><ShieldCheck size={13}/> 默认分支已保护</span>
          <strong>{totals?.protectionKnown ? totals.protected : "—"}<em>/ {totals?.protectionKnown || "—"}</em></strong>
          <small>{totals?.protectionUnknown ?? "—"} 条未知 · 不等于合规率</small>
        </div>
        <div className="gc-metric">
          <span><GitBranch size={13}/> 活跃 Rulesets</span>
          <strong>{count(totals?.rulesets)}</strong>
          <small>{totals?.rulesetsKnown ?? "—"} / {totals?.repositories ?? "—"} 个仓库有已读数量</small>
        </div>
      </section>

      <section className="gc-repositories" id="gc-repository-list" aria-labelledby="gc-repos-title">
        <div className="gc-heading"><div><small>03 / REPOSITORY AUDIT</small><h2 id="gc-repos-title">仓库档案</h2></div>
          <span>{filtered.length} / {rows.length} 条</span>
        </div>
        <p className="gc-section-copy">点击仓库展开 Issues、PR 数量、默认分支保护、Rulesets 和原始 GitHub 入口。未读取完整 Issue/PR 正文，不提供虚构的任务详情。</p>
        <div className="gc-filterbar">
          <label className="gc-search"><Search size={16} aria-hidden="true"/>
            <input type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索仓库或分支" aria-label="搜索仓库或分支"/>
            {search && <button type="button" onClick={() => setSearch("")} aria-label="清空搜索"><X size={15}/></button>}
          </label>
          <div className="gc-filters" role="group" aria-label="筛选治理记录">
            {filters.map(item => <button key={item.key} type="button" aria-pressed={filter === item.key}
              className={filter === item.key ? "selected" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}
          </div>
        </div>
        {filtered.length ? <div className="gc-repo-list">
          {filtered.map(repo => <PolicyRecord repo={repo} key={repo.fullName}/>)}
        </div> : <div className="gc-empty">
          {rows.length ? "当前读取范围内没有匹配项，清空搜索或筛选可查看全部。" : "数据源尚未提供仓库记录；不代表全组织没有仓库。"}
        </div>}
      </section>

      <section className="gc-projects" aria-labelledby="gc-projects-title">
        <div className="gc-heading"><div><small>04 / PROJECT REGISTER</small><h2 id="gc-projects-title">组织 Projects</h2></div>
          <span>{projectsReady ? projects!.items.length + " 个公开项目" : "来源不可用"}</span>
        </div>
        <p className="gc-section-copy">Public Projects 是组织工作视图；Issues 和 PR 的原始记录仍由各仓库 GitHub 保存。</p>
        {projectsReady ? (projects!.items.length ? <div className="gc-project-list">
          {projects!.items.map(project => <a key={project.number} href={project.url} target="_blank" rel="noreferrer" className="gc-project">
            <span className="gc-project-state">{project.closed ? "已关闭" : "活跃"}</span>
            <span className="gc-project-title">
              <strong>{project.title}</strong>
              <small>{project.shortDescription || "Project #" + project.number} · {project.itemCount} 项 · 更新 {formatTime(project.updatedAt)}</small>
            </span>
            <ExternalLink size={15} aria-label="GitHub Project"/>
          </a>)}
        </div> : <p className="gc-empty">公开来源未发现组织 Project。</p>)
          : <p className="gc-empty">Public Projects 尚不可读：{projects?.error ?? "未返回有效数据"}。不据此认定没有项目。</p>}
      </section>

      <aside className="gc-editorial" aria-label="监察公报，为讽刺文字而非事实结论">
        <div><span>05 / EDITORIAL</span><strong>监察公报</strong></div>
        <p>本委员会不审查忠诚。<br/>只审查有没有原始证据。</p>
        <small>反讽文案不构成政策要求、合规判定或生产事件。</small>
      </aside>
      <p className="gc-provenance"><ShieldAlert size={13} aria-hidden="true"/>
        本页只读取公开安全投影 /api/v1/governance，约每 5 分钟刷新。缺失数据保持未知；不直接修改 GitHub、分支规则或 Project 状态。
      </p>
    </section>
  );
}
