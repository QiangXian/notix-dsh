# Notix Host 插件代码地图（`packages/notix-dsh`）

> 用途：《Notix × dsh 代码指南》的逐文件代码事实底稿。行号全部取自当前工作区 `read` 输出，未改任何源码。
> 事实基线：HEAD `4213507`，包版本 `0.1.1`；`node --test packages/notix-dsh/test/*.test.js`（Node v22.23.2）实测 **23 tests / 23 pass**。DESIGN.md v1.1 仅作对照，冲突以代码为准（§10）。

## 0. 端到端数据流

```
dsh 事件面
 ├─ session/event {global:true} ─┬ approval.js:79    approval/asked|decided
 │                               ├ long-task.js:117  turn/start|end, job/registered|settled
 │                               ├ error.js:101      turn/end(reason=error), tool/call|result
 │                               └ completion.js:59 turn/end(completed), job/settled
 ├─ agent/error {global:true} ── error.js:102
 ├─ sessionProjections.onChanged  questions.js:133  key==='userQuestions'
 ├─ session/disposed {global:true} questions.js:144
 └─ ctx.timeout                   approval.js:30 / questions.js:42 / long-task.js:23,49
        │
        ▼  触发器内联构造 { kind, sessionId, urgency, dedupeKey, payload }（无类型/无工厂）
   void core.submit(...)   // fire-and-forget，回调首行 try/catch
        ▼
NotixCore.submit                              lib/core/notix.js:177
 ① quiet hours :179 → inQuietHours :160
 ② dedupe      :180 → store.isDuplicate
 ③ remember    :181 → store.remember
 ④ error 冷却   :183-188 → store.hitCooldown
 ⑤ 渲染         :190 → renderNotification（render.js:94）
 ⑥ 组 record+记历史 :191-204
 ⑦ 串行投递      :206-213 → ChannelRegistry.deliver（channels.js:64）
        ▼
ChannelRegistry.deliver：熔断检查 :68-69 → 最多 4 次尝试 :71-84 → 10s 超时 :73 → 退避 1s/5s/15s
        ▼
MacosChannel.send（macos.js:102）：签名 helper :107 → terminal-notifier :111 → alerter :120 → osascript :126
        ▼
store.update(record.id,{delivered,channels})   notix.js:209 / store.js:168
```

**一句话调用链**：dsh 事件/投影/`ctx.timeout` → 五个 trigger（过滤 + 拼 dedupeKey/payload）→ `NotixCore.submit`（静默→去重→冷却→渲染→记历史→串行投递）→ `ChannelRegistry.deliver`（超时/重试/熔断）→ `MacosChannel` 四后端之一。

## 1. 包身份与装载

### 1.1 `package.json` 逐项（46 行）

| 字段 | 值 / 作用 | 行号 |
|---|---|---|
| `name` / `version` | `notix-dsh` / `0.1.1`；bundle 的安装单元 | 2-3 |
| `description` / `type` / `main` | 市场文案回退 / `module`（纯 ESM）/ `lib/index.js` | 4-6 |
| `exports` | `.`→`lib/index.js`；`./cordis.patch.yml`；`./locale/*.json`；`./package.json`。**无 `default` 导出**，靠 Loader `unwrapExports` 取命名空间 | 7-12 |
| `files` | `lib, icon.png, cordis.patch.yml, locale, README*, assets, scripts`——`assets/scripts` 随包发布（构建签名 helper 用） | 13-22 |
| `icon` | `./icon.png`；bundle 卡片读 manifest icon | 23 |
| `dsh.bundle.patch` | `./cordis.patch.yml`：声明本包是 bundle，Loader 会加载该 patch 插入插件行 | 24-28 |
| `engines.dsh` | `>=0.2.1-rc.2 <0.3.0`；**声明后兼容性只由它裁决，peer 被忽略**（dsh-app-boot README 事实） | 29-31 |
| `peerDependencies` | `@deepseek-ai/cordis: ~4.0.5`；源码并不 import cordis，属意图声明 | 32-34 |
| `dependencies` | `schemastery ^3.18.5`（动态 import，可降级）、`zod ^4.4.3`（store schema） | 35-38 |
| `license` / `keywords` | MIT；`dsh, dsh-plugin, notification, deepseek-harness` | 39-45 |

### 1.2 `cordis.patch.yml` 的 `insert` 语义（41 行）

```yaml
# cordis.patch.yml:1-9
# Notix bundle layer: insert the plugin row with its shipped defaults.
# Users override fields under the same id in the profile's cordis.patch.yml.
- insert:
    - id: notix
      name: notix-dsh
      config:
        language: zh
        verbosity: minimal
```

- `- insert:` 列表插入插件行，行字段 `{ id, name, config, disabled? }`；`name` 是包说明符，文档也允许绝对路径/file URL（`dev/notix.patch.yml:7` 用绝对路径指向 `lib/index.js`）。
- **entry id = `notix`**，与导出 `name`（`index.js:16`）、服务名 `ctx.notix`（`index.js:70`）三处同名。
- `config` 是出厂默认值：`:10-31` 五类触发器、`:32-36` quietHours、`:37-40` macos 渠道。与 `schema.js`、`config.js:DEFAULTS` 逐字段一致（`baseUrl/notifierApp/appIcon` 未重复，靠 schema 默认 `''`）。
- 用户覆写：profile 的 `cordis.patch.yml` 用同 `id: notix` 的 `config`（`README.md:75-88`）。**官方文档事实：用户 patch 是整体替换该 entry 的 config，不是深合并**；因 Notix 出厂 config 恰好等于 schema 默认值，局部覆写才安全——若未来两者分叉，未重述字段会静默回落到 schema 默认值。
- 启停：行上 `disabled: true`（由 Loader 读取，插件代码不处理；DESIGN.md:61）。安装即把包名加入 profile `dsh.profile.bundles`（`README.md:64-69`）。
- 本地免安装：`dev/notix.patch.yml:5-16` 同时插入 `notix` 与 `ui-notix`，路径硬编码本机。

### 1.3 locale / icon

- `locale/en.json`、`locale/zh.json` 各 6 行，仅 `meta.title/description`，**不含通知模板**（模板在 render.js，§10 D22）。
- 市场卡片标题回退（dsh plugin-manager README 事实）：导出 locale `meta` → 包根 `package.json` → 全名；图标读 manifest `icon` 或导出 `./icon`。

## 2. 插件入口 `lib/index.js`（73 行）

### 2.1 导出与形态

| 导出 | 行号 | 事实 |
|---|---|---|
| `name` | 16 | `'notix'` |
| `inject` | 19 | `['sessions','timer','sessionProjections']`，**全为强依赖**（无 optional） |
| `Config` | 26-33 | 顶层 `await import('@deepseek-ai/schemastery')` 构建；失败则 `undefined`，插件仍跑、Settings 表单不可用 |
| `apply` | 55-73 | 唯一启动入口 `async (ctx, rawConfig)` |

**代码事实：这不是 `Service` 子类。** 没有 `super(ctx,'notix')`、`static inject`、`static Config`、`startNotix`；而是对象形态插件字段集，服务通过 `ctx.provide('notix', core.api())`（`:70`）注册。DESIGN §2.1/§7.2 的 Service 形态未落地（§10 D1）。

### 2.2 `apply` 生命周期

```js
// lib/index.js:55-72（节选）
export async function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig)
  const logger = createLogger(ctx)
  const core = new NotixCore(ctx, config, logger)
  await core.start()
  installTriggers(ctx, core)
  ctx.on('loader/volatile-update', () => {
    try { core.replaceConfig(readConfig(rawConfig)) }
    catch (error) { logger.warn(`notix: applying live configuration failed: ${String(error)}`) }
  })
  ctx.provide('notix', core.api())
  ctx.effect(() => () => core.dispose(), 'notix: dispose')
```

1. `readConfig(rawConfig)`：解 volatile 引用再合并默认值（§3.3）。
2. `await core.start()`：`store.open()` + `syncChannels()`（`notix.js:87-90`）。
3. `installTriggers`：注册五个触发器（§4）。
4. `loader/volatile-update`：Loader 已把新值提交进 volatile 引用并广播（官方 loader README 事实）；这里**忽略 changed paths**，整体重读 `rawConfig`，`replaceConfig` 原地替换 `core.config`（`notix.js:110-114`），不重载插件。
5. `ctx.provide` + `ctx.effect`：服务面注册与 fiber 清理（只 `store.close()`）。

`createLogger`（`:36-48`）对 `ctx.logger('notix')` 做形状探测，失败回退 console logger，避免日志设施成为启动失败点。

### 2.3 config 如何到达各层

| 消费者 | 方式 | 依据 |
|---|---|---|
| triggers | 读 `core.config`（每次回调实时读，不缓存） | 五个 trigger 的 `rule()`/直接属性访问 |
| macos 渠道 | `new MacosChannel(() => this.config.channels.macos, logger)`，**getter 闭包** | `notix.js:96-98` |
| core | `this.config`；`replaceConfig` 先 delete 全部 key 再 assign，**保持 identity** | `notix.js:110-113` |
| 外部插件 | `ctx.notix.config`（同一个可变对象） | `notix.js:246` |

## 3. 配置层

### 3.1 `schema.js` 字段树与默认值（94 行）

`buildSchema(z)`（`:22`）返回根 `z.object({ language, verbosity, quietHours, triggers, channels })`（`:80-93`）。所有可编辑叶子 `.volatile()`，中间对象 `.default({})`。共 **29 个叶子**：

| 组 | 字段（类型/约束 = 默认） | 行号 |
|---|---|---|
| 顶层 | `language` union(zh,en)=`zh`；`verbosity` union(minimal,normal)=`minimal` | 81-82 |
| quietHours | `enabled`=false；`from`='23:00'；`to`='08:00'；`allowUrgent`=true | 85-88 |
| approval | `enabled`=true；`remindAfterMs`(step1,min0)=300000；`maxReminders`(min0,max10)=2 | 42-44 |
| userQuestion | `enabled`=true；`remindAfterMs`=300000；`maxReminders`=2；`remindOnContinued`=true | 49-52 |
| longTask | `enabled`=true；`turnThresholdMs`=600000；`jobThresholdMs`=900000 | 57-59 |
| error | `enabled`=true；`cooldownMs`=60000；`toolErrors`=false；`toolTimeout`=false | 64-67 |
| completion | `enabled`=true；`minDurationMs`=180000；`jobs`=true | 72-74 |
| channels.macos | `enabled`=true；`sound`=true；`clickToOpen`=true；`baseUrl`=''；`notifierApp`=''；`appIcon`='' | 27-32 |

**volatile 机制**：官方 dsh-settings README 事实——表单只暴露含 `.volatile()` 的 Config；`schema.js:3-14` 注释明确写“不标 volatile，`settings.describe()` 不返回该命名空间，Settings 卡片不出现”（DESIGN §11 修正 3 记录的坑）。Loader 对 volatile-only 变更走 `_commitVolatile` 并 emit `loader/volatile-update`（changed paths），监听器抛错只记日志。全部 29 个叶子都标了 volatile，含 `baseUrl/notifierApp/appIcon` 这类路径/URL 字符串（schema 未做 URL/路径校验）。

### 3.2 `config.js` 解析（124 行）

| 符号 | 行号 | 行为 |
|---|---|---|
| `DEFAULTS` | 11-59 | `Object.freeze` 深冻结默认配置 |
| `merge` | 67-75 | 递归深合并、不改入参；override 非 plain object 时返回 base 拷贝 |
| `resolveConfig` | 82-84 | `merge(DEFAULTS, raw)`，返回新对象 |
| `isVolatileRef` | 90-98 | 启发式：非 null 对象 + `get` 是函数 + `Object.isFrozen` + 可枚举键只有 `'get'` |
| `unwrapVolatile` | 105-114 | 递归把 ref 换成 `get()` 当前快照，数组/对象同构展开 |
| `readConfig` | 122-124 | `resolveConfig(unwrapVolatile(raw))`；热更后重调 |

```js
// lib/config.js:90-98
function isVolatileRef(value) {
  return (
    typeof value === 'object' && value !== null &&
    typeof value.get === 'function' &&
    Object.isFrozen(value) &&
    Object.keys(value).every((key) => key === 'get')
  )
}
```

- 零依赖（`config.js:1-8` 注释）：schemastery 不可用时仍工作。volatile 判断是形状启发式而非 `instanceof`；测试用 `Object.freeze({get})` 模拟（`core.test.js:8-18`）。
- `merge` 对显式 `null` 会覆盖成 null（schema 在时不会发生；schema 缺失时下游可能读到 `null` 形状）。
- 三处默认值来源（schema / DEFAULTS / cordis.patch.yml）当前一致，但有漂移风险。

### 3.3 运行时读取点（热更生效依据）

| 配置 | 读取位置 |
|---|---|
| `triggers.approval` | `approval.js:28,49` |
| `triggers.userQuestion` | `questions.js:40,64,93` |
| `triggers.longTask` | `long-task.js:14` |
| `triggers.error` | `error.js:12,29,52,82` |
| `triggers.completion` | `completion.js:12,18,34` |
| `triggers.error.cooldownMs` | `notix.js:185` |
| `quietHours` | `notix.js:161`（`parseClock:16-23`、`nowMinutes:26-29`） |
| `language`/`verbosity` | `render.js:95,119` |
| `channels.macos.*` | `macos.js:55,60,105-106,115`；开关 `notix.js:94` |

### 3.4 校验与边界

- schema 可用时才真正校验：`language:'fr'` 使插件加载 reject（`integration.test.js:86-89`）。`config.js` 自身不校验。
- 数字负值只在 schema 拒绝；schema 缺失时负阈值可能传给 `ctx.timeout`（触发器另有 `<=0` 短路：`long-task.js:80,99`、`approval.js:29`）。
- `parseClock` 只认 `^\d{1,2}:\d{2}$`，非法 → `undefined` → `inQuietHours` 返回 false（静默失效但不崩）；`from===to` 视为不启用；不支持秒。
- `nowMinutes` 用 Host 本地时区（`notix.js:26-29`），无时区配置项。

## 4. 触发器层（`lib/triggers/`）

### 4.1 装配与公共形状

`installTriggers` 固定顺序安装：approval → questions → long-task → error → completion（`index.js:18-24`）。每个 `installX(ctx, core)` 无返回值，用闭包保存自身 Map。**没有统一 `RawTriggerEvent` 类型/工厂**，约定字段 `{ kind, sessionId, urgency, dedupeKey, payload }`；core 另读 `payload.sessionTitle`、写入 `trigger.suppressedCount`（`notix.js:179-198`）。kind 取值：`approval` / `user-question` / `long-task` / `error` / `completion` / `manual`。所有回调 try/catch + `void core.submit(...)`；**规则过滤（enabled/阈值）在各 trigger 内完成，core 无统一规则引擎**（§10 D11）。

### 4.2 T1 审批 `approval.js`（80 行）

| 项 | 事实 | 行号 |
|---|---|---|
| 订阅 | `ctx.on('session/event', onEvent, { global: true })` | 79 |
| 事件/过滤 | `approval/asked`（`triggers.approval.enabled`）、`approval/decided` | 48-50,70 |
| 状态机 | `pending: Map<approvalId,{sessionId,timer?,reminders,payload}>` | 16 |
| 首次通知 | urgency `urgent`、dedupeKey `approval:${sessionId}:${id}` | 58-64 |
| 提醒 | `ctx.timeout(remindAfterMs)` 递归；`reminders>=maxReminders` 或 `remindAfterMs<=0` 停 | 27-43 |
| 提醒 key | `approval:${sessionId}:${id}:reminder:${n}` | 33 |
| payload | `{toolName, reason, sessionTitle}`，提醒时加 `reminder:n` | 52-56,39 |
| 配对解除 | decided → `settle(id)`（清 timer + 删 pending）+ `clearBusy(sessionId,'approval')` | 70-73 |
| busy | asked 时 `markBusy(sessionId,'approval')` | 57 |

```js
// lib/triggers/approval.js:27-35
const schedule = (id, entry) => {
  const rule = core.config.triggers.approval
  if (entry.reminders >= rule.maxReminders || rule.remindAfterMs <= 0) return
  entry.timer = ctx.timeout(() => {
    if (!pending.has(id)) return
    entry.reminders += 1
    const dedupeKey = `approval:${entry.sessionId}:${id}:reminder:${entry.reminders}`
```

注意：`outcome` 完全不读；只要收到 decided 就清 busy。busy 是“每 session 一个 reason 集合”，同会话多个未决审批时任一 decided 就清掉，另一个仍挂起——长任务防抖可能提前恢复。`callId` 未进 payload。无 `ctx.effect`；提醒 timer 由 `ctx.timeout` 的 fiber 归属清理，`pending` Map 不显式清空。

### 4.3 T2 用户提问 `questions.js`（153 行）

| 项 | 事实 | 行号 |
|---|---|---|
| 数据源 | `sessionProjections.stateOf(session,'userQuestions')` 的 `state.active[]` | 10-17 |
| 订阅 | `projections.onChanged((session,key,value)=> key==='userQuestions' && observe(...))` | 128-141 |
| 状态 | `announced: Map<sessionId,{open:Set,continued:Set}>`；`reminders: Map<callId,{timer?,sessionId,callId,reminders,payload}>` | 26,28 |
| open | 首次见且 `state==='open'` → 通知；dedupeKey `question:${sessionId}:${callId}` | 69-90 |
| continued | 首次见且 `remindOnContinued` → 再通知；key `question:${sessionId}:${callId}:continued` | 91-108 |
| 提醒 | 同构，key `question:${sessionId}:${callId}:reminder:${n}` | 39-54 |
| payload | `{callId,count,question:questions[0].question,sessionTitle}`（+`continued`/`reminder`） | 72-77,99-106 |
| 过期清理 | observe 末尾把不在 `stillActive` 的 reminder `settle` | 110-115 |
| busy | 有 active → markBusy('question')，否则 clearBusy | 117-118 |
| 启动 seed | `for (session of ctx.sessions.list()) observe(...)` | 121-126 |
| 会话清理 | `session/disposed` → 删 announced、settle 本会话 reminders、clearBusy | 144-152 |
| 降级 | projections 缺失/无 `onChanged` → warn + 该触发器停用 | 128-132 |

**注意 1**：seed 注释说“已有问题重载不通知”（`:121`），但 `observe` 对 unseen open 会 `core.submit`（`:69-89`），所以启动时已 active 的问题**会发通知**；测试未覆盖（mock 的 questionState 初始为空）。
**注意 2**：`onChanged(...)` 返回的 disposer 被丢弃（`:133`），未登记 `ctx.effect`/fiber——fiber 卸载后监听器是否残留取决于 projection 服务自身契约；集成测试只验证了 session/event 监听器与服务被移除（§10 D13）。
**注意 3**：`reminders` 以 `callId` 为全局键（跨 session），依赖 callId 全局唯一。

### 4.4 T3 长任务 `long-task.js`（126 行）

| 项 | 事实 | 行号 |
|---|---|---|
| 订阅 | `session/event`：turn/start、turn/end、job/registered、job/settled | 71-117 |
| 状态 | `turns: Map<${sessionId}:${turn},…>`；`jobs: Map<jobId,…>` | 15-18 |
| turn 计时 | start 时 `core.beginTurn` 后 `ctx.timeout(turnThresholdMs)`；到点 busy 则重 arm | 75-84,21-44 |
| turn key | `longturn:${sessionId}:${turn}` | 35 |
| job 计时 | `job/registered`：`startedAt=Number(data.startedAt)\|\|Date.now()`，label 回退 `data.kind ?? 'job'` | 93-103 |
| job key | `longjob:${sessionId}:${jobId}` | 59 |
| payload | turn：`{scope:'turn',turn,durationMs,thresholdMs}`；job：`{scope:'job',jobId,label,durationMs,thresholdMs}` | 36-41,60-66 |
| urgency | 均 `normal` | 34,58 |
| busy 防抖 | 到点若 `core.isBusy(sessionId)` → 重新等**一个完整阈值** | 26-30,51-54 |
| 结束清理 | turn/end 清 timer；job/settled 清 timer + `core.endJob(jobId)` | 86-92,105-111 |
| fiber 清理 | `ctx.effect` 取消所有 turn/job timer 并清 Map | 119-125 |
| 禁用行为 | `beginTurn/beginJob` 在 enabled 检查**之前**执行（保证 completion 有时长） | 79,98 |

```js
// lib/triggers/long-task.js:21-30
const watchTurn = (key, entry) => {
  const ruleNow = rule()
  entry.timer = ctx.timeout(() => {
    if (!turns.has(key)) return
    const sessionId = entry.sessionId
    if (core.isBusy(sessionId)) {
      // The agent is blocked on the user; T1/T2 already cover this period.
      watchTurn(key, entry)
      return
    }
```

- `BUSY_RECHECK_MS = 30_000`（`:6`）**定义但从未使用**；DESIGN 的“按剩余阈值重新计时”实际是“每等完整阈值再检查 busy”（§10 D10）。
- 每个 watchdog 只发一次；busy 分支是唯一续 arm 路径。

### 4.5 T4 错误 `error.js`（103 行）

| 子源 | 过滤 | dedupeKey | payload | 行号 |
|---|---|---|---|---|
| `turn/end` reason.error | `enabled` | `error:${sessionId}:${turn}` | `{scope:'turn',turn,errorName,message,sessionTitle}` | 27-39 |
| `agent/error`（需 `agent.session`） | `enabled` | **同上**（与 turn/end 合并一条） | 同上 + `step` | 80-99 |
| `tool/result` isError | `toolErrors`/`toolTimeout` | `toolerror:${sessionId}:${toolCallId}` | `{scope:'tool',toolName,errorName,message,sessionTitle}` | 50-74 |

```js
// lib/triggers/error.js:50-58
      if (event.type === 'tool/result') {
        const current = rule()
        if (!current.enabled) return
        const message = event.data.message
        if (message?.isError !== true) return
        const info = event.data.error ?? {}
        const code = info.code ?? ''
        const isTimeout = code === 'TOOL_TIMEOUT' || info.name === 'ToolTimeoutError'
        if (isTimeout ? !current.toolTimeout : !current.toolErrors) return
```

- 错误名：`error.code ?? error.name ?? error.kind ?? 'Error'`，message 转字符串（`:17-22`）。
- `toolNames: Map<callId,name>`，`tool/call` 记录，上限 200 FIFO 淘汰（`:40-49`）；`tool/result` 用 `toolNames.get(id) ?? info.name ?? 'tool'`（`:60`）。
- **超时只看 `toolTimeout`**：`toolTimeout=false` 时即使 `toolErrors=true` 超时也不通知（`:58`）。
- 冷却不在这里做，由 core 按 `error:${sessionId}` 桶统一处理；无 job 错误分支（§10 D17）。

### 4.6 T5 完成 `completion.js`（60 行）

| 子源 | 过滤 | urgency | dedupeKey | payload | 行号 |
|---|---|---|---|---|---|
| `turn/end` | `enabled`、reason `completed`、`durationMs>=minDurationMs` | `low` | `completion:${sessionId}:${turn}` | `{scope:'turn',turn,durationMs,sessionTitle}` | 17-31 |
| `job/settled` | `enabled && jobs` | failed→`normal`，否则 `low` | `jobdone:${sessionId}:${jobId}` | `{scope:'job',jobId,status,label,durationMs,sessionTitle}` | 33-53 |

- turn/end 第一件事 `core.endTurn(...)`，**即使 completion 关闭也消费起点**防泄漏（`:19-20`）；job/settled 第一件事 `core.endJob(jobId)`（`:36`）。
- **job 的 `durationMs` 恒为 0**：long-task 先注册（`triggers/index.js:21` 在 `:23` 前），其 job/settled 处理器先 `endJob` 删掉 facts（`long-task.js:110`），completion 再取为 undefined（`completion.js:36,49`）。渲染不展示该字段，用户无感（§10 C2）。
- `status` 用于标题/urgency，`cause/finishedAt` 未用；job failed 走这条“完成”通知，不进 error 冷却、不产生 error 历史（§10 D17）。

### 4.7 状态与清理总表

| Trigger | 状态 Map | 清理路径 | 降级 |
|---|---|---|---|
| approval | `pending` | decided 时 settle；无 effect，timer 由 `ctx.timeout` 归属清理 | — |
| questions | `announced`、`reminders` | projection 收口 settle / session disposed | projections 缺失 → warn + 停用 |
| long-task | `turns`、`jobs` | turn/end、job/settled、fiber effect | 无外部服务依赖 |
| error | `toolNames`（≤200） | FIFO | — |
| completion | 无（复用 core 计时） | `endTurn`/`endJob` 消费 | — |

`ctx.timeout` 由 `cordis-plugin-timer` 管理，随 fiber 卸载自动清理（`inject` 含 `timer`）；普通 Map 随闭包 GC，HMR 重挂是新闭包。唯一跨 fiber 风险是 `onChanged` 监听器（§4.3 注意 2）。

## 5. Core 编排 `lib/core/notix.js`（249 行）

### 5.1 结构

`class NotixCore`（`:32`），构造 `(ctx, config, logger)`（`:38`）：

| 字段 | 含义 | 行号 |
|---|---|---|
| `store` | `NotixStore`（§6） | 42 |
| `channels` | `ChannelRegistry`（§8） | 43 |
| `chain` | `Promise` 串行链，保证按提交顺序投递 | 44 |
| `turnStarts` | `Map<'sessionId:turn', number>` | 45-46 |
| `jobStarts` | `Map<jobId,{startedAt,label}>` | 47-48 |
| `busy` | `Map<sessionId,Set<'approval'\|'question'>>` | 49-50 |
| `macosRegistration` | macos 渠道 disposer，用于热更启停 | 51-52 |

### 5.2 start / 渠道同步 / 热更 / dispose

```js
// lib/core/notix.js:87-103（节选）
async start() { await this.store.open(); this.syncChannels() }

syncChannels() {
  const macosEnabled = this.config.channels?.macos?.enabled === true
  if (macosEnabled && this.macosRegistration === undefined) {
    this.macosRegistration = this.channels.register(
      new MacosChannel(() => this.config.channels.macos, this.logger))
  } else if (!macosEnabled && this.macosRegistration !== undefined) {
    this.macosRegistration(); this.macosRegistration = undefined
  }
}
```

- Settings 关 macos 会真正注销适配器；开则重新注册（新 MacosChannel，backend 缓存重置）。
- `replaceConfig`（`:110-114`）：清 key → assign → `syncChannels()`；不重建 core/triggers/渠道，保持 config identity。
- `dispose`（`:117-119`）只 `store.close()`；渠道/监听器交给 fiber（`macosRegistration` 未显式调用，registry 随 core GC）。
- `sessionTitle`（`:122-129`）：`ctx.get('sessionProjections')?.stateOf(session,'title')`，非空 string 才返回；DESIGN 写 `ctx.agents`，实现是 title 投影（§10 D3）。

### 5.3 busy 与计时

`markBusy/clearBusy/isBusy`（`:60-84`）：Set 去重、空集删 key；long-task 用它防抖，测试直接断言（`triggers.test.js:26,36,51,62`）。`beginTurn/endTurn`（`:132-145`）返回时长、未知返回 0；`beginJob/endJob`（`:148-157`）返回 facts。**计时数据跨 trigger 共享**（long-task 写、completion 读），`triggers/index.js:2-4` 的“disjoint state”注释不准确（§10 C2）。

### 5.4 quiet hours（`:160-170`）

```js
inQuietHours(urgency) {
  const quiet = this.config.quietHours
  if (!quiet?.enabled) return false
  if (urgency === 'urgent' && quiet.allowUrgent) return false
  const from = parseClock(quiet.from), to = parseClock(quiet.to)
  if (from === undefined || to === undefined) return false
  const current = nowMinutes()
  if (from === to) return false
  return from < to ? current >= from && current < to : current >= from || current < to
}
```

支持跨午夜；`from===to` 关闭；urgent + `allowUrgent` 放行。静默判断在去重/冷却/记历史**之前**（`:179`），被静默事件不留痕、时段结束不补发（DESIGN 顺序相反，§10 D9）。

### 5.5 `submit` pipeline（逐行事实）

```js
// lib/core/notix.js:177-190（节选）
async submit(trigger) {
  try {
    if (this.inQuietHours(trigger.urgency)) return undefined
    if (this.store.isDuplicate(trigger.dedupeKey)) return undefined
    this.store.remember(trigger.dedupeKey)
    if (trigger.kind === 'error') {
      const bucketKey = `error:${trigger.sessionId}`
      const suppressed = this.store.hitCooldown(bucketKey, this.config.triggers.error.cooldownMs)
      if (suppressed > 0) return undefined
      trigger.suppressedCount = this.store.suppressed(bucketKey)
    }
    const { title, body } = renderNotification(this.config, trigger)
```

| # | 步骤 | 行号 | 关键事实 |
|---|---|---|---|
| ① | 静默 | 179 | 先于去重；完全丢弃 |
| ② | 去重 | 180 | TTL 24h（内存/持久） |
| ③ | 记 dedupe | 181 | **先记后投递**：投递失败 24h 内也不重试同 key |
| ④ | error 冷却 | 183-188 | 桶键 `error:${sessionId}`；`cooldownMs<=0` 不抑制 |
| ⑤ | 渲染 | 190 | 同步纯函数 |
| ⑥ | record | 191-203 | `randomUUID()`；`delivered:false`、`channels:[]`；`sessionTitle` 可选 |
| ⑦ | 记历史 | 204 | 内存 + best-effort 持久 |
| ⑧ | 串行投递 | 206-213 | `chain = chain.then(deliver)`；catch 记 warn 不污染后续 |
| ⑨ | 返回 | 214 | 不等投递；测试需 `await core.chain` |

### 5.6 并发/重试/熔断

- **通知级串行**：共享一条 `this.chain`，投递一次一条（`:206`）。
- **渠道级串行**：`deliver` 的 `for` 顺序 await（`channels.js:67-93`），同通知逐渠道。
- 重试/超时/熔断都在 registry（§8.1），core 不重试；单条通知单渠道最坏约 4×10s 超时 + 1+5+15s 退避 ≈ 61s，会阻塞后续通知。
- 失败隔离：registry 不 reject、core 链再 catch、`submit` 外层 try/catch 兜同步错误。
- 无队列持久化、无优先级、无容量/背压（§10 D11/D12）。

### 5.7 history 与服务 API

- `notify(input)`（`:225-238`）：`kind:'manual'`，`sessionId` 默认 `'manual'`，dedupeKey 默认随机 UUID（永不去重）；返回 `record|undefined`（DESIGN 写 `Promise<void>`，§10 D8）。
- `api()`（`:241-248`）：`notify`、`registerChannel`、`history`、`config`（live 对象，外部可读；改它不触发 syncChannels/校验）。

## 6. `lib/core/store.js`（192 行）

### 6.1 域与 schema

```js
// lib/core/store.js:12-13,35-43
const HISTORY_LIMIT = 200
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000
// historyRecordSchema（:15-28）: id/kind/urgency/title/body/sessionId/sessionTitle?/dedupeKey/createdAt/delivered/channels/error?
// dedupeRecordSchema（:30-32）: { at: number }
const notixDomain = {
  name: 'notix', version: 1, layout: 'per-record',
  tables: { history: { valueSchema: historyRecordSchema }, dedupe: { valueSchema: dedupeRecordSchema } },
}
```

- **一个域 `notix` + 两张表**，不是 DESIGN 的 `notix.dedupe`/`notix.history` 两个域（§10 D4）。`version:1` 供迁移；未用 `defineDomain`（`:34` 注释）。
- `historyRecordSchema.error?` 预留但 core 从未写入（`store.js:27`）。

### 6.2 open / 持久化时机

```js
// lib/core/store.js:64-83（节选）
async open() {
  const storageDomain = this.ctx.get('storageDomain')
  if (storageDomain === undefined || typeof storageDomain.open !== 'function') {
    this.logger?.info('notix: storageDomain unavailable; notification history stays in memory')
    return
  }
  try {
    this.domain = await storageDomain.open(notixDomain)
    const now = Date.now()
    for (const [key, value] of this.domain.table('dedupe').entries())
      if (now - value.at <= DEDUPE_TTL_MS) this.dedupe.set(key, value.at)
    const records = [...this.domain.table('history').entries()].map(([, v]) => v).sort((l, r) => l.createdAt - r.createdAt)
    this.records = records.slice(-HISTORY_LIMIT)
  } catch (error) { /* warn + domain=null 内存兜底 */ }
}
```

- 服务缺失或 open 抛错 → 静默降级内存（info/warn 区分），插件功能不降级。
- 写入时机：`remember`（dedupe）、`record`（新通知）、`update`（投递结果）全部**异步 fire-and-forget**，失败只 debug，从不 await。
- `close`（`:87-96`）置空 domain 后 await close。
- **契约假设**：`table.entries()` 同步可迭代、`table.put()` 返回 thenable（代码直接 `.catch`）；集成测试 fake 满足（`integration.test.js:106-126`）。若 Host 的 `put` 同步，这里会因 `.catch` 不存在而抛错。

### 6.3 内存算法

| API | 行号 | 语义 |
|---|---|---|
| `isDuplicate(key,ttl=24h)` | 104-112 | 过期即删返回 false |
| `remember(key)` | 115-124 | 写 Map + 持久化 `{at}` |
| `pruneDedupe` | 187-191 | size≥512 才清理过期项 |
| `hitCooldown(key,windowMs)` | 132-142 | `<=0` 返回 0；窗口内 `count+=1` 返回 count；否则新建 `{count:0,until}` |
| `suppressed` | 145-147 | 当前桶 count |
| `record` | 153-161 | push + 截断 200 + 持久化 |
| `update` | 168-175 | 内存 assign + 重新 put |
| `history(limit=20)` | 182-184 | 尾部 limit 条、反转、浅拷贝 |

- **cooldown 只在内存**：重启清零；dedupe/history 持久。固定窗口不滑动延长。
- **suppressedCount 实际不可达**：`hitCooldown` 窗口内返回 >0，`submit` 立即 return（`notix.js:186`）；能走到 `suppressedCount=store.suppressed()`（`:187`）的只剩未被抑制（count 0）的情况，`render.js:134` 的聚合分支永不成立（§10 D21）。

## 7. `lib/core/render.js`（144 行）

| 导出 | 行号 | 说明 |
|---|---|---|
| `formatDuration(ms,language)` | 7-15 | <60s 特判；分钟四舍五入；≥60min 输出小时+分钟 |
| `truncate(text,max=200)` | 18-21 | 空白折叠+trim+超长截断加 `…` |
| `renderNotification(config,trigger)` | 94-136 | 唯一 kind→(title,body) 入口 |
| `firstQuestionText` | 139-142 | **包内未使用**（死代码/预留） |
| `textOf` | 24-28,144 | **包内未使用** |

- 两套模板常量 `ZH`（`:30-57`）/`EN`（`:59-86`），`language==='en' ? EN : ZH`（`:95`）；无 i18n 加载器/插值引擎，模板就是返回字符串的函数。
- switch（`:99-133`）按 kind：approval / user-question / long-task（再按 `payload.scope==='job'` 二选一）/ error / completion（scope 二选一）/ default（manual 直接用 payload.title/body）。
- `sessionTitle` 来自 payload；body 用 `[..., sessionTitle].filter(Boolean).join('\n')`。
- `verbosity` **只影响 error body**（`:46-49,75-78`）：minimal 只给 sessionTitle，normal 给 `truncate(message,200)`+sessionTitle。
- 截断：问题 160（`:35,64`）；error message 200；最终统一 title≤120、body≤500（`:135`）。
- 聚合追加 `if (trigger.suppressedCount>0)`（`:134`）实际不可达（§6.3）。
- payload 的 `reminder/thresholdMs/toolName(错误分支未用)/jobId` 多数不参与渲染；`jobDoneBody` 拼英文 `status` 原值（`:54-55`）。
- locale JSON 只有 meta，因此换语言须改代码（§10 D22）。

## 8. 渠道层

### 8.1 `lib/core/channels.js`（96 行）

接口（隐含、无 TS 类型）：`{ id: string, send(notification): Promise<void> }`（`:36-42`）。

```js
// lib/core/channels.js:7-10
const RETRY_DELAYS_MS = [1000, 5000, 15000]
const DELIVERY_TIMEOUT_MS = 10_000
const BREAKER_FAILURES = 3
const BREAKER_COOLDOWN_MS = 5 * 60_000
```

| 成员 | 行号 | 行为 |
|---|---|---|
| `register(adapter)` | 39-46 | 校验 id 非空、send 为函数，否则 TypeError；存 `{id,send:bind,enabled:true}`；**返回 disposer** |
| `setEnabled` / `ids` | 49-57 | 包内未使用 |
| `deliver(notification)` | 64-95 | enabled 适配器顺序投递，返回成功 id 数组 |

`deliver` 细节：熔断命中直接 `continue`（`:68-69`）；每次尝试独立 10s 超时（`:73`，`withTimeout` `:13-19` 只 race 不杀进程）；尝试次数 = 1+3 重试（`:71`）；整轮失败后 breaker failures+1，达到 3 次 → `until=now+5min`（`:85-90`）；成功则删除 breaker（`:75`）。`adapters/breakers` 均在内存，插件重载清零。

### 8.2 `lib/channels/macos.js`（129 行）

| 常量/成员 | 值 | 行号 |
|---|---|---|
| `PACKAGE_ROOT` | `dirname^3(import.meta.url)` → 包根 | 23 |
| `DEFAULT_APP` | `~/Applications/Notix.app` | 24 |
| `DEFAULT_APP_ICON` | `<包根>/assets/notifier-icon.png` | 25 |
| 渠道 id | `'macos-system'`（配置键是 `channels.macos`） | 49-51 |
| `notifierAppPath`/`appIconPath` | 配置优先，否则默认 | 54-61 |
| `detectBackend` | helper exe → `which terminal-notifier` → `which alerter` → osascript；结果缓存 `this.backend` | 64-80 |
| `send` | 平台守卫 → detect → sound → 分派 | 102-128 |

| 后端 | 命令/参数 | 特点 | 行号 |
|---|---|---|---|
| helper-app | `executable title body (sound?'default':'silent')` | UNUserNotificationCenter，横幅显示鲸鱼图标；需签名授权 | 83-96,107-110 |
| terminal-notifier | `-title -message -group dedupeKey [-appIcon] [-sound default] [-open baseUrl]` | 支持点击跳转（`clickToOpen && baseUrl`）；`-group` 用 dedupeKey | 111-119 |
| alerter | `--title --message [--sound default]` | 不支持 open/点击；无 icon | 120-125 |
| osascript | `osascript -e '<script>' -- body title` | 零依赖兜底 | 126-127 |

```js
// lib/channels/macos.js:27-33
const WITH_SOUND = `on run argv
  display notification (item 1 of argv) with title (item 2 of argv) sound name "Glass"
end run`
const WITHOUT_SOUND = `on run argv
  display notification (item 1 of argv) with title (item 2 of argv)
end run`
```

**注入防护**（本文件最值得讲）：全部 `execFile` + 参数数组，不经 shell；osascript 不是把 title/body 拼进脚本，而是 `-e <常量脚本> -- body title`，脚本内 `item 1/2 of argv` 读取（`:127`），空格/引号/分号都无法逃逸。terminal-notifier/alerter 的值也在参数位，不会被当成新 flag。helper 错误码 2 被翻译成“未授权 + 重建签名”的可操作提示（`:87-93`），其他错误抛给 registry 重试。

**取舍**：`detectBackend` 只检查 `~/Applications/Notix.app/Contents/MacOS/NotixNotifier` 是否存在（`:67-68`），不检查签名/授权；授权失败在首次 `sendWithHelper` 以 exit 2 暴露，重试 4 次仍失败并熔断，**不会自动回退 osascript**（宁失败提示修签名，不悄悄退回 Script Editor 图标）。`backend` 缓存意味着运行中改 `notifierApp` 要等插件重载才重新探测。

### 8.3 helper App 构建链

| 文件 | 事实 |
|---|---|
| `scripts/notifier/NotixNotifier.swift`（54 行） | argv[1..3]=title/body/sound\|silent；`NSApplication.shared` + `.accessory`；`requestAuthorization([.alert,.sound])`，denied `exit(2)`；`UNNotificationRequest` 无 trigger 立即投递；`RunLoop.main.run(until:+5s)`；日志 `/tmp/notix-notifier.log`（argv[4] 可覆盖，`:15`） |
| `scripts/build-notifier-app.sh`（89 行） | `swiftc` 编译；组装 `Notix.app/Contents/{MacOS,Resources,Info.plist}`；`BUNDLE_ID` 默认 `com.notix.notifier`；`codesign --force --deep --sign "$IDENTITY"`；无 `NOTIX_SIGN_IDENTITY` 时 ad-hoc 并警告；`--install` 复制到 `~/Applications/Notix.app` |

## 9. 测试

### 9.1 `test/mock.js`（167 行）

- `installClock(start)`（`:9-21`）：覆写全局 `Date.now`，`advance(ms)` 累加 offset，`restore()` 还原。
- `createSession(id,title)`（`:24-29`）：`{header:{id},title}`。
- `createMockContext`（`:35-147`）：手写 Cordis-like ctx——`logger`（捕获 logs）、`sessions.list`、`on`、`timeout`（登记 `{callback,due,cancelled}`）、`get`/`provide`（services Map）、`effect(fn)`（**直接执行 fn 并忽略返回的 disposer**，清理逻辑不被测）、`emit`、`emitSession`（补 `{type,data,seq,time}` 后广播）、`emitUserQuestions`（写 questionState 后调 projection listener）、`advance`（假时钟 + 跑到期 timer，`runDueTimers` guard 1000）。
- 假 `sessionProjections`（`:52-64`）：`stateOf` 返回 title / userQuestions `{active,settled}`；`onChanged` 只保留一个 listener。
- `createCore(options)`（`:153-167`）：假时钟 + `resolveConfig({channels.macos:{enabled:false},...options.config})` + `new NotixCore` + `start` + 注册捕获型 `test` 渠道；返回 `{core,ctx,notifications,clock}`。
- mock 覆盖的 dsh 服务：`sessions`、`sessionProjections`、`timeout`、`logger`；**没有** `storageDomain`（单测一律内存降级）、`agents`、`jobs`、真实 Cordis dispatch；`ctx.on` 不模拟 `{global:true}` 的冒泡语义。

### 9.2 `test/core.test.js`（9 个用例）

| # | 用例名 | 行号 | 断言点 |
|---|---|---|---|
| 1 | readConfig unwraps volatile references before applying defaults | 7-19 | 嵌套/数组 ref 解引用；`jobThresholdMs` 回落 900000 |
| 2 | resolveConfig fills defaults and keeps overrides | 21-27 | 覆盖值 + 兄弟/开关默认值 |
| 3 | renderNotification renders a Chinese approval | 29-39 | 标题「需要审批：bash」；body 含 reason 与 sessionTitle |
| 4 | renderNotification renders English completions and merges suppressed counts | 41-52 | `Task completed`、`2 min`、`2 similar notifications were merged`（用例手动给 `trigger.suppressedCount=2`，绕过 pipeline，故未暴露 §6.3 的不可达） |
| 5 | formatDuration and truncate behave at boundaries | 54-59 | 30s→不到1分钟；5min en；90min→1 小时 30 分钟；`truncate('abcdef',4)='abc…'` |
| 6 | pipeline dedupes identical keys | 61-75 | 同 dedupeKey 两次提交只投递 1 条 |
| 7 | error cooldown suppresses repeats until the window expires | 77-97 | 窗口内第二条抑制；`advance(61_000)` 后放行 |
| 8 | quiet hours suppress normal notifications but keep urgent ones | 99-123 | 00:00-23:59 内 normal=0、urgent=1 |
| 9 | history records delivered notifications | 125-134 | manual notify 后 `delivered:true`、`channels:['test']` |

### 9.3 `test/triggers.test.js`（9 个用例）

| # | 用例名 | 行号 | 断言点 |
|---|---|---|---|
| 1 | approval/asked notifies and reminders stop after decided | 12-37 | 通知+busy；1s 后提醒 1 条；decided 后不再提醒、busy 清除 |
| 2 | user questions notify on open and continued, tracking busy state | 39-64 | open 通知；continued 再通知 1 次；清空后 busy 清除 |
| 3 | turn watchdog fires once when a turn runs too long | 66-83 | 阈值到点 1 条「长任务」；turn/end 后不再增加 |
| 4 | turn watchdog defers while the agent waits on the user | 85-102 | busy 期间 0 条 long-task；decided 后下一阈值 1 条 |
| 5 | terminal turn errors notify once across agent/error and turn/end | 104-122 | 同 turn 两来源只 1 条「执行出错」 |
| 6 | long turns notify completion after the configured minimum | 124-135 | 4 分钟完成 → 「任务完成」+「4 分钟」 |
| 7 | short turns do not notify completion | 137-146 | 10s turn → 0 条 |
| 8 | settled background jobs notify completion | 148-164 | job 注册/结束 → 「后台任务结束」 |
| 9 | open questions get reminder chains that stop when answered | 167-187 | 1 次提醒后 answered，不再提醒 |

`flush(core)`（`:7-10`）先 `setImmediate` 再 `await core.chain`（投递在微任务链里且渠道异步）。

### 9.4 `test/integration.test.js`（5 个用例，真实 Cordis）

`createApp`（`:13-38`）：`new Context()` → `plugin(TimerService)` → `provide('sessions')`/`provide('sessionProjections')` → 可选 `provide('storageDomain')` → `plugin(notix, config)` → `root.get('notix')` 注册 `test` 渠道。

| # | 用例名 | 行号 | 断言点 |
|---|---|---|---|
| 1 | plugin loads on a real Cordis runtime and exposes ctx.notix | 40-60 | `name`、`inject` 三元素、`typeof Config==='function'`；emit approval → 1 条英文通知；history 1 |
| 2 | manual notifications go through the service API | 62-72 | `ctx.notix.notify` → 渠道收到 |
| 3 | the Loader schema applies defaults and rejects invalid values | 74-89 | 暴露 config 是 volatile ref（`get()`）；600000；macos false；`language:'fr'` reject |
| 4 | disposing the plugin fiber removes listeners and services | 91-103 | dispose 后 `get('notix')===undefined`；再 emit 不投递 |
| 5 | history and dedupe persist through the storage domain | 106-142 | fake storage 写入 history/dedupe；重建 app 后 history 可读 |

### 9.5 覆盖缺口

- macOS 渠道零测试（平台相关）：`detectBackend` 四分支、超时/重试/熔断都无单测。
- `loader/volatile-update` 热更、`replaceConfig`、`syncChannels` 启停无集成测试。
- `toolErrors/toolTimeout` 开关、job failed、`session/disposed`、quietHours 跨午夜/非法值无测试。
- suppressedCount 聚合路径无测试（因此没暴露 §6.3 的不可达逻辑）。
- mock 的 `ctx.effect` 忽略 disposer，long-task 清理逻辑（`:119-125`）未被真实验证。
- README/DESIGN 写“19 项测试”，实际 **23 项**（§10 C3）。

## 10. 代码事实 vs DESIGN.md 偏差清单

### A. 插件形态 / 结构

| # | DESIGN 断言 | 代码事实 | 证据 |
|---|---|---|---|
| D1 | `class NotixService extends Service`、`super(ctx,'notix')`、`static inject/Config`、`startNotix()`（§2.1/§7.2） | 对象形态插件 `{name,inject,Config,apply}`；`ctx.provide('notix',core.api())`；无 Service 子类/startNotix | `index.js:16,19,26-33,55-73` |
| D2 | `inject=['sessions','agents','timer','storageDomain']`，projections/jobs 可选（§7.2） | `inject=['sessions','timer','sessionProjections']`；storageDomain 经 `ctx.get` 可选；agents/jobs 完全未用 | `index.js:19`；`notix.js:124`；`store.js:65` |
| D3 | 用 `ctx.agents` 取会话标题（§2.3） | 用 `sessionProjections.stateOf(session,'title')` | `notix.js:122-129` |
| D4 | 两个 storage 域 `notix.dedupe`/`notix.history`（§5.2） | 单域 `notix` + 两张表 | `store.js:35-43` |
| D5 | `ChannelAdapter` 含 `Config: Schema` 并入总 Config（§6） | 适配器只有 `{id,send}`；macos 配置在主 schema | `channels.js:39-42`；`schema.js:23-36` |
| D6 | 仓库 `src/*.ts → 构建 lib/`（§7.1） | 无 src、无构建脚本；`lib/*.js` 即手写源码 | `package.json:13-22`；目录 |
| D7 | Notification 无 `delivered/channels`（§5.1） | 历史记录增加 `delivered`、`channels` | `notix.js:191-203`；`store.js:15-28` |
| D8 | `notify(): Promise<void>`（§5.2） | 返回 `Promise<record \| undefined>` | `notix.js:225-238` |

### B. 行为偏差

| # | DESIGN 断言 | 代码事实 | 证据 |
|---|---|---|---|
| D9 | 顺序：规则→去重→冷却→静默→渲染（§5.2） | 静默最先：quiet→dedupe→cool→render→record→queue；静默事件不记 dedupe/冷却、不补发 | `notix.js:179-190` |
| D10 | busy 解除后“按剩余阈值重新计时”（§T3a） | 每轮重新等完整阈值；`BUSY_RECHECK_MS` 定义未用 | `long-task.js:6,21-44` |
| D11 | 通用规则引擎、sessionFilter、优先级/聚合（§4/§5.2） | 只有 trigger 内 enabled/阈值；无 sessionFilter、优先级、聚合、LLM 重试风暴、工具白名单 | 五个 trigger；`notix.js:177-219` |
| D12 | FIFO 队列、每渠道并发 1、重试 ≤3（§5.2） | 一条全局 Promise 链串行；registry 顺序投递；最多 4 次尝试；无容量/背压/持久化 | `notix.js:44,206-213`；`channels.js:7,71` |
| D13 | dispose 清空索引与队列、HMR 无残留监听（§8） | store/dedupe 随对象 GC；`onChanged` disposer 被丢弃；trigger Map 不显式清 | `questions.js:133`；`approval.js:16`；`notix.js:117-119` |
| D14 | T1 payload 含 `callId`（§T1） | 只有 toolName/reason/sessionTitle（+reminder） | `approval.js:52-56,39` |
| D15 | T2 payload 含选项标签（§T2） | 只有 callId/count/question/sessionTitle（+continued/reminder） | `questions.js:72-77,99-106` |
| D16 | error dedupeKey=`error:{sessionId}:{turn}:{errorName}`（§T4） | `error:${sessionId}:${turn}`（有意合并 agent/error 与 turn/end） | `error.js:35,93` |
| D17 | job failed 命中 T4 时与 T5 合并（§T5） | 无 T4 job 分支；job failed 只走 T5「后台任务失败」+normal，不进 error 冷却/历史 | `completion.js:33-53`；`render.js:53` |
| D18 | T5 job payload 带 `cause`（§T5） | 只用 status；cause/finishedAt 忽略 | `completion.js:38-51` |
| D19 | 渠道 urgency 映射：urgent→声音+⚠️、low→静默（§6） | 渠道不看 urgency；发声只看 `sound`；无标题前缀 | `macos.js:102-128`；`render.js` |
| D20 | `clickToOpen` 对 terminal-notifier 与 alerter 都可用（§6） | 只有 terminal-notifier 有 `-open` | `macos.js:111-125` |
| D21 | error 窗口内聚合“又发生 k 次”（§T4） | `suppressedCount` 赋值路径只剩 0，聚合分支不可达 | `notix.js:185-187`；`store.js:132-142`；`render.js:134` |
| D22 | locale 文件含通知模板（§7.1） | locale 只有 meta；模板硬编码 render.js | `locale/*.json:1-6`；`render.js:30-86` |

### C. 文档陈旧 / 代码内部矛盾

| # | 现象 | 证据 |
|---|---|---|
| C1 | seed 注释说已有问题不通知，实现会通知 | `questions.js:121-126` vs `:69-89` |
| C2 | 注释说各 trigger “disjoint state”，实际共享 turnStarts/jobStarts；long-task 先消费 jobStarts，completion 的 job durationMs 恒 0 | `triggers/index.js:2-4`；`long-task.js:110`；`completion.js:36,49` |
| C3 | README/DESIGN 称 19 项测试，实际 23 项（本次 23/23 pass） | `README.md:130`；`README.zh.md:125`；`DESIGN.md:446` |
| C4 | README 说“rate-limited per session”，实际只 error 有冷却 | `README.md:22`；`notix.js:183-188` |
| C5 | README 默认值表缺 `channels.macos.enabled/sound/clickToOpen` 三行 | `README.md:90-108` |
| C6 | `BUSY_RECHECK_MS`、`firstQuestionText`、`textOf`、`setEnabled`、`ids` 未被包内使用 | `long-task.js:6`；`render.js:139-144`；`channels.js:49-57` |
| C7 | `historyRecordSchema` 预留 `error?`，core 从不写 | `store.js:27` |
| C8 | `dev/notix.patch.yml` 硬编码本机路径并引用 ui 包，换机失效 | `dev/notix.patch.yml:1-16` |

DESIGN §11 自述的三处修正（userQuestions 枚举、job 走 session 事件、volatile 修复）与代码一致，不重复计入偏差；其中“job 走 session 事件”就是 §4.4 的实现选择。

## 11. 关键代码位置速查

| 概念 / 文件 | 行号 |
|---|---|
| `index.js`：name / inject / Config / apply / provide / volatile 监听 / effect | 16 / 19 / 26-33 / 55-73 / 70 / 63-69 / 71 |
| `config.js`：DEFAULTS / merge / resolveConfig / isVolatileRef / unwrapVolatile / readConfig | 11-59 / 67-75 / 82-84 / 90-98 / 105-114 / 122-124 |
| `schema.js`：根对象 / triggers / channels | 80-93 / 38-78 / 23-36 |
| `notix.js`：构造 / busy / 计时 / start / syncChannels / replaceConfig / dispose | 38-53 / 60-84 / 132-157 / 87-90 / 93-103 / 110-114 / 117-119 |
| `notix.js`：inQuietHours / parseClock / nowMinutes / **submit** / error 冷却 / chain / notify / api | 160-170 / 16-23 / 26-29 / **177-219** / 183-188 / 206-213 / 225-238 / 241-248 |
| `store.js`：域 spec / history schema / dedupe schema / open / close | 35-43 / 15-28 / 30-32 / 64-84 / 87-96 |
| `store.js`：isDuplicate / remember / hitCooldown / suppressed / record / update / history / prune | 104-112 / 115-124 / 132-142 / 145-147 / 153-161 / 168-175 / 182-184 / 187-191 |
| `render.js`：formatDuration / truncate / ZH / EN / renderNotification | 7-15 / 18-21 / 30-57 / 59-86 / 94-136 |
| `channels.js`：常量 / withTimeout / register / deliver | 7-10 / 13-19 / 39-46 / 64-95 |
| `macos.js`：脚本常量 / id / app 路径 / detectBackend / helper 错误 / send | 27-33 / 49-51 / 54-61 / 64-80 / 86-93 / 102-128 |
| `triggers/index.js`：安装顺序 | 18-24 |
| `approval.js`：schedule / onEvent / ctx.on | 27-43 / 45-77 / 79 |
| `questions.js`：schedule / observe / seed / onChanged / disposed | 39-54 / 57-119 / 121-126 / 133-141 / 144-152 |
| `long-task.js`：watchTurn / watchJob / onEvent / fiber 清理 | 21-44 / 47-69 / 71-117 / 119-125 |
| `error.js`：turn/agent error / tool/result | 24-78 / 80-99 |
| `completion.js`：turn 完成 / job 完成 | 17-31 / 33-53 |
| `test/mock.js`：clock / ctx / createCore | 9-21 / 35-147 / 153-167 |
| `test/integration.test.js`：createApp | 13-38 |
| 元数据/装载：`package.json` exports / dsh.bundle / engines；`cordis.patch.yml` insert；`dev/notix.patch.yml` | 7-12；24-31；`cordis.patch.yml:3-41`；`dev/notix.patch.yml:5-16` |
| helper：Swift 主流程 / 构建脚本 | `NotixNotifier.swift:15-54` / `build-notifier-app.sh:18-89` |
