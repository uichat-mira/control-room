# OPS-033 · 六仓库 GitHub Gate / 发布证据矩阵

> **状态：2026-11-20 只读尽调快照；配置事实与权限缺口。** 本文不是新的强制 CI 策略，也不是当前生产健康声明。后续采集器必须回源读取最新 SHA、Run、Ruleset、Review 和部署事实。
>
> 所属工作项：[OPS-033 #104](https://github.com/uichat-mira/control-room/issues/104) · 决策框架：[GitHub「需要关注」资格契约](github-attention-qualification-contract.md) · 组织约束：[main AGENTS.md](https://github.com/uichat-mira/.github/blob/main/AGENTS.md)（读取版本 2026-09-16.2）。
>
> 实际核查范围：六个公开仓库的当前默认分支、dev/test/prod 引用、当前工作流源码、部分仓库级 Rulesets、近期 Actions Runs / Jobs、Release 与任务/发布合同。不曾编辑其他仓库、运行部署或读私密凭据。

## 1. 首期目标与分支快照

仓库当前默认分支 **不总是 dev**。以下为 2026-11-20 读取到的远端提交 SHA（后续使用时须重新读取）：

| 仓库 | GitHub 默认分支 | dev SHA | test SHA | prod SHA |
| --- | --- | --- | --- | --- |
| [mira-desktop](https://github.com/uichat-mira/mira-desktop) | prod | e8655dbbb5452d88c35d643542757b10d4779450 | 89a881291390c481a2552340405cf63ac03479a1 | f99d975dbb530a1eb5514584139c0cd23a6369e1 |
| [mira-mobile](https://github.com/uichat-mira/mira-mobile) | prod | 1fe0f02b1c33a56929a3c73ff5ba2cd49eff24d4 | f51a485dde969716af135747af8ba24aaa175168 | f946174951c4b08c10c4788abad1145af827da43 |
| [cloud-auth](https://github.com/uichat-mira/cloud-auth) | dev | cbf967478bb6b235e59d8f4a8cbc9723cc5d978b | 未从当前分支枚举中找到（不等于从未存在） | 69804354a13a399757f80c08bfc954926c263d38 |
| [mira-cloud](https://github.com/uichat-mira/mira-cloud) | dev | f2a40a189f9ca01edab36353fff8dec7be36318c | 12b97b62da6e8dbcedc6fc1adb8289da63e8c1f6 | c37b801d178caec475ccec409e849c6811633a0c |
| [cloud-pi](https://github.com/uichat-mira/cloud-pi) | dev | f7ceb6f90d71cbd9928e6954b363931c78174687 | f7ceb6f90d71cbd9928e6954b363931c78174687 | f7ceb6f90d71cbd9928e6954b363931c78174687 |
| [control-room](https://github.com/uichat-mira/control-room) | prod | 0ba58849b10469769badd2c0fc86a2a7ed7ddf71 | 9a944c5f0b80cc21767d4e53f3d4e9d845c624ed | f2a89a5ae42a2d6bbc76025dcf900ead3317b38e |

**重要**：Actions 的 event、branch、head SHA、run attempt 与 workflow ID/path 必须一起读取。对有多个有效工作流的仓库，最后一个 Actions Run 不等于最后一次必要 CI。只看到默认分支的某个 Run 时，不要拿它解释其他分支。

## 2. 六仓库 Gate / Release 事实矩阵

以下“必要”区分 **工作流内部实际要求** 与 **GitHub 保护设置强制要求**。前者可由源码确认；后者必须以当前有效 Branch Protection / Ruleset 的 required status checks 为证据，当前连接多数无法证实。

| 仓库 | 代码/合同可证实的验证工作流 | 正式发布/部署入口 | GitHub 强制 required checks |
| --- | --- | --- | --- |
| **Desktop** | Build Desktop Apps：PR dev/test/prod 执行 Windows Check pull request，push dev/test/prod 执行跨平台构建；Branch Policy：PR 来源路由；另有按文件路径触发的 Server Full Test、Agent Runtime CI、Windows Native Runtime Smoke 等 | **prod 来源的稳定 v* Tag** → Release Production 校验 prod Tag → Release Factory V2 → GitHub Release / R2；不是任意 prod push 就等于已发布 | **未知**。已读到启用的 prod Ruleset，但仅列出禁止删除和强推，没有读到 required status check |
| **Mobile** | Mobile CI 含确定性的 **Mira Gate** Job，依 event/branch 对 quality、Android、Maestro、iOS、签名 APK、dev/prod 发布结果分别要求 success 或 skipped；Feature CI 单独用于 feat/**；predev 为历史独立通道 | prod push 的 Mobile CI 发布正式 Release；独立 R2 Release Truth 在条件允许时核对同 SHA 的 canonical CI 后发布渠道 manifest（dev/test/prod/predev） | **未知**。有启用的 prod Ruleset，仅看到删除/强推限制；Mira Gate 的**工作流内部**规则可证实，不等于 GitHub 设置中已标为 required |
| **Cloud Auth** | Cloud Auth CI 对 dev/test/prod PR/push，Static、T1、T2、T3、Docker 等 Job 汇总为 Mira Gate；必须保留各层失败原因 | prod push / workflow_dispatch → Deploy Cloud Auth Production 构建镜像、SSH 部署、server-local smoke；test 工作流为 GitHub runner **隔离 Docker**，不接生产主机 | **未知**。无可见仓库级 Ruleset，传统 Branch Protection 明细因权限 403 不可读取 |
| **Mira Cloud** | Mira Cloud Gate 的 Docs Contract、Engineering Checks、PostgreSQL Integration、Production Package 汇总到 **Mira Gate**；prod PR 还要求来源为本仓库 test 分支 | prod **手动** Deploy Mira Cloud to Tencent VPS，先核准 prod SHA，受控构建/部署并按 DNS 条件做公网 smoke；dev/test 无共享服务器 | **未知**。prod 的 branch 元数据报告 protected=true；但无法读取有效 required checks，不能推断保护内容 |
| **Cloud Pi** | Validate 在 dev PR/push 执行 npm test；Validate Cloud Pi Container 在涉及 Docker/部署路径的 dev PR/push 执行容器构建测试。所查工作流未提供一个可证明跨发布阶段的 Mira Gate 汇总 | workflow_dispatch 先构建不可变 Linux image 并创建 prerelease；prod **手动** Deploy Cloud Pi (direct)，必须提供已发布的 release_sha、验证 prod 祖先关系、镜像 SHA-256、SSH 部署 | **未知**。无可见仓库级 Ruleset，传统 Branch Protection 明细 403；Validate 成功不是正式部署 |
| **Control Room** | Control Room CI / Deploy：dev/test/prod PR/push 进入 Verify（npm run check），Deploy Job 在非 PR 且 prod ref 时才执行；另有 AI Review 和 GitHub Overview 专项工作流，不能当通用 CI | **prod push** → Verify → Deploy Cloudflare Worker；发布把 DEPLOYED_COMMIT 设为目标 Git SHA，并在 workflow 进行无副作用生产 smoke | **未知**。仓库级 prod Ruleset 当前是 disabled；传统 Branch Protection 明细 403，不能声称存在强制 required checks |

### 2.1 Desktop 来源与例证

- [Branch Policy · dev@e8655db](https://github.com/uichat-mira/mira-desktop/blob/e8655dbbb5452d88c35d643542757b10d4779450/.github/workflows/branch-policy.yml) 校验 PR 源/目标：工作分支 → dev、dev/hotfix → test、test/hotfix → prod。
- [Build Desktop Apps](https://github.com/uichat-mira/mira-desktop/blob/e8655dbbb5452d88c35d643542757b10d4779450/.github/workflows/build-desktop.yml) PR 与 push 有**不同** Job；[Build macOS Intel](https://github.com/uichat-mira/mira-desktop/blob/e8655dbbb5452d88c35d643542757b10d4779450/.github/workflows/build-macos-intel.yml) 在 PR 可触发但构建 Job 会跳过，不能因 skipped 就报警。[Server Full Test](https://github.com/uichat-mira/mira-desktop/blob/e8655dbbb5452d88c35d643542757b10d4779450/.github/workflows/server-full-test-ci.yml) 和 [Agent Runtime CI](https://github.com/uichat-mira/mira-desktop/blob/e8655dbbb5452d88c35d643542757b10d4779450/.github/workflows/agent-runtime-ci.yml) 仅在匹配路径的 dev PR/手动触发时生效，不是对所有 PR 无条件要求。
- [Release Production](https://github.com/uichat-mira/mira-desktop/blob/f99d975dbb530a1eb5514584139c0cd23a6369e1/.github/workflows/release-production.yml) 仅稳定 v* Tag push 触发；正式发布要核对 tag 属于 prod、构建验收和 GitHub/R2 镜像。最近稳定 [v0.106.1](https://github.com/uichat-mira/mira-desktop/releases/tag/v0.106.1)（2026-11-17 发布），GitHub Release 本身不等于安装端健康。
- [dev Build Desktop Apps Run #44562121184](https://github.com/uichat-mira/mira-desktop/actions/runs/44562121184)：push dev@e8655db，success；[prod External Worker #44562320626](https://github.com/uichat-mira/mira-desktop/actions/runs/44562320626)：issue_comment，skipped。若按 prod 最后一条 Run 解释构建健康，就会读错信号。
- [repo AGENTS.md](https://github.com/uichat-mira/mira-desktop/blob/e8655dbbb5452d88c35d643542757b10d4779450/AGENTS.md)、[Branching](https://github.com/uichat-mira/mira-desktop/blob/e8655dbbb5452d88c35d643542757b10d4779450/.github/BRANCHING.md) 是本次读取的仓库合同。

### 2.2 Mobile 来源与例证

- [Mobile CI](https://github.com/uichat-mira/mira-mobile/blob/1fe0f02b1c33a56929a3c73ff5ba2cd49eff24d4/.github/workflows/mobile-ci.yml) 最终 Mira Gate 使用 always()，检查上游 Job 结论；[阶段规则](https://github.com/uichat-mira/mira-mobile/blob/1fe0f02b1c33a56929a3c73ff5ba2cd49eff24d4/docs/testing/mobile-ci-gate.md) 与 [可执行评估器](https://github.com/uichat-mira/mira-mobile/blob/1fe0f02b1c33a56929a3c73ff5ba2cd49eff24d4/.github/scripts/evaluate-mobile-gate.cjs) 是同一仓库拥有的判断依据。
- PR：quality + Android debug + iOS 必需，其他指定 Job 应跳过；test push：额外要求 Maestro；dev/prod push：相应签名 Release 与本渠道发布 Job 必需；手动 workflow_dispatch 的 Maestro 要求另有分支差异。**预期 skipped 是成功门禁的一部分**，不是要处理的失败。
- [R2 Release Truth](https://github.com/uichat-mira/mira-mobile/blob/1fe0f02b1c33a56929a3c73ff5ba2cd49eff24d4/.github/workflows/r2-release-truth.yml) 监听 dev/test/prod/predev 的发布相关变更，文档/Markdown 等变更可合法触发 paths-ignore，不出现 Run 不代表发布失败。[发布说明](https://github.com/uichat-mira/mira-mobile/blob/1fe0f02b1c33a56929a3c73ff5ba2cd49eff24d4/docs/github-build-release.md) 区分 GitHub Release、R2 manifest 与真机验收。
- [dev Mobile CI #44455957013](https://github.com/uichat-mira/mira-mobile/actions/runs/44455957013) 和 [dev R2 Truth #44455956847](https://github.com/uichat-mira/mira-mobile/actions/runs/44455956847) 在 dev@1fe0f02 上均 success；最近正式 [v0.3.28](https://github.com/uichat-mira/mira-mobile/releases/tag/v0.3.28) 对应 prod@f946174；dev prerelease [v0.3.31-dev](https://github.com/uichat-mira/mira-mobile/releases/tag/v0.3.31-dev) 对应 dev@1fe0f02。跨渠道不能混用 success。
- [prod issue_comment Mira Start Work #44670900970](https://github.com/uichat-mira/mira-mobile/actions/runs/44670900970) skipped：不应取代 prod Mobile CI。生产构建/发布还需要实际 GitHub Release、R2 manifest 及目标版本签名产物证据；该次尽调未独立读取 R2 manifest 或手机真机运行。

### 2.3 Cloud Auth 来源与例证

- [dev Cloud Auth CI](https://github.com/uichat-mira/cloud-auth/blob/cbf967478bb6b235e59d8f4a8cbc9723cc5d978b/.github/workflows/ci.yml) 在 dev/test/prod 的 PR/push 上包含 Static、T1、T2、T3、Docker 与最终 Mira Gate。
- [dev CI #44208831970](https://github.com/uichat-mira/cloud-auth/actions/runs/44208831970) 绑定 dev@cbf9674，实际 **failure**：T1/T2/T3/Docker 均 success，**Static 的 pnpm audit --audit-level=moderate 失败**，Mira Gate 随之 failure。应描述为“当前 dev 提交的依赖审计阻塞 CI”，**不是**“生产服务故障”。
- 更晚的 [issue_comment External Worker #44452672505](https://github.com/uichat-mira/cloud-auth/actions/runs/44452672505) 为 skipped；旧算法读 per_page=1 会漏掉上面的有效 CI 失败。
- [test workflow](https://github.com/uichat-mira/cloud-auth/blob/cbf967478bb6b235e59d8f4a8cbc9723cc5d978b/.github/workflows/deploy-test.yml) 只在 test ref 上做 runner-local disposable Docker smoke，不向远端部署。当前分支枚举未发现 test，需在真正晋级时复查。
- [prod workflow 的**真实当前版本**](https://github.com/uichat-mira/cloud-auth/blob/69804354a13a399757f80c08bfc954926c263d38/.github/workflows/deploy-prod.yml) 相比 dev 文件有改动（prod blob 54dd2cb，dev blob 52b6070）：监控生产必须按 prod SHA 取文件，不能把 dev 的保护步骤当作已在 prod 执行。prod@69804354 的 [Cloud Auth CI #42887140933](https://github.com/uichat-mira/cloud-auth/actions/runs/42887140933) 与 [Deploy Production #42887140714](https://github.com/uichat-mira/cloud-auth/actions/runs/42887140714) 都在 2026-11-10 success。
- 生产工作流将 SHA 传入服务器部署脚本，并有 server-local smoke。但**公网 smoke 在 DNS 未就绪、或重试后仍无法验证时会警告并 exit 0**；因此绿灯不能独立证明公网正常，更不能证明生产没有发布偏移。见 [部署指南](https://github.com/uichat-mira/cloud-auth/blob/cbf967478bb6b235e59d8f4a8cbc9723cc5d978b/docs/deployment.md)。生产 SHA 仍需经服务器 /opt/cloud-auth/.deployed-sha、运行日志和公网实际响应核对；本卡未读取服务器。
- [Cloud Auth root AGENTS](https://github.com/uichat-mira/cloud-auth/blob/cbf967478bb6b235e59d8f4a8cbc9723cc5d978b/AGENTS.md) 与 CI 源码属于本仓库合同，不允许 Control Room 复制一份自封的 Gate 策略。

### 2.4 Mira Cloud 来源与例证

- [Mira Cloud Gate](https://github.com/uichat-mira/mira-cloud/blob/f2a40a189f9ca01edab36353fff8dec7be36318c/.github/workflows/mira-gate.yml) 覆盖 dev/test/prod PR 和 push（及 feat/**、main 的指定 push）。Mira Gate 最终要求 Docs Contract、Engineering Checks、real PostgreSQL Integration、Production Package success；prod PR 还需检查从同仓库 test 分支晋级的路由 Job。**属于源代码/运行包门禁，不是线上生产 T5。**
- [prod@c37b801 Mira Cloud Gate #43006378424](https://github.com/uichat-mira/mira-cloud/actions/runs/43006378424) success；随后 [prod 手动 Deploy #43006399618](https://github.com/uichat-mira/mira-cloud/actions/runs/43006399618) success。当前 dev@f2a40a 的 [Mira Gate #44228451628](https://github.com/uichat-mira/mira-cloud/actions/runs/44228451628) success。
- [prod-only 腾讯部署](https://github.com/uichat-mira/mira-cloud/blob/c37b801d178caec475ccec409e849c6811633a0c/.github/workflows/tencent-prod-deploy.yml) 为 workflow_dispatch，校验 GITHUB_REF=prod 和 HEAD=GITHUB_SHA 后进行服务器部署；[runbook](https://github.com/uichat-mira/mira-cloud/blob/f2a40a189f9ca01edab36353fff8dec7be36318c/docs/engineering/environment.md) 明确 dev/test 无服务器。公网 T5 在 DNS 未指向预期机器时仅 warning 并 exit 0，**部署工作流 success 不能代替“公网验收通过”**。
- prod branch 元数据 protected=true，但传统保护规则详细读取因当前凭据 403；[Mira Cloud AGENTS](https://github.com/uichat-mira/mira-cloud/blob/f2a40a189f9ca01edab36353fff8dec7be36318c/AGENTS.md) 禁止把源代码 Gate 误写成 Cloud Auth/Cloud Pi/Task 的真实联调验收。

### 2.5 Cloud Pi 来源与例证

- [Validate](https://github.com/uichat-mira/cloud-pi/blob/f7ceb6f90d71cbd9928e6954b363931c78174687/.github/workflows/validate.yml) 对 dev PR/push 执行离线 npm test；[Validate Cloud Pi Container](https://github.com/uichat-mira/cloud-pi/blob/f7ceb6f90d71cbd9928e6954b363931c78174687/.github/workflows/validate-container.yml) 对特定 Docker/部署路径变化的 dev PR/push 执行容器构建/配置校验。该路径过滤器有合法“不运行”的情况。未在所查当前工作流里识别到覆盖全部发布阶段的 Mira Gate 汇总，不能虚构。
- [dev@f7ceb Validate #41981843686](https://github.com/uichat-mira/cloud-pi/actions/runs/41981843686) 与 [Container #41981843684](https://github.com/uichat-mira/cloud-pi/actions/runs/41981843684) success；dev/test/prod 当前分支提交相同，不代表有独立的 test 运行时。
- [Cloud Pi Container Image](https://github.com/uichat-mira/cloud-pi/blob/f7ceb6f90d71cbd9928e6954b363931c78174687/.github/workflows/release-image.yml) 须手动触发，创建绑定构建提交的不可变镜像 prerelease；[direct deploy](https://github.com/uichat-mira/cloud-pi/blob/f7ceb6f90d71cbd9928e6954b363931c78174687/.github/workflows/deploy-direct.yml) 仅允许 prod ref，要求 release_sha 输入、其属于 prod 历史、镜像校验和服务器发布。
- [prod 手动 Deploy #41981897050](https://github.com/uichat-mira/cloud-pi/actions/runs/41981897050) 同 SHA 先失败，随后 [#41982354589](https://github.com/uichat-mira/cloud-pi/actions/runs/41982354589) success；应按**目标发布候选与最新有效尝试**判断，而不是永久保留早期失败。
- 当前所见最近 image prerelease [cloud-pi-84c745d63d55](https://github.com/uichat-mira/cloud-pi/releases/tag/cloud-pi-84c745d63d55) 绑定 84c745d（不是当前 prod HEAD f7ceb）；标准 Run 列表不暴露手动输入的 release_sha，本次无法仅从 deploy Run success 独立判定服务器最终载入哪张镜像。必须另外读取部署元数据/宿主机 version.txt 才能完成部署 SHA 证明。
- [Cloud Pi AGENTS](https://github.com/uichat-mira/cloud-pi/blob/f7ceb6f90d71cbd9928e6954b363931c78174687/AGENTS.md) 区分设计、离线验证、真实云端认证与生产联调，禁止把 Docker success 当业务成功。

### 2.6 Control Room 来源与例证

- [Control Room CI / Deploy](https://github.com/uichat-mira/control-room/blob/0ba58849b10469769badd2c0fc86a2a7ed7ddf71/.github/workflows/deploy.yml) 在 dev/test/prod 的 PR 和 push 都先执行 Verify（npm run check），**仅 prod 非 PR** 执行 Deploy Cloudflare Worker；仍需同 SHA 的生产冒烟，不能根据 GitHub Actions 的最后一个 Run 判断。
- [dev CI #44671003436](https://github.com/uichat-mira/control-room/actions/runs/44671003436) 对 dev@0ba58849 success；[prod 正式部署 #44655515292](https://github.com/uichat-mira/control-room/actions/runs/44655515292) 对 prod@f2a89a5 success。工作流部署时写 DEPLOYED_COMMIT 并核对 /api/v1/health 的精确版本；生产实际版本须回源公网 [health](https://control.mira.tomz.io/api/v1/health) 再比较，不能只相信代码声明。
- 非通用版本监控例子：[AI Review Gateway Smoke](https://github.com/uichat-mira/control-room/blob/0ba58849b10469769badd2c0fc86a2a7ed7ddf71/.github/workflows/ai-review-gateway-smoke.yml) 是 workflow_run 触发的专项检查；在 2026-11-20 [Run #44671081364](https://github.com/uichat-mira/control-room/actions/runs/44671081364) 结果 skipped，并非 prod Deploy 失败。
- [Control Room 仓库环境合同](https://github.com/uichat-mira/control-room/blob/0ba58849b10469769badd2c0fc86a2a7ed7ddf71/docs/environment.md)：dev/test 只做源码及 CI 晋级，没有共享 Cloudflare 实例；prod 部署后的 T5 只属于实际生效的提交。此仓库没有根 AGENTS.md，按当前 Organization AGENTS.md 与本 Issue/仓库合同处理。

## 3. GitHub 保护规则与当前凭据的可证明范围

- 六仓库的普通 [Branch Protection](https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection) 读取均返回 **403 Resource not accessible by integration**：**不能确认**各仓库实际 required status checks、最少审查数、例外规则。应申请适用的只读权限或由维护者出具当前设置的核验证据；未获授权前保持 UNKNOWN。不要为了监控而修改保护策略。
- 仓库级 Rulesets 列表可读取：Desktop prod 规则集 ID **19754667 active**；Mobile prod ID **19859285 active**，均只返回 deletion 与 non_fast_forward 两类规则，**未报告 required_status_checks**；Control Room prod ID **24312136 disabled**；Cloud Auth、Mira Cloud、Cloud Pi 读到的仓库级列表为空。记录的是**本次可见配置**，不能据此证明所有继承/传统保护或 effective branch checks 都不存在。Ruleset 名称或 enabled 状态不能替代生效分支匹配与检查清单。
- 当前 branches 元数据仅 Mira Cloud 的 prod 读到 **protected=true**；Desktop/Mobile/Cloud Auth/Cloud Pi/Control Room 的 prod 在该接口返回 protected=false。此布尔值不足以推断 Actions Gate 是否被实际强制；与 Rulesets 是否存在是不同观察维度。
- Organization [Testing Standard §4](https://github.com/uichat-mira/.github/blob/main/docs/engineering/testing-standard.md) 规定应提供名为 Mira Gate 的稳定聚合状态，但**政策约定不证明每个仓库实现，更不证明 branch protection 已配置必需检查**。
- 建议针对有权限的未来监控读取：REST repository branches / protection 或适用的 repository rulesets（视凭据是否允许）；Checks API 查询目标 HEAD 的 Check Runs / Check Suites；Commit Statuses API 查询同 SHA contexts；GitHub PR reviews 与 mergeability。**权限缺失、不同 Check 的外部 app 来源、等待计算等均单独报告**。

## 4. 给 OPS-034 / 035 的直接采集输入

### 4.1 源与筛选身份

- **仓库发现**：GET /orgs/uichat-mira/repos，筛选目标六仓库、非 archived；一次缓存快照记录 source timestamp、实际默认分支和范围外仓库数。
- **分支/提交**：GET /repos/{owner}/{repo}/branches/{branch}、PR head.sha/base.ref；优先固定 immutable SHA，分别标记 dev/test/prod。
- **Actions**：GET /repos/{owner}/{repo}/actions/runs?branch=...（有条件时按 workflow ID/path 进一步限定），读取 workflow ID/name/path、event、status、conclusion、head_sha、run_attempt、created/updated、html_url、jobs。**不能仅 per_page=1，不能只按 workflow 名字匹配**。
- **必要 Gate**：从当前仓库拥有的 workflow 配置与适用分支/事件关系，判定 job 的 required success、合法 skipped、null/unknown。GitHub **强制执行**门禁仅在实际可读的保护配置证明后声明；否则标记 required_by_workflow=true / required_by_github=unknown。
- **PR/Release**：开放 PR 列表只作候选索引；当前 HEAD 的 Check/Review、可信 Issue 合同、tag、Release、Deploy event，分别用于不同层级。不要拿 Draft 时长、Release 存在、prod ref 更新、任意成功 CI 推断人工阻塞已经解除或部署成功。
- **产线核验**：Desktop Tag→prod provenance + GitHub/R2 产物；Mobile canonical CI→Release→渠道 R2 manifest 与签名文件；Cloud Auth prod deploy→/opt/cloud-auth/.deployed-sha +公网；Mira Cloud prod deploy→服务器/Web/API 及公网 T5；Cloud Pi prerelease SHA→手动 deploy release_sha→主机 version.txt；Control Room prod deploy SHA→公开 /api/v1/health。非公开的 host 状态**不能通过此公共 GitHub read token 直接取证**。

### 4.2 查询成本的真实结构与仍需测量的边界

- 当前 Control Room 核心路径每仓库以 /actions/runs?branch=default&per_page=1 读一次最新 Run，组织约 21 个公开仓库即每轮约 20 次 Run GET（.github 例外），外加组织目录、Release GraphQL、治理和独立 Factory Feed。**这已经是既有成本**。
- #103 假设的六仓库、每 15 分钟一轮、每仓库一个必要 workflow = 6×4=24 Actions GET/h；PR 列表同样 6×4=24 GET/h；再加 12 个候选细查 = **假设增量 60 REST/h**。**本卡发现一仓库可能有多个必要 workflow / 事件路径：Desktop Build + 按路径 CI，Mobile CI + R2 发布，Cloud Pi Validate + 条件 Container，Cloud Auth CI + 生产 Deploy 等。实际所需查询数可能超过假设。**
- 不允许为完成数字指标悄悄省略本应覆盖的 Workflow。OPS-034 应先完成实际请求测量、缓存复用与覆盖损失报告；允许改变采样窗口或减少详细候选数量，但必须明确试点观察范围。Cloudflare Worker 子请求、GitHub REST 主/次级限流、GraphQL point、地域/实例缓存不能用一个“60/h”数字混算。
- 条件请求、304、ETag、Retry-After、403/429/超时、分页截断、因 source SHA 变化导致的过期与候选缺失必须有计量与独立状态。公开 Control Room 不得暴露令牌、私人扫描或部署主机凭据；不在首页默认查询 Cloudflare Workers Logs。

## 5. OPS-033 结论与未解决事项

1. **已证实**：六仓库代码级 Gate / 发布机制具有真实差异；Desktop/Mobile/Control Room 的默认分支是 prod，Cloud Auth/Mira Cloud/Cloud Pi 是 dev；按默认分支最新单 Run 推断当前必要 CI 已被真实案例反证。
2. **已证实**：Mobile、Cloud Auth、Mira Cloud 的工作流内有 Mira Gate 聚合；Cloud Pi 与 Control Room 当前主要依靠独立 Validate/Verify；Desktop 有多个工作流与来源路由检查。**没有证据证明六仓库在 GitHub 保护配置上都强制要求这些检查。**
3. **已证实**：Cloud Auth dev 当前真正的构建阻塞来自 pnpm audit，不是 T1/T2/T3/Docker 失败；Cloud Pi 存在同 SHA 手动发布失败后重跑成功；Cloud Auth/Mira Cloud 的公网 T5 可以警告并退出 0，必须进一步检查实际服务。
4. **未知/待后续授权**：六仓库有效 GitHub required status checks、部分手动部署输入与服务器运行 SHA、真实生产公网验收、R2 最新 manifest、完整 open PR/hold 合同，均非本卡凭据和范围可全部证明。**不得把这些标成“通过”。**
5. **后续切片**：OPS-034 只负责有界采集、覆盖/限流与权限；OPS-035 才用本矩阵与实时 Gate/Release 证据判定人工注意资格。矩阵不是另一份永不更新的 Gate 配置数据库，源仓库仍拥有实际策略。

**本次交付仅是一份审阅用的快照文档；没有设置 GitHub 保护、触发工作流、部署服务、修改其他仓库或判定当前生产完全健康。**
