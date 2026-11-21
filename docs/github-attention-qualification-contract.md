# GitHub「需要关注」资格、解除与查询预算（原始设计基线）

> Status: Historical design baseline (2026-11-20); current implementation follows the source and task contracts.
>
> Date: 2026-11-20 · Owner: uichat-mira/control-room
>
> 本文是可审查的产品/技术设计候选，不是新 GitHub Issue、组织政策或已经生效的监控。此次只提交文档，不修改运行代码、创建任务卡、发送通知或发布生产。

## 2026-11-21 实施状态说明

以下“未实施 / 仅设计”等措辞记录起草当日的历史情况，不是当前产品状态。

- OPS-034～037 已在生产，事实契约分别由 docs/github-attention-facts.md、docs/github-attention-gate-status.md、docs/github-attention-pr-status.md、docs/github-attention-worker-status.md 和对应源码负责。
- OPS-038 由 Issue #109 定义交付和验收；当前开发候选由 src/attention-center.ts 复用原有资格；首页 src/Overview.tsx 仅显示部门／专用控制台入口和有界仪表；详细关注记录与按需 PR／Worker 核验迁至 src/AttentionDeskPage.tsx 的 /attention。四类「需要关注 / 正在推进 / 历史观察 / 数据不足」留在证据详情页，避免首页成为九章长报表。
- 当前仍有边界：必要 GitHub required checks 无可信全面读取；非 Draft Hold 不能自动取证；Worker 当前性由有界 Recovery Pointer 支撑；六仓库 Facts 是每小时缓存、PR 每仓库最多 5 项、Factory Feed 最近最多 12 项。未核验及试点外事项绝不当作已恢复或“0 风险”。
- 此处标注的 OPS-038 实施状态仅指开发候选；合并、验收和生产发布须另以 PR/CI/运行事实确认。

## 一、目标与当前事实

「需要关注」只回答：**谁出了什么问题？为什么现在需要人介入？自动化做到了哪一步？下一步该查看什么证据？**

当前生产/开发代码证据（以实际代码为准）：

- src/github.ts 的 latestWorkflow 每仓库只拉默认分支最后一个 GitHub Actions Run（branch + per_page=1）。该 Run 可能是 CI、部署或 issue_comment 触发且 skipped 的 Worker；不能代表「最后一次必要 CI」。
- src/overview-facts.ts 的 collectAttention 将 HTTP 探针非在线、默认分支最后 Run 失败和无报告的分支保护统一计入关注，缺乏必要性、恢复和任务上下文。无保护配置观察不自动构成违规。
- src/worker.ts 的 buildFailed 会使旧失败或 action_required 影响组织汇总 degraded；「汇总降级」本身不能证明生产服务故障。
- src/factory-feed.ts 发现源仅扫描当前公开仓库中的最多 24 个候选、每仓库最近最多 20 Run、14 天窗口，并且最多向 UI 显示 12 条；它是 Factory TV 近期观察源，不能代表全组织全部未结工作。
- src/factory-read-model.ts 已读 GitHub Run / Jobs / Artifacts / PR 及可信 Reporter 事件，具备 repairing / blocked / escalated / delivered / observation_gap / artifact_unavailable 等状态。Reporter 有独立时效和缺失风险，GitHub Run success **不是** Candidate 验证、PR 交付或产品验收。
- Control Room 是公开可访问的只读投影，不是第二份 GitHub Issue、PR、Project、部署状态台账。

依据：仓库 README.md、docs/factory-tv-real-read-model.md、docs/environment.md；组织 main 当前 AGENTS.md（policy 2026-09-16.2）。OPS-032 #77 的生命周期验收范围保持独立。

## 二、关注资格：四层，不是四种颜色的流水账

| 层级 | 必要条件 | 是否计入首页人工待处理 |
| --- | --- | --- |
| **需要关注** | 当前目标仍有效；有可证实阻塞或人工决策；自动化不能继续或明确由维护者接手 | 是 |
| **正在推进** | 在自动构建、修复、验证或交付；尚未超过适用合同的边界 | 否 |
| **观察记录** | 有真实记录但不足以证明需要介入，如正常 Draft、历史 CI 失败、成功/跳过 Run、治理配置观察 | 否 |
| **数据/权限缺口** | 证据不完整、数据源失联、缓存过期或读权限不足 | 不能当成故障；仅在证实关键监控持续失明且影响决策时独立提报 |

**不允许的推断**：工作流失败即生产宕机；GitHub Run 成功即产品验收；PR 挂着未合并即阻塞；未配置分支保护即违反政策；Reporter 过期即 Worker 失败；API 没返回即零风险。

同一根因的 Issue、PR、Run、Job、Artifact 应归并为**同一主关注项**，并保留多条证据，不制造多份待办。

## 三、三项首期监控：入选、恢复、排除条件

### A. Actions 必要检查与生产发布

**观察目标**：仓库、有效目标分支、适用 Workflow 身份（ID/path）、当前 head SHA、Run ID/attempt、真正必要的 Checks/Gate、发布目标 SHA 和生产部署/冒烟事实。

**入选需要关注**
1. 当前有效的 PR、发布或任务被**已确认为必要**的检查阻塞，而且没有尚在自动处理的有效恢复。
2. 已完成的生产发布候选出现确定的部署失败或部署后目标 SHA 与真实生产 SHA 不符，且相应无副作用冒烟可核查；生产影响程度单独判断。
3. 需要人提供权限、批准或决策时，有明确的 GitHub/合同证据指向责任人。

**保持正在推进**
- 同目标的检查 queued / in_progress；自动 rerun、回滚或补救正在有效执行。
- 普通第一次失败可以留在工程车间；只有达到适用的阻塞条件才升级为人工事项。
- 超时阈值必须来自仓库拥有的验证/发布合同或实测后明确选定，**不得全组织随意固定一个时长**。

**自动解除**
- 当前有效 SHA/attempt 的必要 Gate 已通过，阻塞已消失。
- 生产部署的目标 SHA 与实际 Worker/应用报告一致且针对该版本的冒烟通过。
- 目标 Issue/PR 在真实 GitHub 上合法完成、关闭或取消，已不再待处理。
- **不可以用另一个不相关的 Workflow success 清除原故障。**

**排除**
- issue_comment 触发的 skipped Worker、neutral/cancelled、非必要 CI、旧 SHA 的失败、未验证适用的 Gate、来源过期、明确有意暂停的发布/工作项。
- 没有可靠规则解释 required checks 时显示「必要 Gate 未知」，不猜测阻塞。Mira Gate 是组织建议的汇总命名，不能仅凭名称就认定实际配置正确。

### B. PR 合并阻塞

**观察目标**：公开 PR number、draft、base ref、head SHA、有效 Reviews、合并能力、适用必要检查、关联 Issue 当前合同。

**入选需要关注**
- 当前有效交付已经需要继续，但 latest HEAD 上的有效 CHANGES_REQUESTED、真实 merge conflict 或必要 Check 失败阻塞下一步。
- 必须同时有明确的维护者可执行动作；否则只作为「审查/交付状态」记录。

**保持正在推进或暂缓**
- Draft、正在修改的 PR、Review Pending、明确 batch hold 或等待配套消费者 PR 不自动告警。
- mergeable=null 表示计算或证据未齐，不可当成确定冲突。
- 不根据 PR 创建时间或未合并天数直接决定人工待办。

**自动解除**
- 当前 HEAD 的阻塞被真实新提交、有效 Review/Checks 结果或合并能力变化消除。
- PR 已合并、按合同关闭/declined，或者目标工作已不再需要推进。
- 旧版 CHANGES_REQUESTED 在新版代码上是否仍有效必须重算，不能永久引用老审查。

**历史例证（只作测试样本，正式实施应重新获取状态）**
- mira-desktop PR #404 存在请求修改记录：作为可能有人工审查阻塞的例子。
- mira-desktop PR #464 明确 Draft / batch hold：**不能仅因为没有合并就上报**。

### C. External Worker 升级与返工

**观察目标**：Issue、External Worker 原始 Run + attempt、Jobs、Candidate Artifact、Verification、Delivery PR、Trusted Reporter 的确切时间及可信范围。

**入选需要关注**
- 工作项仍有效，有证据证明 blocked 或 escalated 为当前终态，自动恢复已耗尽或明确无法继续，且需要维护者接手。
- Delivery 已明确失败并且后续自动补救不可用，有可靠的当前交付阻塞证据。
- 根据上游 Issue 合同明确需要维护者验收/授权，也可作为候选，但不能由 Run 成功自行推导「待验收」。

**保持正在推进**
- queued、working、validating、repairing、candidate_captured，或者有较新的同一目标恢复 Run 仍在有效处理。
- 单次 failed Job 和验证失败不能凌驾于其后的自动返工结果。

**自动解除**
- 同一工作项/候选获得有来源的后续恢复、必要验证和交付解除阻塞证据，或 Issue 已被合法终结。
- Run success、Artifact 存在、Draft PR 创建各只证明各自步骤，不等于功能验收或 Issue 关闭。

**观察缺口**
- observation_gap、logs_expired、artifact_unavailable 是不同性质的证据缺失，不能自动当作 Worker 失败。
- 默认只走 GitHub-only Factory 投影（includeReporter=false），不在首页触发 Workers Observability/Reporter 日志查询。
- 现有 Factory Feed 受 14 天/12 条展示限制，首期只能标记为「最近可发现 Worker 候选」。没有补齐覆盖前不得展示「全组织 Worker 待办总数」。

## 四、每条关注事项的最小解释合同

- **identity**：category + canonical owner（PR/Issue/生产候选）+ 当前受影响目标的稳定标识；同一根因去重。
- **subject**：仓库、工作流/PR/Issue、分支、对应 head SHA/Run/attempt 或发布 SHA。
- **what / why_now**：发生什么、为何仍然阻塞且需要人介入。
- **what_system_tried**：现有自动修复/重试/验证的可证实动作；没有证据就写「未知」。
- **next_step**：下一步人的具体动作，如查看必要 Check、处理 Review、介入 Worker 恢复。
- **evidenceUrls / observedAt / freshness / coverage**：原始证据、时间与覆盖范围。
- **exit_condition**：同一目标上哪些后续原生事实出现后自动从关注区退出。
- **classification**：需要关注 / 正在推进 / 观察记录 / 未知，以及单独的处理优先级。

P0 只给**已证实生产受到影响**的情形；Actions failure 不能直接升为 P0。P1 为有效任务/发布受阻，P2 为等人决策，P3 为确实妨碍关键判断的监测失明。这是**拟议产品优先级**，不是 GitHub 自带严重度。

示例文案：**“mira-desktop · PR #X 的必要检查仍阻塞合并。HEAD abc123 · 最近验证 xx:xx · 当前需维护者排查。查看 PR / Check。”** 不允许“1 项运行异常待查看”。

此阶段不增加本地确认按钮、独立人工任务状态或第二套持久数据库；消除关注依赖真实上游状态。对新变更、恢复变更也仅展示事实，不主动修改 GitHub。

## 五、数据源与查询成本（预算上限仍需实测）

既有实现基线：
- GitHub 公开仓库当前为 **21 个**；核心快照每仓库最新 Run 一次 REST，约 21 次工作流查询/次缓存重建，另有组织目录与 Release GraphQL。
- 已连接 GitHub 核心数据缓存约 15 分钟，治理缓存约 30 分钟；Factory Feed 独立扫描，最多 120 秒共用缓存。
- 本合同不把这些既有调用当成新增监控免费额度。Cloudflare Worker 子请求、GitHub REST primary/secondary limit 和 GraphQL points 都应分别记录。

**试点范围建议（未最终确认）**：mira-desktop、mira-mobile、cloud-auth、mira-cloud、cloud-pi、control-room 六仓库。其余 15 个仓库显示「试点范围外」，**不是健康**。

| 采集项目 | 建议读取 | 假设增量/小时 |
| --- | --- | ---: |
| 必要 Actions/Gate | 每试点仓库每 15 分钟 1 次明确工作流/分支查询 | 6 × 4 = 24 REST |
| 开放 PR | 每试点仓库每 15 分钟 1 次列表；有变化才详细读取 | 6 × 4 = 24 REST |
| 候选细查 | 按变化和风险分配 Review/Checks/Jobs 查询，严格上限 | ≤ 12 REST |
| **首期增量目标** | 不含基线、GraphQL points、Worker Logs | **≤ 60 REST/h** |

上表是**调度预算假设而非实际调用测量**。若某仓库有多个必要 Workflow，必须重算成本，不能偷偷按每仓库 1 个计算；必要 Gate 应由仓库实际保护规则/Rulesets 或仓库拥有的校验合同确定，而不是在 Control Room 复制一套策略。

运行守则：
1. 后台公共快照同一轮采集供 UI/MCP 共用；不能每个浏览者重扫 6–21 仓库。分页、最大候选数、并发、超时必须有界。
2. 使用条件请求 ETag/If-None-Match 和响应头 x-ratelimit-* / Retry-After；按 GitHub 403/429 和 secondary limit 原则降速，不无限重试。
3. 输出覆盖率：本轮实际读到多少仓库/工作流/PR、多少因为权限/限流/缓存或截断未知；未知不是零。
4. 无新增公开私有仓库、Secret Scanning、Dependabot 细节。涉及安全告警必须另开**有认证的私有数据边界**设计。
5. Webhook 不是本轮要求；若将来为及时性引入，另设计签名验真、去重、事件丢失补偿和权限。此轮不建设常驻监控基础设施。
6. 不新增定时主动提醒，未授权的邮件/消息通知与 GitHub 写动作均为非目标。

官方 API 依据：
- Workflow Runs: https://docs.github.com/en/rest/actions/workflow-runs
- Pull Requests: https://docs.github.com/en/rest/pulls/pulls
- PR Reviews: https://docs.github.com/en/rest/pulls/reviews
- Check Runs: https://docs.github.com/en/rest/checks/runs
- REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- API best practices: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api

## 六、后续实施顺序与验收案例（仅设计，不授权施工）

**建议的三个独立交付切片**：
1. 真实必要 Gate / Release 资格投影，先修「最后一个 Run = CI」误判。
2. 真实 PR 阻塞资格，结合最新 HEAD、Review/Checks 与 Issue 的有意暂缓。
3. Worker Escalation 资格，沿用 Factory read model，解决近 14 天/12 项发现源的局限，去重、取消过期事项。

UI 只用统一的关注资格投影，不扩展第二套台账；首页把需要关注、正在推进、历史观察分开。支持先看人话结论，再看原始 GitHub 证据。

必须验证：
- 旧 CI 失败后同目标新必要 Gate 通过 → 退出；无关 workflow success 不可解除。
- 旧 SHA 与新 SHA 不混算，skipped/comment Worker 不参与必要 CI 统计。
- Draft/明确 hold/等待配套修复的 PR 不因滞留触发；mergeable=null 不被当成冲突。
- 当前有效的 CHANGES_REQUESTED、冲突或必要 Gate 阻塞才可能成为人工候选，并保留下一步操作与证据。
- 首次 Worker 失败但正在返工 → 正在推进；可信 escalated 且无后续恢复、仍需维护者 → 需要关注。
- Reporter 过期、GitHub 403/429、工位列表截断 → 覆盖不足，不能冒充故障或归零。
- 相同 Issue/PR/Run 根因仅一条首页事项，并能从原始 GitHub 事实解除。
- 在预算上限、缓存、多访客、权限缺失时不会导致 N 倍查询、费用失控或伪精确计数。
- 测试层次：T1 规则逻辑，T2 API/契约，T3 Worker 运行时；正式部署时遵循仓库的 T5 小型真实冒烟。绿灯不是功能验收。

## 七、正式实施前仍需确认的产品取舍

- 首期六仓库名单、每仓库真正有效的 required Gate/部署合同。
- 何种明确证据构成 hold / 等待用户决定；谁实际负责人工介入。
- 公开 Control Room 能显示多少 GitHub 内容；当前默认为只读、公开安全摘要。
- 是否需要主动通知：默认**不需要**。
- 预算 60 REST/h 是否经真实缓存与 Cloudflare Worker 运行成本验证。

**未实现、权限不够或证据不支持时，明确写“开发中 / 无法判断”，绝不造数据。**

此草案不与组织 Issue/Project 的契约争夺真相源，也不自动接受或关闭 OPS-032 #77。
