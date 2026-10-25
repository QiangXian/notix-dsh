# Notix DSH 全链路测试计划

> 目录说明（2026-10-25 后续）：手写源码已统一迁至 `src/host/` 与 `src/client/`，`lib/` 现为全量生成目录。文中早期的 Host `lib/...` 源文件路径对应 `src/host/...`；运行时入口仍使用生成后的 `lib/...`。

> 文档状态：已完成 UX 复核并补入 UI-23～26；本轮已执行核心自动化、真实 DSH UI 与真实通知，结果见 [测试执行报告](TEST_REPORT.zh-CN.md)。未执行项仍保持“未执行”。
>
> 受测对象：`notix-dsh` 0.2.0（以当前工作区文件快照为准）。当前目录没有 Git 元数据，正式执行前需补充受测提交号或源码归档哈希。
>
> 计划日期：2026-10-24。所有用例当前状态均为“未执行”。
>
> 计划规模：15 个用例模块、228 条场景条目（P0 42 / P1 174 / P2 12）；参数化组合在执行时继续展开。

## 1. 目标与验收原则

本计划依据当前仓库的 Host 插件、浏览器设置 UI、macOS 渠道、通知助手、持久化、安装脚本和现有测试资产编写，目标是：

1. 覆盖从 **DSH 事件/投影 → 触发规则 → 去重/冷却/免打扰 → 渲染 → 排队 → 渠道投递 → 历史记录** 的完整链路。
2. 覆盖 **安装/加载 → 设置 UI → 配置持久化与热更新 → Host 即时生效 → 重载/卸载** 的完整链路。
3. 覆盖正常、边界、异常、并发、多会话、重启恢复、兼容性、性能与安全隐私场景。
4. 验证 Notix 始终是纯观察者：不代替用户审批或回答，不写会话事件，不阻塞或改变 Agent 执行结果。
5. 建立“能力—风险—用例—现有测试—结果”的可追踪关系，而不是只验证通知能够弹出。

### 1.1 完成定义

- 本文件列出的每项能力至少映射到一条自动化、集成或实机用例；参数化矩阵必须完整展开，不得只抽测一个组合。
- P0/P1 用例通过率 100%；无未关闭的阻断、严重数据泄露或 Agent 执行受干扰问题。
- 所有失败均附带配置、事件序列、时间线、通知历史和渠道日志；文档默认值与代码有效默认值一致。
- 覆盖率用于发现遗漏，不代替场景验收。建议核心 `lib/core`、`lib/triggers` 分支覆盖率不低于 90%，macOS 后端选择分支通过替身覆盖 100%。

### 1.2 范围边界

**范围内：** 本包公开行为、与 DSH 的集成边界、内置 macOS 渠道、随包通知助手及其构建/安装脚本、打包产物和设置 UI。

**范围外：** DSH/Agent/LLM 自身的完整功能回归、审批或提问业务决策正确性、第三方 notifier 内部实现、macOS 通知中心内部实现、插件市场服务端。只验证它们与 Notix 的契约和相互影响。

### 1.3 UX 验收补充

功能可用不等于体验可接受。除功能断言外，执行时同时检查：

1. **可发现：** 用户能从 Plugins 页看到 Notix 摘要，并在一次点击内进入完整设置；Settings → Plugins 中也能找到同一配置。
2. **首屏可信：** 详情页不得空白、崩溃或只显示标题；表单加载、不可用、只读、保存中、失败必须有清晰可见状态。
3. **信息无歧义：** 设置摘要不重复；不同“后台任务”开关有明确区别；错误、免打扰和点击跳转的说明与实际行为一致。
4. **控件诚实：** 不展示永久禁用或无效果的按钮；依赖字段随主开关启用/禁用；非法输入就地提示且不写入 Host。
5. **每次操作有反馈：** 保存/失败状态可见，刷新或重启后已接受的值保留；失败不能显示“已保存”。
6. **通知可消费：** 标题能快速识别事件类型，正文包含会话/动作上下文，默认不泄露完整命令；同类提醒不轰炸，点击/声音/图标行为与通道能力一致。
7. **键盘与可访问性：** 所有开关、输入和选择器有可读标签、可见焦点和可朗读状态；窄窗口无横向溢出。

## 2. 能力与链路基线

### 2.1 关键链路

```text
安装包 manifest
  ├─ cordis.patch.yml → Host lib/index.js → NotixCore + Triggers + ctx.notix
  └─ dsh.client → 浏览器 lib/client.js → plugins.item / settings.plugins.tab

session/event ─┬─ approval/asked|decided ───────→ 审批及重复提醒
               ├─ turn/start|end ───────────────→ 长 turn / turn 错误 / turn 完成
               ├─ job/registered|settled ───────→ 长后台任务 / 后台任务结束
               └─ tool/call|result ─────────────→ 可选工具错误 / 工具超时
agent/error ───────────────────────────────────→ 与 turn 错误合并去重
userQuestions projection ──────────────────────→ 待回答问题 / continued / 重复提醒

所有触发 → quiet hours → dedupe → error cooldown → 中英文渲染/截断
         → 先写历史（pending）→ 全局串行队列 → 各启用渠道顺序投递
         → 超时/重试/熔断 → 更新 delivered/channels → 可选持久化

设置 UI → configForms.mutate → profile 配置 → loader/volatile-update
        → readConfig/unwrapVolatile → core.replaceConfig → 新规则/渠道生效
```

### 2.2 默认值基线

下表是静态源码口径，不代表各来源已经一致。功能用例除“默认值”专项外，都应显式给出关键开关，避免被打包层覆盖值影响。

| 能力 | `lib/config.js` / Schema / UI 回退值 | 随包 `cordis.patch.yml` | README 监听表 |
|---|---|---|---|
| 审批 | 开；5 分钟；最多 2 次 | 相同 | 相同 |
| 待回答问题 | 开；5 分钟；最多 2 次；continued 再提醒 | 相同 | 监听表未写上限 |
| 长 turn | 开；10 分钟 | 相同 | 相同 |
| 长后台任务 | `jobs=false`；15 分钟 | 未覆盖 `jobs`，继承为关 | 默认关 |
| turn 完成 | 开；仅不短于 3 分钟 | 相同 | 相同 |
| 后台任务结束 | `jobs=false` | 相同（默认关） | 默认关 |
| turn/Agent 错误 | 开；同会话冷却 60 秒 | 相同 | 相同 |
| 普通工具错误 / 工具超时 | 均关，需分别开启 | 相同 | 工具失败写为关 |
| 免打扰 | 关；23:00–08:00；允许 urgent | 相同 | 只概述能力 |
| macOS 渠道 | 开；声音开；点击跳转开；URL/助手路径/图标路径为空时走默认 | 相同 | macOS 为 v1 渠道 |

### 2.3 macOS 实际后端矩阵

代码实际有四种后端，检测顺序如下；首次检测结果会缓存。

| 优先级 | 后端及选择条件 | 声音 | 自定义鲸鱼图标 | 点击打开 `baseUrl` | 失败处理 |
|---|---|---|---|---|---|
| 1 | 配置或默认 `Notix.app` 内存在 `Contents/MacOS/NotixNotifier` | `default` / `silent` | 由签名 Helper App 提供 | 当前未实现 | 权限退出码 2 转专用错误；其他错误抛出 |
| 2 | PATH 中存在 `terminal-notifier` | `-sound default` | 图标文件存在时传 `-appIcon` | 仅 `clickToOpen=true` 且 URL 非空时传 `-open` | 错误抛出，无自动换后端 |
| 3 | PATH 中存在 `alerter` | `--sound default` | 当前未传自定义图标 | 当前未实现 | 错误抛出，无自动换后端 |
| 4 | 以上均不可用，使用 `osascript` | Glass / 无声音 | Script Editor 图标 | 当前未实现 | 错误抛出 |

共同行为：非 macOS 直接报错；渠道错误交由 ChannelRegistry 做每次最多 4 次尝试、退避和熔断。选中后端发送失败时，当前实现**不会**自动降级到下一后端。

## 3. 执行前必须确认的基线与风险

以下是静态审查发现的口径或高风险边界，不作为“已复现缺陷”结论。评审需给出预期；未关闭前，相关用例只能标记为“待确认”，不能直接判产品通过。

| 编号 | 待确认项 | 建议验收口径 |
|---|---|---|
| BL-01 | 后台任务看门和结束提醒在 README、Schema、UI、打包层中的默认值不一致。 | 明确唯一默认值，并分别验证直接加载、随包 patch 加载和 UI 显示一致。 |
| BL-02 | README 写“按会话限流”，实现仅对 `kind=error` 做冷却；其他类型只有 dedupe。 | 明确是否需要通用会话级限流；若不需要，修正文档并按错误冷却验收。 |
| BL-03 | 问题触发器注释称重载时不通知已有问题，但 seed 复用 `observe()`，可能产生首次通知。 | 建议重载只恢复状态、不重复打扰；新出现的问题仍通知。审批重载后的提醒恢复策略也需明确。 |
| BL-04 | 审批关闭时在 `markBusy` 前返回；多个并发审批只用一个 `approval` busy reason；审批没有 session-dispose 清理。 | busy 应表示真实等待状态，与通知开关解耦；最后一个阻塞原因解除才清 busy；销毁会话清理全部状态。 |
| BL-05 | 热更新后既有审批/问题提醒和长任务定时器未必按新开关或新阈值重排；macOS 后端和路径检测被缓存。 | 明确“仅影响新事件”还是“立即影响在途事件”；UI 文案为“即时生效”，建议后者。 |
| BL-06 | `long-task` 与 `completion` 都消费共享 `jobStarts`，且监听器顺序固定；跨会话相同 jobId/callId/approvalId 也可能碰撞。 | 一个结束事件不得让后续观察者丢失 label/duration；明确外部 ID 是否全局唯一，否则以 sessionId 联合隔离。 |
| BL-07 | 免打扰在 dedupe 和历史之前直接丢弃；长 turn 看门狗只发一次，静默后不会在时段结束补发。 | 建议明确为“不投递、不记历史、不积压补发”；仍等待的问题是否继续后续提醒需单独验证。 |
| BL-08 | README 的点击跳转/签名降级描述与后端实际能力不完全一致；Helper 存在但未授权时不会回退 osascript。UI 还写“baseUrl 留空使用默认地址”，实际空值不会传 `-open`。 | 以确认后的后端能力矩阵为准；明确发送失败是重试还是自动降级，以及空 URL 的真实语义。 |
| BL-09 | `scripts/test-macos-notification.mjs` 调用了当前类中不存在的 `detectHelper()`。 | 正式执行前修复或替换自检入口；不能用该脚本当前状态作为渠道通过证据。 |
| BL-10 | UI 的 30 个配置叶子只暴露 27 个，缺 `userQuestion.maxReminders`、`notifierApp`、`appIcon`；“发送测试通知”按钮始终禁用，却建议通过保存验证投递；quiet urgent 文案只提审批而未提问题。 | 三个缺失字段通过 profile patch 覆盖，是否补 UI 由产品决定；保存配置不得被当作已发送通知；禁用按钮仅验证说明与不可操作；统一 urgent 文案与实际范围。 |
| BL-11 | `verbosity` 实际只影响 error body；`minimal` 隐藏错误消息，但审批 reason、后台任务 label 等仍可能包含命令或路径，`normal` 也只是截断 error.message，并非完整命令/文件内容；渠道异常日志还可能带参数。 | 统一文档与实现，建立字段级隐私白名单和日志脱敏口径，再执行 secret canary 用例。 |
| BL-12 | 本地 overlay 曾以固定绝对路径入库；已拆为入库模板 `dev/notix.patch.example.yml` + 被 `.gitignore` 忽略的 `dev/notix.patch.local.yml`。 | E2E 环境准备时生成指向受测 checkout 的临时 patch，不直接依赖本机实例路径。 |
| BL-13 | 错误冷却中的 suppressed count 在窗口结束后是否应汇总到下一条，需要结合当前状态重置逻辑确认。 | 明确“合并提醒”的计数语义，并验证窗口内、跨窗口和重启后的行为。 |
| BL-14 | 定义了 30 秒 busy 重查常量，但实际重查使用任务阈值；预注册 job 的剩余阈值计算也需确认。 | 建议忙碌解除后 30 秒内重查；已有 startedAt 的 job 按已运行时长计算剩余等待。 |
| BL-15 | `history(0)`、负数/小数/NaN limit、空数字输入、非法 quietHours 字符串等公开边界没有完整契约。 | 执行前固定输入校验和归一化规则；不允许静默产生“返回全部”或意外改为 0 等危险行为。 |

本轮执行状态：BL-01、BL-02（文档口径）、BL-09、BL-12 已修复；BL-08、BL-10、BL-11 已修正 UI/文档中会误导用户的说明，但后端降级策略、3 个高级字段的 UI 暴露和隐私字段白名单仍需产品决策；BL-03～07、BL-13～15 尚未关闭。详见 [测试执行报告](TEST_REPORT.zh-CN.md)。

## 4. 测试策略与环境

### 4.1 优先级

- **P0：** 安装可用性、纯观察者、审批/提问主链路、Agent 故障隔离、隐私、配置写入破坏风险。
- **P1：** 其余触发器、去重/冷却/免打扰、持久化、重试熔断、UI 全字段、macOS 各后端和重启恢复。
- **P2：** 扩展浏览器/系统组合、视觉细节、极端 Unicode、长稳和低频边界。

优先级表示执行顺序，不等于缺陷严重度。安全与 Agent 阻断问题无论来自哪条用例都按高严重度处理。

### 4.2 分层方法

| 层级 | 方法与工具建议 | 主要对象 |
|---|---|---|
| L0 静态/打包检查 | manifest、导出、包内容、文档默认值对照；在独立临时目录解包 | 包结构和发布完整性 |
| L1 单元/组件 | Node test、可控时钟、可控 timers、内存 storage、捕获型 channel | 规则、状态机、渲染、队列、重试、熔断 |
| L2 Host 集成 | 真实 Cordis + 可控 sessions/projections/storage；事件序列驱动 | 生命周期、热更新、跨触发器、真实服务注入 |
| L3 UI 组件 | React 测试支架 + ConfigFormController/Slots/Locale 仿真 | 渲染、交互、校验、状态与可访问性 |
| L4 渠道集成 | 临时 PATH 中的可执行替身、临时 Helper/Home；严禁调用真实通知 | 进程参数、选择优先级、错误和平台分支 |
| L5 DSH E2E | 隔离 profile，复用受测 DSH Web GUI，真实 Host/Client/Storage | 安装、两页面、热更新、真实 Agent 事件与重启 |
| L6 macOS 实机 | 专门测试签名和通知权限，逐后端人工确认 | 横幅、声音、图标、点击、系统权限与 Focus |
| L7 非功能 | 事件风暴、多会话、故障注入、长稳、敏感数据 canary | 性能、资源、韧性、安全隐私 |

现有 `pnpm test`、`pnpm smoke` 可作为未来自动化入口，但应先补足缺口；本轮不运行。真实通知脚本只能在 L6 明确授权后单独使用。

### 4.3 环境矩阵

| 维度 | 必测 | 扩展/说明 |
|---|---|---|
| DSH | 支持范围最低版本、当前目标版本、范围内最新版本 | `>=0.2.1-rc.2 <0.3.0`；范围外版本验证清晰拒绝或不支持提示 |
| 安装 | registry/tarball 安装、`link:` 开发安装、旧双包升级 | 全新 profile 与已有 `id:notix` 配置各一套 |
| 运行 | 真实 Cordis、真实 DSH Host + Web GUI | storageDomain 有/无/故障三类 |
| macOS | 当前支持版本，Apple Silicon；若支持 Intel 则补 Intel | Helper 声明最低 macOS 11，实际矩阵还需满足 DSH 自身要求 |
| 通知后端 | Helper、terminal-notifier、alerter、osascript | 每次只让目标后端可见，避免优先级串扰 |
| 浏览器 | DSH 正式支持的 Chromium 浏览器 | Safari/Firefox 仅在 DSH 支持时纳入；移动窄屏做布局检查 |
| 主题/语言 | Light/Dark × 中文/English | UI 语言与通知 `language` 分开验证 |
| 架构与权限 | 正常用户、无通知权限、只读配置部署 | 不使用真实用户生产 profile 或真实助手安装目录做破坏性测试 |

Node/pnpm 版本在正式执行前按所选 DSH 的支持矩阵锁定，不在本计划中虚构额外版本要求。

### 4.4 测试数据与隔离

- 会话：`s1`、`s2`，含同名标题、空标题、超长标题和相同外部 callId/jobId/approvalId 的隔离数据。
- 时间：阈值前 1ms、恰好阈值、阈值后 1ms；午夜、跨天免打扰、24 小时 dedupe 边界；统一可控时钟。
- 文本：空值、纯空白、换行、引号、反斜杠、Emoji/CJK、超长字符串、`$()`/反引号/AppleScript 片段等只作为字面值的数据。
- 隐私：在 message、reason、label、sessionTitle、baseUrl、日志中放置不同 `SECRET_*` canary，逐字段断言出现或隐藏的位置。
- 配置：每一开关的 on/off、数值 0/下限/上限/越界、直接 patch 与 UI 两种来源；除默认值专项外显式配置。
- 隔离：使用临时 HOME、临时 `NOTIX_APP_OUTPUT`、独立 DSH profile 和通知分组。不得为测试删除真实 `~/Applications/Notix.app`，不得输出签名私钥或 API Key。
- 证据：事件序列、配置快照、通知调用参数、history 前后快照、timer 数、日志、截图/录屏和 Host 版本；真实通知用例还需权限状态。

## 5. 详细测试用例库

> 表内“参数化”表示列出的每个值/组合都要执行。除专用实机用例外，优先用捕获渠道断言，避免把系统横幅可见性当作唯一判据。

### 5.1 A. 打包、安装与生命周期（PKG）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| PKG-01 | P0 | 校验 name/version/main/exports、Host/Client 入口、cordis patch、locale、icon、DSH engine 和依赖声明。 | 所有声明指向包内实际文件；Client 平台与 inject 正确；无旧 `notix-dsh-ui` 引用。 |
| PKG-02 | P1 | 在未来执行打包并解包检查文件清单、符号链接和路径。 | Host/Client、assets、scripts、locale、README、LICENSE、patch 完整；无 node_modules、build、测试临时文件、密钥和绝对本机路径依赖。 |
| PKG-03 | P0 | 在全新隔离 profile 通过 registry/tarball 安装并启用 bundle，刷新受测 GUI。 | 只加载一个 Host 和一个 Client；Plugins 与 Settings→Plugins 均可配置；无第二个 UI 包安装要求。 |
| PKG-04 | P1 | 通过 `link:` 安装；随后复制/移动 checkout，用重新生成的临时 patch 再加载。 | 路径按当前 checkout 解析；无旧绝对路径残留；Host/Client 均可用。 |
| PKG-05 | P0 | 从旧双包升级到单包，保留旧 `id:notix` 配置；再验证重复来源/旧 UI 同时启用。 | 只保留一个 Notix 来源时配置兼容；重复启用有明确提示且不会重复通知或重复插槽。 |
| PKG-06 | P0 | 分别缺少 sessions、timer、sessionProjections；再模拟 schemastery 无法解析。 | 必需服务缺失时加载失败清晰且不半初始化；仅 schema 缺失时有效默认配置仍可运行，设置表单明确 unavailable。 |
| PKG-07 | P1 | storageDomain 分别为正常、未提供、open 抛错/返回异常；观察启动和通知。 | 正常时持久化；其余按契约降级内存并告警；通知和 Agent 不因存储故障崩溃；慢/挂起 open 的启动上界需确认。 |
| PKG-08 | P0 | 检查 `ctx.notix.notify/registerChannel/history/config`；传入空 notify、非法 adapter、缺 send 等。 | 正常 API 可用；非法输入有明确、可预期错误且不产生半条历史；config 反映当前有效值。 |
| PKG-09 | P0 | dispose 后再次发 session/projection/agent 事件、推进所有 timer、调用旧回调。 | 服务与全部订阅/提醒/看门狗清除，storage 关闭，无新通知、无未处理拒绝；重复 dispose 不破坏 Host。 |
| PKG-10 | P1 | 热重载和进程重启，覆盖未读历史、未到期 dedupe、在途审批/问题/turn/job。 | 持久数据和配置按契约恢复；不重复打扰；在途状态按 BL-03 恢复或安全放弃，无幽灵定时器。 |
| PKG-11 | P1 | 参数化 DSH 最低、当前、范围内最新和范围外版本。 | 支持版本功能一致；不支持版本不会静默以未知契约运行，错误可诊断。 |
| PKG-12 | P1 | 仅生产依赖安装后在 macOS 与非 macOS 启动；非 macOS 保持默认渠道并发通知。 | 不依赖 devDependency；非 macOS 不执行 osascript，不错误阻断 Agent，渠道禁用/降级策略清晰。 |
| PKG-13 | P1 | 同一 Host 多会话并行加载与销毁其中一个会话，另一会话继续。 | 单例服务正常；会话状态互不误清，无重复订阅或跨会话通知。 |
| PKG-14 | P2 | ctx.logger 正常、返回空值、抛错；渠道或渲染再次抛错。 | logger 回退可用，告警不会递归打崩通知或 Agent；日志不含不应出现的正文/密钥。 |

### 5.2 B. 配置 Schema、合并与热更新（CFG）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| CFG-01 | P0 | 分别经直接插件、随包 patch、UI 空配置解析全部默认值。 | 与 BL-01 确认后的唯一默认矩阵一致；所有字段完整且不会共享意外可变状态。 |
| CFG-02 | P1 | 仅覆盖一个深层字段；输入包含 null、数组、未知字段和嵌套部分对象。 | 合法深合并，其他默认保留；不修改 DEFAULTS 或输入；非法形状按 Schema/降级契约处理。 |
| CFG-03 | P1 | volatile ref 出现在叶、对象、数组及嵌套组合，动态改变 get() 后重读。 | 每轮得到全新普通快照；无 ref 泄漏到运行时；未变字段仍正确补默认。 |
| CFG-04 | P0 | 参数化 language、verbosity 的合法/非法值。 | 仅 zh/en、minimal/normal 被接受；非法值拒绝且旧有效配置保留。 |
| CFG-05 | P1 | 对全部时长/冷却字段验证 -1、0、1、小数、NaN、Infinity、超大值。 | Schema 要求整数毫秒且不小于 0；0 的“禁用/立即”语义逐字段符合规则；非法输入不进入 Host。 |
| CFG-06 | P1 | 对 approval/userQuestion 的 maxReminders 验证 -1、0、1、2、10、11、小数；审批同时走 UI/profile，用户问题先走 profile。 | 仅 0–10 整数合法；已暴露的 UI 与 profile 契约一致，0 表示不做重复提醒；用户问题若补 UI 后复用同一矩阵。 |
| CFG-07 | P1 | quietHours from/to 输入合法 HH:MM、单数字小时、越界、空值、非字符串。 | 采用 BL-15 的统一格式契约；非法值不能意外开启/关闭整天免打扰，错误可诊断。 |
| CFG-08 | P0 | UI 遍历修改 27 个已暴露 volatile 叶，其余 3 个经 profile 修改，分别触发 loader/volatile-update；保留 core/api.config 引用。 | 原引用看到新值，配置对象身份不被替换；无需 remount，profile 中保存相同值。 |
| CFG-09 | P1 | 热切换 macos.enabled：off→on→off→on，期间发通知。 | 注册/注销幂等，不重复渠道；off 时无系统进程，历史 delivered/channels 与实际一致。 |
| CFG-10 | P1 | 热改 language、verbosity、quietHours、error.cooldownMs、completion.minDurationMs。 | 新事件立即用新规则；已生成历史不被回写；在途事件按 BL-05 处理。 |
| CFG-11 | P1 | 热改审批/问题的 enabled、间隔、上限，以及长任务开关/阈值/jobs。 | 在途 timer 的取消、重排、上限和新建行为符合 BL-05；无重复 timer 或禁用后仍提醒。 |
| CFG-12 | P1 | readConfig/replaceConfig/syncChannels 注入异常，随后再提交合法更新。 | 异常被告警隔离，不破坏上一次有效配置；后续合法更新可恢复，无未处理拒绝。 |
| CFG-13 | P1 | 修改后重启 DSH，再比较 UI、Loader、Host 和实际通知。 | 四方值一致；被拒绝的修改不持久化，不显示“已保存”。 |
| CFG-14 | P2 | Schema 不可用时传入合法配置和非法配置；再恢复 Schema。 | 合法配置降级可用；非法配置的 fail-closed/忽略策略明确；恢复后表单与校验可用。 |

### 5.3 C. 设置 UI 与浏览器链路（UI）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| UI-01 | P0 | 加载浏览器 bundle 并执行 factory。 | 模块 id 唯一，导出 apply/inject/NS；依赖均可由 DSH 注入，无语法错误和额外未声明 require。 |
| UI-02 | P1 | notix 配置服务出现、消失、再次出现；观察两个 slot。 | whileServed 正确挂载/卸载 `plugins.item` 与 `settings.plugins.tab`，顺序/id/label 正确，不重复注册。 |
| UI-03 | P1 | 分别进入 Plugins 和 Settings→Plugins。 | 两处均能显示同一 Notix 配置；一处修改后另一处同步；不出现双份样式或双份卡片。 |
| UI-04 | P1 | 模拟 loading、unavailable、ready 空值、ready 部分值、read-only。 | 各状态文案正确；部分值由默认补齐；加载/不可用不显示可误操作表单。 |
| UI-05 | P1 | 参数化 0–5 个启用触发器、quiet/channel 开关，查看摘要与完整页。 | 两处摘要计数和开关一致，来自已接受快照而非未保存草稿。 |
| UI-06 | P0 | 遍历每个已暴露的主开关、子开关、下拉框、时间和文本控件，记录 mutate path/value。 | 仅写目标路径；approval/userQuestion/longTask/error/completion、quiet、language、verbosity、sound/click/baseUrl 均正确。 |
| UI-07 | P1 | 关闭主开关、关闭 longTask.jobs、只读和保存中。 | 对应子字段保留可见但禁用；jobThreshold 还受 jobs 控制；所有禁用态不会产生 mutate。 |
| UI-08 | P1 | 验证 UI 未暴露的 userQuestion.maxReminders、notifierApp、appIcon。 | 可按 BL-10 通过 profile 设置且 UI 不清空/覆盖这些值；若决定补 UI，则追加对应路径用例。 |
| UI-09 | P1 | 分钟字段输入 0、0.01、1.5、大值、负数、空串、空白、NaN、Infinity、科学计数法；另放入非 0.01 分钟精度的原始 ms 后直接 blur。 | 合法值正确换算并四舍五入为整数 ms；非法值不写 Host；空串行为符合 BL-15，不得静默变 0；未编辑不得仅因显示精度而改写原值。 |
| UI-10 | P1 | 在审批 maxReminders 控件输入 0、1、10、11、-1、1.4、1.5、空串。 | 仅接受约定范围；取整策略与 Schema/文案一致；非法输入有错误提示且不提交。 |
| UI-11 | P1 | 数字和文本分别通过 blur、Enter、重复 Enter、值未变 blur 提交，并记录 mutate 调用次数。 | 一次用户提交只写一次且值正确，Enter 后的 blur 不重复 mutate；未变化不多发；非法 Enter 不应通过失焦隐藏错误，合法 Enter 正常结束编辑。 |
| UI-12 | P1 | 输入非法数字后修改、blur、接收外部快照。 | `aria-invalid`/describedby/role=alert 正确；保留可修正草稿；外部合法值按焦点契约同步。 |
| UI-13 | P1 | Host 在字段聚焦编辑时和未聚焦时推送新值。 | 聚焦时不覆盖正在输入的草稿；失焦/提交后按已接受值收敛；未聚焦立即同步。 |
| UI-14 | P1 | mutate 分别 resolve true、resolve false、reject、长时间 pending。 | true 显示已保存；false/异常显示失败并保留输入；pending 锁定字段；状态不会被旧请求错误覆盖。 |
| UI-15 | P1 | 快速修改多个字段/同字段多次，乱序完成请求。 | 不丢更新、不错误显示最终状态；pending 计数归零；若不支持并发，应串行或明确阻止。 |
| UI-16 | P1 | TimeField 和 SelectField 通过键盘/鼠标修改，尝试非法时间或伪造 option。 | 合法值立即写正确路径；非法 UI 输入不提交；通知语言与 UI 界面语言互不错误联动。 |
| UI-17 | P1 | 切换 DSH 中/英文，再独立切换通知 language。 | 界面字典无缺失/回退乱码；通知正文按自身 language； Plugins locale 元信息正确。 |
| UI-18 | P1 | 卸载/重挂组件并检查订阅、style、timer 和事件监听。 | 订阅全部释放；相同样式最多一份；无 setState-after-unmount 或重复保存。 |
| UI-19 | P1 | 键盘遍历 Switch/input/select/button，检查 label、focus、status live region、对比度。 | 全部可操作控件可访问且名称唯一；错误/保存状态可朗读；焦点可见，不只靠颜色表达。 |
| UI-20 | P2 | Light/Dark × 中/英文 × 宽/窄视口，覆盖长错误和长 URL。 | 两页面无溢出、遮挡、截断关键控件；主题变量有效；保留截图基线。 |
| UI-21 | P1 | 查看“发送测试通知”按钮及提示，尝试点击；再仅保存任一配置并观察是否有通知。 | 当前版本按钮始终禁用且解释未来能力，不会伪造 Host 请求；保存配置本身不等于发送测试通知，提示不得造成误解；通过其他受控入口完成渠道测试。 |
| UI-22 | P2 | 页面刷新、客户端重载和受支持的浏览器组合。 | bundle 重建后刷新可加载；不承诺未经 watcher 验证的 HMR；状态恢复、控制台无未处理异常。 |
| UI-23 | P0 | 从 Plugins 列表点击 Notix 进入详情，再从 Settings → Plugins 打开 Notix 页签；捕获控制台与 DOM。 | 两个入口都渲染完整卡片，不空白、不崩溃、无 `getSnapshot is not a function`；页面标题摘要只出现一次。 |
| UI-24 | P1 | 检查完整设置页的摘要、提示文案和控件可用性。 | 摘要不重复；“留空则不启用点击跳转”等提示与实际行为一致；无永久禁用或未来能力的死控件。 |
| UI-25 | P1 | 关闭 clickToOpen 后检查 URL 输入；开启后再检查。 | URL 字段随主开关禁用/启用，禁用时不可编辑且视觉清晰，保存后刷新保持该状态。 |
| UI-26 | P1 | 检查长任务与完成两组中的后台任务开关、阈值和完成时长文案。 | 两组开关有不同且可理解的标签，术语“轮次/任务”一致，用户能区分超时提醒与结束提醒。 |

### 5.4 D. 审批触发器（APR）

通用事件：`approval/asked(id, toolName, reason)` → 可选多次 reminder → `approval/decided(id, outcome)`。除通知外，必须同时观察 busy、pending timer、会话事件和工具是否执行。

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| APR-01 | P0 | asked 后检查首次通知的 urgency、dedupeKey、标题/reason/会话标题。 | urgent；内容正确；只通知，不自动允许/拒绝，不追加任何会话事件。 |
| APR-02 | P0 | 等待用户处理，Agent/工具保持待决；分别允许、拒绝及支持的其他 outcome。 | 决定权仍在原 DSH 流程；Notix 无 answerer；decided 后取消后续提醒并正确清 busy。 |
| APR-03 | P1 | approval.enabled=false 时 asked/decided；再动态开启并发送新审批。 | 不发审批通知；busy 是否仍跟踪按 BL-04；重新开启后仅新审批通知，无历史补发。 |
| APR-04 | P1 | maxReminders 参数化为 0、1、2、10，间隔短于测试阈值。 | 首次 1 条加恰好 N 条不同 reminder key；达到上限后无额外通知/timer。 |
| APR-05 | P1 | remindAfterMs=0；再验证恰好到期和 decided 与回调同刻。 | 0 禁用重复提醒；竞争时最多产生契约允许的一条，不出现 decided 后持续提醒。 |
| APR-06 | P1 | asked 后未决定，重复投影/重复 asked、同 id 不同内容。 | 重复事件不多条提醒链；是否更新内容/是否重发按幂等契约，dedupe 不错误吞掉新审批。 |
| APR-07 | P1 | decided 未知 id、重复 decided、decided 先于 asked。 | 不抛错、不误清其他审批或 question busy；后续合法审批仍可通知。 |
| APR-08 | P0 | 同会话两个未决审批，决定其中一个再决定另一个。 | 仍有未决项时 busy 保持；对应 timer 独立；全部结束后才清 approval busy。 |
| APR-09 | P0 | 两会话使用相同和不同 approvalId，交叉 asked/decided。 | 通知、定时器和 busy 按确认后的 ID 契约隔离；不会一会话决定取消另一会话提醒。 |
| APR-10 | P1 | 同会话审批与问题并存，分别解除其中一个。 | 两种 busy 独立；全部解除前长任务看门狗仍按等待用户处理。 |
| APR-11 | P1 | 未决时 session/disposed 或插件 dispose。 | pending/timer/busy 全部清理，无后续通知和内存增长。 |
| APR-12 | P1 | 缺 toolName/reason/id、异常 session projection、非法事件数据。 | 缺内容有安全回退；关键 id 非法时不污染全局状态；错误只告警，不影响 Agent。 |
| APR-13 | P1 | 等待期间热改 enabled/remindAfterMs/maxReminders。 | 已建提醒链按 BL-05 立即取消/重排/限次，次数计算不重复、不绕过新上限。 |
| APR-14 | P1 | quietHours 内首次及提醒到期，分别 allowUrgent=true/false，直到退出免打扰。 | urgent 穿透规则正确；被静默项不记历史；后续提醒和补发策略符合 BL-07。 |
| APR-15 | P1 | 重启时仍有未决审批；DSH 重放或不重放 asked 各测一次。 | 按 BL-03 恢复/去重，不重复提醒风暴，不自动做审批决定。 |

### 5.5 E. 待回答问题触发器（UQ）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| UQ-01 | P0 | projection 从空变为一个 open，含一个/多个 questions。 | 首次 urgent 通知；取首个问题、总数和会话标题正确；busy=true。 |
| UQ-02 | P1 | 相同 open projection 连续多次、无关 projection key 变化。 | 不重复通知、不重复建 timer；无关 key 完全忽略。 |
| UQ-03 | P1 | open→continued→重复 continued→settled，remindOnContinued 分别 on/off。 | on 时 continued 只通知一次，off 时不通知；open 首次提醒链在离开 active 后取消。 |
| UQ-04 | P1 | open→continued→open、问题内容变化、state 未知。 | seen.open/continued 语义稳定，不因状态往返形成通知风暴；内容更新策略明确。 |
| UQ-05 | P1 | active 中多个 callId、单个 callId 含 0/1/N 个子问题。 | 每个新 callId 独立追踪；0 或缺文本使用回退文案；count 正确；busy 在 active 非空时保持。 |
| UQ-06 | P1 | maxReminders=0/1/2/10，remindAfterMs=0/正数，问题一直未回答。 | 次数和间隔准确；每次 key 唯一；回答/离开 active 后立即停止。 |
| UQ-07 | P1 | 回答后重复 settled、重新出现同 callId、全新 callId。 | settled 本身不通知；同 ID 重用或新 ID 的 dedupe/announced 清理符合会话生命周期契约。 |
| UQ-08 | P1 | userQuestion.enabled=false 后出现 open，再开启并出现另一问题。 | 关闭期间无通知但仍正确维护 busy/seen；开启不补发旧问题，新问题正常。 |
| UQ-09 | P1 | 热改 remindOnContinued、间隔、上限、enabled。 | 在途提醒按 BL-05 处理；已有 announced 集不被意外重置造成重复首次通知。 |
| UQ-10 | P0 | 两会话 active 独立更新，使用相同 callId 和不同 callId。 | 不互相覆盖 reminders/announced/busy；一个会话清空不影响另一个。 |
| UQ-11 | P1 | 一个会话有审批与多个问题，逐条离开 active。 | 仅 active 全空时清 question busy；approval busy 独立；长任务不错误唤醒。 |
| UQ-12 | P1 | 插件启动前已有 open/continued/settled，sessions.list 正常/为空/抛错。 | seed 行为符合 BL-03；异常只告警并仍可订阅后续变化，不阻断 Host。 |
| UQ-13 | P1 | stateOf 返回 undefined、active 非数组、question 缺 callId/非字符串/questions 非数组或抛错。 | 安全归一为空/跳过非法项；不通知畸形项、不留下无法清理的 busy。 |
| UQ-14 | P0 | sessionProjections 不存在、无 onChanged、订阅后 dispose。 | 缺失时明确禁用该触发器但其他触发器工作；dispose 必须退订，旧 projection 不再产生通知。 |
| UQ-15 | P1 | session/disposed 时仍有多个问题及 timer。 | announced/reminders/question busy 全清，其他会话不受影响。 |
| UQ-16 | P1 | quietHours allowUrgent 两值下首次 open、continued 和 reminder。 | 与审批 urgent 规则一致；无意外历史/补发，busy 不因通知被静默而丢失。 |
| UQ-17 | P1 | 真实 GUI 回答问题，同时监听通知与会话。 | Notix 不提交答案；由原问答链路完成 settled；通知只反映 GUI 相同 active 投影。 |
| UQ-18 | P1 | open 保持 active 转为 continued，继续等待多个提醒间隔，核对提醒内容、次数及最终 settled。 | continued 的一次性通知是否占用 maxReminders 需固定；原 open 链的继续/取消和 payload 更新符合确认口径，不出现双提醒链或 settled 后提醒。 |

### 5.6 F. 长 turn / 长后台任务看门狗（LT）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| LT-01 | P1 | turn 持续时间在阈值前/恰好/后 1ms 结束或保持运行。 | 仅运行达到阈值且未结束时发一次 long-task；duration/turn/sessionTitle 正确。 |
| LT-02 | P1 | turnThresholdMs=0、enabled=false、重复 turn/start。 | 0/关闭不建看门狗但仍记录开始时间供 completion；重复 start 不留下多条同 key timer。 |
| LT-03 | P1 | turn/end 在阈值前、与阈值同刻、重复 end、未知 turn end。 | 在途 timer 正确取消；未知/重复 end 不抛错、不误删其他 turn；不多发。 |
| LT-04 | P1 | 同一 session 多 turn、不同 session 同 turn 序号并行。 | `${sessionId}:${turn}` 状态隔离；每个至多一条长 turn 通知。 |
| LT-05 | P1 | 到期时 busy，保持忙碌多次重查，再解除；期间 turn 已结束。 | busy 时不发长任务；结束会清 timer；解除后按 BL-14 重查一次并仅发一条，duration 含真实总时长。 |
| LT-06 | P0 | approval 通知开关关闭但实际仍等待审批；question/approval 多原因组合。 | 长任务抑制依据真实 busy 而非通知开关；最后一个原因解除后才可触发。 |
| LT-07 | P1 | 等待期间热改 enabled、turnThresholdMs、quietHours。 | 既有 timer 按 BL-05 取消/重排；新阈值不导致立即连发或旧阈值漏发。 |
| LT-08 | P1 | job enabled/jobs/jobThresholdMs 组合：总开关 off、jobs off、阈值 0、全开。 | 仅 enabled=true、jobs=true、阈值>0 时建 job 看门狗；beginJob 仍可供 completion 使用。 |
| LT-09 | P1 | job 在阈值前/恰好/后结束，持续运行则到期；验证 label/kind/jobId/duration。 | 到期一次，结束取消；字段和时长正确，无额外周期通知。 |
| LT-10 | P1 | registered 自带过去 startedAt、0、非法值、未来值、缺 startedAt。 | 已运行时长和剩余 timer 按 BL-14；非法值安全回退当前时间；未来值不产生负时长文案。 |
| LT-11 | P1 | jobId 缺失/非字符串、label 为空、kind 回退、重复 registered。 | 非法 id 忽略；label 回退正确；重复注册不多条 timer、不覆盖其他会话状态。 |
| LT-12 | P1 | 同 session 多 job、跨 session 相同 jobId，交叉 settled。 | ID 契约按 BL-06；各自 label/duration/timer 不串线，无误取消。 |
| LT-13 | P1 | job 到期时关联 session busy，再解除或 job 先 settled。 | 与 turn 相同的等待抑制；结束后不再发长任务；不会清错 busy。 |
| LT-14 | P1 | 长 turn/job 到期时处于免打扰，退出后继续保持运行。 | 按 BL-07 不记历史、不投递；是否补发严格符合确认口径，无静默重复。 |
| LT-15 | P1 | dispose/session 销毁、Host 关闭时仍有大量看门狗。 | 所有 timer 与 map 清空；无回调进入已关闭 storage；其他会话按生命周期契约保留或清理。 |
| LT-16 | P2 | 系统时钟回拨/跳跃、电脑睡眠后唤醒（单测模拟 + 实机）。 | 不出现负时长、异常连发或永久不看门；单调时钟/墙钟取舍有记录。 |

### 5.7 G. 错误触发器（ERR）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| ERR-01 | P0 | turn/end reason.kind=error，再测试 completed/cancelled/缺 reason。 | 仅 error 通知；urgency=normal，turn/errorName/message/sessionTitle 正确。 |
| ERR-02 | P0 | agent/error→turn/end、turn/end→agent/error、各自单独、重复多次。 | 同 session+turn 仅一条；首个有效来源内容不被重复覆盖；不同 turn 不受错误去重影响。 |
| ERR-03 | P1 | agent/error 缺 agent/session/turn，projection 抛错，error 为 null/字符串/对象。 | 无会话时安全忽略；describe 按 code→name→kind→Error 回退；消息稳定且不抛错。 |
| ERR-04 | P1 | error.enabled=false 时三类错误；动态重开。 | turn、agent、tool 全部静默；工具名追踪是否保留不应造成泄漏；重开后只处理新错误。 |
| ERR-05 | P1 | tool/call 记录 callId→name，随后成功 result、isError 非 true、普通失败。 | 成功不通知；普通失败名称优先来自 tool/call，找不到时回退 info.name/tool。 |
| ERR-06 | P1 | 普通工具错误按 toolErrors off/on，toolTimeout off/on 做组合。 | 普通错误只受 toolErrors 控制；总 enabled 仍为前置条件；工具超时不错误受普通开关替代。 |
| ERR-07 | P1 | 超时分别由 code=TOOL_TIMEOUT、name=ToolTimeoutError 指示，组合两个超时开关。 | 超时只受 toolTimeout 控制；开启后 errorName=ToolTimeout；非超时不会被误判。 |
| ERR-08 | P1 | tool/result 缺 toolCallId、重复 result、跨会话同 callId、超过 200 个工具名。 | 非法 ID 不导致互相 dedupe；重复结果一次；映射最多 200 且淘汰最旧项；会话隔离符合契约。 |
| ERR-09 | P1 | 同 session 不同 error key 在冷却内、恰好到期、到期后；不同 session 并行。 | 同 session 窗口内抑制，窗口外允许；不同 session 独立；cooldownMs=0 完全禁用冷却。 |
| ERR-10 | P1 | 同 turn 重复错误与不同 turn 冷却同时发生，重启后再发。 | dedupe 与 cooldown 的先后和计数符合设计；dedupe 可持久化，cooldown 是否跨重启按当前内存契约明确。 |
| ERR-11 | P1 | 窗口内合并 N 条后，窗口外再发生错误，检查 suppressed 文案。 | 计数及“另有 N 条”符合 BL-13，不多算被 dedupe 的完全相同事件，不跨错误窗口串计数。 |
| ERR-12 | P0 | minimal/normal 下在 message 放 secret、命令、路径和超长文本。 | minimal 不出现 error.message；normal 仅显示约定截断内容；日志和标题不泄漏 secret，字段白名单符合 BL-11。 |
| ERR-13 | P1 | 工具错误同时导致 agent/error 和 turn/end error。 | 按各自 dedupe/cooldown 规则合并，通知数量可解释；同一次根因是否需跨 scope 合并由产品确认并固定。 |
| ERR-14 | P1 | quietHours 内错误、冷却后错误、错误通知渠道失败。 | quiet 优先且不写 dedupe/cooldown/历史；冷却和渠道故障不向外抛入 Agent；恢复后行为可预测。 |
| ERR-15 | P1 | tool/call 或 agent/error 在插件 dispose 后到达。 | 无 toolNames 增长、无通知、无未处理异常。 |

### 5.8 H. 完成触发器（CMP）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| CMP-01 | P1 | completed turn 时长为 minDuration 前/恰好/后 1ms。 | 达到下限才通知；urgency=low；duration、turn、sessionTitle 和中英文文案正确。 |
| CMP-02 | P1 | error/cancelled/其他 reason 的 turn/end。 | 不发出“完成”通知；仍消费 turnStarts，不泄漏 map。 |
| CMP-03 | P1 | completion.enabled=false、minDurationMs=0、未知 start 的 turn/end。 | 关闭仍清理开始状态；0 和未知 start 是否通知按明确契约，避免插件中途加载误报 0 时长完成。 |
| CMP-04 | P1 | 重复 turn/end、重复 turn 序号跨 session、插件重启后仅收到 end。 | dedupe/状态清理正确；不跨会话误算；重启未知开始时间按契约处理。 |
| CMP-05 | P1 | completion.jobs off/on × enabled off/on，job completed。 | 两个开关同时开才通知后台任务结束；关闭仍清理 jobStarts；默认行为按 BL-01。 |
| CMP-06 | P1 | job status=completed/failed/缺失/其他终态。 | failed 标题和 normal urgency 正确；其他状态用结束标题和 low urgency；缺失回退 completed。 |
| CMP-07 | P1 | registered 后运行一段时间再 settled，使用捕获渠道检查 label 与 duration。 | 使用注册时 label/start；即使 long-task 监听器先执行也不丢 facts；时长与真实运行一致。 |
| CMP-08 | P1 | 未 registered 的 settled、重复 settled、settled 自带 label。 | 未知任务按契约回退 label/0 时长或忽略；重复只通知一次；不会读到其他 job 的 facts。 |
| CMP-09 | P1 | 跨 session 相同 jobId、同 session 多 job 交叉结束。 | 通知内容、urgency 和状态隔离；一个任务结束不删除另一个任务 facts。 |
| CMP-10 | P1 | 长任务看门已发，再完成 turn/job；quietHours 内完成。 | 长任务与完成是不同 dedupe key，可各一条；quiet 内完成不投递/不记历史，不错误抑制后续其他任务。 |
| CMP-11 | P1 | 等待期间热改 enabled/minDurationMs/jobs，dispose 后收到 settled。 | 新完成事件用新配置；dispose 后无通知；开始状态不泄漏。 |

### 5.9 I. 核心管线、免打扰、渲染与服务 API（CORE）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| CORE-01 | P0 | 对所有 kind 走完整 submit，观察每一步顺序和 history。 | quiet→dedupe→cooldown→render→record→queue→deliver→update；被静默项不产生后续副作用。 |
| CORE-02 | P1 | quiet disabled；from<to；from>to；from=to；from/to 非法；边界 from、to 各测。 | 采用本地时间，区间[from,to)；跨午夜正确；相等/非法按契约不免打扰；urgent allowUrgent 优先穿透。 |
| CORE-03 | P1 | normal/low/urgent/manual × allowUrgent on/off × quiet on/off。 | 只有 urgent 且允许时穿透；其余静默；任何分支不抛错、不错误写 dedupe/history。 |
| CORE-04 | P1 | 相同 dedupeKey 并发/串行 submit，不同 session/kind 使用相似 key。 | 24h 内同 key 至多一条；不同 key 互不影响；并发不多发，record id 每次唯一。 |
| CORE-05 | P1 | dedupe 到期前、恰好 24h、超过 24h，规模达到 512 条。 | TTL 边界和 prune 正确；过期可再通知，未过期仍去重；内存有界策略明确。 |
| CORE-06 | P1 | 无启用渠道、一个成功、全部失败、部分成功。 | history 先 pending 后最终更新；仅至少一个成功时 delivered=true；channels 只含成功 id。 |
| CORE-07 | P1 | 连续 submit 多条，第一渠道慢/失败，后续还有通知。 | 全局队列顺序明确，无 record 串写；后续是否等待及最大等待可观测，不出现未处理拒绝。 |
| CORE-08 | P0 | render、randomUUID、store.record/update、logger 或渠道任意环节抛错。 | 异常隔离并告警；Agent 事件调用不抛回；尽可能保留一致历史，不出现 Promise 链永久 rejected 阻塞后续。 |
| CORE-09 | P1 | `ctx.notix.notify` 缺省 session/urgency/dedupe、指定全部字段、重复 dedupe。 | 默认 manual/normal/随机 key 正确；自定义字段保留；重复自定义 key 被去重；manual 也受 quiet/渠道规则约束。 |
| CORE-10 | P1 | notify 返回后立即读 history，再等待 core.chain/最终投递。 | API 的“已接收”与“已送达”语义明确；初始和最终 delivered/channels 可观察且一致。 |
| CORE-11 | P1 | dispose 时有排队/在途通知，随后再 notify/submit。 | 按契约停止接收、完成或取消在途工作；不能向已关闭 storage 写入或产生未处理拒绝。 |
| CORE-12 | P1 | 参数化每种 kind × zh/en：approval、question、long turn/job、error、turn/job completion、manual。 | 标题、正文、urgency 来源、fallback、sessionTitle、job failed 文案与字典一致。 |
| CORE-13 | P1 | formatDuration 测 0、59999、60000、89999、90000、60min、90min、小时进位和异常负值。 | 中英文单位、四舍五入和小时进位一致；异常值按 BL-15/时钟契约处理。 |
| CORE-14 | P1 | truncate/textOf/firstQuestionText：空白、换行、0/1/边界/超长、多个 content block、无文本。 | 空白归一、省略号和上限正确；取首个文本块/首个问题；缺省安全回退。 |
| CORE-15 | P2 | 标题 120、正文 500 边界，CJK/Emoji/组合字符；正文接近上限且带 suppressed count。 | 不越界、不产生坏字符；关键合并计数是否必须保留有明确预期；截断后仍可读。 |
| CORE-16 | P1 | 通知在非免打扰时 submit 并排入慢队列，实际 deliver 时进入免打扰；反向跨越也测一次。 | 明确 quiet 判定发生在 submit 还是 deliver；按当前实现只约束提交时，已进入队列的通知不得被重复判定或重复投递。 |

### 5.10 J. 历史、去重与持久化（STORE）

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| STORE-01 | P1 | 无 storageDomain 启动、记录、读取、关闭。 | 全功能内存运行并明确日志；重启后内存数据自然清空，不影响通知。 |
| STORE-02 | P1 | 正常 domain 写入 history/dedupe，dispose 后重新 open。 | domain=notix/version=1/layout/table 契约正确；历史和未过期 dedupe 恢复。 |
| STORE-03 | P1 | open、entries、table、put、update put、close 分别抛错/拒绝。 | 每类失败均隔离并按要求告警；内存镜像仍可用；Agent 和通知主链不崩。 |
| STORE-04 | P1 | 重启后同 dedupe key 在 TTL 内/外再次提交。 | TTL 内不重复，过期可再发；重启不会把过期键永久保留在内存。 |
| STORE-05 | P1 | 连续生成 199/200/201/1000 条历史，检查内存及重启后顺序。 | 内存最多 200，最新优先，createdAt 排序稳定；持久表是否物理清理需符合保留策略，不能无限无说明增长。 |
| STORE-06 | P1 | history 默认、1、20、200、超过总量、0、负数、小数、NaN。 | 默认 20 且 newest-first；边界按 BL-15，不错误将 0 解释为全部；返回数量和顺序稳定。 |
| STORE-07 | P1 | 修改 history 返回记录及其 channels 数组，再次读取。 | 至少顶层副本不污染内部；嵌套数组是否需深拷贝按 API 契约确认，不能意外篡改持久历史。 |
| STORE-08 | P1 | delivered 更新发生在记录被 200 条淘汰之后。 | update 找不到记录时安全返回，不重新插回旧记录、不抛错。 |
| STORE-09 | P1 | 冷却窗口状态在重启前后、多个 bucket 并行，并持续产生大量不同 session 的 bucket。 | bucket 按 key 隔离；内存冷却不跨重启（若产品改持久化则更新预期）；suppressed count 与 BL-13 一致；过期 bucket 有清理或明确有界策略。 |
| STORE-10 | P1 | 持久化数据缺字段、类型错误、重复 createdAt、未来 createdAt、损坏记录。 | Schema/Host 校验失败有降级；单条坏数据不应拖垮整个插件；顺序和告警可诊断。 |
| STORE-11 | P1 | 写盘慢、通知连续进入、dispose 与未完成 put 竞争。 | 内存历史立即可读；异步写不错误覆盖新状态；关闭无未处理拒绝和数据损坏。 |
| STORE-12 | P2 | 两个 Notix 实例意外指向同一 storage domain。 | 明确不支持或验证并发写安全；不得静默互相删除/覆盖无关历史。 |

### 5.11 K. 渠道注册、超时、重试与熔断（CHAN）

时间常量：每次发送超时 10s；失败后等待 1s/5s/15s；一条通知最多 4 次尝试；连续 3 条通知最终失败后熔断 5 分钟。

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| CHAN-01 | P0 | register 空 id、非字符串 id、无 send、合法 adapter，调用 disposer 两次。 | 非法输入明确 TypeError；合法注册幂等销毁；异常不进入 Agent。 |
| CHAN-02 | P1 | 注册多个渠道，setEnabled/ids，重复注册同 id，旧 disposer 与新 adapter 交错。 | ids/enabled 正确；同 id 替换和旧 disposer 不误删新 adapter 的语义明确；无隐藏重复投递。 |
| CHAN-03 | P1 | 第一次、第二次、第三次、第四次尝试分别成功。 | 成功后停止重试并记录一次 delivered；退避序列准确；成功后 breaker 清零。 |
| CHAN-04 | P1 | send 一直抛错或 reject。 | 每条恰好 4 次，延迟 1/5/15s；最终只返回其他成功渠道；一条告警可定位根因。 |
| CHAN-05 | P1 | send 永不 resolve、恰好 10s、10s 后晚到成功/失败。 | 每次 10s 超时并进入重试；晚到结果不更新已判定记录、不产生未处理拒绝；底层取消/重复通知风险被记录。 |
| CHAN-06 | P1 | 三条通知均最终失败，然后第四条到达。 | 前两条后仍尝试，第三条后打开 breaker；5 分钟内第四条不调用 send，其他渠道不受影响。 |
| CHAN-07 | P1 | breaker 到期后成功、再次失败、反复半开。 | 到期允许探测；成功完全复位；失败按计数策略重开；不会永久关闭或每事件都全量重试。 |
| CHAN-08 | P1 | 一个渠道失败时另一个成功/禁用/也失败。 | 渠道顺序和故障隔离正确；至少一个成功则 delivered=true；禁用渠道完全跳过。 |
| CHAN-09 | P1 | 重试等待中 disable/unregister/dispose，原 send 最后完成。 | 后续尝试和记录更新符合生命周期契约；无向已注销渠道继续发送或关闭后写入。 |
| CHAN-10 | P1 | 无渠道、全 breaker 打开、全部 disable。 | deliver 返回空数组且不抛错；history delivered=false；Agent 继续执行。 |
| CHAN-11 | P1 | 重试与熔断期间热改 macOS 配置或替换 adapter。 | 在途通知使用何时的配置/适配器有明确契约；breaker 不错误污染同名新渠道。 |
| CHAN-12 | P2 | 多渠道均超时形成队头阻塞，后续通知持续进入。 | 记录最大排队时间、队列长度和内存；达到预期有界策略或明确接受的串行语义，不无限失控。 |
| CHAN-13 | P1 | 分别注入永久错误（非 macOS、未授权、非法可执行文件）与临时错误（超时、短暂退出）。 | 明确错误分类策略；永久错误是否仍做 4 次无差别重试需有验收结论，不能无意义延迟后续通知或重复申请权限。 |

### 5.12 L. macOS 渠道适配器（MAC）

L1–L4 用可执行替身记录 argv/env/退出码；不得依赖真实横幅判断参数。只有标注“实机”的项目在隔离权限环境执行。

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| MAC-01 | P0 | process.platform 非 darwin，所有后端分别可见。 | 在探测/执行前报“仅 macOS”，不启动任何进程；Registry 隔离错误，Agent 不受影响。 |
| MAC-02 | P1 | 配置 Helper 可执行文件存在，同时 PATH 有其他工具。 | 优先 helper-app，使用配置/默认路径，不调用 which 或其他后端。 |
| MAC-03 | P1 | Helper 不存在，terminal-notifier/alerter 可见性做四组合；再全不可见。 | 选择顺序严格为 terminal→alerter→osascript；which 失败继续探测，不提前中止。 |
| MAC-04 | P1 | 首次探测后安装/删除工具、改 notifierApp/appIcon，重发并重载渠道。 | 缓存与热更新行为符合 BL-05；重载后可重新探测；不同通知不意外使用已删除路径。 |
| MAC-05 | P1 | Helper 分别 sound=true/false，标题正文含空格/Unicode。 | argv 恰为 title/body/default 或 silent，无 shell 拼接；成功返回后记录 macos-system。 |
| MAC-06 | P0 | Helper 退出码 2、1、其他系统错误。 | 2 转权限/签名指导；其他错误保留可诊断信息；不静默成功；是否降级按 BL-08。 |
| MAC-07 | P1 | terminal 基础参数、dedupe group、声音 on/off。 | `-title/-message/-group` 值正确；仅 on 时加 `-sound default`；不多发、不 shell 执行。 |
| MAC-08 | P1 | 默认/自定义 appIcon 存在、不存在、路径含空格。 | 仅存在时传 `-appIcon`；默认指向包内 whale 图标；自定义路径不被拆参数。 |
| MAC-09 | P0 | clickToOpen on/off × baseUrl 空/http(s)/非法或危险 scheme。 | 仅 on 且非空时传 `-open`；URL 白名单按安全契约；非法值不执行任意本地资源，不拖垮 Agent。 |
| MAC-10 | P1 | alerter sound on/off、clickToOpen on 且 baseUrl 非空。 | title/message/sound 参数正确；当前不错误声称支持点击或自定义图标；能力文档与实现一致。 |
| MAC-11 | P1 | osascript sound on/off，正文含引号、换行、AppleScript 片段。 | 选择正确脚本，argv 顺序 body/title 正确；内容只作为参数字面显示，不注入执行。 |
| MAC-12 | P1 | osascript/which/工具不存在、权限拒绝、进程超时。 | 错误向上交给重试/熔断；历史 delivered=false；不阻断 Agent，不无限等待。 |
| MAC-13 | P1 | macos.enabled=false，或热关闭后再发通知。 | 不注册/不调用任何后端；自定义其他渠道仍可独立接收。 |
| MAC-14 | P1 | 实机：四种后端分别发送中/英文、长文本、声音开关。 | 横幅标题正文与捕获参数一致；无乱码/错误截断；声音符合系统和应用双层设置。 |
| MAC-15 | P1 | 实机：terminal 点击有效 URL，Helper/alerter/osascript 按能力矩阵点击。 | terminal 打开正确 Harness 地址；其他后端不宣称不支持的行为；空 URL 不误开应用。 |
| MAC-16 | P2 | 实机：系统横幅风格、通知中心、锁屏、Focus/DND、睡眠唤醒。 | 系统允许时可见/可点击；被系统 Focus 静默时有明确记录，不误判 Notix 应用层 quietHours。 |
| MAC-17 | P1 | 实机：terminal 同 group 多条及不同 reminder key。 | 系统替换/并存行为与 dedupeKey 设计一致，不出现旧通知误点或无法区分的提醒风暴。 |
| MAC-18 | P1 | notifierApp/appIcon 使用 `~`、相对路径、空格、非可执行文件、损坏 app；GUI Host 与终端 PATH 不同。 | 路径展开/解析和可执行性契约明确，不依赖偶然 cwd；检测失败可诊断；实际 DSH GUI 进程能按支持方式找到工具。 |

### 5.13 M. Notix Helper 构建、签名与权限（HELPER）

所有构建用例先重定向输出和 HOME；真实签名仅使用专门测试身份。不得以 ad-hoc 构建成功推断通知权限可用。

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| HELPER-01 | P1 | PATH 无 swiftc。 | 退出非零并提示 Xcode Command Line Tools；不删除旧输出、不安装半成品。 |
| HELPER-02 | P1 | 默认 ad-hoc 构建成功。 | 编译/bundle/codesign 完成并打印醒目警告；只证明布局可检查，不声称通知授权可用。 |
| HELPER-03 | P1 | 有效 NOTIX_SIGN_IDENTITY 构建；再模拟 codesign 失败。 | 有效签名可验证；失败时 set-e 终止且不安装/不报成功；日志不泄露私钥。 |
| HELPER-04 | P1 | 自定义 NOTIX_APP_OUTPUT、NOTIX_BUNDLE_ID、路径含空格，重复构建。 | 仅清理指定测试输出；源码和二进制/图标/plist 完整；bundle id 正确；重复构建无残留。 |
| HELPER-05 | P0 | 在临时 HOME 使用 --install，预先放同名测试 App；再模拟复制失败。 | 只替换临时目标，最终安装完整；失败不指向真实用户目录、不留半安装状态。 |
| HELPER-06 | P1 | 校验 Info.plist、CFBundle 执行名/icon/LSUIElement、最低系统版本和架构。 | 与实际文件一致；受测 macOS/CPU 可运行；包版本策略明确。 |
| HELPER-07 | P1 | 直接无参数、标准 title/body、silent/default、额外 logPath 调用。 | 默认 Notix/空正文/声音回退正确；silent 不设置声音；日志写指定测试路径。 |
| HELPER-08 | P0 | 实机：首次授权允许；拒绝；系统设置中后续禁止再允许。 | granted 后投递；denied 退出 2；渠道给可操作指导；系统状态与日志一致，不伪报成功。 |
| HELPER-09 | P0 | 实机：有效签名与 ad-hoc/无效签名分别请求权限。 | 有效签名按矩阵工作；无效签名不能获批；不会把 README 中的“自动回退 Script Editor”当作已验证行为。 |
| HELPER-10 | P1 | UNUserNotificationCenter.add 返回错误、授权回调延迟、5 秒 RunLoop 边界。 | add 失败退出 1；成功退出 0；慢回调不会既超时又误报成功，进程最终退出且无孤儿。 |
| HELPER-11 | P2 | 多个 Helper 并发、同/不同日志路径、只读 /tmp 或不可写日志。 | 通知不串内容；日志失败不泄露敏感正文或改变授权结果；进程状态可收敛。 |
| HELPER-12 | P1 | 实机：横幅图标、默认声音、无声音和重复通知唯一 identifier。 | 有效签名显示 whale，声音正确；通知请求不互相覆盖；无意外常驻 Dock。 |
| HELPER-13 | P0 | 在隔离目录验证 OUT 与安装目标相同、未知参数、`--install` 非首参、拷贝/plist 阶段失败及 bundleId 含 XML 特殊字符。 | 禁止自删除后自复制等破坏路径；参数错误有用法提示；构建/安装尽量原子且失败可恢复；bundleId 安全校验或转义，不生成畸形 plist。 |

### 5.14 N. 真实 DSH 端到端场景（E2E）

执行时使用独立 profile、短阈值和确定性测试工具/事件，避免真实等待 10–15 分钟。复用受测 DSH 实例，不为测试另起替代 GUI；Host/Client 变更按实际构建要求刷新页面。

| ID | 优先级 | 场景与操作 | 预期结果 |
|---|---|---|---|
| E2E-01 | P0 | 从安装到刷新 GUI，检查 Host 日志、两个设置页和默认通知。 | 单包两半均运行，入口可见，默认配置一致，无重复 Host/Client。 |
| E2E-02 | P0 | 真实审批请求出现，未处理、允许、拒绝各一次。 | 桌面通知及时；未处理保持原 fail-closed；Notix 不执行工具/回答；处理后提醒停止。 |
| E2E-03 | P0 | Agent 通过 ask_user_question 提出单个/多个问题，GUI 回答或超时 continued。 | 通知与 GUI active 投影一致；回答/continued/重复提醒符合规则，无自动答案。 |
| E2E-04 | P1 | 可控慢 turn 跨越阈值后成功，再测短 turn。 | 长 turn 一条；达到完成下限才发完成；时长合理；短 turn 不多报。 |
| E2E-05 | P1 | 可控后台 job 分别长运行、completed、failed。 | jobs 开关和阈值生效；长任务与结束可各一条；label/status/urgency 正确。 |
| E2E-06 | P0 | 注入 turn/agent/tool 普通错误与超时，含同源双事件。 | 开关、去重、冷却生效；Agent 错误处理不被通知异常改变。 |
| E2E-07 | P0 | 设置页修改开关/阈值/语言/详略/quiet/channel，立即触发事件并重启后再触发。 | 不 remount 即按新值运行；重启后仍一致；UI 不接受值时无假成功。 |
| E2E-08 | P1 | 两个会话同时审批、提问、运行和失败，交叉处理。 | 通知标题可归属正确会话；busy/cooldown/timer/history 不串线。 |
| E2E-09 | P1 | 免打扰跨越本地午夜，含审批/问题/普通/低优先级。 | 应用层静默/穿透正确，macOS 系统 Focus 单独记录；退出后无未定义补发。 |
| E2E-10 | P1 | 重启 Host/进程，恢复 history/dedupe 和在途事件；重载插件再触发。 | 历史和去重按契约恢复；无重复监听、重复通知、幽灵 timer。 |
| E2E-11 | P0 | 渠道拒绝、超时、连续失败和恢复，同时让 Agent 继续执行长任务。 | 通知失败不影响工具结果/turn 结果；重试熔断有界；恢复后新通知可达。 |
| E2E-12 | P1 | storageDomain 不可用/写失败，继续完成一次真实 Agent turn。 | 内存降级，历史能力符合预期；Agent 成功/失败只由自身决定。 |
| E2E-13 | P1 | terminal-notifier 下点击通知回跳当前 GUI；含多会话。 | 打开配置的准确 baseUrl；不打开旧实例或危险地址；其他后端按能力矩阵验收。 |
| E2E-14 | P1 | 卸载/禁用插件后再次运行 Agent；重新启用。 | 卸载后无通知/订阅/配置写入；重新启用单实例恢复，历史与配置按产品策略保留。 |
| E2E-15 | P1 | 从旧双包升级真实 profile，运行一次审批和设置保存。 | 无重复通知/卡片；原 id 配置保留；旧 UI 不再参与运行。 |

### 5.15 O. 非功能、韧性与安全隐私（NFR）

| ID | 优先级 | 场景与操作 | 预期结果/指标 |
|---|---|---|---|
| NFR-01 | P1 | 100 会话、重复/唯一事件混合、至少 1000 条事件与 512+ dedupe 键。 | 记录同步事件耗时 p50/p95/p99、吞吐、CPU、RSS、timer/map/queue；阈值在性能评审后锁定，不得靠丢弃合法事件达标。 |
| NFR-02 | P1 | 多渠道慢超时与通知风暴，观察队列和 Agent 延迟。 | 通知串行成本不影响 Agent；队列/内存有明确上界或经评审的背压策略；无失控重试。 |
| NFR-03 | P2 | 2 小时开发长稳和 24 小时发布前长稳，含午夜、系统睡眠和周期事件。 | 稳定后 RSS/timer/map/listener 不单调增长；无重复订阅、句柄泄漏和未处理拒绝。 |
| NFR-04 | P0 | 通知 message/reason/label/title/URL 埋 secret canary，minimal/normal 分别运行。 | 按 BL-11 字段白名单验证横幅、history、持久文件、Host/Helper 日志；最小模式不泄漏禁止字段。 |
| NFR-05 | P0 | 标题/正文/工具名包含 shell、AppleScript、HTML、控制字符和超长输入。 | execFile/argv 不执行注入；UI 不注入 HTML；日志可安全展示；通知内容可追踪但不破坏 Host。 |
| NFR-06 | P0 | baseUrl 使用 http、https、空值、畸形 URL、file/javascript/自定义 scheme；配置文件路径含特殊字符。 | 采用明确允许列表和本机信任边界；危险输入不自动打开/执行；错误可诊断且不影响 Agent。 |
| NFR-07 | P1 | 配置对象包含 `__proto__`/constructor/prototype、极深对象和未知键。 | 不污染全局原型、不越权写配置；资源消耗有界；非法配置不绕过 Schema。 |
| NFR-08 | P1 | 存储文件无权限、磁盘满、损坏、并发写、进程强杀后重启。 | 不损坏 DSH 其他 domain；Notix 可降级/恢复；无敏感信息意外扩散，错误可诊断。 |
| NFR-09 | P1 | 无通知权限、只读设置、无签名、无 PATH 工具、非 macOS。 | 每种环境都有真实能力提示和可控降级，不显示虚假“已送达/已保存”。 |
| NFR-10 | P1 | 随机生成合法事件序列（模型化状态测试）：ask/decide、open/settle、start/end、register/settle、dispose。 | 不变量始终成立：无结束后看门通知、无重复 dedupe、无跨会话清理、无 Agent 决策副作用、timer 最终可收敛。 |
| NFR-11 | P2 | UI 可访问性扫描、200% 缩放、系统减少动态效果（若适用）。 | 无严重可访问性违规；关键设置和状态可读可操作。 |
| NFR-12 | P1 | 全部测试结束后检查测试 HOME/profile/签名/通知记录和临时进程。 | 无残留后台进程、测试通知风暴、真实用户文件修改或密钥；环境可重复创建。 |

## 6. 纯观察者专项不变量

以下断言应作为 APR/UQ/E2E/故障注入的共同检查，而不是单独测一次：

1. 不注册 approval answerer 或 user-question answerer，不调用允许、拒绝、回答等决策 API。
2. 不向 session event log append 任何 Notix 事件，不修改投影业务状态。
3. 无论通知渲染、存储、进程执行、重试、熔断是否失败，原工具结果、turn reason、答案和审批结果均不变。
4. fire-and-forget 不意味着失去可观测性：通知自身失败必须有界、有日志、有最终 history 状态。
5. quietHours 或关闭触发器只影响通知，不改变 Agent 是否等待、是否完成或是否失败。
6. dispose 后所有观察者消失，不能残留继续截获会话内容的回调。

## 7. 现有测试资产与缺口（静态盘点，未运行）

| 资产 | 已有覆盖 | 本计划需重点补齐 |
|---|---|---|
| `test/core.test.js`（9 条） | volatile/default、部分中英文渲染、时长/截断、基本 dedupe、错误冷却、基础 quiet、已送达历史 | 全类型/全边界、持久化失败、队列、所有 quiet 组合、历史 200/TTL、API 非法输入和隐私 |
| `test/triggers.test.js`（11 条） | 审批基本提醒/决定、问题 open/continued、turn 看门与 busy、双源错误去重、长短 turn、job 看门/完成部分开关 | 多数边界、热更新、多会话/同 ID、多审批、session dispose、重启、job facts 顺序、工具错误矩阵 |
| `test/integration.test.js`（5 条） | 真实 Cordis 加载、ctx.notix、少量 Schema 默认/非法语言、基本 dispose、history 重开恢复和 dedupe 表写入 | projection 退订、volatile 真热更新、重启后同 key 真正被 dedupe 拦截、生命周期竞争、存储异常、渠道故障与纯观察者 |
| `test/package.test.js`（4 条） | 单包导出声明、随包后台任务默认关闭、单 Loader/无旧 UI、1024 RGBA 图标 | 实际 tarball 内容、生产安装、版本矩阵、迁移、运行时入口与资源路径 |
| `test/ui.test.js`（5 条） | 浏览器 bundle 注入契约、完整卡片渲染、摘要去重、URL 联动、缺失表单降级 | 真实浏览器 DOM、保存持久化、键盘/焦点、窄屏和主题需由 L3/L5 覆盖 |
| `test/macos.test.js`（4 条） | helper/terminal-notifier/osascript 参数、声音/图标/URL 开关、失败不自动降级 | 真实授权、签名 Helper、系统横幅和点击行为需 L6 实机覆盖 |
| `test/error.test.js`（3 条） | 普通工具错误、工具超时独立开关、禁用抑制与 minimal 隐私 | 更多并发/重启组合仍待扩展 |
| `scripts/smoke-client.mjs` | VM 中模块 id、factory apply/inject、依赖 smoke | 不是浏览器渲染测试；需 UI 组件和真实 DSH 两页面 E2E |
| `scripts/test-macos-notification.mjs` | 设计为真实渠道自检，但不属于 `pnpm test` | BL-09 方法不匹配需先处理；还缺四后端 argv mock、权限、签名、点击、声音、图标实机矩阵 |
| `test/mock.js` | fake context/clock/timer/projection 与捕获渠道，适合扩展确定性组件测试 | 绕过 Schema 和随包 patch，无 configForms/Loader；全局 Date.now 缺统一恢复，正式扩测前先增加 afterEach 清理和 timer/listener 泄漏断言 |
| macOS Helper 构建/Swift | 当前无对应自动化测试资产 | 构建失败、签名、安装隔离、plist、授权回调、add 错误、退出码和日志 |

本轮已执行自动化测试共 41 条并全部通过；执行结果见 [测试执行报告](TEST_REPORT.zh-CN.md)。本计划仍保留未执行的高成本场景，不能把 41 条通过等同于全部用例通过。

## 8. 能力—用例追踪矩阵

| 能力/链路 | 主用例组 | 必配共同检查 |
|---|---|---|
| 单包 Host/Client 安装与迁移 | PKG-01～05、E2E-01/15 | 默认矩阵、无重复加载 |
| 生命周期与服务 API | PKG-06～14、CFG、CORE-07～11 | dispose、异常隔离、纯观察者 |
| 设置到 Host 热更新 | CFG-08～13、UI、E2E-07 | profile/UI/Host 一致、失败不假成功 |
| 审批输入与重复提醒 | APR | 不做审批决定、busy/timer 清理 |
| 问题投影与 continued | UQ | 不写答案、与 GUI active 一致 |
| 长 turn / 长 job | LT、CMP-10 | busy 抑制、阈值、结束后取消 |
| turn/agent/tool 错误 | ERR、CORE | dedupe/cooldown、minimal 隐私、Agent 不受影响 |
| turn/job 完成 | CMP | 时长、状态、监听器顺序、jobs 默认 |
| 免打扰、渲染、历史 | CORE、STORE | 边界、不重复、不泄漏、持久恢复 |
| 渠道重试/熔断/多通道 | CHAN | 次数/延迟/超时、最终 history、故障隔离 |
| macOS 四后端 | MAC、HELPER、E2E-13 | argv、权限、图标/声音/点击、无注入 |
| 多会话/重载/故障/性能安全 | PKG/UQ/APR/LT、NFR | 隔离、有界资源、无残留 |

## 9. 执行阶段与准入/准出

### 阶段 0：计划评审与基线冻结

- 关闭 BL-01～15，确认支持矩阵、默认值、隐私字段、热更新和重启语义。
- 固定受测版本/归档、测试 profile、时间控制方案、各后端替身与实机权限。
- 将每条用例补充自动化归属、负责人和测试数据；不先以真实通知代替自动化。

**准出：** P0/P1 用例均具备确定预期，环境和测试签名可用，旧绝对路径与自检入口问题有处理结论。

### 阶段 1：快速自动化

- 扩展现有 Node 测试：CFG、APR、UQ、LT、ERR、CMP、CORE、STORE、CHAN。
- 参数化完整开关和边界矩阵；接入覆盖率与随机事件状态测试。
- 每次提交运行，真实 macOS 进程全部由替身替代。

### 阶段 2：Host/包/UI 集成

- 真实 Cordis 生命周期、volatile 热更新、storageDomain、打包安装。
- UI 组件测试后，再进入真实 DSH 两页面联动和升级场景。

### 阶段 3：macOS 专项

- 先完成可执行替身和临时 HOME 构建测试，再使用专门签名执行 Helper/系统通知实机矩阵。
- 记录后端、macOS、权限、签名、Focus 状态以及截图/录屏，不能把“进程退出 0”等同于“用户看到横幅”。

### 阶段 4：真实 DSH E2E 与非功能

- 执行完整审批、提问、长任务、错误、完成、重启、多会话链路。
- 最后执行故障注入、长稳、性能与安全隐私；通过环境清理用例。

### 发布准出

1. P0/P1 全通过，P2 未执行项有风险接受记录。
2. 所有支持安装方式、DSH 版本和 macOS 后端均有结果；不适用项说明原因。
3. 无未处理的 Agent 阻断、审批/回答越权、敏感数据泄漏、配置破坏或无限重试问题。
4. 测试报告、覆盖率、缺陷清单、实机证据、性能数据和环境清理记录齐全。
5. README、配置 Schema、UI 和打包默认值一致；测试计划中的“待确认”全部转为明确结论。

## 10. 后续测试交付物模板

本阶段只交付计划。正式执行后应追加独立结果文档，至少包含：

- 受测版本、环境、配置、后端与权限矩阵；
- 用例 ID、结果、实际通知数、history/delivered/channels、日志和证据链接；
- 缺陷严重度、复现事件序列、影响链路、回归用例 ID；
- 覆盖率与未覆盖原因、性能/长稳数据、安全和隐私检查；
- P0/P1 准出结论及剩余风险接受人。

---

**本次结论：测试计划已完成 UX 复核，并已执行核心自动化、真实 DSH UI 和真实通知；结果和证据见 [测试执行报告](TEST_REPORT.zh-CN.md)。本计划中未执行的高成本场景仍不得视为通过。**
