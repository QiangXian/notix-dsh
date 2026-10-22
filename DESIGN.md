# Notix — dsh 通知插件设计文档

> 版本：v1.1（已评审定稿，Host 侧已实现）
> 目标运行时：DeepSeek Harness (dsh) 0.2.1-rc.2，Cordis 插件体系（`@deepseek-ai/cordis` ~4.0.5）
>
> 文中所有机制事实均核实自 dsh 打包产物源码（`@deepseek-ai/*` 各包 lib/README），关键处标注出处。

---

## 1. 背景与目标

dsh 的 agent 在执行任务时，存在若干"需要用户关注"的时刻，但用户不一定盯着 Web GUI：

- **需要用户输入**：审批请求（`approval`）、`ask_user_question` 提问——agent 会**阻塞**等待，用户晚看到一分钟任务就停一分钟（timed 提问默认 120s 超时后转为 `continued` 继续挂起）；
- **任务执行时间过长**：一个 turn / 后台 job 跑了很久，用户想被提醒回来看一眼；
- **执行错误**：LLM 请求失败、工具执行失败、turn 异常终止；
- **任务完成**：长任务跑完了，可以回来验收。

**Notix** 是一个 dsh 宿主侧（Host）Cordis 插件：订阅 dsh 运行时的事件面，按可配置规则生成通知，经投递渠道送达用户。**v1 首要渠道是 macOS 系统通知**，多渠道（webhook/IM 等）后续版本支持。

### 1.1 已确认的决策（Review 结论）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 完成通知 | **纳入 v1**（T5） |
| 2 | 可交互审批（远程批准/回答） | **不做**，Notix 永远保持纯通知观察者（见 §1.3 非目标） |
| 3 | 渠道优先级 | **macOS 系统通知优先**，多渠道后续迭代 |
| 4 | 配置入口 | **需要 Settings UI**（不只是 YAML），阈值等默认值可在设置页修改 |
| 5 | 命名 | 包名 `notix-dsh`，服务名 `ctx.notix` |
| 6 | 默认阈值 | turn 10min / job 15min / 完成 3min / 阻塞提醒 5min×2，Settings UI 可改 |

### 1.2 设计原则

1. **只观察，不干预**：不注册任何 waterfall answerer，不消费/改变任何事件语义（审批 fail-closed 语义不变），不阻断 agent loop；
2. **零侵入会话日志**：不向 session log 追加任何事件（dsh 对未知事件类型的持久化读取会拒绝重建），通知历史走 `ctx.storageDomain`（对模型不可见）；
3. **渠道可插拔**：触发规则与投递渠道解耦，渠道以适配器注册（为后续多渠道预留）；
4. **可降噪**：每类触发独立开关、阈值、冷却、去重键，默认配置保守；
5. **失败自包含**：投递失败只影响通知本身，绝不抛出到 agent 执行路径。

### 1.3 非目标（Non-goals）

- **远程审批/远程回答**：Notix 不注册 `approval/request`、`user-questions/request` 的 answerer，不提供"在通知里点按钮替 agent 做决定"的能力。通知只负责"叫你回来"，决策永远发生在 dsh GUI。
- 不做任务控制（不 kill job、不 steer agent）。
- 不做跨实例/多端聚合的通知中心服务端。

---

## 2. dsh / Cordis 插件机制速览（设计依据）

### 2.1 插件形态与加载

- 插件三种形态（cordis `registry.ts`）：函数 `(ctx, config)`、对象 `{ name?, inject?, Config?, apply(ctx, config) }`、类（通常 `extends Service`，`super(ctx, 'name')` 注册 `ctx.<name>`）。入口 `exports.default ?? exports`（loader `unwrapExports`）。Notix 用 **Service 子类**形态（参考 `dsh-schedule`）。
- **Config**：`@deepseek-ai/schemastery` schema（实现 Standard Schema），启动前校验；`.default()` 给默认值；**所有可编辑叶子字段标记 `.volatile()`**——这是 dsh-settings 暴露设置命名空间（`volatileForm()`）的前提，且 Loader 会把 volatile-only 变更直接提交进运行中的 fiber（插件不重载），插件监听 `loader/volatile-update` 实时读取新值。
- **生命周期**：`ctx.on(...)` 返回 disposer；`ctx.effect(fn, label)` 注册 cleanup-aware effect；随 fiber 卸载自动逆序清理（HMR 安全）。
- **inject**：`static inject = [...]` 声明服务依赖，全部可用才加载。

### 2.2 分发单元：bundle 与 profile

- 可安装单元是 **bundle**：`package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；patch 用 `- insert:` 列表声明插件行（`id / name / config / disabled`，支持 `!!js` 表达式按 Loader 上下文求值）。
- **安装位置**：profile 目录 `$DSH_HOME/profiles/<name>/`（`$DSH_HOME` 默认 `~/.dsh`）——`pnpm add` 进 profile 的 `node_modules`，包名加入 `package.json` 的有序 `dsh.profile.bundles`。无项目级插件目录。
- **组合顺序**：bundle patches（按 bundles 顺序）→ profile `cordis.patch.yml` → home 级 `$DSH_HOME/cordis.patch.yml` → `--patch` overlays。用户改配置 = 在 profile patch 覆写同 id entry 的 `config`；启停 = `disabled` 字段。
- **安装入口**：Web 侧边栏 Plugins 页 / `plugin_manager` 工具 / `dsh plugin` CLI（`installBundle` 自带 `engines.dsh`/peer 版本兼容检查；HMR 开启时即时重组，否则重启生效）。
- **显示元数据（可选）**：`icon`、`locale/<lang>.json`（`{ "meta": { "title", "description" } }`，exports 含 `./locale/*.json`）。`README.i18n.yaml` 是官方 monorepo 内部记录，第三方不需要。
- **兼容性声明**：`engines.dsh`（SemVer 范围）+ `peerDependencies: { "@deepseek-ai/cordis": "~4.0.5" }`。

### 2.3 事件与服务面（触发源的事实基础）

Cordis dispatch 五模式：`emit`（同步广播）、`parallel`、`serial`、`bail`、`waterfall`（中间件式，不调 `next()` 即否决后续链路）。子上下文事件向上冒泡；`ctx.on(name, fn, { global: true })` 在根上下文观察全部会话/agent 事件（参考实现：`dsh-user-approval/lib/types/invariant.js`）。

| 关注点 | 机制 | 事件 / API | 出处 |
|---|---|---|---|
| 审批请求 | session 事件对 | `approval/asked` `{id, toolName, callId?, reason?}` / `approval/decided` `{id, outcome}`（outcome ∈ `allowed-once / rejected / cancelled / unavailable`） | dsh-user-approval |
| 提问语义状态 | 投影变更 | `ctx.sessionProjections.onChanged(listener)`，unit `userQuestions`，`questions.active[]` 的 `state: 'open' \| 'continued'`（实现核对：投影枚举是 open/continued）；timed 提问默认 120s 超时转为 continued | dsh-session-projection / dsh-user-questions |
| turn 生命周期 | session 事件 | `turn/start {turn}`、`turn/end {turn, reason}`（**finally 必发**），`reason.kind`: `completed / blocked / max-tokens / aborted(user\|parent\|disposed\|hook) / error{message,code}`；另有 `step/start`、`step/end` | dsh-agent-loop |
| agent 错误 | cordis 事件 | `agent/error {agent, turn, step, error}`（throwError 先 emit 再 throw） | dsh-agent-loop |
| 工具结果 | session 事件 / emit | `tool/result`：`message.isError: true`，可选 `error: {message, info: {name, code}}`；观察事件 `tools/result` | dsh-agent-loop / dsh-tools |
| LLM 重试 | session 事件 | `llm/retry-started` / `llm/retry` | dsh-llm-retry |
| 后台 job | 服务订阅（推荐） | `ctx.jobs.events.subscribe(filter, listener)`，filter `{owners:'all'}`，事件 `registered / stopping / output / progress / settled{cause, awaited} / removed`；终态 `completed\|killed\|failed` | dsh-jobs / dsh-jobs-local |
| job 持久化事实 | session 事件 | `job/registered`、`job/settled {finishedAt, status, cause, detail?}` | dsh-jobs-local |
| 计时 | 服务 | `ctx.timeout(cb, ms)` → disposer、`ctx.interval(cb, ms)`（`ctx.setTimeout/setInterval` 为 deprecated 别名）；随 fiber 自动清理 | cordis-plugin-timer |
| 持久 KV | 服务 | `ctx.storageDomain`：schema 校验 KV，同步读、落盘写、`domain/changed` 事件，对模型不可见 | dsh-storage-domain |
| agent 枚举 | 服务 | `ctx.agents`（`.get(id) / .roots() / .list()`）——取会话标题等丰富通知内容 | dsh-agent |
| 会话事件总线 | cordis 事件 | `ctx.on('session/event', (session, event) => …, {global: true})`，目录约 60 种类型（`dsh-session/lib/types/known-event-types.js`） | dsh-session |

### 2.4 投递通道的事实基础

**现状：dsh 没有任何面向插件的用户通知服务。** 唯一的 OS 级通知是 Electron 壳私有的强制更新提醒；托盘仅 Windows；无 dock badge；Web 前端未使用浏览器 Notification API。

- **桌面宿主**：`dsh-desktop-host` 以 `ELECTRON_RUN_AS_NODE=1` **纯 Node 模式**运行，不 import electron，**插件拿不到 Electron 对象**；与壳之间仅固定私有 IPC，无 notify 通道与插件扩展点。→ **macOS 系统通知走 `child_process` 调 `osascript -e 'display notification …'`**（零依赖）；PATH 存在 `terminal-notifier`/`alerter` 时优先（支持点击回调跳转 GUI URL）。
- **外部 HTTP**（后续多渠道）：用 **Node 全局 `fetch`**——`dsh-http-proxy` 已安装进程级 undici dispatcher，自动继承 `HTTPS_PROXY` 代理。不要用 `ctx.web.fetch`（匿名、仅公网 GET 语义、限大小，只适合抓页面）。
- **Host → Web 前端推送**（后续 GUI 渠道）：Typert RPC，`@Remote({mode:'stream'})` 流式方法走 `/api/remote.mux` WebSocket；client-ui 插件包（`dsh.client` 声明 + `lib/client.js` + `ctx.slots.register` 挂 UI，`dsh-client-ui-primitives` 有现成 Toast）。

### 2.5 Settings UI 的事实基础（决策 4 的落地路径）

- **Host 侧**：`dsh-config-editor`——把插件配置保存进**当前 profile 的 patch**，写前校验完整候选值，与 profile 变更/HMR 串行化，立即生效。
- **Client 侧**：`dsh-client-ui-settings` 提供 `ctx.configForms` 服务：
  - `configForms.get('<entryId>')` 拿到某个 Host 插件 entry 的**schema 驱动配置表单**（读镜像 + 写队列，schema 即插件的 schemastery Config）；
  - `configForms.whileServed(namespaces, register)`：Host 组合了该插件时才注册对应 UI；
  - 插件卡片挂在 **`plugins.item`** slot：`slots.register({ name: 'plugins.item', id: 'notix', order, label, locale, inject }, CardComponent)`（参考 `dsh-client-ui-settings-agent-loop` 的 AgentLoopCard）。
- **推论**：Notix 的 Config schema 即设置页表单的单一事实源；**字段必须标记 `.volatile()`，否则 `settings.describe()` 不会返回该命名空间，设置卡片也就不会出现**（这是实现期踩到的坑，已修复）；保存后经 Loader 的 volatile 提交通道即时生效，无需重载。

---

## 3. 总体架构

```
┌───────────────────────────── dsh Host 进程 ─────────────────────────────┐
│                                                                         │
│  ┌─ Triggers（订阅器，全部只读观察）─────────────────────────────┐      │
│  │  T1 approval        session/event: approval/asked|decided     │      │
│  │  T2 user-question   sessionProjections.onChanged(userQuestions)      │
│  │  T3 long-task       turn/* + ctx.timeout；jobs.events.subscribe      │
│  │  T4 error           agent/error、turn/end(reason=error)、      │      │
│  │                     tool/result(isError)                       │      │
│  │  T5 completion      turn/end(reason=completed)、job settled    │      │
│  └──────────────┬───────────────────────────────────────────────┘      │
│                 ▼  RawTriggerEvent                                     │
│  ┌─ Notix Core（Service: ctx.notix）───────────────────────────┐       │
│  │  规则引擎（开关/阈值/过滤） → 去重 & 冷却 → 优先级/聚合       │       │
│  │  → 渲染（locale 模板） → 发送队列（串行、超时、有限重试）     │       │
│  └──────────────┬───────────────────────────────────────────────┘      │
│                 ▼  Notification                                        │
│  ┌─ Channels（适配器注册表）────────────────────────────────────┐      │
│  │  v1: macos-system                                            │      │
│  │  后续: webhook │ lark │ wecom │ bark │ ntfy │ gui-toast      │      │
│  └──────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
        │
        ▼ (v1 同步交付)
  notix-dsh-ui（client-ui 包）：Settings 插件卡片
  （plugins.item slot + configForms，编辑 ctx.notix 的 Config）
```

### 3.1 模块划分

| 模块 | 形态 | 职责 |
|---|---|---|
| `notix-dsh`（本体） | Cordis Service 插件 + bundle | 触发订阅、规则引擎、去重冷却、发送队列、渠道注册表、历史记录 |
| 内置渠道 | 包内适配器模块，按 config 启用 | v1 仅 `macos-system`；接口预留多渠道 |
| `notix-dsh-ui`（v1 同步交付） | dsh client-ui 插件包 | Settings 插件卡片（改阈值/开关/静默时段等） |

> 单包同时声明 `dsh.bundle.patch` + `dsh.client` 是否可行需开发期 spike 验证；不可行则拆为两个包（官方 `dsh-client-ui-*` 均为独立包，node 半为 no-op）。

---

## 4. 触发器（Trigger）详细设计

统一抽象：

```ts
interface RawTriggerEvent {
  kind: 'approval' | 'user-question' | 'long-task' | 'error' | 'completion'
  sessionId: string
  agentId?: string
  dedupeKey: string                 // 默认去重键，触发器负责给出
  urgency: 'urgent' | 'normal' | 'low'
  payload: Record<string, unknown>  // 原始事实，供规则与模板使用
}
```

所有订阅回调**同步快速返回**（首行按事件类型白名单过滤）；耗时逻辑（计时、渲染、发送）全部进 Core 队列；回调包 try/catch，异常仅记日志。

### T1 审批请求（需要用户确认）

- **订阅**：`ctx.on('session/event', (session, event) => …, { global: true })`，过滤 `approval/asked`（事件在 open turn 内持久化，含 `{id, toolName, callId?, reason?}`）。
- **触发**：立即（agent 已阻塞）。`dedupeKey = approval:{sessionId}:{id}`（幂等，日志重放不重复）。
- **配对解除**：同监听观察 `approval/decided {id, outcome}`——v1 用于抑制后续重复提醒（用户已在 GUI 处理就不再催）。
- **重复提醒**：`remindAfterMs`（默认 5 min）未 decided 则再发，最多 `maxReminders`（默认 2）次；`ctx.timeout` 实现，decided/dispose 时清理。
- **payload**：`toolName`、`reason`（审批请求自带的人类可读描述）、会话标题。

### T2 用户提问（ask_user_question）

- **订阅**：`ctx.sessionProjections.onChanged(listener)`，读 unit `userQuestions`，diff 前后快照 `questions.active`，新增 `state === 'open'` 即触发（实现核对后的实际枚举）。
  - 投影是面向客户端的语义状态，天然处理批量问题、撤销、跨端同步，与 GUI 待答集合一致。
  - timed 提问 120s 超时转为 continued 时也体现为投影变更——`remindOnContinued: true`（默认开）时对"超时转 continued"再提醒一次（此时用户更可能不在电脑前）。
- `dedupeKey = question:{sessionId}:{callId}`；`remindAfterMs` 同 T1。
- **payload**：question 文本（截断）、选项标签、会话标题。
- **降级**：`sessionProjections` 服务缺失时该触发器停用并告警（不拖垮整个插件）。

### T3 任务执行时间过长

**(a) turn 级**（默认开，`turnThresholdMs = 10 min`）
- `turn/start {turn}` 记录起点 + `ctx.timeout(threshold)`；到点未 `turn/end` → 触发一次。
- `dedupeKey = longturn:{sessionId}:{turn}`，一个 turn 只提醒一次；`turn/end` 清计时器。
- **防抖**：turn 内出现 `approval/asked` 或待答问题 → 暂停计时（阻塞原因已知，T1/T2 已覆盖），解除后按剩余阈值重新计时。

**(b) job 级**（默认**关**，`jobs` 开关打开后按 `jobThresholdMs = 15 min` 看门）
- **首选 `ctx.jobs.events.subscribe({owners:'all'}, listener)`**：`registered` 起计时，`settled` 前到点触发；订阅接口还能拿到 `output/progress` 增量（后续可做"进度停滞"提醒）。
- 降级：`session/event` 的 `job/registered` / `job/settled`。
- `dedupeKey = longjob:{sessionId}:{jobId}`。

### T4 执行错误

| 子类 | 数据源 | 默认 | 说明 |
|---|---|---|---|
| turn 异常终止 | `turn/end` 且 `reason.kind === 'error'`（带 `{message, code}`） | **开** | 终局性错误，信息最全 |
| agent 级错误 | `ctx.on('agent/error', …, {global: true})` `{agent, turn, step, error}` | **开** | 与上一行同源，**同 `(sessionId, turn)` 去重为一条** |
| LLM 重试风暴 | `llm/retry-started`，窗口内 ≥ N 次 | 关 | 网络/限流预警 |
| 工具结果错误 | `tool/result` session 事件（`isError` / `error.info.{name,code}`） | **关** | 噪音大（命令非零退出很常见）；开启后按 `toolName` 白名单过滤；`TOOL_TIMEOUT` 单列开关 |

- **冷却**：同 session 错误通知 `errorCooldownMs`（默认 60 s），窗口内聚合为"又发生 k 次"。
- `dedupeKey = error:{sessionId}:{turn}:{errorName}`。

### T5 任务完成（v1 纳入）

- `turn/end` 且 `reason.kind === 'completed'`：仅当 turn 时长 ≥ `completionMinDurationMs`（默认 3 min）才通知（短交互不打扰）。默认**开**。
- job `settled`：默认**不通知**（`jobs` 开关，默认关）；开启后 payload 带终态 `completed / killed / failed` 与 `cause`。failed 同时命中 T4 时按 `(sessionId, jobId)` 合并为一条"失败"通知，不发两条。

### 触发器统一配置（每类五元组）

```ts
interface TriggerRule {
  enabled: boolean
  thresholdMs?: number      // 时间类
  cooldownMs?: number
  maxReminders?: number     // 阻塞类重复提醒上限
  sessionFilter?: string[]  // 会话标题/工作区 glob 白名单（缺省全部）
}
```

---

## 5. 通知模型与 Core

### 5.1 Notification

```ts
interface Notification {
  id: string                    // uuid
  kind: RawTriggerEvent['kind']
  urgency: 'urgent' | 'normal' | 'low'
  // urgent: approval / user-question（agent 阻塞中）
  // normal: error / long-task；low: completion
  title: string                 // 已渲染，如「需要审批：bash 写文件」
  body: string                  // 已渲染摘要（截断 500 字符）
  sessionId: string
  sessionTitle?: string
  dedupeKey: string
  createdAt: number
}
```

（无可交互 actions 字段——纯通知定位，见 §1.3。）

### 5.2 规则引擎流水线

```
RawTriggerEvent
  → ① 开关/阈值/会话过滤（TriggerRule）
  → ② 去重：dedupeKey 命中未过期记录则丢弃
  → ③ 冷却：同 (kind, sessionId) 窗口聚合
  → ④ 静默时段（quietHours；urgent 可破窗，可配）
  → ⑤ 渲染（locale 模板 × 渠道粒度覆写）
  → ⑥ 入发送队列
```

- **去重/历史存储**：`ctx.storageDomain` 开两个域：`notix.dedupe`（dedupeKey → 末次时间，TTL 24h）与 `notix.history`（最近 200 条通知元数据 + 投递状态）。对模型不可见、不进会话日志。
- **发送队列**：内存 FIFO，每渠道并发 1；单次投递超时 10 s；指数退避重试 ≤ 3 次（1s/5s/15s）；失败记 history 并按渠道冷却，单渠道连续失败 ≥ 3 次熔断 5 min。队列不持久化（进程重启丢通知可接受；阻塞类有重复提醒兜底）。
- **服务接口**（供其他插件扩展）：

```ts
class NotixService extends Service {
  notify(input: ManualNotificationInput): Promise<void>   // 任意插件手动发通知
  registerChannel(adapter: ChannelAdapter): Disposable    // 第三方注册渠道
  history(limit?: number): NotificationRecord[]
}
```

---

## 6. 投递渠道（Channel）设计

```ts
interface ChannelAdapter {
  id: string                                // 'macos-system' | 'webhook' | …
  Config: Schema                            // 渠道自有 schema，并入 Notix 总 Config
  send(n: Notification): Promise<void>
}
```

### v1：`macos-system`（首要渠道）

- **实现**：Host 进程 `child_process` 调 `osascript -e 'display notification "<body>" with title "<title>"'`（零依赖，桌面宿主为纯 Node 模式的现实路径）；
- PATH 探测到 `terminal-notifier` / `alerter` 时优先使用（支持**点击通知跳转** GUI URL `http://127.0.0.1:<port>` 直接回到会话）；
- 配置项：`enabled`、`sound`（默认开）、`clickToOpen`（默认开，仅 terminal-notifier/alerter 可用）；
- urgency 映射：urgent → 声音 + 标题前缀 `⚠️`；low → 静默（不发声）。

### 后续版本渠道（接口已预留）

| 渠道 | 实现要点 |
|---|---|
| `webhook` | 通用 HTTP POST，Node 全局 `fetch`（继承 dsh-http-proxy 代理），JSON 模板插值 |
| `lark` / `wecom` | 飞书/企微自定义机器人 webhook（飞书可选签名） |
| `bark` / `ntfy` | iOS/跨端推送 HTTP 端点 |
| `gui-toast` | client-ui 渠道：Typert stream 推送 + Toast 组件 + 浏览器 Notification API（覆盖 GUI 在后台场景） |
| Windows/Linux 系统通知 | `powershell` Toast / `notify-send` |

---

## 7. 包结构与配置

### 7.1 仓库布局

```
notix-dsh/                         # 仓库根
├── packages/
│   ├── notix-dsh/                 # Host bundle（本体）
│   │   ├── package.json           # type:module；main/exports["."] → lib/index.js；
│   │   │                          # dsh.bundle.patch → ./cordis.patch.yml；
│   │   │                          # engines.dsh、icon、exports 含 ./locale/*.json
│   │   ├── cordis.patch.yml       # - insert: [{ id: notix, name: 'notix-dsh', config: {…默认} }]
│   │   ├── icon.png
│   │   ├── README.md / README.zh.md
│   │   ├── locale/en.json / zh.json   # meta.title/description + 通知模板文案
│   │   ├── src/                   # TS 源码 → 构建产物 lib/
│   │   │   ├── index.ts           # class NotixService extends Service；export default
│   │   │   ├── triggers/{approval,questions,long-task,error,completion}.ts
│   │   │   ├── core/{rules,dedupe,queue,render}.ts
│   │   │   └── channels/macos-system.ts
│   │   └── lib/ …
│   └── notix-dsh-ui/              # client-ui 包（Settings 卡片）
│       ├── package.json           # dsh.client: { inject: [...], platform: 'web' }；./client 入口
│       └── src/client.tsx         # slots.register({ name: 'plugins.item', id: 'notix', … })
│                                  #   + configForms.whileServed(['notix'], …) + ConfigFormController
└── pnpm-workspace.yaml
```

### 7.2 Host 插件骨架

```ts
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export default class NotixService extends Service {
  static inject = ['sessions', 'agents', 'timer', 'storageDomain']
  // sessionProjections / jobs 用可选注入：缺失时对应触发器降级停用并告警，不拖垮整体

  static Config = z.object({
    triggers: z.object({
      approval:     z.object({ enabled: z.boolean().default(true),
                               remindAfterMs: z.number().default(300_000),
                               maxReminders: z.number().default(2) }).default({}),
      userQuestion: z.object({ enabled: z.boolean().default(true),
                               remindAfterMs: z.number().default(300_000),
                               remindOnContinued: z.boolean().default(true) }).default({}),
      longTask:     z.object({ enabled: z.boolean().default(true),
                               turnThresholdMs: z.number().default(600_000),
                               jobThresholdMs:  z.number().default(900_000),
                               jobs: z.boolean().default(false) }).default({}),
      error:        z.object({ enabled: z.boolean().default(true),
                               cooldownMs: z.number().default(60_000),
                               toolErrors: z.boolean().default(false),
                               toolTimeout: z.boolean().default(false) }).default({}),
      completion:   z.object({ enabled: z.boolean().default(true),
                               minDurationMs: z.number().default(180_000),
                               jobs: z.boolean().default(false) }).default({}),
    }).default({}),
    quietHours: z.object({ enabled: z.boolean().default(false),
                           from: z.string().default('23:00'), to: z.string().default('08:00'),
                           allowUrgent: z.boolean().default(true) }).default({}),
    verbosity: z.union(['minimal', 'normal']).default('minimal'),
    channels: z.object({
      macos: z.object({ enabled: z.boolean().default(true),
                        sound: z.boolean().default(true),
                        clickToOpen: z.boolean().default(true) }).default({}),
    }).default({}),
  })

  constructor(ctx, config) {
    super(ctx, 'notix')
    ctx.effect(async () => {           // 初始化 + 返回清理 disposer（HMR/卸载安全）
      const stop = await startNotix(ctx, config, this)
      return () => stop()
    })
  }
}
```

### 7.3 Settings UI（v1 交付，`notix-dsh-ui`）

- 卡片注册：`slots.register({ name: 'plugins.item', id: 'notix', order, label, locale }, NotixCard)`；
- 表单数据：`configForms.get('notix')` 得到 schema 驱动的 `ConfigFormController`（读镜像 + 写队列），保存经 `dsh-config-editor` 写入当前 profile 的 patch 并**立即生效**；`configForms.whileServed(['notix'], register)` 保证未安装 Host 插件时不出现卡片；
- 表单分区：五类触发器的开关与阈值（滑块/数字输入）、静默时段、通知详细度、macOS 渠道开关；
- 所有叶子字段 `.volatile()`；保存后 Loader 把新值提交进运行中的 fiber（`loader/volatile-update`），插件调用 `readConfig()` 重读并原地更新配置对象，UI 通过快照订阅回显。

### 7.4 用户配置（YAML 兜底路径，与 UI 等价）

```yaml
# $DSH_HOME/profiles/<name>/cordis.patch.yml
- id: notix
  name: 'notix-dsh'
  config:
    triggers:
      longTask: { turnThresholdMs: 300000 }
    channels:
      macos: { sound: false }
```

**开箱零配置可用**：默认 macos-system 渠道开 + approval/user-question/error/long-task/completion 全开。

### 7.5 安装与分发

- 开发：Web Plugins 页 / `dsh plugin` 安装 `link:<绝对路径>`；
- 分发：发布 npm 后 `installBundle`（自动 `engines.dsh`/peer 兼容检查）；两个包都进 `dsh.profile.bundles`（或 UI 包随宿主包的 patch 一并引入——以 spike 结论为准）。

---

## 8. 关键实现细节与风险

| 议题 | 决策 / 对策 |
|---|---|
| 全局 `session/event` 监听性能 | 首行按类型白名单（约 8 个类型）返回，不做正则/深遍历。`dsh-user-approval/invariant` 等同模式，风险可控。 |
| 不干预 agent 路径 | 不注册任何 waterfall answerer；`emit` 监听返回值不被等待；回调 try/catch，异常只进 Notix 日志。 |
| 会话日志纯净 | 不 `session.append`。通知历史只进 `storageDomain`。 |
| 隐私 | body 默认只含会话标题、工具名、问题摘要（截断 200 字符）；不含命令全文/文件内容。`verbosity: minimal（默认）\| normal`。系统通知内容同时受 macOS 通知中心隐私设置约束。 |
| 计时器生命周期 | 全部 `ctx.timeout/ctx.interval`，随 fiber dispose 自动清理，HMR/卸载无残留。 |
| HMR / 配置热更 | 可编辑字段全部 `.volatile()`，设置保存走 Loader 的 volatile 提交（不重载）；插件监听 `loader/volatile-update` → `readConfig()` 重读引用并原地更新；dispose 清空内存去重索引与队列；历史在 storageDomain 不丢。 |
| 多端重复 | 同一 Host 进程一条事件总线，不重复；多 profile/实例各自通知（符合预期）。 |
| 错误去重 | `agent/error` 与 `turn/end(reason=error)` 同源，同 `(sessionId, turn)` 合并；job `failed` 的 T4/T5 合并为一条。 |
| 故障渠道 | 渠道失败互不影响；连续失败熔断 + history 标记。 |
| macOS 通知限制 | 拿不到 Electron 对象（纯 Node 宿主）→ osascript 零依赖兜底；自定义横幅图标需走 UNUserNotificationCenter 的签名助手 App 或 terminal-notifier `-appIcon`。**实测：ad-hoc/未签名 App 的 `requestAuthorization` 被系统直接拒绝（denied，无授权弹窗）**，因此鲸鱼图标需用户提供 Apple Development/Developer ID 证书后签名。 |
| Settings UI 双包形态 | 单包双声明（bundle + dsh.client）可行性需在 M1 末期 spike 验证；不行则 `notix-dsh-ui` 独立 bundle 发布（官方先例均如此）。 |

---

## 9. 里程碑

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **M1（MVP）** | `notix-dsh` 包骨架 + bundle 可安装；T1/T2/T4 + T5(job)；macos-system 渠道（osascript + terminal-notifier 探测）；去重/冷却；storageDomain 历史 | 装入 profile 后：触发需审批的 bash 写操作 → 5s 内收到 macOS 通知；agent 报错 → 收到错误通知；job 完成 → 收到完成通知；卸载后无残留定时器/监听器 |
| **M2** | T3 + T5(turn)；阻塞类重复提醒；防抖；静默时段；`notix-dsh-ui` Settings 卡片（configForms） | 长 turn 超阈值提醒；审批 5min 未处理重复提醒（GUI 已处理则不催）；Settings 页改阈值立即生效且不重启 |
| **M3（后续迭代）** | 多渠道：webhook / lark / wecom / bark / ntfy；gui-toast 渠道（通知中心）；Windows/Linux 系统通知 | 飞书收到 urgent 通知；GUI 后台时浏览器弹系统通知 |

---

## 10. 已解决的开放问题（存档）

见 §1.1。评审中曾讨论"Phase 2 可交互审批"（Notix 注册为真实 `approval/request` answerer，支持在飞书卡片上直接批准操作），**结论：不做**——该能力把插件从"观察者"变为"决策者"，引入远程授权攻击面且破坏 fail-closed 的单一职责；Notix 保持纯通知，决策永远发生在 dsh GUI。


---

## 11. 实现状态（v1.1）

| 交付物 | 状态 | 位置 |
|---|---|---|
| `notix-dsh` Host 插件（T1–T5、去重/冷却、静默时段、历史、macOS 渠道） | ✅ 已实现，19 项单元/集成测试通过 | `packages/notix-dsh/` |
| bundle 形态（`dsh.bundle.patch` + `cordis.patch.yml`） | ✅ 已实现，`dsh --dump-config` 组合校验通过 | `packages/notix-dsh/cordis.patch.yml` |
| macOS 通知渠道 | ✅ osascript 通道已在真机验证；新增**签名通知助手 App** 支持（`scripts/build-notifier-app.sh`，横幅显示鲸鱼图标；受 macOS 签名要求限制，需用户签名身份） | `packages/notix-dsh/lib/channels/macos.js`、`scripts/notifier/` |
| Settings UI（`notix-dsh-ui`） | ✅ 已实现（kimi-k3 设计与实现），bundle 契约冒烟通过 | `packages/notix-dsh-ui/`、`docs/ui-settings-design.md` |
| 多渠道（webhook/lark/wecom/bark/ntfy） | 计划 M3，渠道注册表接口已就绪 | — |

实现核对产生的三处设计修正：
1. `userQuestions` 投影的 state 枚举实际为 `open` / `continued`（设计初稿写作 pending），触发器已按实际枚举实现；
2. 通用 `job` 观看优先走 session 事件 `job/registered`/`job/settled`（实现取的是持久化事实，未依赖 `ctx.jobs.events.subscribe`，避免额外可选服务耦合；如需 output/progress 增量可作为 M3 增强）；
3. **设置卡片不出现的根因**：dsh-settings 的 `describe()` 只暴露含 `.volatile()` 字段的 Config（`volatileForm()` 过滤），初版 schema 没有 volatile → 命名空间被过滤 → `configForms.whileServed(['notix'])` 永不触发。已将所有可编辑叶子标为 `.volatile()`，并改造 `readConfig()`/`loader/volatile-update` 支持热更新。
