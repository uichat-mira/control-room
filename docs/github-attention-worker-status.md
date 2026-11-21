# GitHub Worker 升级资格 (#108)

> Status: OPS-037 implementation slice. Read-only, public-safe。它消费 OPS-032 的 canonical
> Factory 投影，不复制 Factory TV 状态机，不重新实现 Worker 派工/返工/恢复算法，也不是
> 第二份 Issue/PR/Project 台账、提醒或自动关闭机制。

## Scope

新增两个只读模块和一个按需路由：

```text
src/factory-attention.ts       从 canonical FactoryRunProjection 推导关注候选（纯函数）
src/factory-attention-facts.ts 一次有界、缓存的 GitHub Issue 状态读取
GET /api/v1/factory/attention?repository=uichat-mira/<repo>&runId=<id>[&includeReporter=true]
```

- 只接受公开 `uichat-mira/*` 仓库中真实的 Mira External Worker Run。
- 默认 `includeReporter=false`：只复用 `getFactoryRunProjection(..., includeReporter=false)`，
  **绝不**查询 Cloudflare Workers Observability，也不访问首页。
- `includeReporter=true` 是显式详情动作，复用现有单 Run Reporter 投影与其缓存；只有这时才
  可能看到可信 `escalated` / `blocked` 终态；但**单 Run 旧升级不能直接进入 P1**。
  只有在 Issue 仍开放、最新完整可信 GitHub Recovery Pointer 确认该 Run/attempt
  仍是当前终态时，才可以输出 `needs_attention`。缺少此证明即 `unknown`。
- 路由默认不扫描 `getFactoryFeed()`；单 Run 的缺失不能推导全组织未结数量。批量候选聚合
  （如果未来首页需要）应把已获取的投影交给纯函数，并附带 `discoveryFromFeed()` 的覆盖边界。
- 不修改 Factory TV UI、Overview、MCP、Worker workflow、dispatch、Recovery、通知或 GitHub 写路径。

## Source hierarchy

1. **GitHub Run / Job / Artifact / PR**：canonical Factory 投影的事实来源。Run success 只证明
   Run 成功，不证明 Verify PASS、PR 交付、产品验收或 Issue 关闭。
2. **Trusted Reporter（号脉）**：可把状态细化为 `candidate_captured / validating / repairing /
   blocked / escalated / delivered / verified`。Reporter 缺失、过期、查询失败或空事件都是观察
   缺口，不是 Worker 失败。
3. **GitHub Issue 状态**：只有从可信来源获得 Issue 链接后，才允许一次有界读取 Issue 当前
   `open / closed`。标题、分支、`display_title`、Artifact 名称和自由文本都不是 Issue 号来源。
4. **GitHub Recovery Pointer**：仅在显式详情读取确认 `escalated/blocked` 且 Issue
   为 open 后，才追加一次有界 GitHub Issue 评论页读取。只接受 GitHub Actions 官方 Bot
   （verified bot id）的 `mira-recovery-candidate:v1` 合同，严格匹配仓库、Issue、
   Run/attempt、终态及 Candidate 指纹字段。若评论多于第一页（100 条）、签名来源不符、
   最新 Pointer 指向新 Run、Issue 在 Pointer 后又有变动，均**不能**证明旧升级为当前待办。
5. **Factory Feed**：14 天 / 每仓库最多 20 Run / 最多展示 12 条的**近期候选发现**，不是全组织
   事实，也不是精确待办总数。

## Status semantics

| Status | 含义 | 人工待办？ |
| --- | --- | --- |
| `needs_attention` | 可信 `escalated`/`blocked` 终态；Issue 已核实为 open；所供证据未显示可用的自动恢复 | 是（P1） |
| `in_progress` | queued / working / candidate captured / validating / repairing / verified 等待交付 / delivery retry | 否 |
| `observed` | Run success、Draft PR 已交付、Issue 已合法关闭，或没有可证明的人工阻塞 | 否 |
| `unknown` | 缺 Reporter、Reporter 过期、Artifact 过期/缺失、Issue 身份或状态不可证、GitHub-only Worker failure、校验缺口 | 否；这是覆盖缺口 |

关键规则：

- 首次 Verify 失败、后续 repair/validating 有效执行 → `in_progress`，不进入待处理。
- GitHub-only 的 `worker_failed` **不会**被提升为 `needs_attention`：没有 Reporter 证据时无法
  证明自动返工已耗尽。可信 Reporter 的 `escalated`/`blocked` 才是升级信号。
- `blocked` 也要求可信 repair 事件；仅仅 canonical 字段写着 `escalated` 而没有匹配事件时是
  `unknown`。
- **重要修复**：单次读到旧 Run 的 `escalated` 不代表「仍无恢复」。
  最新 Recovery Pointer 缺失/截断/不可信/被后续 Issue 更新覆盖时输出 `unknown`；
  Pointer 证实同 Issue 更新的 Run 则将旧 P1 清除为 `unknown`，要求查询最新 Run
  才能判断其新状态。只有与指定 Run/attempt 匹配的最新可信 Pointer 才可授予 P1。
- `identity.candidateArtifact` 严格匹配规范 Candidate Artifact 名称；
  只有 Verify/Delivery Artifact 时返回 `null` 并声明 Candidate 缺失，绝不顶替。
- Run success、Artifact 存在、Draft PR 创建各只证明各自步骤；不自动接受、不自动关闭 Issue。
- 自定义 `P0` 从不由普通 Worker 失败产生。P1 表示有效工作项确实无法自动继续。

## Identity 与同一 Issue 的解除

关注候选身份：

```text
worker:uichat-mira/<repo>#issue:<n>           已核实 Issue
worker:uichat-mira/<repo>#run:<id>:attempt:<n> 无核实 Issue，仅锚定 Run/attempt
```

- `WorkerIssueLink` 只能由可信调用方提供（trusted Reporter / 等价的已取证合同），并必须与
  `repository + runId + attempt` 完全匹配；不匹配的链接会被丢弃并记录告警。
- 同一 Issue 的多个投影会按 `createdAt → runId → attempt` 收敛到**最新** Run/attempt。
  较旧的 `escalated` 只保留为 archive evidence，不会永久告警。
- 参与收敛的较新 Run 必须同样带有已核实 Issue 链接；缺少链接的新 Run 不会被猜成同一 Issue，
  旧候选会保持“同 Issue 历史未提供”的覆盖缺口，而不是被它错误清除。
- 较新的同 Issue Run 仍在 `repairing / validating / working / verified / delivered` 时，
  旧升级被替代并转为 `in_progress` / `observed`。
- 较新的同 Issue Run 若只是 GitHub success 而没有可信 Verify/Delivery，结果是 `observed`
  或 `unknown`，不能冒充产品验收；也**不会**错误地宣告旧问题“已恢复”。
- 不同 Issue 的 Run 绝不互相清除；无关成功 Run 不能解除当前阻塞。
- Issue 在 GitHub 合法关闭 → `observed`，并在解释中明确“关闭 Issue 清除关注”，而不是
  “Run success 验收通过”。

## Coverage gaps

以下都不会被转换为伪失败、伪恢复或全组织精确计数：

- Reporter `not_requested` / `not_expected` / `unavailable` / `expired`；
- Reporter 查询成功但没有该 Run attempt 的可信事件；
- Artifact 缺失或 `expired=true`；
- Issue 链接缺失、链接与 Run/attempt 不匹配；
- Issue 读取 403 / 429 / 404 / 超时；
- Factory Feed 的 14 天、20 Runs/仓库、12 条展示截断，或仓库扫描部分失败；
- 同一 Issue 的较新 Run 未被提供（本路由只读一个 Run）。

每个候选都带 `coverage.status`、`coverage.reasons`、`issueState`、`sameIssueHistory`、
`discovery` 与 `warnings`。`unknown` 明确表示“不能证明”，不是“没有问题”。

## 请求预算与凭据

- 生命周期读取完全复用现有 `cachedFactoryRun` 缓存，路由本身不增加 Factory Feed 扫描。
- 只有存在可信 Issue 链接时才追加一次 `GET /repos/{org}/{repo}/issues/{n}`；
  显式 Reporter 模式确有可信终态且 Issue open 时，再追加**至多一页** 100 条
  `GET /repos/{org}/{repo}/issues/{n}/comments?per_page=100` 核实 Recovery Pointer。
  两种读取分别边缘缓存 60 秒 / isolate fallback；每次最多一次短窗口 Retry-After
  重试。普通详情额外 0–1 REST；终态详情额外最多 2 REST（含短重试的绝对请求上界 4）。
  原 canonical Run 读取本身常用 4 REST，因此终态无关联 PR 的首次冷读正常 6 REST。
  这不是组织每小时请求预算已经经生产证明。
- 默认响应头明确标注 `x-mira-factory-attention-source: github-only` 与
  `x-mira-factory-attention-issue-read: 0`。
- 公开响应只包含 allowlist 字段；不包含 `GITHUB_READ_TOKEN`、Cloudflare 凭据、原始
  Observability 响应、私有事件或未经验证的“实时施工行为”。
- GitHub PR 号与 Issue 号共用编号空间，但 Issues API 返回的 `pull_request` payload 会被拒绝，
  不会被当作工作项 Issue。

## 真实只读证据链（2026-11-21T01:40–01:50Z，匿名公开 GitHub API）

这是一次 runner 时点观察，不是永久结论，也未使用 Reporter/Cloudflare 凭据。

1. [`mira-desktop` Run 44547710817](https://github.com/uichat-mira/mira-desktop/actions/runs/44547710817)
   （`workflow_dispatch`, attempt 1, `dev`, head `c8e944ef…`）：
   - Run `completed/success`；Jobs 包括 `worker / verify` success、`worker / delivery` success、
     `worker / trusted_reporter` success；
   - Artifact 包括 `mira-external-worker-candidate-482-44547710817-1`（未过期，2026-12-03 到期）。
   - GitHub-only canonical 投影是 `observation_gap`（Run success 但无可信 Verify/Delivery 事件），
     本切片输出 `observed`，`run_success_not_acceptance`，**不**产生关注候选。
2. [`mira-desktop` Issue #482](https://github.com/uichat-mira/mira-desktop/issues/482)：
   读取时 `closed / completed`，`closed_at=2026-11-19T16:06:32Z`。即使维护者另外提供可信
   Issue 链接，本切片也会输出 `observed`（Issue 合法关闭），而不是继续告警。注意：Artifact
   名称里出现 `482` **不是**本切片接受的 Issue 身份来源，因而真实路由输出仍是
   `issueNumber: null`。
3. [`cloud-auth` Run 44141740924](https://github.com/uichat-mira/cloud-auth/actions/runs/44141740924)
   （`workflow_dispatch`, `dev`）：Run `completed/failure`，`enrollment` Job failure，
   `worker` Job skipped，无可读 Artifact。GitHub-only canonical 投影落在
   `artifact_unavailable`，本切片输出 `unknown` / coverage gap，**不**声称 Worker 升级或
   自动返工耗尽。
4. 请求数：上述单 Run 探测各使用 1 次 repository visibility + 1 次 Run + 1 次 Jobs +
   1 次 Artifacts（无关联 PR），Issue 状态另 1 次；总计每个 Run 4 次、加 Issue 后 5 次。
   这是 runner 时点测量，不是全局每小时上限。

## 验证

- `tests/factory-attention.test.ts` — T1 规则：`failed → repairing → escalated → recovered`、
  同 Issue 多 Run、旧/新 attempt、无关 success、Issue 关闭、Reporter 缺失/过期、Artifact 过期、
  Feed 截断、缺 Issue 身份、链接不匹配、可信事件缺失。
- `tests/factory-attention-facts.test.ts` — GitHub Issue payload 形状、PR payload 拒绝、
  403/429/404、单次有界重试、凭据不泄漏。
- `tests/worker-factory-attention-route.test.ts` — T3：GitHub-only 默认不触发 Reporter/Issue
  读取、显式 includeReporter、Issue/Recovery Index 读取缓存、403 unknown、最新
  同 Issue Pointer 清除旧升级、普通用户伪造 Pointer 不具资格、无 token 泄漏。
- `tests/factory-attention.test.ts` 的维护者新增反例：没有当前性证明的旧升级
  不能作为 P1；更晚同 Issue Pointer 必须清除旧 P1；仅 Verify/Delivery Artifact
  不能代替 Candidate。
- `npm run check` 包含 typecheck、`test:factory`（含新路由测试）和生产构建。

## 已知验证缺口与未证实链路

- 本 Worker runner 没有 Cloudflare/Reporter 凭据，因此**没有**在真实生产 run 上实际取得
  trusted `escalated` 事件并跑通端到端关注候选；可信升级路径由夹具覆盖。真实 Run 只证实了
  GitHub-only `observation_gap`/`artifact_unavailable` 与 Issue 关闭读取。
- `escalated → 后续同 Issue Repairing → 解除` 在多 Run 纯函数中会重算；
  单 Run 路由现在能利用 GitHub Recovery Pointer 判断**已有更新的可信索引**并
  撤下旧 P1，但**不能**据此推断新 Run 已完成产品验收，也无法自动发现尚未写入
  Recovery Pointer 的在途 Run。Pointer 页不完整或 Issue 后续有新活动时拒绝
  输出 P1。首页如何聚合仍属于 OPS-038，不在本切片内。
- 人工“权责映射”（谁具体接手）尚未由组织合同授予；候选只写 `<repo> maintainers`，不伪造个人。
- Factory Feed 不是完整发现源；本切片不会输出“全组织剩余 N 单”。

## Rollback

删除 `/api/v1/factory/attention`、`src/factory-attention.ts`、
`src/factory-attention-facts.ts`、`src/factory-attention-route.ts`、对应测试、
`test:factory` 中的路由测试条目，以及 OpenAPI/README/本文档新增内容。`factory-feed.ts` 仅导出
既有常量，可一并恢复为本地常量。OPS-032 Factory 读模型、Factory TV UI、Overview、MCP 和
现有 `/api/v1/factory/*` 行为保持不变。
