# dsh / Cordis 概念参考（源码核验版）

> 面向《Notix×dsh 代码指南》作者面试准备。本文以 **dsh 0.2.1-rc.2 打包产物源码**为准，独立核验 DESIGN.md §2 的机制声明；DESIGN.md 与官方 README 只作交叉参考。
>
> **记号**：`<asar>` = `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`。文中 `@deepseek-ai/xxx/lib/…:N` 的行号均指该 asar 内 `/dsh/node_modules/…` 下的打包产物（已抽取到 `.guide-work/src/dsh/node_modules/…`，可直接 read 复核）。中文文档在 `.guide-work/dsh-docs/dsh/node_modules/@deepseek-ai/<pkg>/README.zh.md`。
>
> **结论标记**：✅ 成立 ｜ ⚠️ 需修正/需补充 ｜ ❌ 不成立 ｜ ◻︎ 未验证
>
> 三条最容易被面试官追问、也最容易答错的结论先放这里：
> 1. **Cordis 事件不是 DOM 冒泡**。整个进程只有一棵事件总线（root `ctx.events`），"作用域"是**分发载体的过滤谓词**，`{global:true}` 只是绕过过滤器（§B.7）。
> 2. **`session/event` 是"已提交之后的观察通知"**，不是日志本身；日志类型词表只认 `KNOWN_SESSION_EVENT_TYPES`（62 种），事件先 `commit` 再通知（§C.1）。
> 3. **`volatile` 不是"热更新开关"，而是"把 Config 字段解析成引用（`Volatile<T>`）"**；`loader` 只对"仅 volatile 字段变化"走 `loader/volatile-update`，其余照样重挂载（§G）。

---

## A. 平台总览：进程、profile、bundle、patch 组合与安装

### A.1 启动链

`dsh` 是唯一的 Node 启动器，profile 是同一套安装的不同组合面（`web`/`headless`/`acp`/`sdk`/`sdk-minimal`，`desktop` 保留给 Electron 壳）。

证据：`.guide-work/dsh-docs/.../dsh/README.zh.md:19-27`（入口模式表）；`@deepseek-ai/dsh-app-boot/lib/index.js:508-549`：

```js
const PROFILES_DIR = "profiles";
const PROFILE_PATCH_FILENAME = "cordis.patch.yml";
function resolveProfileDir(name, home = resolveDshHome()) {
	if (name === "" || name.includes("/") || name === "\\" || name === "." || name === ".." || name === "node_modules") throw ...
	return join(home, PROFILES_DIR, name);
}
```

`$DSH_HOME` 优先级：显式配置 > `$DSH_HOME` > `~/.dsh`（`.guide-work/dsh-docs/.../dsh-home-paths/README.zh.md:35-40`，源码 `@deepseek-ai/dsh-home-paths/lib/index.js:102-111`）。

启动路径（`boot()`，`@deepseek-ai/dsh-app-boot/lib/index.js`）：
1. `loadLayeredEnv` 载入 `.env`；2. `loadProfile`/`loadProfileDirectory` 解析 profile manifest 与 bundle 层；3. `prepareProfilePatches` 在**挂载根 Include 时**组合出启动器自己的副本，并做导入前兼容性预检（被拒绝的行永不 import）；4. 挂载根 `cordis:include`（`mountRootInclude`）；5. Loader 按 entry 启动插件；6. 结算 required entry、输出诊断。

> 面试点：兼容性检查发生在**启动器的组合副本**里（把不兼容行改成 `disabled: true` / 跳过 bundle），不改写 profile 的 patch、依赖清单与 bundle 列表；精确版本豁免存在 profile 自己的 `compatibility.json`（`dsh-app-boot/README.zh.md` 的 "Profile" 段）。

### A.2 patch 层组合顺序（权威实现）

`readProfilePatches()` 是所有组合视角（boot、`--dump-config`、config-editor）唯一入口，顺序写死在源码里：

`@deepseek-ai/dsh-app-boot/lib/index.js:1115-1140`：

```js
function readProfilePatches(binName, context, initialProfile) {
	const patches = structuredClone([
		...readBundlePatches(binName, context, initialProfile),      // ① dsh.profile.bundles 顺序
		...initialProfile?.patches ?? loadOptionalPatches(...),      // ② profile 自己的 cordis.patch.yml
		...loadOptionalPatches(binName, join(context.home, "cordis.patch.yml")) ?? [], // ③ home 级
		...context.overlays                                          // ④ --patch（可重复）
	]);
	... // ⑤ 遥测关闭 patch 追加在最后
}
```

结论：**bundle 层（按 `dsh.profile.bundles` 顺序）→ profile patch → home patch → `--patch` overlays（后者胜）**，最后可能追加一条 telemetry disable patch。DESIGN §2.2 的顺序 ✅。

`dsh --patch` 是启动器自己的 flag（可重复），之后所有 token 才交给 profile 应用（`@deepseek-ai/dsh/lib/bin.js:28-29,106`：`--patch <path>` "extra patch-list overlay applied after the profile layer (repeatable)"）。

### A.3 patch 语义

`applyEntryPatches()` 是"THE patch semantics"（挂载与 `--dump-config` 共用，因此 dump 不会漂移）：

`@deepseek-ai/dsh-app-boot/lib/index.js:62-123` 摘要：
- 非 `insert` patch：按 `id` 找行，**整体替换**该行声明的顶层字段（`for (const [key,value] of Object.entries(overrides)) target[key]=value`）——所以补 `config` 必须重述所有要保留的键；
- `insert` 无 `id`：追加到根列表；带 `id`：目标必须是 group（`config` 是数组），追加进 `config`；
- 同一列表里后一个 patch 可以命中前一个 patch 插入的行（边插边建索引）；
- `name` 不匹配则跳过并 warn；未命中一律 warn 不报错（一份 overlay 可跨多个树复用）。

`insert` 的 `name` 可以是包名、绝对路径、`file:` URL；patch 解析时会把**相对 patch 文件**的 `./`/`../`/绝对路径转成 file URL（`loadOverlayPatches` → `anchorInsertedPluginNames`，`dsh-app-boot/lib/index.js:3962-3980`）。DESIGN 的 `dev/notix.patch.yml` 用绝对路径正是这个原因。

### A.4 bundle 声明

`dsh.bundle.patch` 是**一个路径或一个有序路径列表**（同属一个 bundle 层，按列表顺序拼接）：

`@deepseek-ai/dsh-app-boot/lib/index.js:518-532`：

```js
function bundlePatchFiles(bundle) {
	const declared = typeof bundle.patch === "string" ? [bundle.patch] : bundle.patch;
	if (!Array.isArray(declared) || !declared.every((file) => typeof file === "string")) throw new Error("dsh.bundle.patch must be a file path or a list of file paths");
	return declared;
}
```

真实例子：`@deepseek-ai/dsh-web-app/package.json` 的 `dsh.bundle.patch` 是 5 个文件（`cordis.patch.yml` + `presets/{standard,ptc,minimal,cordis}.patch.yml`）；`@deepseek-ai/dsh-base` 是单文件。

### A.5 安装流程（`dsh plugin` / Web Plugins 页 / plugin_manager 工具）

CLI 入口 `dsh plugin --profile <name> <pnpm args…>`（`@deepseek-ai/dsh/lib/bin.js:46`，`@deepseek-ai/dsh/lib/plugin-*.js`）：在 profile 目录的 `package.json` 文件锁内转发给 pnpm（`runPluginCommand`，`@deepseek-ai/dsh-plugin-manager/lib/types/operations.js:591-604`）。

安装后有一次 **bundle 对账**（`operations.js:94-125`）：

```js
for (const name of dependencies) {
	if (beforeDeps.has(name)) continue;
	const metadata = bundleManifest(name, dir, anchor);
	if (metadata?.dsh?.bundle === undefined) {
		options.onOutput?.(`dsh: warning: ${name} declares no dsh.bundle — installed as a plain dependency, not a profile layer\n`, 'stderr');
		continue;
	}
	...
	if (!bundles.includes(name)) bundles.push(name);   // 按安装顺序追加到末尾
}
```

结论：
- **新装且声明了 `dsh.bundle` 的包**按安装顺序 append 到 `dsh.profile.bundles`（末尾优先级最高）；
- **没有 `dsh.bundle` 的包只是普通依赖**，不成为 layer（但可以被某个 bundle patch 的 `insert` 行引用——见 §F.7）；
- 兼容性由 app-boot/plugin-manager 统一检查：声明 `engines.dsh` 时只看该范围，否则逐条匹配 `peerDependencies` 中 `@deepseek-ai/dsh*`（`dsh-app-boot/README.zh.md` Profile 段；`evaluatePluginCompatibility`、`readProfileVersionExemptions` 导出）。
- HMR 开时重载即时生效（`reconcileProfilePatches` + `recomposeProfile`），未开需重启（`@deepseek-ai/dsh-hmr/README.zh.md`）。

### A.6 一个 Host bundle 的完整文件面（Notix 实例）

`packages/notix-dsh/package.json`：`exports["."]` → `lib/index.js`，`exports["./cordis.patch.yml"]`、`exports["./locale/*.json"]`，`dsh.bundle.patch: "./cordis.patch.yml"`，`engines.dsh`，`peerDependencies["@deepseek-ai/cordis"]`，`icon`。`cordis.patch.yml`：

```yaml
- insert:
    - id: notix
      name: notix-dsh
      config: { ...shipped defaults... }
```

Loader 用 `entry.options.name` 走 Node 解析（profile 根 baseUrl），`unwrapExports` 后 `registry.plugin(plugin, config)`（`@deepseek-ai/cordis-plugin-loader/lib/index.js:449-465`）。

---

## B. Cordis 运行时概念

> 源码：`@deepseek-ai/cordis/lib/index.js`（1829 行，打包产物保留注释）。以下行号可直接核对。

### B.1 Context：树、代理、单例服务

- 根上下文构造时安装内建服务：`this.reflect / registry / events / logger`，并把 `self` 交回代理（`:1679-1692`）。
- `ctx.events` **在整个 root 树里是同一个 EventsService 实例**（子 ctx 通过服务解析拿到同一个），所以事件总线是进程级单例——这是理解 §B.7 的前提。
- `extend(props)`/`isolate(name,label)`/`intercept(name,config)` 派生子上下文；`ctx.get(name, strict=true)` 只返回**提供者 fiber 处于 active（state===2）** 的服务值（`:762-775`）。

### B.2 Service：`super(ctx, name)` 即"注册 + 绑定 fiber 生命周期"

`@deepseek-ai/cordis/lib/index.js:1771-1790`：

```js
constructor(ctx, name) {
	this.ctx = ctx;
	name ??= this.constructor["provide"];
	let self = this;
	...
	self.ctx.reflect.provide(name, self, this[symbols.check]);
	return self;     // 注意：构造函数 return 了代理对象
}
```

`ctx.reflect.provide(name, value, check)` 本身是一个 **fiber effect**：注册时写 `store`/`isolate` 表，disposer 里 `delete store` 并 `notify([name])` 让依赖方重新检查（`:800-825`）。因此：

- 服务随 fiber 卸载自动下线，**无需手写 dispose**；
- `notify` 会给依赖该服务的 fiber 做 `_checkImpl` + `_refresh`，这也是"服务后到、插件等待"的机制（inject 的运行时形态）。

`ctx.notix` 这类服务**不是**只能由 `Service` 子类提供：函数插件里 `ctx.provide('notix', core.api())` 等价（Notix 实现就这么做，`packages/notix-dsh/lib/index.js:65`）。

### B.3 插件形态与入口归一

`RegistryService.resolve()`（`:1534-1540`）：

```js
resolve(plugin) {
	try {
		if (typeof plugin === "function") return plugin;      // 函数插件 / class 插件（class 也是 function）
		if (isApplicable(plugin)) return plugin.apply;        // { name?, inject?, Config?, apply }
	} catch {}
}
```

真正的"函数 vs 类"分叉在 Fiber 执行器（`:1068-1073`）：

```js
execute: function() {
	if (isConstructor(runtime.callback)) {
		const instance = new runtime.callback(this.ctx, this.config);
		for (const hook of instance?.[symbols.initHooks] ?? []) hook();
		return instance?.[symbols.init]?.();
	} else return runtime.callback(this.ctx, this.config);
}
```

插件三形态（DESIGN §2.1 ✅）：
1. **函数** `(ctx, config) => void | disposer | promise | iterator`；
2. **对象** `{ name, inject, Config, apply(ctx, config) }`；
3. **类**（常 `extends Service`）：被 `new`，可返回实例（Service 构造函数已 return 代理）。

Loader 入口归一（`@deepseek-ai/cordis-plugin-loader/lib/index.js:668-674`）：

```js
unwrapExports(exports) {
	if (isNullable(exports)) return exports;
	exports = exports.default ?? exports;
	if (!exports.__esModule) return exports;
	return exports.default ?? exports;
}
```

> ⚠️ 与 DESIGN 的差异：DESIGN 写的"入口 `exports.default ?? exports`"只是第一层；实际还有 **`__esModule` 二次解包**。CJS/转译包的 `default.default` 也能被认出来。

Config 校验：`resolveConfig(runtime, config)` 用 Standard Schema（`runtime.Config["~standard"].validate`），异步校验直接 throw（`cordis/lib/index.js:958-966`）；`Fiber._resolveConfig` 先跑 `internal/config` waterfall 再校验（`:1346-1349`）。

### B.4 Fiber：effect、逆序清理、状态机

- 一个插件 = 一个 `Fiber`；`ctx.plugin()` 返回 fiber（带 `then`，可 `await` 到启动完成）。
- `fiber.effect(execute, label)` 的 `execute` 可返回：disposer 函数、Promise（解析成 disposer）、同步/异步 iterator（逐个 yield disposer）（`_execute`，`:1136-1170`）。Context 的 `ctx.effect`、`ctx.on`、`ctx.provide`、timer 全部落到这个机制上。
- **dispose 逆序**：`effect()` 内部 `for (const disposable of disposables.splice(0).reverse())`（`:1182-1193`）——所以 HMR 卸载时后注册的清理先跑。
- 已释放 fiber 上再 `ctx.on` → `INACTIVE_EFFECT`（`assertActive`，`:1150-1156`；`on` 里先断言 `:372-380`）。
- 状态：0 pending / 2 active / 3 failed / 4 disposed / 5 unloading（`_getState`，`:1289-1295`）；每次变化 emit `internal/status`。
- `fiber.update(config)` 先走 **`internal/update` waterfall**（HMR/宿主可 veto 或替换重启）再 restart（`:1425-1440`）——volatile 提交通道绕过的正是"重启"，但**不绕过** `internal/config` waterfall（§G.4）。

### B.5 inject：声明依赖、延迟启动、拦截配置

`Inject.resolve()` 接受数组或 name→config 映射，并从原型链合并（`:1477-1500`）。`ctx.inject(['a','b'], cb)` = `plugin({ inject, apply: cb })`（`RegistryService.inject`，`:1601-1607`）——服务不齐时 fiber 保持 pending，服务出现后由 `notify` 拉起。

> 重要细节：`inject` 的 value 不是"等服务就报错"，而是**进入 `Context.intercept`**（`Fiber` 构造器 `:1055-1063`），供服务自己 `resolveConfig(intercept, base, head)` 合并出"该消费方看到的配置"（如 logger 级别、client 行为开关）。这是"同一服务对不同 inject 方呈现不同 config"的机制。

### B.6 事件分发五模式（返回值/异常语义）

`@deepseek-ai/cordis/lib/index.js:220-330`：

| 模式 | 调度 | 返回 | 异常 | 典型用途 |
|---|---|---|---|---|
| `emit` | 同步，全部调用，**丢弃返回值**（不 await 返回的 promise） | `undefined` | 监听器同步 throw 会**中断后续监听器**（`Array.map` 语义） | 纯广播通知 |
| `parallel` | 全部并发，`Promise.allSettled` | `undefined`；有拒绝则 `AggregateError` | 不中断彼此 | 多持久化后端 flush |
| `serial` | 顺序 await，遇到 bail 值停 | 第一个 bail 值 | 抛错会中断 | 可短路但需异步 |
| `bail` | 同步顺序，遇到 bail 值停 | 第一个 bail 值 | 中断 | 同步"第一个应答者" |
| `waterfall` | 组合中间件，最后一个参数是内层 `next` | 最外层返回值 | 中断 | 请求拦截、answerer、pre-step |

`isBailed` 的定义（`:220-223`）——**只有 `null`/`false`/`undefined` 不算 bail**，所以 `bail` 监听器返回 `0`/`""` 也会短路：

```js
function isBailed(value) {
	return value !== null && value !== false && value !== void 0;
}
```

`waterfall` 的关键语义（`:318-330`）：`next()` 之后才轮到内层；**不调用 `next()` 就是否决**整条链（包括内建行为）。审批 answerer、`agent/request`、`user-questions/request`、`tools/pre-execute` 都是这个模式。

> `agent/error` 这类"广播"并不是直接用 `ctx.emit`：`dsh-agent` 的 `agentEvents.emit` 自己 `events.dispatch` 后**逐监听器 try/catch + Promise catch**，避免一个抛错监听器饿死后面的监听器（`@deepseek-ai/dsh-agent/lib/types/dispatch.js:41-60`）。同理 session 事件用 `invokeContainedSessionObservers`（§C.1）。

### B.7 作用域与 `{global:true}`：不是冒泡，是过滤器

机制链：
1. `EventsService._hooks[name]` 是**全局表**，每条记录带注册时的 `ctx`（`:372-388`）。
2. 分发时取 `thisArg`（emit 的第一个对象参数）作为"载体"，用 `thisArg[Context.filter]` 得到过滤器；**没有载体（thisArg 非对象）或过滤器为空 → 所有监听器都收到**（`:259-266`）。

```js
dispatch(type, args) {
	const thisArg = typeof args[0] === "object" || typeof args[0] === "function" ? args.shift() : null;
	const name = args.shift();
	...
	const filter = thisArg?.[Context.filter];
	return (this._hooks[name] || []).filter((hook) => hook.global || !filter || filter.call(thisArg, hook.ctx)).map(...);
}
```

3. `scopeTarget(base, key)` 构造载体，其谓词（`@deepseek-ai/dsh-scope/lib/index.js:328-340`）：

```js
const carrier = { [Context.filter](ctx) {
	if (baseFilter !== void 0 && !baseFilter.call(base, ctx)) return false;
	const tag = scopeOf(ctx);              // 监听器注册上下文的最近 scope 标签
	if (tag === void 0) return true;       // 无标签监听器：全局接收
	for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor))
		if (cursor === tag) return true;   // 标签是本键或祖先：接收
	return false;                          // 标签在下面：不接收
} };
```

由此得到四条可直接背下来的结论：
- **无 tag 的监听器全局接收**（插件通常挂在无 scope 的根 ctx 上，所以 `ctx.on('session/event', fn)` 本来就能收到所有会话）；
- **带 tag 的监听器"向上"接收**：自己 scope 与后代 scope 的事件；**事件从不向下流**；
- **`{global:true}` 绕过过滤器**（`hook.global || !filter || …`），因此即使插件被挂在某个 agent scope 下也不会漏事件；
- 若分发方本身**无 key**（如 sessions 服务 ctx 未 scope 时 `scopeTarget(session, undefined)`），带 tag 的监听器**一个都收不到**，只有无 tag 或 `global:true` 能收到。

> 所以 DESIGN 里"子上下文事件向上冒泡，`ctx.on(..., {global:true})` 观察全部"——**行为结论对，机制描述错**：不存在逐级冒泡，只有一次全局 dispatch + 一次过滤；`global:true` 也不是"穿透冒泡"，而是**跳过过滤**。

### B.8 谁在什么载体上发事件（决定 `global` 是否必要）

| 事件族 | 分发方式 | 载体 | 无 tag 监听器可见？ |
|---|---|---|---|
| `session/*`（created/disposed/flush/event） | `ctx.events.dispatch('emit', [carrier, name, ...])` | `scopeTarget(session, scopeOf(sessions.ctx))`（sessions 服务 ctx 通常无 scope → key=`undefined`） | ✅（session 事件在所有会话可见） |
| `agent/*` | `agentEvents(ctx, agent)` | `scopeTarget(agent, agent)` | ✅（无 tag 全局；带 agent scope 的只收自己） |
| `tools/*` | `dispatch('emit'/'waterfall', [scopeTarget(this, exec.agent), name, ...])` | agent 载体 | ✅ |
| `approval/request` | `ctx.waterfall(scopeTarget(req.agent, req.agent), …)` | agent 载体 | ✅ |
| `user-questions/request` | 无 agent 时直接 `ctx.waterfall`；有 agent 时 scopeTarget | 视调用 | ✅ |
| `loader/*`、`domain/changed`、`settings/document-updated`、`internal/*` | 普通 `emit` / `waterfall` | 无载体或专用派生 ctx | ✅（`loader/volatile-update` 例外，见 G.4） |

---

## C. 事件面目录

### C.1 两套词表：session log（持久化）vs Cordis 事件（运行时）

- **Session 事件**：`session.append(type, data, opts?)` 构造候选 → 校验/冻结 → `commit()` 入 log（`log.push`）→ 通知 `session/event` 观察者。顺序是"先提交、后通知"，且**通知失败不影响已提交事实**：

`@deepseek-ai/dsh-session/lib/index.js:1576-1600`（`commit`）：

```js
const callbackArgs = [this, event];
if (entry !== void 0) callbacks = collectSessionCallbacks(entry.emitCtx, [entry.carrier, "session/event", ...callbackArgs]);
this.log.push(event);            // 先入日志
this.eventsSnapshot = void 0;
if (callbacks !== void 0 && entry !== void 0) invokeContainedSessionObservers(entry.emitCtx, "session/event", entry.id, callbackArgs, callbacks);
```

`invokeContainedSessionObservers` 逐监听器 try/catch 并把 rejected promise 记 warn（`:1232-1243`）。因此 **`session/event` 是"已持久化事实的只读观察流"**，插件在这个回调里 `session.append` 会命中"append 不可重入"保护（`publicationEntry()`，`:1566-1575`）。

- **Session 词表**：`@deepseek-ai/dsh-session/lib/types/known-event-types.js:21-84`，`KNOWN_SESSION_EVENT_TYPES` 共 **62** 种。读路径遇到未知类型且无 `ignorable: true` 信封会**拒绝重建**（该文件头注释 `:7-19`）——这是 DESIGN"零侵入日志"的技术根据。

- **Cordis 事件**：不进入 log，无持久化，进程内观察；见 §C.4。

### C.2 持久化 session 事件类型表（62 种，按域分组）

来源：`known-event-types.js:21-84`（全部）；关键 payload 来自各 append 点。

| 域 | 类型 | payload 要点 | 模型可见？ |
|---|---|---|---|
| 审批 | `approval/asked` | `{id, toolName, callId?, reason?}` | 否（审计） |
| | `approval/decided` | `{id, outcome}`，outcome ∈ `allowed-once\|rejected\|cancelled\|unavailable` | 否 |
| | `approval/policy` | `{policy}`（ask/never 会话快照） | 经运行时上下文间接 |
| 轮次 | `turn/start` | `{turn}` | 否 |
| | `turn/end` | `{turn, reason}`（见 C.3） | 否 |
| | `step/start` / `step/end` | `{turn, step}` | 否 |
| 工具 | `tool/call` | `{turn, step, callId, name, arguments}` | 否（派生出调用块） |
| | `tool/result` | `{turn, step, message, error?, meta?}`，**`error` 是 `{name, code}`** | 是（surface） |
| | `tool/ptc-dispatch(-start)` | PTC 子调用记录 | 否 |
| 消息 | `system/message` `developer/message` `user/message` `assistant/message` `tool/result` | 五个 **surface 事件**，必须带 `surfaceOp` | 是 |
| | `assistant/attempt` | 失败/重试/取消的 attempt（无模型历史） | 否 |
| | `request/header` / `request/context` | 请求封装快照 / 路由元数据 | 否（重建用） |
| 后台任务 | `job/registered` | `{jobId, owner, kind, label, startedAt, toolCall?}` | 否 |
| | `job/settled` | 上述 + `{finishedAt, status, cause, producerReported, detail?}` | 否 |
| LLM | `llm/retry` | `{retryId, turn, step, provider, mode, policyKey, retry, delayMs, failure}`（**延迟前**记录） | 否 |
| | `llm/retry-started` | `{retryId, turn, step, retry}`（延迟结束、真正重试前） | 否 |
| 会话管理 | `session/title`、`session/end-seed`、`session/title-llm-request`、`model/selection`、`schedule/change`、`goal/change`、`todo/write`、`plan/mode`、`permission/preset`、`sandbox/mode`、`working-directory/change`、`workspace/changes`、`deliverables/presented`、`hook/invoked|result`、`command/run|done`、`compaction/*`、`agent-preset/selected`、`agent/inbox/spliced`、`subagent/*`、`team/*`、`feedback/*`、`image/offload`、`session-log-deepseek/delivery-accepted`、`web/deepseek-search-llm-request`、`tool-workflow/*`、`agent-preset/*` | 各域自述 | 多数否 |

模型可见面由 `SURFACE_EVENT_TYPES` 固定（`@deepseek-ai/dsh-session/lib/index.js:139-145`）：

```js
const SURFACE_EVENT_TYPES = new Set([
	"system/message", "developer/message", "user/message", "assistant/message", "tool/result"
]);
```

`MESSAGE_PROJECTION_EVENT_TYPES` 目前只有 `image/offload`（`known-event-types.js:86-88`）——需要"插件解释模型可见内容"的事件必须注册纯投影器（`sessions.registerMessageProjection`）。

### C.3 关键事件细节（核验后）

**approval**（`@deepseek-ai/dsh-user-approval/lib/index.js:129-146`）：

```js
session.append("approval/asked", { id, toolName: req.toolName, ...(req.callId!==void 0?{callId:req.callId}:{}), ...(req.reason!==void 0?{reason:req.reason}:{}) });
const outcome = await this.decide(req, session);
session.append("approval/decided", { id, outcome });
```

约束：请求**必须处于未结束的 turn 内**（否则在审计前 throw，`:131`）；outcome 词表见 `:31-36`。answerer 是 `approval/request` waterfall（`:177`）。

**turn/end 的 reason 词表**（`@deepseek-ai/dsh-agent-loop/lib/index.js:946-1035`）：
- `{kind:'completed'}`：step 返回 completed 且无后续；
- `{kind:'blocked'}`：`agent/pre-step` waterfall 返回 `{kind:'reject'}`；
- `{kind:'max-tokens'}`：模型 finish=max-tokens；
- `{kind:'aborted', reason}`：`reason` 来自取消原因，`{kind:'user'|'parent'|'disposed'}` 或 `{kind:'hook', reason}`（`:732-747`）；
- `{kind:'error', error:{message, code}}`：`LlmError` 取 `.failure`，否则 `{message: errorChain(e), code:'UNKNOWN'}`。

`turn/end` 写在 `finally` 里（`:1028-1032`），除非 append 自身失败否则必发。`step/end` 同样 finally（`:993-998`）。

**agent/error**（`@deepseek-ai/dsh-agent-loop/lib/index.js:877-886`）：

```js
throwError(error) {
	const turn = this.phase.kind === "running" ? this.phase.turn : this.phase.lastTurn;
	const step = this.phase.kind === "running" ? this.phase.step : 0;
	this.dispatch.emit("agent/error", { turn, step, error });
	throw error;
}
```

载体把 `agent` 注入 payload（`dispatch.js:36-40`），所以监听器拿到 `{agent, turn, step, error}`。是 Cordis 事件（不持久化），语义"先通知、再抛"。

**tool/result**（`@deepseek-ai/dsh-agent-loop/lib/index.js:692-707`）：

```js
session.append("tool/result", { turn, step, message, ...(result.error?.info ? { error: result.error.info } : {}), ...(result.meta !== void 0 ? { meta: result.meta } : {}) }, { surfaceOp: "append", sourceEventSeqs: [callSeq] });
```

⚠️ **DESIGN §2.3 的 `error: {message, info:{name,code}}` 是错的**：工具执行结果的原始对象是 `{message, isError, error:{message, info?:{name,code}}}`（`@deepseek-ai/dsh-tools/lib/index.js:3716-3726`），但**写进 session 事件时只保留 `error.info`**，即 `data.error = {name, code}`；人类可读错误在 `message.content[0].text`。Notix 的 error trigger 读 `info.code/info.name` 是对的，但读 `info.message` 永远是 undefined（次要 bug）。

**LLM 重试**（`@deepseek-ai/dsh-llm-retry/lib/types/index.js:129-135`）：先 `llm/retry`（含 delay/failure），`await cancellableDelay` 后 `llm/retry-started`。做"重试风暴"窗口统计应数 `llm/retry-started`（真正发生的重试），而不是 `llm/retry`（可能被取消）。

**job 持久化事实**（`@deepseek-ai/dsh-jobs-local/lib/index.js:605-626`）：`recordSessionEvent` 在 `settle()` 内**先写 `job/settled`，再向事件流广播 `settled`**；`job/registered` 只有 owner（agent）存在时才写。

### C.4 Cordis 事件表（非持久化，运行时观察面）

| 事件 | 模式 | 触发点/含义 |
|---|---|---|
| `session/created` / `session/disposed` / `session/flush` | emit / emit / parallel-ish | store 生命周期；`flush` 是等待所有持久化 listener 的 durability checkpoint |
| `session/event` | emit（contained） | 每个已提交 session 事件后一条 |
| `agent/created` / `agent/disposed` | serial / emit | agent 生命周期 |
| `agent/status` | emit | `{status: 'idle'\|'running'}` 变化 |
| `agent/error` | emit（contained） | 见 C.3 |
| `agent/inbox/*`、`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping`、`agent/assistant-stream` | waterfall/serial/emit | 循环扩展点；`agent/request` 决定下一次请求的 provider/model |
| `tools/pre-execute`、`tools/execute`、`tools/post-execute`、`tools/result`、`tools/change` | waterfall/emit | 工具管线；`tools/result` 是"观察结果"，args = `(exec, result)` |
| `approval/request` | waterfall | 审批 answerer；无 answerer → `unavailable` |
| `user-questions/request` | waterfall | 提问 answerer；无 answerer 走超时/继续 |
| `internal/config`、`internal/update`、`internal/plugin`、`internal/status`、`internal/dispatch`、`internal/listener`、`internal/service` | waterfall/bail/emit | Cordis 内建生命周期 |
| `loader/volatile-update`（+ `loader/partial-dispose`、`loader/patch-context`、`loader/entry-init`、`loader/config-update`） | emit | volatile 配置提交；**只投递给 owner fiber** |
| `hmr/change`、`hmr/reload` | emit | HMR |
| `domain/changed` | emit | storageDomain 写后通知 |
| `settings/document-updated` | emit | 设置文档 revision 变化 |
| `plugin-manager/changed`、`plugin-manager/install-log`、`plugin-manager/install-state` | emit/stream | 插件管理 |
| `app-boot/config-reload` | emit | 一次成功重载结算后（不带 diff） |

---

## D. 投影（sessionProjections）

### D.1 服务与单元契约

`ctx.sessionProjections`（`@deepseek-ai/dsh-session-projection/lib/index.js:52` 起）：把"日志派生状态"注册成**单元（unit）**，主动驱动，读快照/订阅变更。

```js
register(definition)   // key + stateSchema + stateVersion + init(header, inheritedEventCount) + apply(state,event) + 可选 wire{viewSchema,view}
onChanged(listener)    // listener(session, key, wireView, seq)，只对 client-visible 单元、只在该单元 wire 结果 Object.is 变化时触发
stateOf(session, key)  // host 状态（stateSchema 形状），不产出 wire view
snapshot(session, keys?)// { asOfSeq, values }，同步一致切面
cachedSnapshot(...)    // 只读已物化 cell 的"提示"视图
checkpoint(session)    // {key: {ver, seq, val}}，供 projection-cache 持久化
restoreFloor/restore   // 冷读恢复
```

证据：
- `register` 是 **effect**（随注册方 fiber 卸载；同 key 多注册共享一个 unit，最后一个卸载才删 key）：`dsh/index.js:69-104`；
- `onChanged` 的注册也是 effect，返回的 disposer 只是 `() => void dispose()`（`:110-118`）；
- `stateOf` 返回 `cell.state`（**host state**，含 `stateSchema` 全部字段），`snapshot` 只输出带 `wire` 的单元并对值跑 `viewSchema.parse`（`:127-160`）。

### D.2 驱动语义（为什么它天然"当前"）

`drive(session, event)`（`@deepseek-ai/dsh-session-projection/lib/index.js:400-425`）：
1. 每个已提交事件按注册顺序过每个 unit 的 `apply`；
2. **第一道闸**：`Object.is(next, previousState)` 不变 → 完全不算 view；
3. **第二道闸**：wire 原始 view 与上一帧 `Object.is` 相同 → 不通知；
4. 有变化才 `viewSchema.parse` 并调用所有 `onChanged` 监听器（4 参）。

纪律：`apply` 必须**同步且纯**，无关事件必须返回同一个 state 引用；unit state 只活在内存（重启后首次触达时折叠日志，或由 `session-projection-cache` 播种）。

> 面试点：`onChanged` 只服务 **client-visible（有 wire）** 单元；host-only 单元（如 `titleInput`）只能 `stateOf`。DESIGN 里"diff 前后快照"是客户端视角的近似说法，真正的驱动在 Host。

### D.3 `userQuestions` 单元（Notix T2 的事实基础）

定义：`@deepseek-ai/dsh-user-questions/lib/index.js:268-293`，`stateVersion: 2`，`key: "userQuestions"`。

```js
stateSchema: z.object({
	inheritedEventCount, timed: z.boolean(),
	questions: z.object({ active: pendingQuestionsSchema, settled: settledQuestionsSchema }).strict(),
}).strict(),
wire: { viewSchema: projectionViewSchema, view: (state) => state.questions },
```

- `state` 枚举：**`open` | `continued`**（`dsh-user-questions/lib/types/projection.js:51-53`）——DESIGN 的修正记录 ✅。
- `active[]` 项：`{callId, questions[], state}`；`question = {id, question, detail?, header?, options?[{label,description?}], multiSelect?}`；`settled[] = {callId, answers[]}`。
- **只有 timed 变体被跟踪**：`apply` 先看 `request/header` 里 `ask_user_question` 的工具 schema 是否声明了 `timeout` 参数（`TIMED_WAIT_PARAMETER`，`dsh-user-questions/lib/index.js:9-15, 173-186`）。blocking（旧）schema 的提问**永远不进投影**——这是 DESIGN 没写、但会直接影响 T2 覆盖率的机制事实。
- `open → continued` 的触发：`tool/result` 的 pending payload 或崩溃修复写回的 `TOOL_OUTCOME_UNKNOWN`（`:222-231`）；PTC 子调用 pending 直接进 `continued`（`:240-255`）。
- 120s 默认值不在投影里，而在 `ask_user_question` 工具：`registerTimedAskUser(ctx, timeout = 120)`（`@deepseek-ai/dsh-tool-ask-user/lib/index.js:65`），schema `timeout` 默认 120（`:214`）。
- `stateOf()` 与 `onChanged` 形状不同：`stateOf(s, 'userQuestions')` → `{inheritedEventCount, timed, questions:{active,settled}}`；`onChanged` 的第 3 参 → **wire view** `{active, settled}`。⚠️ Notix `questions.js` 的 seed 路径写 `state?.active`（应为 `state?.questions?.active`），导致重启后 seed 永远为空（`packages/notix-dsh/lib/triggers/questions.js:10-15`）。

### D.4 投影 vs session 事件（一句话区分）

| | session 事件 | 投影 |
|---|---|---|
| 本质 | 不可变、追加、可持久化的**事实** | 从事实折叠出的**当前值**（可重建缓存） |
| 粒度 | 每事实一条，含历史 | 每会话每 key 一份全量状态 |
| 跨会话 | 每条属于一个 session | key 表是**进程级**；key 存在 ≠ 该会话有该能力（README 限制） |
| 消费者 | Host 插件（日志/持久化/审计） | Client 载具/UI（`asOfSeq` 对齐历史切面） |
| 模型可见 | 只有 surface 事件经派生进入模型 | 从不可见（README "模型体验：无"） |

---

## E. 服务清单（签名 + 行为边界）

### E.1 `ctx.sessions`（`@deepseek-ai/dsh-session`）

- `create(sessionId, {meta, seed?})` / `get(id)` / `list()` / `fork(source, boundary?, childId?)` / `flush(session)` / `prepare`+`enter`+`announce`（跨包原语）。
- `session.append(type, data, opts?)`：同步快照冻结 → JSON 无损校验 → 入 log → `session/event`；surface 事件必须带 `surfaceOp`（`'append'` 或 `{op:'replace',startSeq,endSeq}`）。
- `session.deriveMessages()`：把日志投影成模型历史（增量缓存）。
- **边界**：`session/event` 回调内不可再 append（不可重入）；`fork` 只接受 live 源会话；`flush` 是所有持久化 listener 的 durability barrier。

### E.2 `ctx.sessionProjections` — 见 §D。

### E.3 `ctx.agents`（`@deepseek-ai/dsh-agent`）

- `create(options)` / `resume(...)` / `get(id)` / `list()` / `roots()` / `isOwnedBy(id, parent)`；返回/接受 `Agent` 与 `AgentHandle`。
- `Agent` 暴露 `session`、`ctx`（agent scope）、`followup()`（排下一轮并唤醒）、`steer()`（下一步输入并唤醒）、`inject()`（只加下一步上下文、不唤醒）、`cancel(cause, {keepInbox?})`、`whenIdle()`、`status`（`dsh-agent/README.zh.md:48-68, 176-178`；`AgentRegistry.get` 返回裸 Agent，`:597-600`）。
- ⚠️ **Agent 上没有 `title` 字段**。会话标题来自 `dsh-session-title` 注册的投影单元 `title`（client-visible）与 `titleInput`（host-only）：`ctx.sessionProjections.stateOf(session,'title')`（`dsh-session-title/README.zh.md:62`）。Notix 的 `core.sessionTitle()` 用的正是这条路径。

### E.4 `ctx.jobs`（`@deepseek-ai/dsh-jobs` + `dsh-jobs-local`）

- 实现（`dsh-jobs-local`）签名：`list(caller)` / `get(id, caller)` / `read(id, caller)` / `readAt(id, from, caller)` / `wait(id, timeoutMs, caller, signal)` / `kill(id, caller, reason)` / `remove(id, caller)` / `start(spec)`（`dsh-jobs-local/lib/index.js:504-530`）；省略 caller 时只能访问无主 job，`readAt` 是**非消耗**读取（`read` 才推进模型游标）。
- 事件流：`ctx.jobs.events.subscribe(filter, listener)`，filter 三态：
  - `{ owner: sessionId }`：只看某 owner；
  - `{ owners: 'all' }`：所有 owner；
  - `{ owners: 'scope' }`：按注册上下文的 scope 层收（下游 agent 组合）。
- `JobEvent` 类型：`registered | progress | stopping | settled | removed | output`；`settled` 携带 `{job, cause, awaited}`（`dsh-jobs-local/lib/index.js:35-90, 770-798`）。
- **边界/坑**：`JobEventHub.subscribe(ctx=registrar,…)` 的 `ctx` 是 **registry 服务自己的 ctx**，所以订阅 effect 的寿命跟随服务而非调用方 plugin fiber（`dsh-jobs-local/lib/index.js:409-412, 54-66`）；`settled` 在释放所有 waiter **之后**广播，`awaited` 表示是否真的释放了一个等待者。

### E.5 `ctx.storageDomain`（`@deepseek-ai/dsh-storage-domain`）

- 声明：`defineDomain({name, version, tables:{t: domainTable(zodSchema)}, global?})`（模块加载期校验 name/版本/global 不接受 null）。
- 打开：`const domain = await ctx.storageDomain.open(spec)`；`domain.table('t')` 得到句柄：`get(key)` / `entries()` / `keys()` / `size` / `put(key,val)` / `delete(key)` / `update(key, fn)` / `close()`。
- **同步读、落盘写**：读直接内存；每次写排队到 domain 单写链，**先等后端持久化，再改内存，再 emit `domain/changed`**（`lib/index.js:95-110, 236-290`）；被拒绝的写不污染内存。
- `domain/changed` payload：`{domain, table, key, operation:'put'|'deleted', value?}`；监听器异常被隔离（`:211-220`）。
- **对模型不可见**：不添加工具/提示词/session 事件（README 概述）；Notix 的 `notix` domain（`packages/notix-dsh/lib/core/store.js:26-38`）正是利用这一点。
- 失败码：`already-open / backend-not-found / facet-unsupported / invalid-record / missing-key / closed`。调用方自己 `close()`（或作为 `ctx.effect` 清理）。

### E.6 `ctx.timer`（`@deepseek-ai/cordis-plugin-timer`）

- `ctx.timeout(cb, ms) → disposer`；`ctx.timeout(ms) → Promise`（dispose 时 reject "Context has been disposed"）；`ctx.interval` 同理；`throttle` / `debounce`。
- `ctx.setTimeout/ctx.setInterval` 是 **deprecated 别名**（`lib/index.js:17-25`）。
- 全部走 `ctx.effect`，随 fiber 逆序清理——这是"HMR/卸载无残留定时器"的机制保证。

### E.7 `ctx.settings` / `ctx.configEditor`

- `settings.describe(options?)`：遍历 `configEditor.configuration()`，**只保留** `entry.fiber` 存在且 `state===2`、有 schemastery `Config`、且 `volatileForm(schema) !== undefined` 的 entry。返回 `{autoGenerate, ns, schema, revision, applies:'live', value, base, user, secrets?}`（`@deepseek-ai/dsh-settings/lib/index.js:414-461`）。
- 写：`update(ns, patch, expectedRevision)` / `replace(ns, section, rev)` / `mutate(ns, ops, rev)`；写入前把整份候选按插件完整 Config 校验，且逐路径要求 `isVolatilePath`（`:487-540`）——**非 volatile 路径直接 throw**。
- `settings.documentPath` / `prepareDocument()` → `configEditor.documentPath`。
- `configEditor.edit(entry, change)`：apply 外部变更 → 拿 `internal/config` waterfall + `resolveConfig` 校验 → 读写 profile patch（保留注释与 `!!js`）→ 用 `reconcileProfilePatches` 走**普通 Loader 重载路径**；与 HMR 用 `hmr.runExclusive` 串行；失败回滚文件（`@deepseek-ai/dsh-config-editor/lib/index.js:70-136`）。

### E.8 审批/提问 seam（不是服务调用，是 waterfall）

- `ctx.approval.request(req)`：内部 `ctx.waterfall(scopeTarget(agent,agent), 'approval/request', req, () => Promise.resolve('unavailable'))`；返回非词表值归一为 `unavailable`（fail closed）（`dsh-user-approval/lib/index.js:177`）。
- `ctx.userQuestions`：`user-questions/request` waterfall；返回 `{kind:'answer'…}` 或继续等待；`askTimed(request, callId, timeoutMs)` 带 120s 默认（工具侧）。
- **插件若注册 answerer 就不再是"观察者"**：这是 Notix 明确不做的边界。

### E.9 "不可见性"边界速查

| 机制 | 会进模型上下文？ | 依据 |
|---|---|---|
| `storageDomain` | 不会 | `dsh-storage-domain/lib/index.js` 无 session/tools 接触；README 明示 |
| `sessionProjections`（host 状态） | 不会 | README "模型体验：无" |
| session 事件（非 surface） | 不会直接进，只能被插件解释 | `SURFACE_EVENT_TYPES` 白名单 |
| Cordis 事件 | 不会 | 进程内总线 |
| `settings` 配置值 | **间接**（被插件读取后影响行为） | settings README "通过面向模型的插件读取的配置值间接影响模型" |

---

## F. Host 插件 vs Client 插件

### F.1 两套声明，两个入口

| | Host 插件 | Client 插件 |
|---|---|---|
| package.json 声明 | `dsh.bundle.patch`（成为 profile layer） | `dsh.client: { platform: 'web', inject?: string[], external?: string[], immediately?: boolean }` |
| 入口 | `exports["."]` → 插件模块 | `exports["./client"]` → `lib/client.js` |
| 运行环境 | Node/Host Cordis 树 | 浏览器 Cordis 树（`window.__ModuleLoader__`） |
| 发现方式 | profile bundles → patch → Loader row → import | Host 半侧扫描**已启用的 Loader 行**，读该包 `package.json` 的 `dsh.client` |
| 入口契约 | 插件三形态 + `Config`/`inject` | bundle 只注册 factory；导出 `apply(ctx)`、`inject = [...]`（Cordis 服务名） |

真实声明（`@deepseek-ai/dsh-client-ui-settings-agent-loop/package.json`）：

```json
"exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./locale/*.json": "./locale/*.json" },
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-plugin-manager"], "platform": "web" } }
```

> ⚠️ 两个 `inject` 语义不同：`dsh.client.inject` 是**浏览器模块图的加载顺序依赖**（包名列表，`dsh-client-modules` 用 `external`/`inject` 排拓扑）；client bundle 里 `export const inject = ['slots','locale','configForms']` 才是 **Cordis 服务依赖**。

### F.2 发现与装载链（关键源码）

`@deepseek-ai/dsh-client-modules/lib/index.js`：
- Host 半侧是普通 Node 插件，`static inject = ["loader"]`（`:514`）；
- 每个 `internal/plugin` 事件把 entry 名标脏，微任务 flush 与 `ctx.loader.entries()` 对账（`:852-878`）；
- `resolveMeta()` 读包 `package.json`：`parseDshClient(pkg.dsh.client)` → `platform !== 'web'` 直接忽略 → `clientExportOf(pkg.exports)` 解析 `./client` → 得到 `clientPath/inject/external/immediately`（`:720-756`）；
- `locatePkgJson()` 用 Loader 的解析器（含 ESM hooks）定位包的最近 `package.json`（`:762-800`）；
- 同一包被多个 active Loader source 解析 → **throw**（"resolves from multiple active Loader sources"，`:890-900`）。

因此：**只要某插件包在 Loader 里有一行且该包声明了 `dsh.client`，它的浏览器半侧就会被组合进 `window.__DSH_BOOT__` 并 lazy load**；Host 半侧可以是空 `apply()`（官方 `dsh-client-ui-*` 全部如此，见 `@deepseek-ai/dsh-client-ui-settings-agent-loop/lib/index.js` 的注释与空 apply）。

`dsh-web-app/cordis.patch.yml:43` 的注释直接写明这一契约：

```
# `dsh.client` rows are the browser roster the modules node half scans into
# window.__DSH_BOOT__; the modules row is simultaneously a host row.
```

### F.3 Client 入口契约（官方先例，完整可抄）

`@deepseek-ai/dsh-client-ui-settings-agent-loop/lib/client.js:137-172`：

```js
const inject = ["slots", "locale", "configForms"];
function apply(ctx) {
	const t = ctx.locale.bind(NS);
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), "…: dictionaries");
	const card = new AgentLoopCardController(ctx.configForms.get("agent-loop"));
	ctx.effect(() => ctx.configForms.whileServed(["agent-loop"], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
		name: "plugins.item", id: "agent-loop", order: 30,
		label: () => t("title"), locale: NS, inject: () => card.inject()
	}, AgentLoopCard))), "…: page");
}
exports.apply = apply; exports.inject = inject;
```

浏览器半侧可用的 Cordis 服务（按需 `inject`）：`slots`、`locale`、`configForms`、`modules`、`remote`（+ 生成的 `remote.<namespace>`）、`connection`、`shortcuts` 等。Client bundle 的首行是 `window.__ModuleLoader__.load({id, factory})`，**bundle 执行只注册 factory**，模块副作用在首次物化时才跑（client-modules README）。

### F.4 slot：`plugins.item` 的精确形状

`slots.register(spec, Component)`：
- `spec = { name, id, order, label, locale, inject }`；
  - `label` 与 `inject` 都是**函数**（`label: () => t('title')`；`inject: () => card.inject()`），在渲染时求值；
  - `locale` 是字典命名空间，卡片内部 `t()` 用它；
- `Component` 收到 props：`{ view: 'summary' | 'form', t, save, discard, edit, resetField, use<Card>(selector) }`（见 `AgentLoopCard`，`:63-90`）；
- `ctx.slots.inject(name, fn)` 把注册延迟到该 slot 的宿主可用时执行；`fn` 可以是普通函数或 generator（`yield ctx.slots.register(...)`，注册随该 slot 生命周期清理）——官方 `ui-plugin-manager`/`ui-settings-agent-loop` 都用它避免过早注册（`@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js:4403-4430`）。

### F.5 `ctx.configForms`（Client 设置服务）

- `configForms.get(entryId) → ConfigFormController`：同一 entryId 返回同一实例（共享读镜像 + 写队列）。API：
  - `getSnapshot() → {status, value, base, user, revision, writable}`；`subscribe(listener)`；
  - `set(field, value)` / `unset(field)` / `mutate(ops, expectedRevision?)`（`ops = [{op:'set'|'unset', path:[...]}]`，可嵌套路径）；
  - 写通过 `ctx.remote.settings.mutate(ns, ops, revision)`，冲突保留草稿、失败重读（`@deepseek-ai/dsh-client-ui-settings/lib/client.js:1081-1215, 1253-1335`）。
- `configForms.whileServed(namespaces, register)`：当 Host describe 镜像里出现任一 namespace 时调用一次 `register(servedSet)`；全部消失时执行它返回的 disposer。**它不在调用方 ctx 注册任何东西**，调用方自己把返回的 disposer 包进 `ctx.effect`（`:1316-1338`）。
- `configForms.describe()`：跨命名空间读取面（`getSnapshot/subscribe/ensure`）。

### F.6 Typert RPC 与 Host 半侧

- 业务包用 `@Remote`（或作用域接收者 `@RemoteScope(key)`）标记方法，服务 `extends TypertRemoteService`；客户端的 `ctx.remote.<ns>` 调用即走 wire（`@deepseek-ai/dsh-typert-protocol`，README:33-52）。
- 设置页的 Host 端是 `@deepseek-ai/dsh-api-settings-controller`：注册 `ctx.remote.settings`（`describe/update/replace/mutate/openSettingsDocument`）与 `ctx.remote.credentials`（`describe/set/unset`），返回**脱敏**视图；陈旧写入 `settings-conflict`。
- 传输：一元调用走 HTTP POST；流式方法（`@Remote({mode:'stream'})`）走 `/api/remote.mux` WebSocket（`@deepseek-ai/dsh-client-connection/README.zh.md:35`）。
- Host 事件向浏览器转发：客户端用 `ctx.remote.$on('settings/document-updated', …)`（`dsh-client-ui-settings/lib/client.js:1489-1496`）。

### F.7 "单包双声明"结论（DESIGN 的 spike 问题）

**可行，机制上没有任何限制**：
- `dsh.bundle` 与 `dsh.client` 是 `dsh` 字段下两个互不校验的成员；
- client-modules 的发现依据是 **Loader 行 → 包的 package.json**，与"这个包是不是 bundle"无关；
- 官方 `dsh-client-ui-*` 是"只有 `dsh.client`、Host 半侧空 apply、由 web-app bundle 的 patch 插行"的形态；Notix 的 `notix-dsh-ui` 是"**自己就是 bundle**（patch 插入自己的行）+ `dsh.client`"的形态——两者都能被扫描到。

但要注意三个现实约束：
1. **必须有 Loader 行**：客户端半侧不会单独被发现；没有行就没有 `dsh.client` 扫描（这也是 `notix-dsh-ui` 要自带 patch 的原因）。
2. **包必须能被 profile 解析**：是 `dsh.profile.bundles` 成员（安装为 layer），或至少是 profile 依赖（被宿主 bundle 的插入行引用）。`dsh plugin add` 对没有 `dsh.bundle` 的包只装成普通依赖并警告（§A.5）。
3. **同一包不能有两个 active Loader source**（否则 client-modules throw）——不要既把它列为 bundle 又让另一个 patch 用别的 specifier 再插一行。

---

## G. Config 热更新链路（schemastery → volatile → settings → config-editor → loader）

### G.1 `.volatile()` 到底做了什么

`@deepseek-ai/schemastery/src/index.ts`（asar 内带源码）：
- `Schema.prototype.volatile()` = `extra('volatile', true)`（`:481-484`）；
- 解析时，`meta.volatile` 的节点**不会返回普通值，而是 `createVolatile(value)`**（`:522-529`）——即一个 `.get()` 读当前值的稳定引用；
- 元数据默认值在缺省/autofix 时也包装成引用（`:770`）；
- 限制：`validateVolatileSchema` 要求 volatile 字段处于**固定对象路径**，禁止嵌套在另一个 volatile 下、禁止出现在 dict 值/数组元素里（`:489-511`）；
- `simplify()` 会把引用解包成普通值用于持久化（README:392-394）。

### G.2 dsh-settings：为什么"不 volatile 就没有设置卡片"

`volatileForm(schema)`（`@deepseek-ai/dsh-settings/lib/types/schema.js:43-54`）：

```js
export function volatileForm(schema) {
	if (schema.meta.volatile) return plainSchema(schema);
	if (schema.type === 'object') {
		const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
			const field = volatileForm(child);
			return field === undefined ? [] : [[key, field]];
		}));
		return Object.keys(dict).length === 0 ? undefined : z.object(dict);
	}
	return undefined;
}
```

`describe()` 对 `form === undefined` 的 entry 直接 `return []`（`dsh-settings/lib/index.js:419-421`）。所以：
- 只要**最近 volatile 祖先**标记了，整棵子树都会出现在表单里（不要求每个叶子都标）；
- 一个 volatile 字段都没有的 Config → 命名空间不会出现在 `settings.describe()` → `configForms.whileServed([ns])` 永不触发 → 卡片永不出现。DESIGN 的这个"坑"✅，且它是**机制必然**，不是巧合。
- `describe()` 还要求 entry 的 fiber 存在且 `state === 2`（active）；被禁用/未启动的 entry 无法配置。

### G.3 一次保存的完整链路

```
[Browser] configForms.get('notix').mutate([{op:'set',path:['triggers','approval','remindAfterMs'],value:…}], revision)
  → ctx.remote.settings.mutate(ns, ops, revision)                 // Typert wire
[Host] dsh-api-settings-controller → ctx.settings.mutate(...)
  → 校验：volatileForm + isVolatilePath（非 volatile 路径 throw）
  → ctx.configEditor.edit(entry, change)
       ├ 与 HMR 串行：hmr.runExclusive(run)
       ├ 取当前 patch / inherited 层 → 计算 next raw config
       ├ fiber.ctx.waterfall(fiber, 'internal/config', next) + resolveConfig(...)   // 完整校验
       ├ 写 profile 的 cordis.patch.yml（yaml Document，保留注释/!!js）
       └ reconcileProfilePatches(root, patches, 'dsh', [entry.id])  // 普通重载路径
[Loader] Entry.update(options)
  ├ 计算 changes；volatileOnly = 只有 config 变 && fiber.state===2 && ctx 原型未变 && equalExceptVolatile(...)
  ├ volatileOnly → fiber._config = 新 raw；_commitVolatile()
  │    ├ resolveConfig(再次过 internal/config) → 与当前 fiber.config 深度比较
  │    ├ 若"普通字段的有效值"变了 → return false → 走普通重载
  │    ├ updateVolatile(ref, source) 逐个提交
  │    └ emit('loader/volatile-update', paths)  （载体过滤器：owner.fiber === 该插件 fiber）
  └ 否则：普通 update（可能卸载重挂载，配置无效则保留旧实例并失败）
[Plugin] ctx.on('loader/volatile-update', () => reread(refs))
```

证据：`dsh-settings/lib/index.js:487-540`；`dsh-config-editor/lib/index.js:70-136`；`@deepseek-ai/cordis-plugin-loader/lib/index.js:366-431`：

```js
const volatileOnly = changes.length === 1 && changes[0] === "config" && this.fiber.state === 2 && ... && equalExceptVolatile(legacy.config, this.options.config, this.fiber.runtime?.Config);
if (volatileOnly) this.fiber._config = this.options.config;
const pending = volatileOnly && this._commitVolatile() ? [] : changes;
```

### G.4 三个必须记住的边界

1. **`loader/volatile-update` 只投递给 owner fiber 的监听器**：`_commitVolatile` 构造了一个派生 ctx 并设置 `self[Context.filter] = (owner) => owner.fiber === fiber`（`cordis-plugin-loader/lib/index.js:420-425`）。所以监听必须写在**插件自己的 ctx 上**（Notix 在 `apply` 里直接 `ctx.on`，正确）；在父上下文/其他插件里监听收不到。
2. **volatile-only 的判定很严格**：只要"普通字段的有效值"变了（含数组/嵌套对象、`!!js` 表达式结果、父层继承变化、context 原型变化），走**普通重载**（可能重挂载）——不是"所有配置都热更"。
3. **`equalExceptVolatile` 用 schema 元数据忽略 volatile 路径，但不执行表达式/校验/transform**（`cordis-plugin-loader/README.md` 的 "Volatile configuration"）；因此"volatile 字段的默认值/缺省对象"按 schema default 比较，等价默认不会触发更新。

### G.5 Notix 的实现对应

- `packages/notix-dsh/lib/schema.js`：所有可编辑叶子 `.volatile()`；
- `lib/config.js`：`unwrapVolatile()` 递归把引用换成快照 + 填默认；
- `lib/index.js:63-69`：`ctx.on('loader/volatile-update', () => core.replaceConfig(readConfig(rawConfig)))`；
- `lib/index.js:19`：`inject = ['sessions','timer','sessionProjections']`；
- `ctx.provide('notix', core.api())` 暴露服务 API（不是 `extends Service`）——见 §H 核查表。

---

## H. DESIGN.md §2 机制声明核查表

> 逐条对照源码。**"需修正"只表示 DESIGN 的表述与实现不一致；不代表设计不可行。**

| # | DESIGN §2 声明 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 插件三种形态：函数 / `{name,inject,Config,apply}` / 类（常 `extends Service`） | ✅ | `cordis/lib/index.js:1534-1540, 1068-1073` |
| 2 | 入口 `exports.default ?? exports`（loader `unwrapExports`） | ⚠️ | 实际还有 `__esModule` 二次解包（`:668-674`） |
| 3 | Notix 用 **Service 子类**形态（§7.2 骨架 `class NotixService extends Service`） | ⚠️ 与实现不符 | 实现是**函数插件**：`export const name/inject/Config` + `ctx.provide('notix', core.api())`（`packages/notix-dsh/lib/index.js:19-24, 47-69`）。两种都合法；指南应描述实现形态 |
| 4 | Config 由 schemastery 定义、启动前校验 | ✅ | `resolveConfig` + Standard Schema（`cordis/lib/index.js:958-966`）；Loader `_init` 后 `fiber.await()` |
| 5 | 所有可编辑叶子 `.volatile()` 才能被 settings 暴露 | ✅ | `volatileForm` 过滤 + `describe` 跳过（§G.2） |
| 6 | Loader 把 volatile-only 变更提交进运行中 fiber（不重载），插件监听 `loader/volatile-update` | ✅ | `cordis-plugin-loader/lib/index.js:384-431`；细节见 G.4 |
| 7 | `ctx.on` 返回 disposer；`ctx.effect` 注册 cleanup；随 fiber 卸载逆序清理 | ✅ | `cordis/lib/index.js:1170-1193` |
| 8 | `inject` 声明服务依赖，"全部可用才加载" | ✅ | `RegistryService.inject` + `notify`（`:1601-1607`, `:833-853`）；另外 inject 的 value 会作为 intercept 配置 |
| 9 | 可安装单元是 bundle；`dsh.bundle.patch` 指定 patch 文件；`- insert:` 行；支持 `!!js` | ✅ | §A.2–A.4；`!!js` 求值在 `cordis-plugin-loader/lib/index.js:230-250` |
| 10 | profile 目录 `$DSH_HOME/profiles/<name>`；`dsh.profile.bundles` 有序列表 | ✅ | `dsh-app-boot/lib/index.js:508-549`；`resolveProfileDir` |
| 11 | 组合顺序：bundle patches → profile patch → home patch → `--patch` | ✅ | `readProfilePatches`（`:1128-1140`）；末尾还有 telemetry patch |
| 12 | 安装入口：Web Plugins 页 / plugin_manager 工具 / `dsh plugin` CLI；有 `engines.dsh`/peer 兼容检查；HMR 即时重组 | ✅ | `operations.js:94-125, 591-604`；`evaluatePluginCompatibility`；`dsh-hmr/README.zh.md` |
| 13 | 显示元数据：`icon`、`locale/<lang>.json`、`README.i18n.yaml` 官方内部用 | ✅ | `readPluginMeta`（`dsh-app-boot/README.zh.md` "读取插件展示元信息"）；`dsh-package-manifest/README.zh.md` |
| 14 | Cordis dispatch 五模式 | ✅ | `cordis/lib/index.js:220-330`；注意 bail/emit 的返回值与异常语义（§B.6） |
| 15 | "子上下文事件向上冒泡；`{global:true}` 在根上下文观察全部会话/agent 事件" | ⚠️ 机制描述错、行为对 | 单 root 总线 + 载体过滤（`dsh-scope/lib/index.js:328-340`）；无 tag 监听器本就全局；`global` 是**绕过过滤**，不是冒泡（§B.7） |
| 16 | `approval/asked {id,toolName,callId?,reason?}` / `approval/decided {id,outcome}`，outcome ∈ `allowed-once/rejected/cancelled/unavailable` | ✅ | `dsh-user-approval/lib/index.js:31-36, 129-146` |
| 17 | `userQuestions` 投影 state 枚举 `open / continued`；timed 提问默认 120s 转 `continued` | ✅（需补一句） | 枚举 `dsh-user-questions/lib/types/projection.js:51-53`；120s 在 `dsh-tool-ask-user/lib/index.js:65,214`；**投影只跟踪 timed schema**（§D.3） |
| 18 | T2 读投影 `questions.active`、diff 前后快照 | ⚠️ | `stateOf` 返回 host state `{questions:{active}}`；onChanged 第 3 参才是 `{active,settled}`。Notix seed 路径用 `state.active` 取不到（`triggers/questions.js:10-15`） |
| 19 | `turn/end` reason：`completed / blocked / max-tokens / aborted(user\|parent\|disposed\|hook) / error{message,code}`，finally 必发 | ⚠️ 形状需精确 | error 在 `reason.error.{message,code}`，aborted 在 `reason.reason.{kind,…}`（`dsh-agent-loop/lib/index.js:732-747, 1010-1035`） |
| 20 | `agent/error {agent,turn,step,error}`（throwError 先 emit 再 throw） | ✅ | `dsh-agent-loop/lib/index.js:877-886`；`agent` 由 fused dispatcher 注入（`dsh-agent/lib/types/dispatch.js:31-40`） |
| 21 | `tool/result`：`message.isError:true`，可选 `error:{message, info:{name,code}}`；观察事件 `tools/result` | ⚠️ session 事件形状错 | 实际 `data.error = {name, code}`（只保留 info），错误文本在 `message.content[0].text`（`dsh-agent-loop/lib/index.js:692-707`；`dsh-tools/lib/index.js:3716-3726`）。`tools/result` 是 Cordis emit `(exec,result)`（`dsh-tools/lib/index.js:3506-3520`） |
| 22 | LLM 重试是 session 事件 `llm/retry-started` / `llm/retry` | ✅ | `dsh-llm-retry/lib/types/index.js:129-135`；顺序：retry（延迟前）→ retry-started（延迟后） |
| 23 | `ctx.jobs.events.subscribe({owners:'all'}, listener)`；事件 `registered/stopping/output/progress/settled{cause,awaited}/removed`；终态 `completed/killed/failed` | ✅ | `dsh-jobs-local/lib/index.js:35-90, 409-412, 770-798` |
| 24 | job 持久化事实：`job/registered`、`job/settled {finishedAt,status,cause,detail?}` | ⚠️ 少一个字段 | 还有 `producerReported`；且 `job/settled` 先于事件流 `settled`（`:605-626, 770-798`） |
| 25 | `ctx.timeout/ctx.interval` 随 fiber 自动清理；`setTimeout/setInterval` 为 deprecated 别名 | ✅ | `cordis-plugin-timer/lib/index.js:8-70` |
| 26 | `ctx.storageDomain`：schema 校验 KV，同步读、落盘写、`domain/changed`、对模型不可见 | ✅ | `dsh-storage-domain/lib/index.js:95-110, 236-290`；README 明示不可见 |
| 27 | `ctx.agents` 的 `.get/.roots/.list`；"取会话标题等丰富通知内容" | ⚠️ 间接 | API ✅（`dsh-agent/lib/index.js:597-626`）；但 `title` 不在 Agent 上，是 `dsh-session-title` 的投影 unit（§E.3） |
| 28 | `session/event` 目录约 60 种类型（known-event-types） | ✅ 精确 62 | `known-event-types.js:21-84` |
| 29 | dsh 无面向插件的用户通知服务；桌面宿主纯 Node、插件拿不到 Electron 对象 | ✅（"唯一 OS 通知=强制更新"◻︎ 壳内不可验） | `dsh-desktop-host/package.json`："Private Node-mode host process for the Electron desktop application"，依赖无 electron；`lib/index.js` 只 import Node 内建 + dsh 包，与壳通过 `process.send` IPC；可见的 `ELECTRON_RUN_AS_NODE:"1"` **只出现在它 spawn 的包管理子进程 env**（`lib/index.js:246`、`lib/cli.js:103`），宿主自身启动方式在 Electron main（asar 外）不可验。web shell bundle 内无 `Notification` 命中（`dsh-web-frontend/dist/assets/index-*.js`） |
| 30 | 不要用 `ctx.web.fetch` 做 webhook（匿名、GET/抓取语义、有上限） | ✅ | `dsh-web/README.zh.md:54-61`；`dsh-web-fetch-http/README.zh.md:65`（匿名、URL 上限 2048、仅解析一次主机并固定 IP、无请求体语义） |
| 31 | Typert RPC：`@Remote({mode:'stream'})` 走 `/api/remote.mux` | ✅ | `dsh-typert-protocol/README.zh.md:50`；`dsh-client-connection/README.zh.md:35` |
| 32 | Settings UI：`configForms.get` / `whileServed` / `plugins.item` slot / 官方 agent-loop 卡片先例 | ✅ | `dsh-client-ui-settings/lib/client.js:1253-1338`；`dsh-client-ui-settings-agent-loop/lib/client.js:137-172` |
| 33 | 字段不 volatile → 命名空间不出现 → 卡片永不出现 | ✅ | §G.2 |
| 34 | 保存后写 profile patch 并经 Loader 即时生效，无需重载 | ✅（仅 volatile-only） | `dsh-config-editor/lib/index.js:70-136`；`_commitVolatile`；普通字段仍可能重挂载 |
| 35 | 单包同时 `dsh.bundle.patch` + `dsh.client` 是否可行"需 spike" | ✅ 可行（已实现） | `packages/notix-dsh-ui/package.json` 双声明；client-modules 按 Loader 行发现（§F.7）。约束：必须有行、必须可解析、不能双 source |
| 36 | T2 降级：`sessionProjections` 缺失时停用、不拖垮插件 | ⚠️ 实现未做到 | `triggers/questions.js:128-132` 有 `ctx.get(...)` 降级分支，但 `lib/index.js:19` 把 `sessionProjections` 放进了 `inject` → 服务缺失时整个插件**停在等待**，根本到不了降级分支。要真降级应移出 `inject`、只用 `ctx.get` |
| 37 | "通知历史走 storageDomain，对模型不可见" | ✅ | §E.5；但 Notix 的 domain spec 是**手写普通对象**而非 `defineDomain`（`store.js:26-38`），打开期不做 name/版本校验——能跑，但少了声明期保护（次要） |
| 38 | macOS 通道用 `osascript -e 'display notification…'`，无 Electron 依赖 | ✅（机制前提） | Host 是纯 Node 进程（#29），`child_process` 可用；实测效果不属源码核验范围 ◻︎ |

**"有惊讶"的条目（建议写进指南的风险提示）**：
- **#15 不是冒泡**：这是最可能被追问的机制误述。
- **#17/#18**：`userQuestions` 只覆盖 **timed** `ask_user_question`；blocking 版本无投影状态，T2 会静默漏报。Notix seed 还读错了层级。
- **#21**：`tool/result.error` 里没有 `message`；Notix 的 payload `message: info.message` 恒为空。
- **#24**：`job/settled` 比事件流 `settled` 更早写盘（先持久化，再广播），所以"先收到 session 事件、后收到 jobs 事件"是设计而非竞态。
- **#29**：`ELECTRON_RUN_AS_NODE=1` 在打包产物里只是宿主给**包管理子进程**设的 env；宿主本身是独立的 Node 模式进程（`dsh-desktop-host`），启动 env 在 Electron main（asar 外）无法核验。正确论据是"宿主包不依赖 electron、只经私有 IPC"，不是"env 里有 ELECTRON_RUN_AS_NODE"。
- **#35**：双声明可行，但"UI 包随宿主 patch 一并引入"需要它是 profile 依赖（否则 Loader 解析不到），不是零成本。

---

## I. 面试可能追问的概念点（易错细节）

1. **`emit` vs `waterfall` 的返回语义**
   - `emit` 丢弃返回值、不 await；`waterfall` 的返回值是最外层监听器（或内建 `next`）的返回值。
   - `waterfall` 不调 `next()` = **否决内建行为**；调了但不 `return next()` = 内建照跑但返回值被吞。
   - `bail`/`serial` 的"bail 值"判定：`null/false/undefined` 不算（`isBailed`）。
   - 追问陷阱："`emit` 里 async 监听器抛错会怎样？"——promise rejection **没人接**（emit 不 await），同步 throw 会中断后续监听器；所以 dsh 的 session/agent/tools 广播都自己做了 containment，而 `ctx.emit` 没有。

2. **为什么 `{global:true}` 不会漏事件**
   - 因为事件不是靠"树上的传播"抵达监听器，而是**同一条全局 `_hooks` 表 + 一次过滤**；`global:true` 只是让 `hook.global || …` 短路为真。
   - 反例更值钱：**没有** `global:true` 的监听器如果注册在**带 scope 标签**的 ctx 上，会漏掉"分发载体 key 为 undefined"的事件（如未 scoped 的 `session/event`），也漏掉**自己 scope 之外**的 agent 事件。这就是 dsh 官方 `invariant` 用 global 的原因。
   - 追问陷阱："那把监听器注册在 root 上就行了吧？"——行为等价，但插件拿不到 root（`ctx.root` 可读但注册要谨慎）；`global:true` 是声明意图。

3. **`volatile` 的过滤条件**
   - `.volatile()` = schema 元数据 + 解析成 `Volatile<T>` 引用；**不是**"热更新开关"。
   - `dsh-settings.describe()` 只暴露"**最近 volatile 祖先存在**"的 Config，且 entry 必须 active；不是"每个字段都得标"。
   - Loader 的 volatile-only 条件：`changes === ['config']` && `fiber.state===2` && `ctx` 原型未变 && `equalExceptVolatile` 为真；`_commitVolatile` 还要"普通有效值完全一致"才原地提交，否则普通重载。
   - 只有 **owner fiber** 的监听器收到 `loader/volatile-update`；监听器抛错被 log 掉，**值已经提交**（不可回滚）。
   - 追问陷阱："给 volatile 字段加一个 transform 会怎样？"——transform 每次 parse 产生新实例，普通字段比较可能永远不等 → 每次都走普通重载（loader README 明确点名这个坑）。

4. **projection 与 session event 的区别**
   - 事件 = 不可变历史事实（持久化、可 replay）；投影 = 从事实折叠出的"当前完整状态"（内存、可重建、可持久检查点）。
   - 投影的 `apply` 必须同步、纯、无关事件返回同一引用（否则客户端每事件都重渲染）；wire view 用 `Object.is` 抑制发布。
   - `onChanged` 只对 **client-visible** 单元触发；`stateOf` 给 host state，形状跟 `onChanged` 的参数**不一样**。
   - 追问陷阱："重启后投影为什么是满的？"——首次触达时用 `init` 折叠日志，或由 `session-projection-cache` 播种；`inheritedEventCount` 之前的继承事件不重放。

5. **`session/event` 与 `session.append` 的时序**
   - append 是同步的，但"通知"发生在 commit 之后；在监听器里 append 会被"不可重入"拒绝。
   - 监听器抛错不影响已提交事实；`session/flush` 才是 durability 同步点。
   - `approval/asked|decided` 必须在 open turn 内成对出现，否则 reload 无法区分 crash tail。

6. **审批 fail-closed 的实现位置**
   - 不在工具里，而在 `ApprovalService.decide()`：`waterfall` 默认 `next` 返回 `'unavailable'`；非词表返回值归一为 `unavailable`；监听器抛错也归一为 `unavailable`；`never` 策略在 waterfall **之前**短路（prepend 也绕不过）。
   - 追问："Notix 只观察会不会影响审批？"——只要不注册 `approval/request` answerer、不改返回值，就不会；`emit` 监听器返回的 promise 也不会被等待。

7. **`job/*` 为什么既有 session 事件又有服务事件**
   - session 事件是**持久化审计**（跨重启/回放可重建"曾有过哪些 job"）；
   - `ctx.jobs.events` 是**运行时观察**（含 output/progress 增量，不可 replay）；
   - `settle()` 先 `recordSessionEvent` 再 `hub.emit`，所以订阅顺序不代表持久化顺序。
   - 订阅粒度 `{owner}` / `{owners:'all'}` / `{owners:'scope'}`；订阅 effect 归 registry 服务 ctx（不是调用方 fiber）。

8. **storageDomain 的读写语义**
   - 读同步来自内存；写**先落盘再改内存再发事件**——被后端拒绝的写不会让读分叉。
   - 每 domain 一条写链，`update(key, fn)` 的 fn 在链上执行，不会交错。
   - 事件是通知不是事务：监听器抛错被吞，写已持久。
   - 追问陷阱："能存 session 历史吗？"——不能，那是 session persistence seam 的领域。

9. **Client 插件为什么"Host 半侧是空的"**
   - `dsh.client` 的发现依赖 **Loader 行 → package.json**；空 `apply` 只是为了让包在 Host 树里有一行，浏览器 bundle 经 `window.__DSH_BOOT__` 懒加载（bundle 执行只注册 factory）。
   - `dsh.client.inject`（包名）与 client bundle 的 `inject`（Cordis 服务）是两套依赖。
   - `whileServed` 让"Host 组合里没有该 namespace"时页面上**零痕迹**；它不在调用方 ctx 注册东西，调用方要自己包 `ctx.effect`。

10. **settings 保存为什么"立即生效但不重载"**
    - 只对 volatile-only 变更成立；写入的是 profile patch（不是内存覆盖），经 `reconcileProfilePatches` 走正常 Loader 更新，`_commitVolatile` 把新值 `updateVolatile` 进运行中的引用并通知 owner fiber。
    - 普通字段 → 重挂载；写被 home patch/`--patch` 覆盖时会被 `configEditor` 拒绝（"overridden by a home patch or command-line overlay"）。
    - 追问陷阱："保存后 UI 为什么立即显示新值？"——`configForms` 把写应答 `acceptView` 折入共享 describe 镜像；失败则重读 Host。

11. **"对模型不可见"到底指什么**
    - 不进 `deriveMessages()` / 系统提示词 / 工具 schema / `request/header`；不是"模型绝对读不到"（插件可以读配置再写进消息）。
    - `storageDomain`、`sessionProjections`、Cordis 事件都满足"不自动进入模型上下文"；真正会进的是 `system/developer/user/assistant/tool/result` 五类 surface 事件 + `image/offload` 投影结果。

12. **一个 Notix 相关的组合事实（面试官可能拿它检验你是否真读过源码）**
    - `ask_user_question` 的 timed 版本才有 `timeout` 参数；投影只跟踪 timed 版本 → **blocking 版本的提问不会触发 T2**。
    - `turn/end` 的 `reason.kind==='error'` 与 `agent/error` 是同一错误的两个观察面，去重键要相同（Notix 用 `(sessionId, turn)`，实现正确）。
    - `tool/result` 的 `error` 只有 `{name, code}`，超时判断应看 `code === 'TOOL_TIMEOUT'`（Notix 对照 `info.name === 'ToolTimeoutError'`，两者都写才稳）。
    - `job/settled` 里 `status` 是终态，`cause` 是取消原因；`producerReported` 区分"生产者自报"与"注册表强制失败"。
    - `ctx.get('sessionProjections')` 是可选依赖 → 缺失时**必须降级**而不是让整个插件起不来；`inject` 里列了就必须等（Notix 把 `sessionProjections` 放进 `inject`，与"缺失时 T2 停用"的降级叙述不一致——实际会**阻塞启动**直到服务出现；这是 DESIGN 与实现的一处自相矛盾，指南应指出）。

---

## 附录：关键源码位置速查（行号对 asar 内 `/dsh/node_modules/@deepseek-ai/…`）

| 概念 | 文件:行 |
|---|---|
| 事件五模式 / `isBailed` | `cordis/lib/index.js:220-330` |
| 事件过滤、`global` 绕过 | `cordis/lib/index.js:259-266`；`dsh-scope/lib/index.js:328-340` |
| 插件形态归一 / 类实例化 | `cordis/lib/index.js:1534-1540, 1068-1073`；`cordis-plugin-loader/lib/index.js:668-674` |
| Fiber / effect / 逆序清理 / 状态 | `cordis/lib/index.js:1009-1300` |
| Service 注册与下线 | `cordis/lib/index.js:800-825, 1771-1790` |
| `ctx.inject` / notify | `cordis/lib/index.js:1601-1607, 833-853` |
| Loader update / volatile 提交 | `cordis-plugin-loader/lib/index.js:366-431` |
| patch 语义 / 层顺序 / profile 目录 | `dsh-app-boot/lib/index.js:62-123, 508-549, 1016-1140` |
| 安装 / bundle 对账 | `dsh-plugin-manager/lib/types/operations.js:94-125, 591-604` |
| CLI `--patch` / `dsh plugin` | `dsh/lib/bin.js:28-29, 46, 106`；`dsh/lib/plugin-*.js` |
| session append / commit / session/event | `dsh-session/lib/index.js:1576-1600, 1856-1935` |
| known event types / surface 白名单 | `dsh-session/lib/types/known-event-types.js:21-88`；`dsh-session/lib/index.js:139-145` |
| projection 注册表 / drive / onChanged | `dsh-session-projection/lib/index.js:52-230, 400-425` |
| userQuestions 折叠与投影 | `dsh-user-questions/lib/index.js:173-293`；`lib/types/projection.js:39-60` |
| 审批事件 / answerer | `dsh-user-approval/lib/index.js:31-36, 129-146, 177-189` |
| turn/step/tool/agent-error | `dsh-agent-loop/lib/index.js:692-707, 732-747, 877-886, 946-1035` |
| agent 事件载体 / AgentRegistry | `dsh-agent/lib/types/dispatch.js:20-70`；`dsh-agent/lib/index.js:597-626` |
| jobs 事件流 / 持久化事实 | `dsh-jobs-local/lib/index.js:35-90, 409-412, 504-530, 605-626, 770-798` |
| storageDomain | `dsh-storage-domain/lib/index.js:62-110, 236-300, 356-400` |
| timer | `cordis-plugin-timer/lib/index.js:8-110` |
| settings describe/write + volatileForm | `dsh-settings/lib/index.js:414-540`；`lib/types/schema.js:43-84` |
| configEditor 保存/校验/串行化 | `dsh-config-editor/lib/index.js:25-136` |
| schemastery `.volatile()` | `schemastery/src/index.ts:481-530, 760-772` |
| client 插件发现 | `dsh-client-modules/lib/index.js:62-75, 513-560, 720-756, 852-900` |
| configForms / whileServed | `dsh-client-ui-settings/lib/client.js:1081-1215, 1253-1338` |
| 官方 `plugins.item` 先例 | `dsh-client-ui-settings-agent-loop/lib/client.js:137-172`；`lib/index.js`（空 apply） |
| client roster patch 注释 | `dsh-web-app/cordis.patch.yml:43, 307-446` |
| desktop host（纯 Node） | `dsh-desktop-host/package.json`；`lib/index.js:225-260` |
