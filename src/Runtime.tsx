import { useMemo } from "react";
import { TuiLoading } from "./TuiLoading";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, Cloud,
  ExternalLink, Package, Radio, Server, ShieldAlert,
} from "lucide-react";
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  cloudflareLabel, formatCount, formatTime, shortSha,
  type AnalyticsPayload, type DeploymentsPayload, type ServicesPayload, usePolling,
} from "./data";
import {
  analyticsCoverage, orderServices, summarizeProbes, workerTrafficRows,
} from "./runtime-facts";
import "./runtime-department.css";

export default function Runtime() {
  const servicesRead = usePolling<ServicesPayload>("/api/v1/services", 60_000);
  const analyticsRead = usePolling<AnalyticsPayload>("/api/v1/analytics", 60_000);
  const deployRead = usePolling<DeploymentsPayload>("/api/v1/deployments", 60_000);

  const services = servicesRead.data?.items ?? null;
  const analytics = analyticsRead.data?.status === "connected" ? analyticsRead.data : null;
  const deployments = deployRead.data;
  const probes = useMemo(() => summarizeProbes(services), [services]);
  const orderedServices = useMemo(() => orderServices(services ?? []), [services]);
  const risks = useMemo(() => orderedServices.filter(s => s.status !== "online"), [orderedServices]);
  const trafficRows = useMemo(() => workerTrafficRows(analytics?.workers ?? []), [analytics]);
  const trafficByWorker = useMemo(() =>
    new Map((analytics?.workers ?? []).map(w => [w.name, w])), [analytics]);
  const coverage = analyticsCoverage(analytics?.workers ?? null);
  const deploysKnown = deployments?.status !== "unconfigured" && Boolean(deployments);
  const generatedAt = servicesRead.data?.generatedAt ?? analyticsRead.data?.generatedAt ?? deployments?.generatedAt;
  const sourceErrors = [
    servicesRead.error ? "服务探针刷新失败；当前可能是上次成功快照。" : null,
    analyticsRead.error ? "24 小时流量读取失败；当前可能是上次成功快照。" : null,
    deployRead.error ? "Cloudflare 资产读取失败；当前可能是上次成功快照。" : null,
    servicesRead.data?.status === "degraded" ? "服务探针来源部分可用。" : null,
    deployments?.status === "degraded" ? "Cloudflare 部署资产来源不完整。" : null,
    deployments?.status === "unconfigured" ? "Cloudflare 资产读取未配置。" : null,
    analyticsRead.data?.status === "unavailable" ? "24 小时 Analytics 不可用：" + (analyticsRead.data.error ?? "未提供原因") : null,
    coverage === "truncated" ? "Workers 流量查询达到采样行数上限；统计可能不完整，不代表全量流量。" : null,
  ].filter((x): x is string => Boolean(x));

  if (!services && !analyticsRead.data && !deployments) {
    return <section className="page-state">
      {sourceErrors.length ? (
        <div role="status"><strong>运行数据暂时无法读取</strong>
          <small>{sourceErrors.join(" ")}</small></div>
      ) : (
        <TuiLoading
          title="正在采集设备科数据"
          detail="服务探针、Workers / Pages 与 24 小时流量来源核对中"
          command="RUNTIME / SCAN"
        />
      )}
    </section>;
  }

  const currentMessage = !probes ? "服务探针尚未就绪"
    : risks.some(s => s.status === "offline") ? "发现 " + probes!.offline + " 项探针离线"
    : probes!.degraded ? "发现 " + probes!.degraded + " 项探针异常"
    : probes!.total === 0 ? "没有已配置的服务探针"
    : "已检查的探针暂无异常";
  const noKnownRisk = probes?.total !== 0 && risks.length === 0;

  return (
    <div className="runtime-department">
      <section className={"rd-brief " + (risks.length ? "rd-alert" : "rd-normal")} aria-label="设备科工况简报">
        <div className="rd-topline"><span>01 / DEVICE DESK</span><span>采集 {formatTime(generatedAt)}</span></div>
        <div className="rd-brief-body">
          <small>RUNTIME · OBSERVATION ONLY</small>
          <h2>{currentMessage}</h2>
          <p>这里报告最新 HTTP 探针、已发现的边缘部署和过去 24 小时流量。探针有响应，不等于业务链路全部正常。</p>
        </div>
        <div className="rd-source-row">
          <span><Radio size={13}/> 探针 {servicesRead.data?.status ?? "未就绪"}</span>
          <span><Cloud size={13}/> Cloudflare {cloudflareLabel(deployments?.status)}</span>
          <span><Activity size={13}/> Analytics {analyticsRead.data?.status ?? "未就绪"}</span>
        </div>
      </section>

      {sourceErrors.length > 0 && <div className="rd-source-warning" role="status">
        <ShieldAlert size={16} aria-hidden="true" />
        <div>{sourceErrors.map(msg => <p key={msg}>{msg}</p>)}</div>
      </div>}

      <section className="rd-exceptions" aria-labelledby="rd-exceptions-title">
        <div className="rd-heading">
          <div><small>02 / EXCEPTION REGISTER</small><h2 id="rd-exceptions-title">值班异常</h2></div>
          <span>{probes ? risks.length + " / " + probes.total + " 项" : "来源未知"}</span>
        </div>
        {!services ? <p className="rd-empty">尚未读取服务探针，不能断言全厂正常。</p>
          : risks.length ? <div className="rd-risk-list">
            {risks.map(service => (
              <a key={service.id} className={"rd-risk-row " + service.status}
                href={service.url} target="_blank" rel="noreferrer">
                <AlertTriangle size={16} aria-hidden="true"/>
                <span><strong>{service.label}</strong><small>{service.detail} · {service.httpStatus !== null ? "HTTP " + service.httpStatus : "无 HTTP 状态码"}</small></span>
                <span className="rd-flag">{service.status === "offline" ? "离线" : "异常"}</span>
                <ExternalLink size={13} aria-label="打开原始服务地址" />
              </a>
            ))}
          </div> : <div className="rd-no-risk">
            {noKnownRisk && <CheckCircle2 size={19} aria-hidden="true"/>}
            <span>{probes?.total === 0 ? "当前无探针覆盖，不能判断服务健康。" :
              "已读取的探针未报告异常；不代表完整服务验收。"}</span>
          </div>}
      </section>

      <section className="rd-metrics" aria-label="设备与流量快照">
        <div className="rd-metric"><span><Radio size={13}/> 探针在线</span>
          <strong>{probes ? probes.online : "—"}<em>/ {probes ? probes.total : "—"}</em></strong>
          <small>{probes ? probes.degraded + " 异常 · " + probes.offline + " 离线" : "未取得快照"}</small>
        </div>
        <div className="rd-metric"><span><Server size={13}/> Workers</span>
          <strong>{deploysKnown ? deployments!.workers.length : "—"}</strong>
          <small>{deploysKnown ? "筛选范围内最新资产" : "资产来源不可用"}</small>
        </div>
        <div className="rd-metric"><span><Package size={13}/> Pages</span>
          <strong>{deploysKnown ? deployments!.pages.length : "—"}</strong>
          <small>{deploysKnown ? "筛选范围内最新项目" : "资产来源不可用"}</small>
        </div>
        <div className="rd-metric"><span><Activity size={13}/> 24h 请求</span>
          <strong>{analytics ? formatCount(analytics.requests) : "—"}</strong>
          <small>{analytics ? formatCount(analytics.errors) + " 错误 · " + analytics.errorRate.toFixed(3) + "%" : "Analytics 不可用"}</small>
        </div>
      </section>

      <section className="rd-service-roster" aria-labelledby="rd-service-title">
        <div className="rd-heading"><div><small>03 / SERVICE PROBES</small><h2 id="rd-service-title">服务探针</h2></div>
          <span>{probes ? probes.total + " 条记录" : "未知"}</span>
        </div>
        <p className="rd-section-description">按离线、异常、在线排序。状态来自最近一次 HTTP 探针采样；响应时间不是持续运行时长。</p>
        {servicesRead.error && <p className="rd-inline-warning">{servicesRead.error}</p>}
        {services ? (orderedServices.length ? <div className="rd-service-list">
          {orderedServices.map(service => <details key={service.id} className={"rd-service " + service.status}>
            <summary>
              <span className="rd-dot" aria-hidden="true"/>
              <span className="rd-service-name"><strong>{service.label}</strong><small>{service.detail}</small></span>
              <span className="rd-service-latency">{service.latencyMs !== null ? service.latencyMs + " ms" : service.status === "offline" ? "离线" : "无延迟数据"}</span>
              <ChevronDown size={15} aria-hidden="true"/>
            </summary>
            <div className="rd-service-detail">
              <span>HTTP 状态码：{service.httpStatus ?? "未取得"}</span>
              <span>探针状态：{service.status}</span>
              <a href={service.url} target="_blank" rel="noreferrer">打开服务地址 <ExternalLink size={12}/></a>
            </div>
          </details>)}
        </div> : <p className="rd-empty">有效快照里没有服务探针记录。</p>) :
          <p className="rd-empty">服务探针来源未就绪，不以空表冒充全部在线。</p>}
      </section>

      <section className="rd-traffic" aria-labelledby="rd-traffic-title">
        <div className="rd-heading"><div><small>04 / EDGE TRAFFIC · 24H</small><h2 id="rd-traffic-title">边缘流量</h2></div>
          <span>{analytics ? "已观测" : "无可用统计"}</span>
        </div>
        <p className="rd-section-description">查询区间：{analytics ? formatTime(analytics.from) + " — " + formatTime(analytics.to) : "未知"}。按 Worker 统计请求数；不能当作 HTTP 服务可用率。</p>
        {analytics ? <>
          <div className="rd-traffic-facts">
            <div><small>请求数</small><strong>{formatCount(analytics.requests)}</strong></div>
            <div><small>错误数</small><strong>{formatCount(analytics.errors)}</strong></div>
            <div><small>错误率</small><strong>{analytics.errorRate.toFixed(3)}%</strong></div>
          </div>
          {coverage === "truncated" && <p className="rd-inline-warning">部分 Worker 查询命中行数上限，统计可能不完整，不能据此推断完整请求总数。</p>}
          {trafficRows.length ? <>
            <div className="rd-chart" aria-label="过去 24 小时 Worker 请求量分布图">
              <ResponsiveContainer width="100%" height={Math.max(160, trafficRows.length * 38)}>
                <BarChart data={trafficRows} layout="vertical" margin={{top:6,right:12,bottom:6,left:2}}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={102} tickLine={false} axisLine={false}
                    tick={{fill:"var(--text-soft)",fontSize:10}}/>
                  <Tooltip cursor={{fill:"var(--surface-soft)"}}
                    contentStyle={{background:"var(--surface)",color:"var(--text)",border:"1px solid var(--line)",borderRadius:2,fontSize:11}}
                    formatter={(value: unknown)=>[formatCount(Number(value)),"请求数"]}/>
                  <Bar dataKey="requests" fill="var(--accent)" radius={[0,2,2,0]} barSize={9}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details className="rd-traffic-ledger"><summary>查看逐 Worker 流量明细 <ChevronDown size={15}/></summary>
              <div>
                {trafficRows.map(row => <div className="rd-traffic-row" key={row.fullName}>
                  <strong>{row.fullName}</strong>
                  <span>{formatCount(row.requests)} 请求 · {formatCount(row.errors)} 错误{row.truncated ? " · 数据截断" : ""}</span>
                </div>)}
              </div>
            </details>
          </> : <p className="rd-empty">本次已取得的统计中没有非零请求 Worker；不代表未覆盖的服务没有流量。</p>}
        </> : <p className="rd-empty">24 小时 Workers Analytics 不可用，暂不显示请求数、错误率或猜测趋势。{analyticsRead.data?.error ?? analyticsRead.error ?? ""}</p>}
      </section>

      <section className="rd-assets" aria-labelledby="rd-assets-title">
        <div className="rd-heading"><div><small>05 / EDGE ASSETS</small><h2 id="rd-assets-title">边缘设备登记</h2></div>
          <span>{deploysKnown ? (deployments!.workers.length + deployments!.pages.length) + " 条" : "来源未知"}</span>
        </div>
        <p className="rd-section-description">Cloudflare 最新部署资产与版本信息。这里不展示未经证实的可用性、发布成功或性能 SLA。</p>
        {!deploysKnown ? <p className="rd-empty">Cloudflare 部署清单不可读，不能判定是否存在 Workers 或 Pages。</p> : <div className="rd-asset-columns">
          <div className="rd-asset-group">
            <div className="rd-group-head"><Server size={15}/><strong>Workers</strong><span>{deployments!.workers.length}</span></div>
            {deployments!.workers.map(worker => {
              const traffic = trafficByWorker.get(worker.name);
              return <details className="rd-asset" key={worker.name}>
                <summary><span className="rd-asset-name"><strong>{worker.name}</strong><small>{formatTime(worker.deployedAt ?? worker.modifiedAt)} · {traffic ? formatCount(traffic.requests) + " 请求/24h" : "流量未取得"}</small></span>
                  <span className="rd-version">{shortSha(worker.versionId)}</span><ChevronDown size={15}/></summary>
                <div className="rd-asset-detail">
                  <span>Version ID：{worker.versionId ?? "未提供"}</span>
                  <span>Deployment ID：{worker.deploymentId ?? "未提供"}</span>
                  <span>部署来源：{worker.source ?? "未提供"}</span>
                  <span>触发者：{worker.triggeredBy ?? "未提供"}</span>
                  <span>备注：{worker.message ?? "未提供"}</span>
                </div>
              </details>;
            })}
            {!deployments!.workers.length && <p className="rd-empty">当前筛选范围内无 Worker 记录。</p>}
          </div>
          <div className="rd-asset-group">
            <div className="rd-group-head"><Package size={15}/><strong>Pages</strong><span>{deployments!.pages.length}</span></div>
            {deployments!.pages.map(page => <details className="rd-asset" key={page.name}>
              <summary><span className="rd-asset-name"><strong>{page.name}</strong><small>{page.productionBranch ?? "生产分支未知"} · {formatTime(page.deployedAt)}</small></span>
                <span className="rd-version">{page.status ?? shortSha(page.commitHash)}</span><ChevronDown size={15}/></summary>
              <div className="rd-asset-detail">
                <span>Deployment ID：{page.deploymentId ?? "未提供"}</span>
                <span>Commit SHA：{page.commitHash ?? "未提供"}</span>
                <span>阶段状态：{page.status ?? "未知"}</span>
                {page.url && <a href={page.url} target="_blank" rel="noreferrer">查看 Pages 地址 <ExternalLink size={12}/></a>}
              </div>
            </details>)}
            {!deployments!.pages.length && <p className="rd-empty">当前筛选范围内无 Pages 记录。</p>}
          </div>
        </div>}
      </section>

      <aside className="rd-editorial" aria-label="编辑公报，与运行事实无关">
        <div><span>06 / BULLETIN</span><strong>设备科通告</strong></div>
        <p>机器允许休息。<br/>监控不许撒谎。</p>
        <small>本段为反讽文案，并非生产状态判断或异常告警。</small>
      </aside>
      <p className="rd-provenance"><ShieldAlert size={13}/>
        仅调用公开只读 /services、/analytics、/deployments 快照（约每分钟刷新）。
        本页不调用 Workers Observability Logs；部分来源缺失时保持未知，不编造生产事故或服务在线。
      </p>
    </div>
  );
}
