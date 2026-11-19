import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2,
  ChevronDown, Cloud, ExternalLink, GitBranch, Package, Search,
  Server, ShieldAlert, X,
} from "lucide-react";
import {
  cloudflareLabel, formatTime, shortSha,
  type DeploymentsPayload, type RepositoriesPayload, usePolling,
} from "./data";
import {
  buildLabel, buildState, filterFleet, summarizeFleet,
  type FleetFilter,
} from "./engineering-facts";
import type { OrganizationRepository } from "./shared";
import "./engineering-workshop.css";

const filters: { id: FleetFilter; text: string }[] = [
  { id: "all", text: "全部" },
  { id: "attention", text: "待关注" },
  { id: "running", text: "执行中" },
  { id: "archived", text: "已归档" },
];

function RepositoryRecord({ repo }: { repo: OrganizationRepository }) {
  const state = buildState(repo.latestWorkflow);
  return (
    <details className={"ew-record ew-" + state}>
      <summary>
        <span className="ew-record-signal" aria-hidden="true" />
        <span className="ew-record-main">
          <strong>{repo.name}</strong>
          <small>{repo.defaultBranch} · {repo.archived ? "已归档" : repo.fork ? "Fork" : "公开仓库"}{repo.language ? " · " + repo.language : ""}</small>
        </span>
        <span className={"ew-build-state ew-" + state}>{buildLabel(repo.latestWorkflow)}</span>
        <ChevronDown size={16} className="ew-chevron" aria-hidden="true"/>
      </summary>
      <div className="ew-record-detail">
        {repo.description && <p className="ew-repo-description">{repo.description}</p>}
        <dl>
          <div>
            <dt>默认分支 · 最新工作流</dt>
            <dd>{repo.latestWorkflow
              ? <><strong>{repo.latestWorkflow.name}</strong><span>{buildLabel(repo.latestWorkflow)} · {formatTime(repo.latestWorkflow.updatedAt)}</span></>
              : <span>当前未取得可用工作流记录</span>}
            </dd>
            {repo.latestWorkflow?.htmlUrl && <a href={repo.latestWorkflow.htmlUrl} target="_blank" rel="noreferrer">
              查看 GitHub Actions Run <ExternalLink size={12}/>
            </a>}
          </div>
          <div>
            <dt>最近 Release</dt>
            <dd>{repo.latestRelease
              ? <><strong>{repo.latestRelease.tagName}</strong><span>{repo.latestRelease.name ?? "已发布版本"} · {formatTime(repo.latestRelease.publishedAt)}</span></>
              : <span>未取得已发布 Release</span>}
            </dd>
            {repo.latestRelease?.htmlUrl && <a href={repo.latestRelease.htmlUrl} target="_blank" rel="noreferrer">
              查看 GitHub Release <ExternalLink size={12}/>
            </a>}
          </div>
          <div>
            <dt>仓库记录</dt>
            <dd><strong>{repo.archived ? "已归档" : "非归档"} · {repo.fork ? "Fork" : "原生仓库"}</strong>
              <span>最近 Push：{formatTime(repo.pushedAt)} · 最后更新：{formatTime(repo.updatedAt)}</span>
            </dd>
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer">进入 GitHub 仓库 <ExternalLink size={12}/></a>
          </div>
        </dl>
      </div>
    </details>
  );
}

function Deployments({ deployments, error }: { deployments: DeploymentsPayload | null; error: string | null }) {
  const known = Boolean(deployments && deployments.status !== "unconfigured");
  return (
    <section className="ew-delivery" id="engineering-deliveries" aria-labelledby="ew-deliveries-title">
      <div className="ew-section-head">
        <div><small>04 / EDGE DELIVERY LEDGER</small><h2 id="ew-deliveries-title">交付登记处</h2></div>
        <span>{cloudflareLabel(deployments?.status)}</span>
      </div>
      <p className="ew-section-context">仅展示已纳入 Mira 筛选范围的 Cloudflare Workers / Pages 最新记录；构建、部署记录并不等于真实业务验收。</p>
      {error && <p className="ew-warning" role="status">Cloudflare 交付读取失败：{error}。{deployments ? "展示上一次成功获取的记录。" : "无法确认当前部署状态。"}</p>}
      {!deployments && !error && <p className="ew-empty">正在读取 Cloudflare 交付记录…</p>}
      {deployments?.status === "degraded" && <p className="ew-warning">Cloudflare 来源部分可用，以下数量不是完整部署资产总数。</p>}
      {deployments?.status === "unconfigured" && <p className="ew-warning">Cloudflare 读取未配置；未知不等于没有部署。</p>}
      {known && (
        <div className="ew-deploy-cols">
          <div className="ew-deploy-group">
            <div className="ew-group-heading"><Server size={16}/><strong>Workers</strong><span>{deployments!.workers.length} 条</span></div>
            {deployments!.workers.map((worker) => (
              <details key={worker.name} className="ew-deploy-row">
                <summary>
                  <span className="ew-deploy-title"><strong>{worker.name}</strong>
                    <small>{worker.deployedAt ? "部署于 " + formatTime(worker.deployedAt) : worker.modifiedAt ? "脚本修改于 " + formatTime(worker.modifiedAt) : "无可核对时间"}</small>
                  </span>
                  <span className="ew-deploy-version">{shortSha(worker.versionId)}</span>
                  <ChevronDown size={15} aria-hidden="true"/>
                </summary>
                <dl className="ew-deploy-info">
                  <div><dt>Version ID</dt><dd>{worker.versionId ?? "未返回"}</dd></div>
                  <div><dt>Deployment ID</dt><dd>{worker.deploymentId ?? "未返回"}</dd></div>
                  <div><dt>触发来源</dt><dd>{worker.source ?? "未提供"}{worker.triggeredBy ? " · " + worker.triggeredBy : ""}</dd></div>
                  <div><dt>提交备注</dt><dd>{worker.message ?? "未提供"}</dd></div>
                </dl>
                <p className="ew-source-note">源数据：Cloudflare 公开只读投影；本记录无可验证的独立发布链接。</p>
              </details>
            ))}
            {!deployments!.workers.length && <p className="ew-empty">当前读取范围内没有 Workers 交付记录。</p>}
          </div>
          <div className="ew-deploy-group">
            <div className="ew-group-heading"><Package size={16}/><strong>Pages</strong><span>{deployments!.pages.length} 条</span></div>
            {deployments!.pages.map((page) => (
              <details key={page.name} className="ew-deploy-row">
                <summary>
                  <span className="ew-deploy-title"><strong>{page.name}</strong>
                    <small>{page.productionBranch ?? "生产分支未返回"} · {formatTime(page.deployedAt)}</small>
                  </span>
                  <span className="ew-deploy-version">{page.status ?? shortSha(page.commitHash)}</span>
                  <ChevronDown size={15} aria-hidden="true"/>
                </summary>
                <dl className="ew-deploy-info">
                  <div><dt>Deployment ID</dt><dd>{page.deploymentId ?? "未返回"}</dd></div>
                  <div><dt>Commit SHA</dt><dd>{page.commitHash ?? "未返回"}</dd></div>
                  <div><dt>当前阶段</dt><dd>{page.status ?? "未知"}</dd></div>
                  <div><dt>生产分支</dt><dd>{page.productionBranch ?? "未知"}</dd></div>
                </dl>
                {page.url && <a className="ew-source-link" href={page.url} target="_blank" rel="noreferrer">
                  查看 Pages 交付地址 <ExternalLink size={12}/>
                </a>}
              </details>
            ))}
            {!deployments!.pages.length && <p className="ew-empty">当前读取范围内没有 Pages 交付记录。</p>}
          </div>
        </div>
      )}
    </section>
  );
}

export default function Engineering() {
  const reposRead = usePolling<RepositoriesPayload>("/api/v1/repos", 60_000);
  const deployRead = usePolling<DeploymentsPayload>("/api/v1/deployments", 60_000);
  const repos = reposRead.data?.items ?? [];
  const deployments = deployRead.data;
  const stats = useMemo(() => summarizeFleet(repos), [repos]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FleetFilter>("all");
  const filtered = useMemo(() => filterFleet(repos, search, filter), [repos, search, filter]);
  const inProgress = useMemo(() => filterFleet(repos, "", "running"), [repos]);
  const failed = useMemo(() => filterFleet(repos, "", "attention"), [repos]);
  const sourcePartial = reposRead.error || deployRead.error ||
    reposRead.data?.status === "degraded" || deployments?.status === "degraded" ||
    deployments?.status === "unconfigured";
  const knownDeployments = Boolean(deployments && deployments.status !== "unconfigured");
  const releaseCount = reposRead.data ? stats.released : null;

  if (!reposRead.data && !deployments) {
    return (
      <section className="page-state">
        <GitBranch size={16} />
        <div><strong>{reposRead.error || deployRead.error ? "工程记录尚不可用" : "正在查阅工程档案"}</strong>
          <small>{reposRead.error ?? deployRead.error ?? "GitHub 仓库 / Cloudflare 交付记录加载中。没有使用假数据填充。"}</small>
        </div>
      </section>
    );
  }

  return (
    <div className="engineering-workshop">
      <section className="ew-brief" aria-label="工程车间来源">
        <div className="ew-topline"><span>01 / WORKSHOP REPORT</span><span>{formatTime(reposRead.data?.generatedAt ?? deployments?.generatedAt)}</span></div>
        <div className="ew-brief-main">
          <span className="ew-micro">反对盲目加班，支持有据可查。</span>
          <h2>每一次交付，都得留下工单。</h2>
          <p>先看构建的异常与在途工作，再翻仓库档案和 Cloudflare 交付登记。Run 成功只是 Run 成功，不代表产品已验收。</p>
        </div>
        <div className="ew-source-row">
          <span><GitBranch size={13}/> GitHub：{reposRead.data?.status ?? "未就绪"}</span>
          <span><Cloud size={13}/> Cloudflare：{cloudflareLabel(deployments?.status)}</span>
          <span>公共只读 · 无派工权限</span>
        </div>
      </section>

      {sourcePartial && (
        <p className="ew-warning" role="status">
          <ShieldAlert size={15} aria-hidden="true" />
          观测范围不完整。{reposRead.error ? "GitHub 读取错误：" + reposRead.error + "。" : ""}
          {deployRead.error ? "Cloudflare 读取错误：" + deployRead.error + "。" : ""}
          没有读取成功的项目不按零计算；旧快照不作为当前最新状态。
        </p>
      )}

      <section className="ew-line" aria-label="构建在途与异常">
        <div className="ew-section-head">
          <div><small>02 / PRODUCTION EXCEPTIONS</small><h2>在途与异常</h2></div>
          <span>最新默认分支 Run</span>
        </div>
        {!reposRead.data ? (
          <p className="ew-empty">GitHub 数据尚不可用，不能判定当前构建是否正常。</p>
        ) : failed.length + inProgress.length === 0 ? (
          <div className="ew-quiet"><CheckCircle2 size={18}/><span>最近默认分支记录里没有已知失败或在途构建。<small>这不代表所有 PR 和产品都已验收。</small></span></div>
        ) : (
          <div className="ew-alert-rows">
            {[...failed, ...inProgress].slice(0, 3).map((repo) => (
              <a href={repo.latestWorkflow?.htmlUrl ?? repo.htmlUrl} target="_blank" rel="noreferrer" key={repo.fullName}
                className={"ew-alert-row ew-" + buildState(repo.latestWorkflow)}>
                {buildState(repo.latestWorkflow) === "failed" ? <AlertTriangle size={16}/> : <Activity size={16}/>}
                <span><strong>{repo.name}</strong><small>{buildLabel(repo.latestWorkflow)} · {formatTime(repo.latestWorkflow?.updatedAt)}</small></span>
                <ExternalLink size={14}/>
              </a>
            ))}
            {failed.length + inProgress.length > 3 &&
              <div className="ew-more-note">另外 {failed.length + inProgress.length - 3} 条最近构建记录，请在仓库列表筛选查看。</div>}
          </div>
        )}
      </section>

      <section className="ew-overview-metrics" aria-label="工程资产快照">
        <div className="ew-metric">
          <span><GitBranch size={13}/> 公开仓库</span>
          <strong>{reposRead.data ? repos.length : "—"}</strong>
          <small>{reposRead.data ? stats.nonArchived + " 个非归档" : "来源不可用"}</small>
        </div>
        <div className="ew-metric">
          <span><Activity size={13}/> 最近构建通过</span>
          <strong>{reposRead.data ? stats.counts.passed : "—"}<em>/ {reposRead.data ? stats.withRuns : "—"}</em></strong>
          <small>{reposRead.data ? stats.counts.failed + " 失败 · " + stats.counts.action + " 待操作 · " + stats.counts.running + " 执行中" : "结果未知"}</small>
        </div>
        <div className="ew-metric">
          <span><Package size={13}/> 已发现 Release</span>
          <strong>{releaseCount ?? "—"}</strong>
          <small>有最近发布版本的仓库数</small>
        </div>
        <div className="ew-metric">
          <span><Cloud size={13}/> 边缘交付资产</span>
          <strong>{knownDeployments ? deployments!.workers.length + deployments!.pages.length : "—"}</strong>
          <small>{knownDeployments ? deployments!.workers.length + " Workers · " + deployments!.pages.length + " Pages" : "Cloudflare 来源不可用"}</small>
        </div>
      </section>

      <section className="ew-fleet" id="engineering-fleet" aria-labelledby="ew-fleet-title">
        <div className="ew-section-head">
          <div><small>03 / REPOSITORY ROSTER</small><h2 id="ew-fleet-title">仓库工位表</h2></div>
          <span>{reposRead.data ? filtered.length + " / " + repos.length : "等待来源"}</span>
        </div>
        <div className="ew-filterbar">
          <label className="ew-search">
            <Search size={16} aria-hidden="true"/>
            <input type="search" value={search} onChange={event => setSearch(event.target.value)}
              aria-label="搜索仓库名称、语言或分支" placeholder="搜索仓库、语言、分支"/>
            {search && <button type="button" onClick={() => setSearch("")} aria-label="清空搜索"><X size={15}/></button>}
          </label>
          <div className="ew-filters" role="group" aria-label="筛选仓库工位">
            {filters.map(item => (
              <button type="button" key={item.id} aria-pressed={filter === item.id}
                className={filter === item.id ? "selected" : ""} onClick={() => setFilter(item.id)}>
                {item.text}{item.id === "attention" && reposRead.data ? " " + (stats.counts.failed + stats.counts.action) :
                  item.id === "running" && reposRead.data ? " " + stats.counts.running : ""}
              </button>
            ))}
          </div>
        </div>
        {reposRead.error && <p className="ew-warning">GitHub 仓库刷新失败：{reposRead.error}。{reposRead.data ? "以下是上次成功取得的记录。" : "未取得有效记录。"}</p>}
        {reposRead.data ? (
          filtered.length ? (
            <div className="ew-repository-list">
              {filtered.map(repo => <RepositoryRecord key={repo.fullName} repo={repo}/>)}
            </div>
          ) : (
            <p className="ew-empty">在已读取的 {repos.length} 个仓库中，没有符合条件的记录。可以清空筛选后查看全量。</p>
          )
        ) : <p className="ew-empty">仓库来源未就绪，不以空清单冒充没有工程任务。</p>}
        <p className="ew-inventory-note">点开工位可查看默认分支、最新构建与 GitHub 原始 Run、Release 标签及链接、最近 Push 与仓库状态。源系统是 GitHub，不在这里复制工作账本。</p>
      </section>

      <Deployments deployments={deployments} error={deployRead.error} />

      <aside className="ew-editorial" aria-label="厂纪公报，非运行事实">
        <div><span>EDITORIAL / BROADCAST 04</span><strong>厂纪公报</strong></div>
        <p>“仓库可以一天提交八次。<br/>但‘我以为已经部署了’，只能说一次。”</p>
        <small>黑色幽默是编辑文案，工程事实以 GitHub / Cloudflare 原始记录为准。</small>
      </aside>
      <p className="ew-provenance">
        <ShieldAlert size={14} aria-hidden="true" />
        工程数据按公共只读 API 约 60 秒轮询，Cloudflare 资产按 Mira 筛选范围提供最新快照；
        既不自动查询 Workers Observability，也不宣称生产链路验收完成。
      </p>
    </div>
  );
}
