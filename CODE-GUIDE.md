# Notix × dsh 代码指南（面试版）

> **这份文档解决什么问题**：你手上有两个可运行的 dsh 插件（`notix-dsh`、`notix-dsh-ui`），但面试官问的往往不是"你写了什么功能"，而是"你懂不懂 dsh 的插件模型"。本文以**仓库代码为第一事实**、以 **dsh 0.2.1-rc.2 打包源码与包 README 为第二事实**，把代码逐个映射回 dsh 概念，并给出可直接背的问答。
>
> **事实基线**：dsh `0.2.1-rc.2`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内 `dsh-desktop-runtime` 版本）、Cordis `4.0.5`、schemastery `3.18.x`；仓库 HEAD `4213507`；`node --test packages/notix-dsh/test/*.test.js` **23/23 通过**。
>
> **怎么读**：面试前 10 分钟看 §0、§3、§10；想深入机制看 §2、§4；被追问实现细节看 §5、§6；被问"设计取舍/缺点"看 §7、§8、§9。

---

## 0. 30 秒讲清这个项目

**一句话**：Notix 是一个"纯观察者"式的 dsh 通知插件——Host 侧订阅 dsh 的会话事件、投影与后台 job 事件，经过"静默 → 去重 → 冷却 → 渲染 → 串行投递"的 pipeline，经可插拔渠道发 macOS 系统通知；Client 侧在 Web GUI 的「设置 → 插件」页挂一张配置卡片，改配置即写当前 profile 的 patch，由 Loader 的 volatile 通道热提交，Host 无需重载就生效。

**三个技术亮点**（面试可主动抛）：

1. **懂 dsh 的事件面分层**：区分"持久化 session 事件"（`turn/end`、`approval/asked`、`job/settled`）与"运行时 Cordis 事件"（`agent/error`、`loader/volatile-update`）与"投影读模型"（`userQuestions`），并分别为五个触发器选对订阅点。
2. **懂 dsh 的插件装载与配置热更新**：`dsh.bundle.patch` 把插件插入 profile；schemastery `Config` + `.volatile()` 决定设置页能否出现；Loader 的 `_commitVolatile` 原地替换运行时 config 引用并发 `loader/volatile-update`。
3. **懂 Host 插件与 Client 插件的双半结构**：Host 半只是 Loader 行，浏览器半通过 `dsh.client` 清单 + `window.__ModuleLoader__` 懒加载，用 `slots.inject/register` 挂 UI、用 `configForms` 读写 Host 配置。

**必须知道的边界**：Notix 不注册 answerer、不 append session 事件、不 block agent loop；通知内容默认只含会话标题 / 工具名 / 截断摘要。

### 关键数字（被问"多大/多复杂"时）

| 项 | 值 | 出处 |
|---|---|---|
| Host 包代码量 | `lib/` 约 1.65k 行 JS（14 个文件） | `packages/notix-dsh/lib/` |
| Client 包 | `lib/client.js` 648 行单文件 bundle | `packages/notix-dsh-ui/` |
| 测试 | 23 个用例（core 9 / triggers 9 / integration 5），含真实 Cordis runtime | `packages/notix-dsh/test/` |
| 配置 schema | 29 个可编辑叶子全部 `.volatile()` | `lib/schema.js:27-88` |
| 触发源 | session 事件（approval / turn / tool / job）+ `userQuestions` 投影 + `agent/error` + timer 看门狗 | 见 §5.3 |
| 渠道 | v1 仅 `macos-system`，回退链 helper app → terminal-notifier → alerter → osascript | `lib/channels/macos.js:64-80` |

---

## 1. 仓库地图

```
Notix-dsh/
├── packages/notix-dsh/            # Host bundle：Cordis 插件 + bundle patch
│   ├── package.json               # dsh.bundle.patch / engines.dsh / peerDeps / icon / locale
│   ├── cordis.patch.yml           # - insert: [{ id: notix, name: notix-dsh, config: 默认值 }]
│   ├── lib/
│   │   ├── index.js               # 插件入口：name/inject/Config/apply；ctx.provide('notix')
│   │   ├── schema.js              # schemastery Config（Settings UI 的唯一来源）
│   │   ├── config.js              # DEFAULTS + 深合并 + volatile ref 解包（readConfig）
│   │   ├── triggers/              # T1 approval / T2 questions / T3 long-task / T4 error / T5 completion
│   │   ├── core/notix.js          # pipeline 编排、busy、quiet hours、串行投递链
│   │   ├── core/store.js          # storageDomain：dedupe/history 两张表 + 内存回退
│   │   ├── core/render.js         # zh/en 文案、时长格式化、截断
│   │   ├── core/channels.js       # 渠道注册表：超时/重试/熔断
│   │   └── channels/macos.js      # macOS 投递：execFile + osascript / terminal-notifier / helper
│   ├── test/                      # mock Cordis ctx + 真 Cordis 集成测试
│   └── scripts/notifier/          # 签名通知助手 App（Swift）与构建脚本
├── packages/notix-dsh-ui/         # Client bundle：dsh.client + 浏览器半
│   ├── package.json               # dsh.client{platform:'web', inject:[...]} + exports["./client"]
│   ├── cordis.patch.yml           # 独立 bundle：- insert: [{ id: ui-notix, name: notix-dsh-ui }]
│   └── lib/{index.js,client.js}   # Host 半 no-op；浏览器半 slots + configForms
├── DESIGN.md                      # 设计文档 v1.1（有若干未落地的设想，见 §8）
├── docs/ui-settings-design.md     # Settings UI 设计
└── dev/notix.patch.yml            # 本地 checkout 免安装 trial（dsh --patch）
```

两个包是**两个独立 bundle**：Host 的 patch 插 `id: notix`，UI 的 patch 插 `id: ui-notix`。UI 包自带 bundle 而不是被 Host patch 引用，是因为 **client 半侧的发现依赖"Loader 里有一行"**（详见 §4.11）。

---

## 2. dsh 的三层概念模型

理解 Notix 只需要三张图：**平台层（怎么装进来）→ 运行时层（怎么活起来）→ 领域层（看见什么、能做什么）**。

### 2.1 平台层：profile / bundle / patch / Loader

```
$DSH_HOME/profiles/<name>/
├── package.json                 # dependencies + dsh.profile.bundles（有序）
├── cordis.patch.yml             # profile 层 patch（用户覆写）
└── node_modules/                # pnpm 安装进来的 bundle 包

启动时组合（readProfilePatches，dsh-app-boot）：
① 各 bundle 的 dsh.bundle.patch（按 dsh.profile.bundles 顺序）
② profile 的 cordis.patch.yml
③ $DSH_HOME/cordis.patch.yml（home 层）
④ --patch overlays（可重复，最后生效）
   ↓
Loader 解析成「entry 行列表」→ 逐行 import 插件模块 → Cordis 挂载
```

- **可安装单元是 bundle**：`package.json` 里 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。安装（`dsh plugin add` / Web Plugins 页 / `plugin_manager`）会把包名 append 进 `dsh.profile.bundles`。
- **patch 的语义**：`- insert:` 追加行；不带 `insert` 的 patch 按 `id` **整体替换**目标行的字段——注意 `config` 是整体替换，不是深合并，所以覆写时要重述要保留的字段。
- **行（entry）字段**：`id` / `name`（包名、绝对路径或 `file:`）/ `config` / `disabled` / `group` / `isolate`；`!!js` 是 Loader 表达式。
- **兼容性**：`engines.dsh` + `peerDependencies["@deepseek-ai/cordis"]`；HMR 开时重组即时生效，否则重启。

**Notix 的落点**：`packages/notix-dsh/package.json:24-34`（bundle patch + engines + peerDeps）、`cordis.patch.yml:3-41`（默认配置随 bundle 下发）；用户覆写就是 profile patch 里同 `id: notix` 的行。

### 2.2 运行时层：Cordis

Cordis 是 dsh 的插件内核，**面试至少要能画出这 6 个概念的关系**：

| 概念 | 一句话 | 与 Notix 的关系 |
|---|---|---|
| `Context` | 依赖容器 + 事件总线 + 服务解析代理；`ctx.plugin()` 创建子 fiber | 插件拿到的 `ctx` |
| `Service` | `class X extends Service { constructor(ctx){ super(ctx,'name') } }`，构造即注册 `ctx.name` | Notix **没用** Service 形态（见 §4.2） |
| `fiber` | 一次插件挂载的生命周期单元；所有 effect/listener/service 都挂在它上面 | `ctx.fiber.dispose()` 卸载插件 |
| `effect` | `ctx.effect(fn, label)`：fn 返回 disposer；fiber 卸载时**逆序**清理 | 计时器、渠道注册、disposer |
| `inject` | 声明依赖服务，全部就绪才启动；值还可作为 intercept 配置 | `inject = ['sessions','timer','sessionProjections']` |
| 事件分发 | `emit`（同步广播）、`parallel`（并发）、`serial`（串行 await）、`bail`（首个非空返回终止）、`waterfall`（中间件，不调 `next()` 即否决） | Notix 只用 `emit` 观察；**不碰 waterfall** |

两条容易答错的规则：

1. **`emit` 不 await、不收集返回值**；监听器抛的同步错会中断后续监听器，async rejection 无人接管。所以 dsh 的 session/agent 广播都自己做了 per-listener containment（`dsh-session` 的 `invokeContainedSessionObservers`），而裸 `ctx.emit` 没有。
2. **`{global:true}` 不是"事件冒泡"**。Cordis 的事件其实是一张进程级监听表 + 分发时按"载体（thisArg）上的 `Context.filter`"过滤；`global:true` 的语义是**让这条监听器绕过过滤器**（`hook.global || !filter || filter(...)`）。Notix 的 `{global:true}` 是为了在插件被挂在某个 agent scope 下时仍能看见全部会话（详见 §4.6）。

### 2.3 领域层：session → projection → service → client

```
agent 执行
  │  append 持久化事件（唯一事实源，可 replay）
  ▼
session log ──► sessionProjections（内存读模型，按 key 折叠事件，client-visible 才发变更）
  │                    │
  │ 广播 session/event │ snapshot / stateOf / onChanged
  ▼                    ▼
Host 插件（Notix）      Web Client（Card/UI）
  │  ctx.jobs / ctx.storageDomain / ctx.timer / ctx.agents
  ▼
Typert RPC（/api/remote.mux 等）──► 浏览器 slots / configForms / locale
```

| 层 | 本质 | 谁消费 | 模型可见？ |
|---|---|---|---|
| **session 事件** | 不可变、追加、持久化的事实 | Host 插件、投影、持久化 | 只有 surface 事件（user/assistant/tool result…）经派生进入请求 |
| **投影（projection）** | 从事实折叠出的"当前完整状态"，可重建 | Client / Host 读 `stateOf` | 否（README「模型体验：无」） |
| **服务（service）** | `ctx.jobs`、`ctx.storageDomain`、`ctx.sessions`、`ctx.timer`… | Host 插件 | 否 |
| **Cordis 事件** | 运行时信号（`agent/error`、`loader/volatile-update`） | Host 插件 | 否 |
| **Client 服务** | `slots` / `configForms` / `locale` / `remote` | 浏览器插件 | 否 |

**面试可背的一句话**：dsh 把"发生了什么"（session log）、"现在是什么状态"（projection）、"能做什么"（service/extension point）拆成三层；插件选错层，轻则性能差（监听事件自己重扫日志），重则破坏可 replay 语义（append 未知事件）。

---

## 3. 概念 → Notix 代码对照表（主表）

| # | dsh 概念 | 机制要点 | Notix 落点（文件:行） | 面试一句话 / 坑 |
|---|---|---|---|---|
| 1 | **bundle + patch** | 包声明 `dsh.bundle.patch`；`insert` 行 = 插件 entry；profile patch 按 id 覆写 | `notix-dsh/package.json:24-28`、`cordis.patch.yml:3-41` | "插件不是 import 进来的，是 profile 组合出来的" |
| 2 | **插件形态** | 函数 / 对象 `{name,inject,Config,apply}` / Service 子类；入口 `exports.default ?? exports` | `lib/index.js:16,19,26-33,55-73` | 实现是**对象形态**，用 `ctx.provide` 注册服务（不是 Service 类） |
| 3 | **inject** | 依赖服务就绪才启动；可选服务用 `ctx.get` / `ctx.inject` | `index.js:19`；`notix.js:124`；`store.js:65`；`questions.js:128-132` | 必选/可选混用是刻意降级；但 `sessionProjections` 列进 inject 会**阻塞启动**（与降级注释矛盾） |
| 4 | **Config / schemastery** | `Config` 在启动前校验；默认值 + 约束 | `schema.js:22-93` | schema 是**校验 + 设置表单的准入条件**，不是表单本身 |
| 5 | **`.volatile()`** | 叶子标 volatile → settings 才暴露命名空间；Loader 才走热提交 | `schema.js:27-88`（29 个叶子全标） | "不标 volatile 不是只读，是整张卡片消失" |
| 6 | **`loader/volatile-update`** | volatile-only 变更：Loader 原地更新 config 引用并发事件，owner fiber 收到 | `index.js:61-69` + `config.js:90-124` | 配置对象里的叶子是 `{get()}` 引用；`readConfig` 负责解包 |
| 7 | **`ctx.provide`** | 注册服务 `ctx.<name>`，随 fiber 清理 | `index.js:70`；`notix.js:241-248` | 对外 API：`ctx.notix.notify/registerChannel/history/config` |
| 8 | **`ctx.effect`** | 注册清理；fiber 卸载逆序执行 | `index.js:71`；`long-task.js:120-125` | 计时器/监听随 fiber 自动清理 |
| 9 | **`session/event` + `{global:true}`** | session 提交后按载体过滤广播；global 绕过过滤 | `approval.js:79`、`long-task.js:117`、`error.js:101`、`completion.js:59` | 官方先例：`dsh-user-approval/lib/types/invariant.js:66-93` |
| 10 | **session 事件目录** | 62 种持久化事件；`turn/start` / `turn/end`、`approval/asked` / `approval/decided`、`tool/result`、`job/registered` / `job/settled` | `approval.js:48-73`、`long-task.js:71-111`、`error.js:27-74`、`completion.js:14-53` | 选"持久化事实"而不是轮询状态 |
| 11 | **投影** | `sessionProjections.stateOf/onChanged`；unit 由领域注册，client-visible 才推 | `questions.js:10-17,121-141`；`notix.js:122-129`（title 投影） | `stateOf` 返回 host state、`onChanged` 给 wire view，**形状不同** |
| 12 | **`userQuestions` 投影** | `state` 枚举 `open` / `continued`，只有 timed 版 `ask_user_question` 被跟踪 | `questions.js:57-119` | 别对 blocking 版提问指望 T2 通知 |
| 13 | **`storageDomain`** | 声明 domain/table（zod schema）；同步读、持久写、`domain/changed`；对模型不可见 | `store.js:15-43,64-96` | Notix 用**单域两张表**，不是两个域 |
| 14 | **`ctx.timeout`** | timer 服务返回 disposer；随 fiber 自动清理 | `approval.js:30`、`questions.js:42`、`long-task.js:23,49` | 提醒链用递归 timeout，不是 setInterval |
| 15 | **`agent/error` Cordis 事件** | `{agent,turn,step,error}`，先 emit 再 throw | `error.js:80-99,102` | 与 `turn/end(error)` 同源，共享 dedupeKey |
| 16 | **`dsh.client` 清单** | `platform:'web'` + `exports["./client"]`；Host 半可为空 | `notix-dsh-ui/package.json:21-33`；`lib/index.js:1-8` | 两个 `inject` 不是一回事（§4.14） |
| 17 | **Client bundle 协议** | `window.__ModuleLoader__.load({id, factory})`；执行只注册 factory | `client.js:1-8,641-646` | 导出 `{NS, apply, inject}` |
| 18 | **slots** | `slots.inject(owner, () => slots.register(spec, Component))` | `client.js:631-638` | `plugins.item` 两种 view：`summary` / `page` |
| 19 | **configForms** | `get(ns)` → 控制器；`whileServed(ns, register)` 门控 | `client.js:630-638` | 控制器没有 `save()`；写入口是 `mutate(ops)` |
| 20 | **保存链路** | UI → settings RPC → config-editor 写 patch → Loader 热提交 → Host 重读 | `client.js:368-377` → `index.js:61-69` | 没有保存按钮；服务端权威，不做乐观更新 |
| 21 | **locale** | 字典注册在 ctx.effect 上；`bind(ns)` 出 `t()` | `client.js:615,625-629` | locale meta 与卡片文案是两套 |
| 22 | **`execFile` 投递** | 纯 Node 宿主无 Electron；`osascript -e 常量脚本 -- body title` 走 argv | `macos.js:14,27-33,102-128` | 无 shell、无字符串拼命令 = 无注入面 |

> 表中"坑"列的详细解释在 §4；代码行号以当前仓库文件为准。

---

## 4. 关键概念逐个深挖

> 每个小节都是"机制（dsh 事实）→ 代码怎么用（Notix）→ 面试怎么答"。

### 4.1 bundle、patch 与「插件是组合出来的」

dsh 启动时不是 `import` 一个插件列表，而是把**多个 patch 层叠成 entry 行列表**，再由 Loader 逐行加载。

- 包的 `dsh.bundle.patch` 是"这个包给 profile 增加的行"；同一个 bundle 层内多个 patch 文件按声明顺序拼接。
- `insert` 行可以带默认 `config`（Notix 就把全部默认值写进 `cordis.patch.yml`，所以"开箱零配置可用"）。
- 用户覆写 = 在自己的 profile `cordis.patch.yml` 写同 `id`、不带 `insert` 的行；**`config` 整体替换**，不深合并。
- `engines.dsh` 与 `peerDependencies` 在安装时做兼容检查；HMR 开时重组即时生效。

**Notix 事实**：`notix-dsh` 的 `cordis.patch.yml:3-41` 是一整棵默认配置树（language/verbosity/5 类 trigger/quietHours/channels），`package.json:29-34` 声明 `engines.dsh: ">=0.2.1-rc.2 <0.3.0"` 和 `peerDependencies["@deepseek-ai/cordis"]: "~4.0.5"`。

**答题模板**："bundle 是分发单元，patch 是组合单元，entry 是运行单元；所以插件可以不改用户代码就插进任意 profile，用户也能只覆写 config 而不影响包本身。"

### 4.2 插件形态：对象插件 + `ctx.provide`，而不是 Service 子类

Cordis 支持三种入口形态：

```js
// ① 函数
export function apply(ctx, config) {}
// ② 对象（Notix 实际形态）
export const name = 'notix'
export const inject = ['sessions', 'timer', 'sessionProjections']
export const Config = /* schemastery */
export async function apply(ctx, rawConfig) { /* ... */ }
// ③ Service 子类（构造即注册 ctx.name）
export default class MyService extends Service {
  constructor(ctx, config) { super(ctx, 'my-service') }
}
```

`lib/index.js` 用的是 ②：`name`（`index.js:16`）、`inject`（`:19`）、`Config` 懒加载构建（`:26-33`）、`apply`（`:55-73`）。服务不是 `super(ctx,'notix')` 注册的，而是 `ctx.provide('notix', core.api())`（`:70`）。

为什么这很重要：

- **Service 子类的生命周期绑定在构造上**；对象插件更灵活，适合"先做初始化再决定暴露什么 API"（Notix 先 `await core.start()` 打开存储、注册渠道，再 `provide`）。
- `ctx.provide` 的值是普通对象 `{notify, registerChannel, history, config}`（`notix.js:241-248`），随 fiber 一起销毁；测试里 `root.get('notix')` 拿到的就是它。
- **代价**：没有 Service 的 `Config` 自动合并、没有服务方法拦截、也没有 `[Service.invoke]` 这类能力；对 Notix 足够。

> 面试注意：`DESIGN.md §7.2` 画的是 Service 子类骨架，但代码是对象插件。被问到时**大方承认设计文档与实现有演进**（见 §8），比硬圆更好。

### 4.3 `inject`、`ctx.get` 与可选依赖降级

`inject` 的语义是"这些服务全部可用才启动"，所以：

- `sessions`：`ctx.sessions.list()` 用于启动时 seed（`questions.js:123`），也是必选。
- `timer`：`ctx.timeout` 提供提醒链与看门狗（`approval.js:30` 等）。
- `sessionProjections`：T2 与标题读取都依赖它——但代码同时写了"缺失时 T2 停用并告警"（`questions.js:128-132`）以及 `ctx.get('sessionProjections')?.…` 的空安全 `notix.js:124`。

**这里有一个代码自身的小矛盾**：`sessionProjections` 既在 `inject` 里（缺失就不会启动整个插件），又写了缺失降级分支（永远走不到）。正确写法二选一：要么把它从 `inject` 移除、完全靠 `ctx.get` 降级；要么保留 `inject`、删掉降级叙事。面试里这可以当作"我知道 inject 与可选服务的区别"的证据。

对 **storageDomain / jobs / agents** 则刻意用 `ctx.get`：

```js
// store.js:64-84：没有 storageDomain 就在内存里工作
const storageDomain = this.ctx.get('storageDomain')
if (storageDomain === undefined || typeof storageDomain.open !== 'function') { /* 内存模式 */ }
```

### 4.4 Config：schemastery、默认值与 `.volatile()`

`Config` 是"Loader 启动前校验 + Settings UI 准入"的单一 schema 来源：

```js
// schema.js（节选）
z.object({
  language: z.union(['zh','en']).default('zh').volatile(),
  verbosity: z.union(['minimal','normal']).default('minimal').volatile(),
  quietHours: z.object({ enabled, from, to, allowUrgent }).default({}),
  triggers: z.object({
    approval: z.object({ enabled, remindAfterMs, maxReminders }).default({}),
    // userQuestion / longTask / error / completion
  }).default({}),
  channels: z.object({ macos: z.object({ enabled, sound, clickToOpen, baseUrl, notifierApp, appIcon }).default({}) }).default({}),
})
```

三个必须分清的东西：

| 东西 | 位置 | 作用 |
|---|---|---|
| **schema** | `schema.js` | 启动前校验 + settings 是否暴露命名空间 + UI 写入合法性 |
| **运行时默认值** | `config.js:11-59` 的 `DEFAULTS` | schema 构建失败/无 Loader 时的兜底；`readConfig` 深合并 |
| **运行时读取** | `config.js:122-124` | 解包 volatile 引用 → 深合并默认值 → 返回普通对象 |

### 4.5 volatile 与 `loader/volatile-update`：热更新的真实机制

这是 Notix 最"dsh 特有"的一段，建议背下来：

1. schemastery 的 `.volatile()` 标记一个叶子"可运行中更新"。
2. **Loader 解析后的 config 不是普通对象**：volatile 叶子是 `{ get() }` 引用（冻结对象）。运行时必须通过 `readConfig` 把它们 `get()` 出来（`config.js:90-124`）。
3. 用户在设置页改值 → `dsh-config-editor` 把新值写进当前 profile 的 `cordis.patch.yml` → Loader 检测到"只有 config 变化且除 volatile 外完全相等"（`equalExceptVolatile`）→ 走 `_commitVolatile()`：
   - 重新解析候选 config；
   - 就地 `updateVolatile(ref, source)` 更新引用；
   - 在**插件自己的 fiber 上下文**上 `emit('loader/volatile-update', paths)`（用 `Context.filter` 过滤成 owner fiber）。
4. 插件监听该事件，重新 `readConfig(rawConfig)` 并**原地替换** core 的 config 对象（`index.js:63-69` + `notix.js:110-114`），因为 triggers 里都是 `core.config.…` 的延迟读取，换引用会丢，原地 `Object.assign` 才生效。
5. **不 dispose、不 remount、不重启**；如果改动包含非 volatile 字段，则回退到普通重载路径。

**为什么"不标 volatile 卡片就消失"**：`dsh-settings.describe()` 只返回含 volatile 叶子的命名空间（`volatileForm` 过滤）；`configForms.whileServed(['notix'])` 看不到 `notix` 命名空间 → 注册回调永不执行 → 卡片完全不渲染。不是"字段只读"，是整张卡消失。

### 4.6 事件分发五模式与 `{global:true}` 的真相

Cordis 五种分发（`cordis/lib/index.js:259-330`）：

| 模式 | 行为 | 返回值语义 |
|---|---|---|
| `emit` | 同步调用所有监听器，不等待 Promise | 无 |
| `parallel` | 并发 await 所有监听器 | 无（聚合错误） |
| `serial` | 串行 await，遇到 bail 值停止 | 第一个 bail 值 |
| `bail` | 同步，遇到 bail 值停止 | 第一个 bail 值 |
| `waterfall` | 中间件链，最后一个参数是 `next`；不调 `next()` 即否决内建行为 | 最外层监听器（或内建 `next`）的返回值 |

`emit` 的坑：同步 throw 会中断后续监听器；async rejection 没人接。所以 dsh 在 session/agent 广播自己做了 contained invoke（`dsh-session` 的 `invokeContainedSessionObservers`：单监听器抛错只记 warn），但**裸 `ctx.emit` 不会**。

`{global:true}`：

- 事件分发不是"沿上下文树冒泡"，而是**一张全局 `_hooks` 表 + 一次过滤**：
  ```js
  dispatch(type, args) {
    const thisArg = /* emit 的第一个对象参数，作为载体 */
    const filter = thisArg?.[Context.filter]
    return hooks.filter(h => h.global || !filter || filter.call(thisArg, h.ctx))
  }
  ```
- dsh 用 `dsh-scope` 的 `scopeTarget()` 给会话/agent 事件构造载体，载体上的 `Context.filter` 按 scope 标签过滤监听器；**没有标签的监听器本来就全局接收，`global:true` 则绕过过滤**。
- 所以 `DESIGN.md §2.3` 说"子上下文事件向上冒泡"——**结论对（根上下文能看到全部会话），机制描述不准确**：不存在逐级冒泡；`global:true` 是"跳过过滤器"的声明。
- 官方先例：`dsh-user-approval/lib/types/invariant.js:66-93` 的 `ctx.on('session/created' | 'session/event', …, { global: true })`。

### 4.7 session/event 与 append 纪律

- `Session.commit()` 在事件入 log 后，用会话的 carrier 上下文 dispatch 一次 `session/event`；监听器抛错**不影响已提交事实**（contained invoke）。
- 监听器里 `session.append()` 会被"不可重入"拒绝——想生成派生事件只能走正规领域 API。
- **不能 append 未知事件类型**：读取端只接受带 `ignorable: true` 的未知存储事件，而 live `append()` 不能设置该标记，会让 Session 拒绝重新打开。
- Notix 的纪律：**不 append 任何事件**，通知历史写 `storageDomain`；`approval` 用配对事件（asked/decided）自然清理提醒。

### 4.8 投影：读模型，不是事件

- 投影是"从已提交事件折叠出的当前完整状态"；领域注册 unit（key + stateSchema + `apply(state,event)` + 可选 `wire.view` + `stateVersion`）。
- **驱动由框架做**：注册表只订阅一次 `session/event`，每个事件喂给每个 unit；`apply` 必须同步、纯、对无关事件返回同一引用（零下游成本）。
- `stateOf(session, key)` 读 host state；`onChanged` 的第一个参数是 session、第二个是 key、第三个是 **wire view**（已按 viewSchema 校验）；`snapshot()` 给客户端一致的切面。
- Notix 的 T2：监听 `onChanged`，只处理 `key === 'userQuestions'`，diff `active[]` 的 `callId` 集合（`questions.js:57-119`）。`stateOf` 被用于 seed 与标题（`questions.js:10-17`、`notix.js:122-129`）。

**两个真实坑**（代码/文档都有对应错误）：

1. `stateOf('userQuestions')` 返回 `{inheritedEventCount, timed, questions:{active,settled}}`，而 `onChanged` 第三参是 `{active, settled}`。Notix 的 seed 写的是 `state?.active`，**应为 `state?.questions?.active`**——所以重启后的 seed 实际是空的（不会误报，但也没起到"标记已有问题"的作用）。
2. `userQuestions` 只跟踪 **timed 版** `ask_user_question`（请求头里 schema 带 `timeout` 参数）；blocking 旧版本的提问永远不进投影 → T2 不会通知。

### 4.9 storageDomain：对模型不可见的持久 KV

- spec：`{ name, version, layout?: 'single'|'per-record', tables: { name: { valueSchema } }, global? }`；官方推荐用 `defineDomain()` 在模块加载期校验并冻结。
- 读：**同步**来自内存；写：**先落盘、再改内存、再发 `domain/changed`**；每 domain 一条写链，`update(key, fn)` 不交错。
- 错误码：`already-open` / `facet-unsupported` / `invalid-record` / `missing-key` / `closed`；版本不匹配透传。
- 生命周期由调用方持有（`domain.close()`），facility 卸载时兜底 close。

**Notix 事实**（`store.js:35-43`）：手写 spec、**一个域 `notix` 两张表 `history`/`dedupe`**，不是设计文档里的两个域；`open()` 失败时静默降级为纯内存（`store.js:64-84`）。因为 `open()` 只消费 spec 的 `name/version/tables[-schema]/layout`，手写 spec 能工作，但少了 `defineDomain` 的加载期校验（表名/版本/global 非空约束）。

### 4.10 timer / effect / dispose：生命周期正确性

- `ctx.timeout(cb, ms)` 返回 disposer；`ctx.interval` 同理；**随 fiber 自动清理**，HMR/卸载无残留。
- Notix 所有计时（审批提醒、问题提醒、turn/job 看门狗）都走 `ctx.timeout`；`long-task.js:119-125` 额外用 `ctx.effect` 在卸载时清空 Map 里的 timer。
- 监听器用 `ctx.on(...)` 注册，disposer 自动挂 fiber；`sessionProjections.onChanged` 的 disposer 被丢弃（`questions.js:133`），但 `onChanged` 本身是用调用方 `ctx.effect` 注册的，所以随 fiber 清理——**功能正确，但不够显式**。

### 4.11 Host 插件 vs Client 插件：两套声明、两个入口

| | Host 插件 | Client 插件（`notix-dsh-ui`） |
|---|---|---|
| package.json | `dsh.bundle.patch` | `dsh.client: { platform: 'web', inject: [包名…] }` |
| 入口 | `exports["."]` → Node 模块 | `exports["./client"]` → 浏览器 bundle |
| 运行环境 | Host Cordis 树 | 浏览器 Cordis 树（`window.__ModuleLoader__`） |
| 发现方式 | profile bundles → patch → Loader 行 → import | Host 半扫描**已激活的 Loader 行** → 读包 `package.json` 的 `dsh.client` |
| 入口契约 | 三形态之一 + `inject`/`Config` | bundle 只注册 factory；导出 `apply(ctx)` + `inject`（服务名数组） |

**装载链（面试可以画）**：

```
dsh.client（package.json）
  → dsh-client-modules 扫描 Loader entries
  → 读包 package.json，platform === 'web'
  → 解析 exports["./client"] 得到 lib/client.js
  → 组合进 window.__DSH_BOOT__ 的启动图（/plugins/<pkg>/client.js?rev=…）
  → 浏览器懒执行 bundle：window.__ModuleLoader__.load({ id, factory })
  → factory 返回 { apply, inject }，由浏览器 Cordis 挂载
```

约束（容易忽略）：**必须有 Loader 行**（所以 `notix-dsh-ui` 自带 patch 插自己的行）；同一包不能有两个 active Loader source（否则 client-modules 抛错）；Host 半可以为空 `apply()`——**它只是让包在 Host 树里占一行**。

### 4.12 slots：`plugins.item` 的注册与 props

```js
ctx.effect(() => ctx.configForms.whileServed(['notix'], () =>
  ctx.slots.inject('plugins.item', () =>
    ctx.slots.register({
      name: 'plugins.item', id: 'notix', order: 40,
      label: () => t('title'), locale: 'settings.notix',
      inject: () => ({ form }),
    }, NotixCard)
  )
), 'notix-dsh-ui: page')
```

- `slots.inject(ownerKey, fn)`：等父级声明了这个 slot 后再执行注册；返回的 disposer 归 owner 的生命周期。
- `slots.register(spec, Component)`：`id` 唯一；`order` 决定排序（本包 40，和内置 shell 同序，实际顺序受 bundle 到达顺序影响）；`label`/`inject` 是**函数**，渲染时求值；`locale` 让卡片拿到 `t`。
- `plugins.item` 是 list slot，有两种 view：**`summary`**（插件列表卡片折叠态）与 **`page`**（详情页配置区）。`NotixCard` 两态都渲染：summary 返回一行摘要字符串，page 返回完整表单。
- 组件被 slot 的错误边界保护：单个 entry 渲染抛错只显示错误占位，不白屏。

### 4.13 configForms：读、写、门控

- `ctx.configForms.get('notix')` 返回 **ConfigFormController**（同一 ns 同实例）：
  - 读：`getSnapshot() → { status, value, base, user, revision, writable }`、`subscribe(listener)`；
  - 写：`mutate([{ op:'set', path:['triggers','approval','enabled'], value }, …])`；`set/unset` 只支持顶层单字段，嵌套必须用 `path` 数组；
  - 生命周期：`dispose()`；**没有 `save()` / `reset()` / `dirty` / 字段级 error**。
- `whileServed(namespaces, register)`：Host describe 镜像里**出现任一命名空间**才调 `register(servedSet)`，全部消失时执行返回的 disposer；它**不在调用方 ctx 上注册东西**，调用方要自己包 `ctx.effect`。
- 保存链路（8 跳，见 §6.6）：`mutate` → settings RPC → `dsh-settings` 校验（volatilePath + revision）→ `dsh-config-editor` 写 profile patch → Loader `_commitVolatile` → `loader/volatile-update` → Host `readConfig` → UI 快照回显。

### 4.14 两种 `inject` 千万别混

| 声明 | 位置 | 语义 |
|---|---|---|
| `dsh.client.inject: ["@deepseek-ai/dsh-client-locale", …]` | 包的 package.json | **浏览器模块图的加载/激活顺序**（包名列表） |
| `export const inject = ['slots','locale','configForms']` | client.js | **Cordis 服务依赖**（服务名） |
| `export const inject = ['sessions','timer','sessionProjections']` | Host index.js | Host 侧 Cordis 服务依赖 |

`dsh.client.inject` 让"设置服务/slot 渲染器"先就绪，避免插件 apply 时服务还不存在；它不提供类型/对象，只排拓扑。面试若被问"你的 UI 依赖谁"，要同时说出这两层。

---

## 5. Host 插件代码走读（`packages/notix-dsh`）

### 5.1 入口 `lib/index.js`：73 行里发生的 8 件事

```js
export const name = 'notix'                                        // :16
export const inject = ['sessions','timer','sessionProjections']    // :19
let Config; try { Config = buildSchema((await import('@deepseek-ai/schemastery')).default) } catch {}
                                                                   // :26-33 懒加载 schema
export async function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig)                             // :56 解包 volatile + 合并默认
  const logger = createLogger(ctx)                                 // :57 ctx.logger 缺失时回退 console
  const core = new NotixCore(ctx, config, logger)                  // :58
  await core.start()                                               // :59 打开 storageDomain、注册渠道
  installTriggers(ctx, core)                                       // :60 五个触发器全部上线
  ctx.on('loader/volatile-update', () => {                         // :63-69 热更新
    try { core.replaceConfig(readConfig(rawConfig)) } catch (e) { logger.warn(...) }
  })
  ctx.provide('notix', core.api())                                 // :70 对外服务
  ctx.effect(() => () => core.dispose(), 'notix: dispose')         // :71 卸载清理
  logger.info('notix: watching ...')                               // :72
}
```

**值得讲的三点**：

1. **`Config` 懒加载**：`try/catch` 包住 `import('@deepseek-ai/schemastery')`。如果插件被 `link:` 安装但解析不到 schemastery，`Config` 为 `undefined`，插件仍靠 `config.js` 的默认值运行；代价是 settings 里看不到这个命名空间（卡片不出现）。这是有意的"可降级"设计。
2. **先 `start()` 再 `provide`**：存储和渠道就绪后才对外宣布 `ctx.notix`，避免其他插件拿到半初始化服务。
3. **`replaceConfig` 必须原地改**：`core.config` 被 triggers 通过闭包持有，`replaceConfig` 用 `delete + Object.assign` 保留对象身份（`notix.js:110-114`），并 `syncChannels()` 让渠道启停跟随配置。

### 5.2 配置层：`schema.js` + `config.js`

- `schema.js`：29 个叶子全部 `.volatile()`；`triggers` 下 5 组、`channels.macos` 6 个字段、`quietHours` 4 个、根级 `language`/`verbosity`。约束：数字 `step(1).min(0)`，`maxReminders` 上限 10，语言/详略用 `z.union`。
- `config.js`：
  - `DEFAULTS`（`:11-59`）是 schema 的运行时镜像，用于 schema 缺席时的兜底；
  - `merge()` 深合并且不修改入参（`:67-75`）；
  - `isVolatileRef()` 用"冻结 + 只有 `get` 一个键"识别 volatile 引用（`:90-98`）；
  - `readConfig()` = `resolveConfig(unwrapVolatile(raw))`（`:122-124`）。

**面试可问**："为什么还要手写一份 DEFAULTS？" 答：schema 是可选的（懒加载降级），且 Loader 之外的测试/直接调用不会经过 schema 校验；手写默认值让两种路径行为一致。代价是漂移风险（schema 改默认值要同步 config.js）。

### 5.3 触发器层（`lib/triggers/*`）

统一输入形状（概念上的 `RawTriggerEvent`）：

```ts
{ kind, sessionId, urgency: 'urgent'|'normal'|'low',
  dedupeKey, payload, suppressedCount? }
```

| 触发器 | 订阅点 | 过滤/状态机 | dedupeKey | 清理 |
|---|---|---|---|---|
| **T1 审批** `approval.js` | `session/event`（global） | `approval/asked` → 发通知 + `markBusy` + 递归 `ctx.timeout` 提醒（`remindAfterMs`，上限 `maxReminders`）；`approval/decided` → `settle` + `clearBusy` | `approval:{sessionId}:{id}`；提醒加 `:reminder:{n}` | decided / dispose |
| **T2 提问** `questions.js` | `sessionProjections.onChanged` + `session/disposed` | 只处理 `key==='userQuestions'`；diff `active[]`：新 `open` 发通知并起提醒链；`continued` 且 `remindOnContinued` 再发一次；问题离开 active 即 `settle` | `question:{sessionId}:{callId}` / `:continued` / `:reminder:{n}` | 回答/离开 active / session disposed |
| **T3 长任务** `long-task.js` | `session/event`（global） | `turn/start` 起 `ctx.timeout(turnThresholdMs)`；`turn/end` 清；到点时若 `core.isBusy(session)`（审批/提问中）则**重新等一整轮**；`job/registered`/`job/settled` 同理 | `longturn:{sid}:{turn}` / `longjob:{sid}:{jobId}` | turn/end、job/settled、fiber dispose |
| **T4 错误** `error.js` | `session/event` + `agent/error`（global） | `turn/end` 且 `reason.kind==='error'`；`agent/error` 用**同一 dedupeKey** 合并；`tool/result` 的 `isError` 默认关闭，`toolErrors`/`toolTimeout` 分开开关 | `error:{sid}:{turn}`（turn/agent 合并）/ `toolerror:{sid}:{callId}` | — |
| **T5 完成** `completion.js` | `session/event`（global） | `turn/end` 且 `reason.kind==='completed'` 且时长 ≥ `minDurationMs`；`job/settled` 直接发（failed 时 urgency normal） | `completion:{sid}:{turn}` / `jobdone:{sid}:{jobId}` | — |

**实现细节（被追问时用）**：

- **T1/T2 的提醒不是 interval**：每次 `ctx.timeout` 回调里 `submit` 一条新 dedupeKey（带 reminder 序号）的触发，再递归 `schedule()`；`settle()` 调 timer disposer 并删 Map。
- **T2 的 diff 是"已宣告集合"**：`announced: Map<sessionId,{open,continued}>`，只在状态首次出现时通知；这天然处理批量问题、撤销、跨端同步（因为投影本身是客户端视图）。
- **T3 的 busy 抑制**：`core.busy` 是 `Map<sessionId, Set<'approval'|'question'>>`；审批/提问期间不报"长任务"，避免重复打扰（`long-task.js:26-29,51-53`）。
- **T4 的同源合并**：`agent/error` 与 `turn/end(error)` 都映射到 `error:{sid}:{turn}`，先到者发、后到者被 dedupe 丢掉。
- **T5 的 job 时长恒 0**：`long-task` 先消费 `job/settled`（调 `core.endJob` 删掉 `jobStarts`），`completion` 再取时已为空，所以 `durationMs=0`（`completion.js:36,49`）。想修：让 completion 先取、或把 job 事实存到 record。

### 5.4 Core：`core/notix.js` 的 pipeline

```js
async submit(trigger) {
  try {
    if (this.inQuietHours(trigger.urgency)) return undefined       // ① 静默（最早）
    if (this.store.isDuplicate(trigger.dedupeKey)) return undefined// ② 去重
    this.store.remember(trigger.dedupeKey)                         // 先记账（失败也不重试）
    if (trigger.kind === 'error') {                                // ③ 错误冷却
      const suppressed = this.store.hitCooldown(`error:${sid}`, cooldownMs)
      if (suppressed > 0) return undefined
      trigger.suppressedCount = this.store.suppressed(bucket)
    }
    const { title, body } = renderNotification(this.config, trigger)   // ④ 渲染
    const record = { id, kind, urgency, title, body, sessionId, dedupeKey, createdAt, delivered:false, channels:[] }
    this.store.record(record)                                      // ⑤ 记历史（内存 + 域）
    this.chain = this.chain                                        // ⑥ 全局串行链
      .then(async () => {
        const channels = await this.channels.deliver({...record, payload})
        this.store.update(record.id, { delivered: channels.length > 0, channels })
      })
      .catch(e => this.logger.warn(...))
    return record
  } catch (e) { this.logger.warn(...); return undefined }          // ⑦ 绝不外抛
}
```

**顺序上的两个"反直觉"**（面试价值高）：

1. **静默在去重/冷却之前**：被静默时段吞掉的通知**不占用 dedupe key、不写历史、不补发**。设计文档写的是"去重→冷却→静默"，代码是反的；代码行为更合理（静默期间的事件不该阻止时段结束后的新通知），但解释时要讲清楚。
2. **dedupe 先记、投递后补状态**：如果投递失败，24h 内同 key 不会重试（只靠提醒链兜底）。这是"至少一次"与"重复打扰"之间的取舍。

其它：

- `inQuietHours`（`:160-170`）：支持跨午夜；`from === to` 视为关闭；urgent + `allowUrgent` 放行。
- `sessionTitle`（`:122-129`）：从 `sessionProjections.stateOf(session,'title')` 读，非空 string 才用——**不是**用 `ctx.agents`（DESIGN 写错了）。
- `api()`（`:241-248`）：暴露 `notify/registerChannel/history/config`；`notify` 默认 `kind:'manual'`、随机 dedupeKey（永不去重）。
- `dispose`（`:117-119`）：只关存储；timer/监听归 fiber 管。

### 5.5 `core/store.js`：单域双表 + 内存回退

- spec（`:35-43`）：`{ name:'notix', version:1, layout:'per-record', tables:{ history:{valueSchema}, dedupe:{valueSchema} } }`，zod 校验记录。
- `open()`（`:64-84`）：`ctx.get('storageDomain')` 缺失或 `open` 失败 → 只用内存；成功则把域里的 dedupe 按 24h TTL 载入、history 按 `createdAt` 取最近 200 条。
- 内存算法：`dedupe: Map<key, timestamp>`（TTL 24h，size ≥ 512 才 prune）；`cooldowns: Map<bucket,{count,until}>`；`records: []`（同步裁剪 200）。
- 写策略：`domain.table(...).put(...).catch(...)` —— **best-effort**，持久化失败只 debug 日志，不影响通知。
- 对外：`history(limit=20)` 返回副本（最新在前）。

**面试题**："为什么不用 `session.append` 存通知历史？" 答：会破坏 session log 的可 replay 语义（未知事件类型/格式迁移只对官方 `plugin:` 记录 best-effort），且通知历史属于插件私有状态，不该被模型/其它读者看到。

### 5.6 `core/render.js`：本地化与降噪

- `formatDuration`（分钟/小时，zh/en 两套）、`truncate`（默认 200，压缩空白）。
- `ZH`/`EN` 两本文案字典：approval / question / long turn / long job / error / completion / job done / suppressed。
- `renderNotification(config, trigger)`：按 kind + `payload.scope` 分派；`verbosity==='minimal'` 时 error body 只给会话标题；最终 title ≤120、body ≤500。
- `suppressedCount` 合并文案的分支存在，但 core 里赋值路径实际只会是 0（`suppressed` 在当前调用顺序下拿不到计数）——**死代码**，见 §8。

### 5.7 渠道：`core/channels.js` + `channels/macos.js`

`ChannelRegistry`（`channels.js`）：

- `register({id, send})` 返回 disposer；`setEnabled/ids` 辅助；
- `deliver()`：按注册顺序逐个渠道；每渠道最多 **4 次尝试**（首次 + 1s/5s/15s），单次 10s 超时；连续失败 3 次 → 熔断 5 分钟；失败只 warn，不影响其它渠道。
- 注意：`deliver` 是**串行**（`for...of` + await），而 `submit` 又把整个 deliver 串到一条全局 `this.chain` 上——所以全进程通知是严格顺序投递的。

`MacosChannel`（`macos.js`）：

| 后端 | 选择条件 | 实现 |
|---|---|---|
| helper App | `~/Applications/Notix.app/Contents/MacOS/NotixNotifier` 存在 | `execFile(exe, [title, body, sound?'default':'silent'])`；UNUserNotificationCenter，只能签名后授权 |
| terminal-notifier | `which terminal-notifier` 成功 | `-title -message -group <dedupeKey> -appIcon <png> [-sound default] [-open <baseUrl>]` |
| alerter | `which alerter` 成功 | `--title --message [--sound default]` |
| osascript | 兜底，永远可用 | 常量 AppleScript + `--` 后跟 `body title`（argv，不拼命令） |

**安全点**：全部 `execFile` + 参数数组，没有 shell、没有字符串插值；AppleScript 用 `run argv` 读参数，body/title 不进入脚本源码。`send()` 里 `process.platform !== 'darwin'` 直接抛错（由 registry 捕获、熔断）。

### 5.8 测试：23 个用例怎么组织的

- `test/mock.js`：假 `Context`（`logger/sessions/on/timeout/get/provide/effect/emit/emitSession/emitUserQuestions`）+ 假时钟 `installClock`；`createCore` 建 pipeline 并挂一个捕获通知的 `test` 渠道。
- `core.test.js`（9）：volatile 解包、默认值、zh/en 渲染、时长/截断边界、去重、错误冷却、静默时段、history。
- `triggers.test.js`（9）：审批提醒/decided 停止、问题 open/continued/busy、turn 看门狗与 busy 抑制、turn error 与 agent/error 合并、完成阈值、job settled、问题提醒链。
- `integration.test.js`（5）：**真实 Cordis runtime**（`new Context()` + `root.plugin(notix, config)`），验证 `ctx.notix`、schema 默认值与非法值拒绝、fiber dispose 后监听/服务消失、storageDomain 持久化重建。

> 这组测试是面试加分项：它同时验证了 Cordis 插件契约（inject/Config/apply/dispose）与业务行为，而不仅是函数级单测。

---

## 6. Client 插件代码走读（`packages/notix-dsh-ui`）

### 6.1 包身份：两个声明

```jsonc
// packages/notix-dsh-ui/package.json
"exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./locale/*.json": "./locale/*.json" },
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },          // 它是一个 bundle（自带 insert 行）
  "client": {                                            // 它同时是一个 client 插件
    "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-plugin-manager"],
    "platform": "web"
  }
}
```

- 没有 `entry` 字段：浏览器入口就是 `exports["./client"]`。
- `cordis.patch.yml:3-5` 插 `id: ui-notix, name: notix-dsh-ui`。
- `lib/index.js`（8 行）只有 `export function apply() {}`——Host 半只为占 Loader 行。

### 6.2 浏览器 bundle 的外壳与导出

```js
// lib/client.js:1-8
window.__ModuleLoader__.load({
  id: "notix-dsh-ui",
  factory: (require) => {
    var module = { exports: {} };
    let react = require("react");
    let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    // ... 全部代码
    exports.NS = "settings.notix";
    exports.apply = apply;
    exports.inject = ["slots", "locale", "configForms"];
    return module.exports;
  }
});
```

- 这是**手工 CJS bundle**：`factory(require)` 里用 `require("react")` 等 externals；bundle 执行本身只注册 factory（无副作用）。
- 导出契约：`{ NS, apply, inject }`；浏览器 Cordis 用 `inject` 等 `slots/locale/configForms` 就绪后调 `apply(ctx)`。
- `NS = "settings.notix"` 是**字典命名空间**，与 Host 的配置命名空间 `notix` 是两回事。

### 6.3 slot 注册与 Card 的两种视图

```js
function apply(ctx) {
  const t = ctx.locale.bind('settings.notix')
  ctx.effect(() => ctx.locale.register('settings.notix', { zh, en }), '…: dictionaries')
  const form = ctx.configForms.get('notix')                 // :630
  ctx.effect(() => ctx.configForms.whileServed(['notix'], () =>
    ctx.slots.inject('plugins.item', () =>
      ctx.slots.register({
        name: 'plugins.item', id: 'notix', order: 40,
        label: () => t('title'), locale: 'settings.notix',
        inject: () => ({ form }),
      }, NotixCard)
    )
  ), 'notix-dsh-ui: page')
}
```

`NotixCard(props)`：

- `props.t`：字典函数（由 `locale` 提供）；
- `props.form`：`configForms.get('notix')` 的控制器（由 `inject()` 提供）；
- `props.view`：`'summary'` 或 `'page'`；
- summary 态：`snap.status==='ready'` 时返回一行"已启用触发器 n/5 · 免打扰 开/关 · macOS 渠道 开/关"；loading/unavailable 返回静态文案。
- page 态：完整表单（5 组触发器 + 免打扰 + 内容 + 渠道 + 状态区）。

### 6.4 状态与交互（React hooks，无自研 store）

- `useSnapshot(form)`（`:147-151`）：`useState(form.getSnapshot())` + `useEffect` 订阅 `form.subscribe`，卸载时调用 disposer。
- `commit(path, value)`（`:368-377`）：`pending+1` → `form.mutate([{op:'set', path, value}])` → 成功 `saved`/失败 `failed` → `pending-1`；写入期间所有控件禁用（防连点乱序）。
- 控件：
  - `NumberField`（含 `MinutesField`/`CountField`）：**draft-commit 模型**——输入不直接写，失焦/Enter 才提交；非法值保留输入、`aria-invalid` + `role="alert"`，不写配置。
  - `TimeField`：`<input type="time">`，`HH:MM` 正则校验；`SelectField`：枚举下拉；`TextField`：失焦/Enter 提交。
- 可访问性：显式 `id` + `<label htmlFor>` + `aria-label`；状态区 `role="status"` + `aria-live="polite"`；错误 `role="alert"`。
- 样式：一段内联 CSS 字符串，`injectStyles()` 用 `data-plugin-css` 去重后插 `<head>`；颜色只用 `--dsw-alias-*` token + fallback。
- i18n：卡片文案内嵌在 client.js（`zh`/`en` 两本字典）；`locale/*.json` 只放 `meta.title/description` 给插件市场/清单。

### 6.5 保存链路：UI 改值到 Host 生效的 8 跳

以关闭审批提醒为例：

| # | 发生什么 | 位置 |
|---|---|---|
| 1 | `Switch.onChange(false)` → `commit(['triggers','approval','enabled'], false)` | `client.js:390-395, 368-377` |
| 2 | `form.mutate([{op:'set', path, value}])`，控制器串行入队（带 revision） | `dsh-client-ui-settings/lib/client.js:1166-1183` |
| 3 | Typert RPC `settings.mutate('notix', ops, revision)` | `dsh-api-settings-controller/lib/index.js:434-477` |
| 4 | `dsh-settings` 校验：entry active、`volatileForm` 非空、path 是 volatile、revision 匹配 | `dsh-settings/lib/index.js:489-538` |
| 5 | `dsh-config-editor` 写当前 profile 的 `cordis.patch.yml`（文件锁 + 原子写 + 校验 + 回滚） | `dsh-config-editor/lib/index.js:70-136` |
| 6 | Loader 判定 volatile-only → `_commitVolatile()`：更新 ref + emit `loader/volatile-update` | `cordis-plugin-loader/lib/index.js:383-428` |
| 7 | Host `ctx.on('loader/volatile-update')` → `core.replaceConfig(readConfig(rawConfig))` | `notix-dsh/lib/index.js:63-69` |
| 8 | 写应答折入 settings 镜像 + `settings/document-updated` → controller 快照 → `useSnapshot` 重渲染 | `dsh-client-ui-settings/lib/client.js:1177-1180,1210-1232` |

**四个结论**：

- **没有保存按钮**：每次交互直接持久化到 profile patch；所谓"已保存/保存中/失败"只是写队列状态。
- **服务端权威**：UI 不做乐观本地覆盖；失败时快照回读到 Host 最新值（revision 冲突则显示保存失败）。
- **volatile 是前提**：非 volatile 字段写不动，而且整个命名空间不会出现在 settings 里。
- **不重载**：volatile-only 变更走热提交；普通字段变化仍会触发 fiber 重建。

### 6.6 一处重要事实纠偏：表单不是 schema 自动生成的

`DESIGN.md` 说"Config schema 即设置页表单的单一事实源"，**实现并非如此**：

- Host 的 schema 确实下发到浏览器（`settings.describe()` 返回 namespace view，含 `schema = form.toJSON()`）；
- 但 `ConfigFormController` 的快照里**没有 schema**，卡片也**没有用 schema 生成任何字段**；
- 所有字段名、嵌套 path、默认值都是 `client.js:314-326` 手写的一份 `DEFAULTS` 镜像；字段名写错会被 Host 的 volatile path 校验拒绝（不会写坏 YAML），但 UI 只能显示笼统失败。
- 因此 UI 与 Host 存在**漂移风险**：Host 新增 `userQuestion.maxReminders`、`macos.notifierApp/appIcon` 等字段，UI 都没有暴露。

**面试这么答**："schema 决定命名空间是否可配置、写入是否合法；表单是手写的，不是 schema-driven。这是当前实现的简化，也是下一步可以做的事（用 `ctx.settingsSchema` 生成嵌套表单）。"

### 6.7 已知的高危风险（静态分析，未 GUI 实测）

`DESIGN.md` 与 UI 设计文档都注明"未在运行中的 GUI 实测"。静态分析发现：

- **详情页**（`view === 'page'`）里 plugin-manager 用 `renderSlot('plugins.item', { view:'page', form }, { only: item.id })` 传入的 `form` 是 `{ state, mutate }` **投影对象**，不是 controller；
- renderer 合并 props 时 **ownerProps 最后展开**，会覆盖本卡片 `inject: () => ({ form })` 注入的控制器；
- `NotixCard` 在 `useSnapshot(form)` 第一行调 `form.getSnapshot()` → page 态会抛 TypeError，被 slot 错误边界兜住（显示错误占位，不白屏）。

**怎么讲**：诚实说"列表页（summary）路径正确；详情页存在 props 覆盖风险，已定位到 renderer 的 ownerProps 合并顺序，修复方式是用 `form.state + form.mutate` 适配页面契约、或把注入字段改名避开 `form`，并补一个真实 GUI 回归测试"。

### 6.8 冒烟脚本冒的是什么

`scripts/smoke-client.mjs`：

- 用 `vm` 执行 `lib/client.js`，stub `window.__ModuleLoader__`、`require`（react / jsx-runtime / primitives / store）；
- 断言：bundle 调用了 `load`、`id` 正确、`factory(require)` 返回对象有 `apply` 函数与 `inject` 数组；
- **不渲染组件**，所以发现不了上面的 page 态问题；它防的是"语法错误 / externals 缺失 / factory 形状回归"。

---

## 7. 设计决策与权衡（面试官最爱问）

### 7.1 为什么坚持"纯观察者"？

- **不注册 answerer / 不碰 waterfall**：审批的 fail-closed 语义由 `dsh-user-approval` 的 waterfall 保证；任何第三方 answerer 都可能改变"拒绝/允许"的结果，扩大远程授权攻击面。
- **不 append session 事件**：session log 是唯一事实源，未知事件类型会破坏 replay/迁移；通知历史属于插件私有状态。
- **不 block agent loop**：所有订阅回调首行过滤、try/catch 包裹、耗时逻辑进队列；投递失败只影响通知。
- **收益**：插件可随时装卸、不改变 dsh 的安全/回放语义；**代价**：无法做"在通知里直接批准"这类交互（明确列为 non-goal）。

### 7.2 为什么通知历史放 storageDomain，而不是 session log / 文件？

- session log：会污染模型可重建的事实、且 Notix 无权写入未知类型；
- 自己写文件：要处理路径、并发、schema、迁移；
- `storageDomain`：schema 校验、同步读、持久写、单进程事件、对模型不可见——正好匹配。降级路径也简单：没有该服务就用内存。

### 7.3 去重、冷却、提醒链、熔断：四层降噪分别防什么？

| 机制 | 防的问题 | 参数 | 代码 |
|---|---|---|---|
| dedupe（24h TTL） | 同一事实重复通知（日志重放、同源事件） | `dedupeKey` 由触发器设计 | `store.js:104-124` |
| 冷却（按 session） | 错误风暴刷屏 | `error.cooldownMs` 默认 60s | `notix.js:183-188` |
| 提醒链 | 阻塞类事件被忽略 | `remindAfterMs` / `maxReminders` | `approval.js:27-43`、`questions.js:39-54` |
| 熔断 | 渠道故障拖垮投递 | 连续 3 次失败 → 停 5min | `channels.js:7-10,64-95` |

**注意**：冷却实际只对 `kind==='error'` 生效（README 说"per session rate-limited"不够准确）；`suppressedCount` 的聚合分支是死代码。

### 7.4 为什么串行投递（一条 `Promise` 链）？

- 通知是低吞吐、对顺序有感知（审批→提醒→完成）的场景；串行能保证同一 session 的通知不交错；
- 实现最简单：`this.chain = this.chain.then(...)`；失败被 catch，链不会断；
- 代价：一个慢渠道会阻塞后面的通知——所以单渠道有 10s 超时 + 熔断；如果未来做多渠道并发，需要改成每渠道队列。

### 7.5 macOS 为什么用 `osascript` / helper App？

- `dsh-desktop-host` 是**纯 Node 进程**（不 import electron，与壳用私有 IPC），插件拿不到 Electron 的 Notification 对象；
- `osascript -e 'display notification …'` 零依赖、永远可用，但图标是 Script Editor；
- `terminal-notifier`/`alerter` 可点击跳转/自定义图标，但需要用户安装；
- 自带签名 helper App（`NotixNotifier.swift`）能显示鲸鱼图标，但 macOS 只授权**代码签名**的 App（ad-hoc/未签名会被静默拒绝），所以需要用户的签名身份。

### 7.6 为什么两个包而不是一个？

- dsh 的 **client 半侧发现依赖"Loader 行 → package.json 的 dsh.client"**；把 UI 放进 Host 包并不会自动被发现；
- 官方 `dsh-client-ui-*` 都是独立包 + 空 apply 的 Host 半；
- Notix 选择"UI 包自带 bundle patch"，让它可以独立安装/停用，代价是用户要装两次（README 有写）。
- **单包双声明其实可行**（`dsh.bundle` + `dsh.client` 互不校验），约束是：必须有 Loader 行、包能被 profile 解析、同一包不能有两个 active Loader source。

### 7.7 为什么把 title 放在通知里？隐私边界怎么划？

- 会话标题是最有信息量、又最低敏感度的上下文；
- `verbosity: minimal`（默认）只给标题/工具名/截断问题，不含命令行、文件内容；
- 系统通知本身还受 macOS 通知中心隐私设置约束；
- 这是"可用性 vs 泄露"的显式取舍，面试可以直接说"默认保守，需要细节的人自己调 normal"。

### 7.8 降级矩阵（插件工程化能力的体现）

| 缺失/失败 | 行为 | 位置 |
|---|---|---|
| schemastery 解析失败 | `Config=undefined`，默认值仍生效；设置卡片消失 | `index.js:26-33` |
| `storageDomain` 缺失/open 失败 | 纯内存去重/历史 | `store.js:64-84` |
| `sessionProjections` 缺失 | 代码有降级分支，但 `inject` 让它阻塞启动（矛盾） | `index.js:19` vs `questions.js:128-132` |
| macOS 渠道失败 | 重试→熔断；不影响其它渠道 | `channels.js` |
| 单个 trigger 抛错 | warn，不影响其它 trigger / agent | 各 trigger try/catch |
| 设置卡片 page 态 props 冲突 | slot 错误边界显示错误占位，不白屏 | §6.7 |

---

## 8. 代码 vs `DESIGN.md` 的偏差清单（展示 review 能力）

> 设计文档是"评审版 v1.1"，实现是"能跑的 v0.1.1"，两者有正常演进差。面试被问"你的设计文档和代码一致吗"时，能逐条说出差异比说"一致"更加分。

### A. 形态/结构

| # | DESIGN 断言 | 代码事实 | 证据 |
|---|---|---|---|
| A1 | `class NotixService extends Service` + `super(ctx,'notix')` + `startNotix()` | 对象插件 + `ctx.provide('notix', core.api())` | `index.js:16-73` |
| A2 | `inject=['sessions','agents','timer','storageDomain']` | `['sessions','timer','sessionProjections']`；storage 走 `ctx.get`；未用 agents/jobs 服务 | `index.js:19`、`store.js:65` |
| A3 | 用 `ctx.agents` 取会话标题 | 用 `sessionProjections.stateOf(session,'title')` | `notix.js:122-129` |
| A4 | 两个 storage 域 `notix.dedupe`/`notix.history` | 单域 `notix` + 两张表 | `store.js:35-43` |
| A5 | 渠道适配器带 `Config: Schema` 并入总 Config | 适配器只有 `{id, send}` | `channels.js:39-42` |
| A6 | `src/*.ts → lib/` 构建 | 无 src、无构建；`lib/*.js` 即源码 | `package.json` |

### B. 行为

| # | DESIGN 断言 | 代码事实 |
|---|---|---|
| B1 | 流水线 = 规则→去重→冷却→静默→渲染 | 静默最先，且静默不占用 dedupe/冷却、不补发（`notix.js:179-188`） |
| B2 | busy 解除后按剩余阈值重新计时 | 每轮重新等完整阈值，`BUSY_RECHECK_MS` 定义未用（`long-task.js:6,21-44`） |
| B3 | 通用规则引擎 / sessionFilter / 优先级聚合 | 只有每 trigger 的 enabled/阈值，无过滤/优先级/聚合 |
| B4 | 每渠道并发 1、FIFO 队列、≤3 次重试 | 全局一条 Promise 链串行；每渠道 4 次尝试；无容量/持久化（`notix.js:44,206-213`；`channels.js:7,71`） |
| B5 | job failed 与 T4 合并为一条 | 无 T4 job 分支；job failed 只走 T5「后台任务失败」 |
| B6 | urgency 映射（urgent 声音+⚠️，low 静默） | 渠道不看 urgency，声音只看 `sound`；无前缀 |
| B7 | `clickToOpen` 对 terminal-notifier 与 alerter 都可用 | 只有 terminal-notifier 有 `-open` |
| B8 | error 窗口聚合"又发生 k 次" | `suppressedCount` 分支不可达（`notix.js:185-187`） |
| B9 | `notify(): Promise<void>` | 返回 `record` 或 `undefined` |
| B10 | Notification 无 delivered/channels | 历史记录增加了 `delivered`/`channels` |

### C. 文档/代码内部矛盾（可直接当"我发现的 bug"讲）

| # | 现象 |
|---|---|
| C1 | `questions.js:10-15` 的 seed 写 `state?.active`，而 `stateOf` 返回 `{questions:{active}}` → seed 永远为空；注释"已有问题不通知"的行为靠的是"投影没变化不触发 onChanged"而非 seed |
| C2 | `job` 完成时长恒 0：`long-task` 先调 `endJob` 删掉 `jobStarts`，`completion` 再取为空 |
| C3 | README/DESIGN 写"19 项测试"，实际 23 项（23/23 pass） |
| C4 | `tool/result.error` 只有 `{name, code}`，`error.js` 用 `info.message` 取文本 → 恒空；超时判断 `info.name === 'ToolTimeoutError'` 不如 `data.error.code === 'TOOL_TIMEOUT'` 稳 |
| C5 | `render.js` 的 `suppressed` 文案 / `firstQuestionText` / `textOf` / `setEnabled` / `ids` / `BUSY_RECHECK_MS` 未被包内使用（死代码/预留） |
| C6 | `userQuestions` 投影只跟踪 timed 版 `ask_user_question`；Notix README 未说明 T2 对 blocking 版不生效 |
| C7 | UI 手写 `DEFAULTS` 与 Host schema 有漂移：漏了 `userQuestion.maxReminders`、`macos.notifierApp/appIcon` |
| C8 | UI `DESIGN.md` 说"schema 即单一事实源/schema 驱动表单"，实现是手写表单（§6.6） |
| C9 | client.js 直接 `require("@deepseek-ai/dsh-client-ui-primitives")`，而官方 practices.md 明确建议**不要**把 Harness Client 包当模块加载（版本变化无类型检查、控件抛错会打崩 slot entry）；官方推荐复制控件/只用 `--dsw-alias-*` token |

> 处理建议（面试可讲）：先修 C1/C2/C4 这类"会静默给出错数据"的；C3/C5 清理文档与死代码；C7/C8 是 UI 与 schema 的契约治理问题，适合下一轮迭代。

---

## 9. 如果继续做：改进路线（面试"你会怎么迭代"）

1. **修正确性 bug**：seed 层级、job duration、tool error message、`sessionProjections` 降级/`inject` 一致化。
2. **让 UI 真正 schema-driven**：用 `ctx.settingsSchema` 从 Host schema 生成嵌套表单，消除手写 `DEFAULTS` 漂移；至少先对齐缺失字段。
3. **修详情页 props 契约**：用 `{state, mutate}` 适配 page 态，或改名避开 `form`，并加一个真实 GUI 的回归测试（Playwright/截图）。
4. **投递可靠性**：可选持久化队列（storageDomain）、每渠道并发队列、失败重投；通知历史可导出。
5. **渠道扩展**：`webhook`（Node 全局 fetch，继承 `dsh-http-proxy`）、`lark`/`wecom`/`bark`/`ntfy`、`gui-toast`（Typert stream + Toast）、Windows/Linux。
6. **可观测性**：投递成功率/延迟指标、调试日志分级；用 `domain/changed` 通知其它插件。
7. **测试补齐**：触发器边界（busy/冷却/跨午夜）、`storageDomain` 真实后端、配置热更新集成测试、UI 渲染测试。
8. **公私有分明**：把 DESIGN 里"计划但未实现"的部分标注为 roadmap，避免文档与实现被面试官抓到矛盾。

---

## 10. 面试问答库（按概念分类，含追问）

> 用法：每题先给"30 秒版"，再记追问点。带 ★ 的是高频。

### A. dsh / Cordis 概念

**A1 ★ dsh 是什么？和普通 Agent 框架有什么不同？**
30 秒：dsh（DeepSeek Harness）是 host + client 双端的 agent 运行时，Host 侧用 Cordis 插件树跑 agent loop、工具、会话持久化；Client 侧是浏览器里的 Cordis 树，通过 Typert RPC 连 Host；插件以 bundle/patch 组合进 profile，可安装、可热更。
追问：session log 是唯一事实源（可 fork/resume/replay）；投影是派生读模型；插件体系是"profile 组合"而不是"代码 import"。

**A2 ★ Cordis 的 Context / Service / fiber / effect 分别是什么？**
Context = 依赖容器 + 事件总线；Service = `super(ctx,'name')` 注册到 ctx 的单例（可 inject）；fiber = 一次插件挂载的生命周期；effect = 注册在 fiber 上的清理单元（逆序执行）。
追问：`ctx.get(name)` 惰性取服务；`ctx.provide` 手动注册；`ctx.plugin` 创建子 fiber。

**A3 ★ Cordis 事件五种分发模式的区别？**
emit 同步广播丢返回值；parallel 并发 await；serial 串行 await 到 bail；bail 同步到 bail；waterfall 中间件链，不调 `next()` 即否决内建行为。
追问坑：`emit` 里 async 监听器 rejection 没人接；`waterfall` 调了 `next()` 但不 `return` 会吞内建返回值；bail 只认非 `null/false/undefined`。

**A4 ★ `{global:true}` 是什么？为什么不会漏事件？**
它是"绕过分发载体过滤器"的声明，不是事件冒泡。Cordis 的事件是一张全局 hook 表，分发时按载体上的 `Context.filter` 过滤；`global:true` 短路过滤器。dsh 官方 `dsh-user-approval` 的 invariant 也用这个模式。
追问：带 scope 标签的监听器只"向上"收事件；无标签的监听器本来就全局接收。

**A5 ★ volatile 是什么？为什么设置页要它？**
schemastery 叶子标记 `.volatile()` → 运行时可原地更新；`dsh-settings.describe()` 只暴露含 volatile 叶子的命名空间（`volatileForm`）；Loader 对 volatile-only 变更走 `_commitVolatile`（更新引用 + 发 `loader/volatile-update`），不重启插件。
追问坑：不标 volatile 的后果是**整个命名空间不出现**（卡片消失），不是字段只读；带 transform 的 volatile 字段可能因每次解析生成新实例导致"永远不相等"，退化为普通重载。

**A6 ★ session 事件和投影（projection）的区别？**
事件是不可变、持久化的事实日志；投影是从事实折叠出的当前完整状态（内存、可重建、可 checkpoint）。事件喂给多个消费者；投影给客户端/UI 一次读全量。
追问坑：`stateOf` 返回 host state，`onChanged` 第三个参数是 wire view，两者形状可能不同（Notix 的 seed bug 就栽在这）。

**A7 session log 的 append 纪律是什么？**
commit 后才通知观察者；监听器里 append 会被"不可重入"拒绝；不能 append 未知事件类型（读取端只接受 `ignorable:true`，live append 设不了）；通知历史应放 storageDomain。
追问：`session/flush` 是 durability 同步点；approval asked/decided 必须成对且 turn 内。

**A8 ★ Host 插件和 Client 插件的区别？**
Host：Node/Cordis，`dsh.bundle.patch` 插行，`exports["."]` 入口；Client：浏览器 Cordis，`dsh.client{platform:'web'}` 声明，`exports["./client"]` 入口，bundle 用 `window.__ModuleLoader__` 注册 factory，导出 `{apply,inject}`。Client 半侧由 Host 扫描 Loader 行发现，Host 半可为空 apply。
追问坑：`dsh.client.inject`（包名，加载顺序）≠ bundle 的 `inject`（Cordis 服务名）。

**A9 ★ 设置保存链路为什么"立即生效不重启"？**
UI `mutate` → settings RPC → `dsh-settings` 校验 volatile path + revision → `dsh-config-editor` 写 profile patch → Loader `equalExceptVolatile` / `_commitVolatile` → 更新运行时 ref + owner fiber 收 `loader/volatile-update` → 插件重读 config。普通字段仍会重挂载。
追问：UI 没有保存按钮；写入是服务端权威；revision 冲突会失败重读。

**A10 storageDomain 的读写语义？**
读同步来自内存；写先后端持久化、再改内存、再发 `domain/changed`；每 domain 一条写链；监听器抛错不影响已持久化写。对模型不可见。
追问：能存 session 历史吗？不能，那是 session persistence 的领域。

**A11 jobs 为什么既有 session 事件又有服务事件？**
session 事件（`job/registered`/`job/settled`）是持久化审计，可跨重启/replay；`ctx.jobs.events` 是运行时观察（含 output/progress），不可 replay；`settle()` 先写 session 事件再广播，所以两者顺序不代表因果。

**A12 ★ 怎么判断一个需求该用哪种扩展点？**
从弱到强：`tools.restrict()`（只能移除工具）→ `tools.guard()`（只能拒绝）→ waterfall（可改写，依赖顺序）→ `system-prompt/assemble`（整体替换）。越强越要保留其他插件的贡献。观察类需求用 `emit` 监听 + projection，不要改 waterfall。

### B. 架构与设计（针对 Notix）

**B1 ★ 为什么说 Notix 是纯观察者？怎么保证？**
不注册 answerer/waterfall、不 append session 事件、不 block agent loop；所有回调 try/catch、首行过滤、耗时逻辑进队列；投递失败只 warn。审批 fail-closed 语义不变。
追问：那怎么提醒"审批未处理"？观察 `approval/asked` + `ctx.timeout` 提醒链，decided 时取消——仍然不参与决策。

**B2 ★ 五个触发器怎么选的订阅点？**
审批/长任务/错误/完成走持久化 `session/event`（事实、可 replay、与 GUI 一致）；提问走 `userQuestions` 投影（客户端语义状态，天然处理批量/撤销/跨端），标题也走 `title` 投影；`agent/error` 是 Cordis 事件，仅用于与 `turn/end(error)` 合并去重。
追问：为什么不用 `ctx.jobs.events`？为了少一个可选服务耦合，且 session 事件已含持久化事实；代价是拿不到 output/progress 增量。

**B3 ★ 去重/冷却/提醒/熔断分别在防什么？**
见 §7.3。强调 dedupeKey 的命名设计（`approval:{sid}:{id}` 幂等；提醒带序号；error 故意让 agent/error 与 turn/end 同 key 合并）。

**B4 ★ 为什么通知历史不放 session log？**
污染事实源、破坏 replay/迁移、对模型可见；storageDomain 是"schema 校验 + 持久 + 不可见"的宿主私有 KV。降级可内存。

**B5 ★ macOS 通知的实现为什么要这么绕？**
宿主是纯 Node 进程、拿不到 Electron Notification；osascript 零依赖兜底；terminal-notifier/alerter 支持点击跳转；自带 helper App 可显示自定义图标但需要代码签名（macOS 只授权签名 App）。安全上用 execFile + argv，无 shell。

**B6 ★ 两个包怎么协作？**
Host 包提供 `notix` 配置命名空间 + `ctx.notix` 服务；UI 包通过 `configForms.get('notix')` 读写同一命名空间，`whileServed` 门控保证 Host 未装时零痕迹。两个 bundle 独立安装。

**B7 ★ 如果 Host 没装/没 volatile/降级了会怎样？**
卡片消失（不是只读）；Host 仍用默认值工作；storage 缺失则内存模式；渠道失败熔断。

**B8 你的通知会不会重复/漏发？**
不会跨进程重复（单 Host 事件总线）；多 profile/实例各自通知是预期；漏发风险在"dedupe 先记、投递失败不重试"和"blocking 提问无投影"，已知并列为改进项。

### C. 代码细节 / 排障

**C1 ★ 一次审批从发生到通知的完整链路？**
`approval/asked`（turn 内 append）→ `session/event` 广播 → `installApproval` 回调 → `markBusy` + `core.submit({kind:'approval', dedupeKey})` → submit 流水线 → 渲染 → 串行链 → ChannelRegistry → MacosChannel → osascript/helper。5 分钟未 decided 递归提醒；decided 清 timer。

**C2 ★ 配置改动怎么生效？**
见 §6.5 八跳；重点：`Form.mutate` 嵌套 path → config-editor 写 patch → Loader `_commitVolatile` → `replaceConfig` 原地更新（因为 triggers 持引用）。

**C3 为什么 `core.replaceConfig` 不直接赋值 `this.config = next`？**
triggers/channels 通过闭包持有 `core.config` 引用；整体替换会丢引用。用 `delete + Object.assign` 保留身份，再 `syncChannels()`。

**C4 插件卸载时怎么保证没有残留？**
监听器 `ctx.on` 自动清理；timer `ctx.timeout` 随 fiber；`ctx.effect` 清 Map/timer；`ctx.provide` 的服务随 fiber 消失；测试 `integration.test.js:91-103` 验证 dispose 后不再通知。

**C5 怎么测试一个 dsh 插件？**
两层：`mock.js` 假 Context + 假时钟做行为单测；真实 `new Context()` + `root.plugin()` 做契约集成测试（inject/Config/dispose/storage）。UI 用 `smoke-client.mjs` 在 VM 里验证 bundle 形状（不渲染）。

**C6 如果通知没发出来，你怎么排查？**
按链路：① 事件是否发生（session log/job 事件）→ ② trigger 是否过滤（enabled、global、kind）→ ③ dedupe/冷却/静默是否吞掉 → ④ 渲染是否抛错 → ⑤ 渠道是否熔断/超时 → ⑥ macOS 权限/后端选择（helper 未签名、terminal-notifier 未安装）。日志在 `ctx.logger('notix')`。

### D. 深挖 / 反问

**D1 ★ 你觉得当前实现最大的问题是什么？**
三个：① UI 与 Host 的 schema 契约靠手抄（漂移 + 详情页 props 风险）；② `inject` 与降级叙事矛盾、seed 层级 bug 这类"代码与注释/文档不一致"；③ 投递可靠性（队列不持久化、失败不重投）。回答时给出修复顺序。

**D2 如果要支持"在飞书里直接批准"，你会怎么做？**
可以，但那会把插件从观察者变成决策者：需要注册审批 answerer/waterfall、做身份认证与审计、保持 fail-closed、防重放。Notix 明确不做，是安全边界选择。

**D3 dsh 的哪个机制让你觉得设计得最好？**
候选：session log 单一事实源 + projection 读模型的分层；volatile 热更新；bundle/patch 组合。答一个并说清"为什么这样分层能同时满足可回放、可扩展、可热更"。

**D4 你对 dsh 插件生态的理解？**
插件 = Host 能力（事件/服务/工具）+ Client 表现（slot/RPC），通过 profile 组合；扩展点强弱有别，越强越危险；生态的关键是契约稳定（本项目的 risk 就是依赖 0.2.1-rc.2 的 slot/configForms 细节）。

---

## 11. 术语表

| 术语 | 含义 | 对应代码/文档 |
|---|---|---|
| **dsh** | DeepSeek Harness，本项目的运行平台 | `@deepseek-ai/dsh*` |
| **Cordis** | dsh 的插件内核（Context/Service/fiber/effect/事件） | `@deepseek-ai/cordis` 4.0.5 |
| **profile** | 一套插件组合 + 配置（`$DSH_HOME/profiles/<name>`） | `dsh-app-boot` |
| **bundle** | 可安装单元，声明 `dsh.bundle.patch` | 两个包的 package.json |
| **patch / entry** | 组合层 YAML / 一行插件声明（id/name/config/disabled） | `cordis.patch.yml` |
| **Loader** | 把 patch 组合成插件树、管 HMR/volatile 的插件 | `cordis-plugin-loader` |
| **fiber** | 一次插件挂载的生命周期 | `ctx.fiber` |
| **effect** | 绑定 fiber 的清理单元 | `ctx.effect` |
| **inject** | 服务依赖声明（Host/Client 各一套） | `index.js:19`、`client.js:619` |
| **volatile** | schemastery 标记：运行时可原地更新 | `schema.js` |
| **session log** | 持久化事件日志（唯一事实源） | `dsh-session` |
| **projection** | 日志派生的当前状态读模型 | `dsh-session-projection` |
| **storageDomain** | 宿主私有、schema 校验的 KV 域 | `dsh-storage-domain` |
| **Typert RPC** | Host↔Client 的类型化 RPC（流式走 mux） | `dsh-typert-*` |
| **slot** | Client UI 的扩展点 | `dsh-client-ui-renderer` |
| **configForms** | Client 侧配置表单服务/控制器 | `dsh-client-ui-settings` |
| **configEditor** | Host 侧把配置写进 profile patch | `dsh-config-editor` |
| **fail-closed** | 审批默认拒绝、异常/未知结果归一为拒绝 | `dsh-user-approval` |
| **HMR** | 热模块替换（组合变更即时生效） | `dsh-hmr` |

---

## 12. 行号速查 & 参考资料

### 12.1 本仓库关键位置

| 概念 | 位置 |
|---|---|
| Host 插件入口（name/inject/Config/apply/provide/热更/effect） | `packages/notix-dsh/lib/index.js:16,19,26-33,55-73` |
| 配置 schema（29 volatile 叶子） | `packages/notix-dsh/lib/schema.js:22-93` |
| 配置解包（volatile ref → 普通值） | `packages/notix-dsh/lib/config.js:90-124` |
| 审批触发器 | `lib/triggers/approval.js:27-79` |
| 提问触发器（投影 diff + 提醒链） | `lib/triggers/questions.js:10-152` |
| 长任务看门狗 | `lib/triggers/long-task.js:21-125` |
| 错误触发器（同源合并） | `lib/triggers/error.js:24-102` |
| 完成触发器 | `lib/triggers/completion.js:14-59` |
| pipeline（静默→去重→冷却→渲染→队列） | `lib/core/notix.js:177-219` |
| 标题投影读取 | `lib/core/notix.js:122-129` |
| storageDomain（单域双表） | `lib/core/store.js:35-96` |
| 渲染/本地化 | `lib/core/render.js:30-136` |
| 渠道注册表（重试/熔断） | `lib/core/channels.js:7-95` |
| macOS 投递（4 后端 + 安全） | `lib/channels/macos.js:27-128` |
| 真实 Cordis 集成测试 | `test/integration.test.js:13-142` |
| Client 装载（slots/configForms/locale） | `packages/notix-dsh-ui/lib/client.js:615-639` |
| Client 保存（mutate/pending/状态） | `client.js:350-377,600-604` |
| Client 手写 DEFAULTS | `client.js:314-326` |
| Client bundle 外壳/导出 | `client.js:1-8,641-646` |

### 12.2 dsh 侧证据（0.2.1-rc.2）

| 主题 | 包/文件 |
|---|---|
| 事件分发五模式、hook 过滤 | `@deepseek-ai/cordis/lib/index.js:220-330` |
| 全局 session 监听先例 | `@deepseek-ai/dsh-user-approval/lib/types/invariant.js:66-93` |
| 62 种持久化事件目录 | `@deepseek-ai/dsh-session/lib/types/known-event-types.js:21-84` |
| 投影注册表 API | `@deepseek-ai/dsh-session-projection/lib/index.js:110-170,419-423` |
| userQuestions 投影 | `@deepseek-ai/dsh-user-questions/lib/index.js:268-293` |
| storageDomain | `@deepseek-ai/dsh-storage-domain/lib/index.js:40-110,340-400` |
| volatile 提交 | `@deepseek-ai/cordis-plugin-loader/lib/index.js:378-428` |
| settings 校验 | `@deepseek-ai/dsh-settings/lib/index.js:419-538` |
| config-editor 写 patch | `@deepseek-ai/dsh-config-editor/lib/index.js:70-136` |
| client-modules 发现 | `@deepseek-ai/dsh-client-modules/lib/index.js:720-900` |
| configForms/whileServed | `@deepseek-ai/dsh-client-ui-settings/lib/client.js:1081-1338` |
| plugins.item 两态 + ownerProps | `@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js:2682-2751,3834-3841` |
| 插件开发官方文档 | `dsh-agent-preset/skills/cordis-plugin-development/{SKILL.md,references/*}` |
| Loader patch 方言 | `dsh-agent-preset/skills/cordis-composition-reference/SKILL.md` |

### 12.3 本仓库内的深挖笔记（本次生成，非交付物）

- `.guide-work/dsh-concepts.md`（888 行，A–I + 源码速查，38 条机制核查表）
- `.guide-work/host-code-map.md`（713 行，逐文件走读 + 偏差清单）
- `.guide-work/ui-code-map.md`（684 行，client 装载/保存链路/契约风险）

> 最后提醒：面试时**先讲你确认过的事实**（代码行号/源码机制），再讲设计意图；`DESIGN.md` 里的"尚未实现"不要当成已实现讲。这份指南里的每条行号都可回到文件核对。
