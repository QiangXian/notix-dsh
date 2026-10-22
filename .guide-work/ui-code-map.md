# Notix Client UI 插件代码地图（`packages/notix-dsh-ui` + `docs/ui-settings-design.md`）

> 用途：给《Notix × dsh 代码指南》直接引用的 Client UI 走读，重点回答「浏览器插件如何挂到 Web GUI」。
>
> 事实基线：仓库 `/Users/jiangxianjie/Desktop/Notix-dsh`，HEAD `4213507 fix(settings): mark config leaves volatile so the settings card appears`，Node v22.23.2，UI 包版本 `0.1.1`。
> 验证：`node --check packages/notix-dsh-ui/lib/{index,client}.js` 通过；`node scripts/smoke-client.mjs` 输出
> `OK packages/notix-dsh-ui/lib/client.js: id=notix-dsh-ui apply=function inject=[slots, locale, configForms]`。
>
> 引用约定：
> - 工作区文件行号来自 `read` 工具输出，未改任何源码。
> - `dsh` 侧 API 行号来自 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/...` 解包源码（0.2.1-rc.2），文中简写为 `dsh-client-ui-settings/lib/client.js:NNN` 等；这些是**外部依赖事实**，不是本仓库代码。
> - 解包工具 `.guide-work/asar-extract.py` 的 `BASE_OFFSET` 少算 2 字节：每个被解出的文件首字节会多出前一个文件尾部 2 字节，于是所有 JS/TS 文件看起来都以一行孤立的 `>` 开头。以 `offset+2` 复读可确认真实首行是 `window.__ModuleLoader__.load({` / `import {`。这一点对判断设计文档「已知限制 #7」很关键（见 §8）。

---

## 0. 装载链路先看一张图（面试三句话）

```
① 包声明   package.json: dsh.client{platform:"web", inject:[locale,ui-settings,plugin-manager]}
           exports["./client"] -> lib/client.js；UI 包自己的 bundle patch 插入 Loader 行 id=ui-notix
② 宿主组合 dsh-client-modules: 扫 Loader entries → 最近 package.json → parseDshClient（platform 须 "web"）
           → exports["./client"] → 快照 bundle → __DSH_BOOT__ 启动图 + /plugins/<pkg>/client.js?rev=… 路由
③ 浏览器   shell 注入 __ModuleLoader__ facade → bootstrap → 惰性执行 bundle
           bundle 只 load({id:"notix-dsh-ui", factory})；factory(require) 返回 {NS, apply, inject}，
           require 仅命中冻结平台模块表（react、ui-primitives…）
④ Cordis   apply(ctx): locale.register/bind → configForms.get('notix')
           → effect(whileServed(['notix'], () => slots.inject('plugins.item', () => register(...))))
⑤ Plugins 页 plugin-manager 的 plugins.item(list) 账本 → 卡片（summary）→ 详情页（page）
```

一句话总结：**Node 半是 no-op 的「Loader 行占位」，真正的插件是 `lib/client.js` 这个 `__ModuleLoader__.load` bundle；它由 dsh-client-modules 从 `dsh.client` 清单发现、随 Web GUI 外壳惰性物化，再以普通 Cordis client 插件身份 `apply(ctx)`，把自己的卡片注册进 Plugins 页声明的 `plugins.item` slot。**

---

## 1. 包身份：`package.json` 的 `dsh.client` 逐项含义

`packages/notix-dsh-ui/package.json`（49 行）：

```json
// package.json:21-33
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  },
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-plugin-manager"
    ],
    "platform": "web"
  }
}
```

### 1.1 逐字段

| 字段 | 值 | 含义与约束（证据） |
| --- | --- | --- |
| `name` | `notix-dsh-ui` | 同时是 **浏览器 bundle 的模块 id**（`lib/client.js:2` `id:"notix-dsh-ui"`），也是启动图行 id（graph row id = manifest 包名）。 |
| `platform` | `"web"` | **唯一被接受的平台值**。`parseDshClient` 只校验它是字符串（`dsh-client-modules/lib/index.js:66`），但扫描时 `decl.platform !== "web"` 直接当普通 Node 包忽略（同文件 `:733-736`）。写成别的值 = 浏览器半永远不加载。 |
| `inject` | 3 个 `@deepseek-ai/*` 包名 | **不是 Cordis 服务注入**，而是「模块到达图」的依赖：浏览器加载本 bundle 前要先把这些包的 bundle 注册/物化完（`dsh-client-modules/lib/client.js:777-793`，`arriveGraphRow` 先处理 `row.external` 再处理 `row.inject`）。真正声明 Cordis 服务依赖的是 `client.js` 的 `exports.inject`（见 §2.4）。 |
| `bundle.patch` | `./cordis.patch.yml` | 声明本包是 **bundle**：插件管理器读它把补丁叠加到 profile（`dsh-plugin-manager/lib/index.js:340`、`:494`、`:2078` 都调用 `bundlePatchPaths(...)` + `loadOverlayPatches(...)`）。 |
| `exports` | 见下 | 没有 `entry` 字段！浏览器入口由 **`exports["./client"]`** 约定提供。 |
| `engines.dsh` | `>=0.2.1-rc.2 <0.3.0` | 兼容窗口；UI 依赖 0.2.1-rc.2 的 `plugins.item` / `ConfigFormController` 契约。 |
| `peerDependencies` | `@deepseek-ai/cordis ~4.0.5` | 与服务端一致，不打包 Cordis。 |
| `icon` / `files` | `./icon.png` | 供 bundle 卡片/插件元信息；但 `plugins.item` 卡片不用它（见 §3.4）。 |

### 1.2 `exports` 逐条（`package.json:7-13`）

```json
"exports": {
  ".": "./lib/index.js",
  "./client": "./lib/client.js",
  "./cordis.patch.yml": "./cordis.patch.yml",
  "./locale/*.json": "./locale/*.json",
  "./package.json": "./package.json"
}
```

| 子路径 | 消费者 | 约束 |
| --- | --- | --- |
| `.` | Loader（Node 行） | Host 半；`apply(){}` no-op。 |
| `./client` | dsh-client-modules | **必须存在**，否则报 `declares dsh.client but exports no "./client" bundle`（`dsh-client-modules/lib/index.js:737-738`）。只有 string 或 `{ default: string }` 两种形态（`:171-182`）。 |
| `./package.json` | 宿主/插件管理器（`readPluginMeta`、`createRequire(...).resolve(pkg/package.json)`） | 对外暴露清单。 |
| `./locale/*.json` | `readPluginMeta` 读 `${specifier}/locale/en.json` 及同目录语言文件（`dsh-app-boot/lib/index.js:2217-2245`） | 只放 `meta.title/description` 展示文案。 |
| `./cordis.patch.yml` | 插件管理器 bundle patch | 声明式插入行。 |

### 1.3 `cordis.patch.yml`：UI 是**独立 bundle**，不被 Host patch 引入

```yaml
# packages/notix-dsh-ui/cordis.patch.yml:1-5
# Notix Settings UI: insert the client plugin that renders the Notix card on
# the Plugins settings page. It edits the `notix` namespace served by notix-dsh.
- insert:
    - id: ui-notix
      name: notix-dsh-ui
```

- UI 包自己的 patch 插入一行 `id: ui-notix, name: notix-dsh-ui`。**Host 包 `packages/notix-dsh/cordis.patch.yml` 只插入 `id: notix, name: notix-dsh`**（Host 文件 1-8 行），不含 UI 行。所以两者是**两个独立 bundle**，各自声明 `dsh.bundle.patch`；`docs/ui-settings-design.md:125` 与 `DESIGN.md:142` 的「单包双声明 spike」结论就是拆成两包（官方 `dsh-client-ui-*` 也全部是 Node 半 no-op 的独立包）。
- 开发期想一次装两个：`dev/notix.patch.yml` 手写两行，且 `name` 用**绝对路径指向 `lib/index.js`**（`dev/notix.patch.yml` 第 7-12 行）。这能工作，因为扫描器对 path-like 的 Loader 行会 `nearestPackage()` 向上找最近 `package.json`（`dsh-client-modules/lib/index.js:762-780`），再按 manifest 包名识别客户端 bundle。**行 id（`ui-notix`）≠ 包名（`notix-dsh-ui`）≠ bundle 模块 id（=`notix-dsh-ui`），三者都要分清。**
- 没有「Host 未安装则 UI 包无法安装」的硬依赖；UI 包只依赖 *运行时 Host 是否服务 `notix` 命名空间*，这正是 `whileServed` 要解决的（§4.4）。

### 1.4 locale 与 icon 约定

- `locale/zh.json` / `locale/en.json` 各 6 行，只有 `meta.title` / `meta.description`（如 `zh.json:1-6` → `"Notix 通知"`）。这是**插件清单/市场展示元信息**，不是卡片文案；卡片完整字典内嵌在 `client.js:11-127`，经 `ctx.locale.register` 注册（见 §5.6）。
- `readPluginMeta` 的规则：`title` 取 locale 的 `meta.title`，缺省回退 **包名**；`description` 回退空串；`icon` 优先 `package.json.icon`，否则 `<specifier>/icon` 资源；支持 SVG/PNG/JPEG/WebP ≤ 256 KiB（`dsh-app-boot/lib/index.js:2200-2245`、`:573-579`）。本包 `icon:"./icon.png"` 符合。
- 注意：`plugins.item` 官方卡片**不读**包图标（§3.4），图标只出现在 bundle 卡片/市场里。

---

## 2. 两半结构：Node 侧 no-op，浏览器侧真身

### 2.1 `lib/index.js` 为什么是 no-op（全文 8 行）

```js
// packages/notix-dsh-ui/lib/index.js:1-8
/**
 * Host half of notix-dsh-ui: intentionally a no-op.
 *
 * All behaviour lives in the browser bundle (`lib/client.js`), which the
 * loader serves through the `dsh.client` manifest entry. The Host half only
 * exists so the package is a valid Cordis plugin on both sides.
 */
export function apply() {}
```

它存在的唯一理由：**让包在 Host 侧是一条合法的 Cordis Loader 行**。dsh-client-modules 的扫描单位是「Loader entry」，只有这一行存在，才会顺着 `name` 找到 package.json、发现 `dsh.client`、进而把 `exports["./client"]` 提供成浏览器 bundle。官方 `dsh-client-ui-settings-agent-loop/lib/index.js` 同样是空 `apply`（该包 README.zh 原话：「宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行」）。

它**不做**任何事：不 `provide` 服务、不注册 Host Config、不提供 Remote API。所以：

- `notix-dsh-ui` 的安装/启用状态与卡片是否出现**没有直接关系**——卡片出现只取决于 Host 是否服务 `notix` 命名空间（§4.4）。
- UI 包没有自己的持久化配置；所有值都写进 Host `notix` 命名空间。

### 2.2 `lib/client.js` 的外壳：手工 CJS bundle

```js
// packages/notix-dsh-ui/lib/client.js:1-8
window.__ModuleLoader__.load({
	id: "notix-dsh-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
```

- 这是 dsh 客户端 bundle 的固定协议：`window.__ModuleLoader__.load({ id, factory })`。**执行 bundle 只注册 factory，没有副作用**；所有副作用（含 CSS 注入）都在 factory 闭包内，等模块被首次 import/物化才跑（`dsh-client-modules/lib/client.js:777-794`，注释在 `:13-27`）。所以「装了插件但没打开 Plugins 页」时几乎零成本。
- `require` 不是 Node require：只按「平台 seed 表 → 已物化模块 → 启动图 row → 已注册 factory」解析（`dsh-client-modules/lib/client.js:841` 的报错文本即证据）。本 bundle 只 require `react` 和 `@deepseek-ai/dsh-client-ui-primitives`，两者都在冻结平台模块表内；因此 `dsh.client.external` 不需要声明任何东西（本包也就没写 `external`）。
- `id` 必须与包名一致（宿主用 manifest 包名作为 bundle 身份，`:730-746`）；`scripts/smoke-client.mjs:15` 默认按 `notix-dsh-ui` 断言。
- 文件末尾 `//# sourceMappingURL=client.js.map`（`:648`）——**工作区没有 `client.js.map`**，浏览器只是 404 一条 map 请求，不影响运行；但说明了它是「仿构建产物手写」的（设计文档 §9.7 也承认）。设计文档「首行 `>` 标记」的说法是解包偏移造成的假象，见 §8。

### 2.3 导出契约：`NS` / `apply` / `inject`（没有 default）

```js
// packages/notix-dsh-ui/lib/client.js:641-644
exports.NS = NS;
exports.apply = apply;
exports.inject = inject;
return module.exports;
```

| 导出 | 值 | 作用 |
| --- | --- | --- |
| `NS` | `"settings.notix"`（`:615`） | 本插件的 locale 字典命名空间；`ctx.locale.bind(NS)` / `register(NS, dict)` 用它。 |
| `apply(ctx)` | `:624-639` | Cordis 插件入口；拿到浏览器端 ctx，完成字典注册与卡片挂载。 |
| `inject` | `["slots","locale","configForms"]`（`:619`） | **Cordis 服务注入**：等这三个 client 服务就绪后才调用 `apply`。没有 `default` 导出，也没有把 Card 组件导出（`NotixCard` 只在模块内部被 `register` 引用）。 |

三个服务的提供方（dsh 0.2.1-rc.2）：
- `slots`：`dsh-client-ui-renderer` 的 `SlotRegistry extends Service`（`super(ctx,"slots")`，`dsh-client-ui-renderer/lib/client.js:1349`）；它属于 Web 外壳组合，启动早于动态插件。
- `locale`：`@deepseek-ai/dsh-client-locale`（本包 `dsh.client.inject` 明确列了它）。
- `configForms`：`dsh-client-ui-settings` 的 `ConfigForms` provider（`dsh-client-ui-settings/lib/client.js:1270-1271`）。

### 2.4 两种 `inject` 必须分清（面试常问）

| | `package.json` 的 `dsh.client.inject` | `lib/client.js` 的 `exports.inject` |
| --- | --- | --- |
| 层级 | **模块到达图**（bundle 加载顺序） | **Cordis 服务注入**（fiber 依赖） |
| 消费者 | dsh-client-modules 浏览器加载器 | Cordis 客户端插件树 |
| 语义 | 先让这些包的 bundle 到达/注册，再加载本 bundle（`dsh-client-modules/lib/client.js:790-793`） | 这些服务不存在就不 apply，服务重启会重新 apply |
| 本包值 | locale / ui-settings / plugin-manager 三个包 | slots / locale / configForms 三个服务 |

之所以两个都要：`dsh.client.inject` 保证「动态提供方先于消费方加载」的静态顺序；`exports.inject` 保证运行时服务就绪与生命周期。

---

## 3. slots 机制：`plugins.item` 是怎么声明和注册的

### 3.1 注册代码原文（client.js 唯一一处挂载）

```js
// packages/notix-dsh-ui/lib/client.js:624-639
function apply(ctx) {
	const t = ctx.locale.bind(NS);
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "notix-dsh-ui: dictionaries");
	const form = ctx.configForms.get(NOTIX_NS);
	ctx.effect(() => ctx.configForms.whileServed([NOTIX_NS], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
		name: "plugins.item",
		id: "notix",
		order: 40,
		label: () => t("title"),
		locale: NS,
		inject: () => ({ form })
	}, NotixCard))), "notix-dsh-ui: page");
}
```

### 3.2 `slots.register(options, Component)` 每个参数的作用与约束

| 参数 | 本包值 | 作用 | 约束/证据 |
| --- | --- | --- | --- |
| `name` | `"plugins.item"` | 目标 slot 名。 | 必须是**父注册声明过的子 slot**，否则渲染端抛 `SlotOwnershipError`（`dsh-client-ui-renderer/lib/client.js:348-350`）。`plugins.item` 由 plugin-manager 的 `main` 注册以 `{kind:"list", scope:"root"}` 声明（`dsh-client-ui-plugin-manager/lib/client.js:4433-4436`）。 |
| `id` | `"notix"` | 注册身份；list slot 里的行 id。 | **list slot 必填**（plugin-manager 源码注释 `:58-61`：`/* v8 ignore next -- list-slot registration requires id */`）。详情页/卡片用 `only: item.id` 过滤渲染（renderer `:1220`），账本（label/order 列表）也按 id 建行（plugin-manager `:49-64`）。 |
| `order` | `40` | list 排序键，缺省 0。 | 渲染时 `[...rows].sort((a,b)=>a.order-b.order)`（renderer `:1204-1222`）。内置四页：subagent 10 / web-search 20 / agent-loop 30 / shell 40（各自 `client.js` 注册处）。**Notix 也用 40，与 shell 并列**；JS 排序稳定，最终次序取决于注册先后（实际由 bundle 到达顺序决定）。 |
| `label` | `() => t("title")` | 卡片标题/详情页标题文本。 | 函数形式，渲染时按当前 locale 求值；plugin-manager 账本 `resolveSlotLabel(entry.options.label)`（`dsh-client-ui-plugin-manager/lib/client.js:58-61`）并用 `ctx.locale.subscribe` 跟随语言切换（`:70`）。 |
| `locale` | `NS`（`"settings.notix"`） | 给组件注入 `t` 座位（`t` 由该字典命名空间 bind 而来）。 | renderer 在装配 entry 时若 `entry.locale !== undefined`，必须已安装 locale face，否则抛 SlotAssemblyError（renderer `:743-746`）；locale revision 变化会让 entry 重渲染（`:1121`）。 |
| `inject` | `() => ({ form })` | 给组件注入额外 props 的工厂。 | 返回值在每次装配时调用并缓存（renderer `:436-460`）；支持 `hooks`/`keyedHooks` 转成 `useXxx` 属性。**与页面 ownerProps 合并时 ownerProps 最后覆盖**（§3.3）。 |
| `Component` | `NotixCard` | 纯函数组件。 | 拿到 `{ t, ...injected, ...ownerProps }`，见 §3.3。 |
| 返回值 | disposer | 注销。 | `SlotRegistry.register = (o,c) => ctx.effect(() => this._register(o,c), "slots.register()")`（renderer `:1814-1817`）——注册天然绑定 fiber 生命周期；`whileServed` 的 `off()` 调这个 disposer。 |

### 3.3 Card 组件拿到的 props（含覆盖顺序，重要）

装配顺序（renderer `ContextualEntry`/`renderEntry`，`:774-810`）：

```js
// dsh-client-ui-renderer/lib/client.js:785-791（节选）
return jsx(Comp, {
  ...kit,               // t、renderSlot、store/actions 等标准座位
  ...injected,          // ← entry.inject() 的返回值，本包是 { form: ConfigFormController }
  ...slotInjected.props,// slot 级注入
  ...contextual,        // slot hook 工厂
  ...ownerProps         // ← renderSlot(key, ownerProps, opts) 的第二个参数，最后覆盖
});
```

本卡片的实际 props：

| 场景 | ownerProps | 最终 `props.form` | 结果 |
| --- | --- | --- | --- |
| 卡片列表折叠态 | `{ view: "summary" }`（plugin-manager `:2682`、`:2740`） | **inject 的控制器** | 正常，渲染一行摘要。 |
| 详情页展开态 | `{ view: "page", form }`（plugin-manager `:2748-2751`） | **被 ownerProps.form 覆盖** | 见 §7.6：这是静态分析发现的高危缺陷。 |

`props.t` 来自 locale 座位，`props.view` 是页面约定的 `"summary" | "page"` 两态（`docs/ui-settings-design.md:9`、`:110`）。此外 renderer 给 entry 注入 `renderSlot` 等（`:755`），本卡片没用到。

### 3.4 为什么需要 `order`/`label`——以及卡片实际落在哪个分组

- `plugins.item` 是 **list slot**，plugin-manager 把账本里的每个 entry 渲染成 `<li data-plugin-item>` 卡片（`ItemCard`，`:2673-2684`），标题取 `item.label`，描述取 `renderSlot("plugins.item",{view:"summary"},{only:item.id})`；点击进入 `ItemDetail`（`:2711-2755`）。
- 账本分组：`renderGroup("basic", t("basicTitle"), basicCards)`（`:4208`），zh 文案 `basicTitle: "内置插件配置"`（plugin-manager 内嵌字典 `:103`）。**所以 Notix 这张第三方卡片会出现在「内置插件配置」分组里**，和 shell/agent-loop 等官方页并列——这是选择 `plugins.item` 的直接后果，README 只写「插件」页卡片，没写分组。
- 官方卡片图标来自写死的 `ITEM_ARTWORK`（shell/agent-loop/subagent/web-search 四个 id），其它 id 回退 `PluginArtworkDefault`（`:2274-2283`）。**`id:"notix"` 没有 artwork，包里的 `icon.png` 在这里不会被使用**（它只用于 bundle 卡片的 `PackageArtwork`）。
- `order` 决定卡片在内置组里的先后；`label` 决定标题与「插件」导航下的可见文本；二者都是「列表账本」需要的信息，缺 label 的 list 条目在账本里显示为空标题。

---

## 4. configForms 机制：真实的控制器 API 与门控

### 4.1 `ctx.configForms.get('notix')` 返回什么

返回 **`ConfigFormController`**（每个 entryId 一个，重复 get 得同一实例，`dsh-client-ui-settings/lib/client.js:1295-1302`）。真实公开 API 只有下表这些：

| 成员 | 签名 | 语义（证据） |
| --- | --- | --- |
| `getSnapshot()` | `() => {status,value,base,user,revision,writable}` | 同步快照；引用稳定直到下次变化（`:1122-1125`、`:1109-1116`）。**没有 schema 字段**。 |
| `subscribe(listener)` | `(fn) => disposer` | 快照替换时回调，返回退订器（`:1131-1133`）。 |
| `set(field, value)` | 顶层单字段写 | 等价 `mutate([{op:"set",path:[field],value}])`（`:1141-1147`）。 |
| `unset(field)` | 顶层单字段清 | 等价 `mutate([{op:"unset",path:[field]}])`（`:1154-1159`）。 |
| `mutate(ops, expectedRevision?)` | `(ops, rev?) => Promise<boolean>` | **唯一的嵌套写通道**；写队列串行化；Host 接受返回 `true`，拒绝返回 `false`（`:1166-1183`）。 |
| `dispose()` | `() => Promise<void>` | 停止派生、等最后一个上线请求结束（`:1195-1200`）。 |

**任务简报里提到的 `save`/`reset`/`dirty`/`error`/`patch` 在 0.2.1-rc.2 的控制器上并不存在**：没有显式 save（`mutate` 即写）、没有 reset（需自己发 `{op:"unset"}`）、没有 dirty 状态（要 UI 自己比较 `value` 与 `base`/草稿）、没有 error 字段（失败只通过 `mutate` 的 `false`/reject 表达）。本 UI 也没有实现这些：它没有「保存」按钮，没有「恢复默认」，不做脏标记（设计文档 §7 明确「即改即存」的取舍）。

### 4.2 `mutate` 的写队列与失败恢复（Host 侧事实）

```js
// dsh-client-ui-settings/lib/client.js:1166-1183（节选）
mutate(ops, expectedRevision) {
  const generation = ++this.writeGeneration;
  return this.enqueue(async () => {
    const revision = expectedRevision ?? this.pendingRevision ?? this.getSnapshot().revision;
    const response = await this.ctx.remote.settings.mutate(this.spec.namespace, ops, revision);
    if (!response.ok) { await this.recover(generation); return false; } // 失败：mirror.load() 重读 Host 真值
    if (generation === this.writeGeneration) { this.mirror.acceptView(response.value); } // 成功：应答折进共享镜像
    return true;
  });
}
```

要点：ops 先 `structuredClone`（`:1167`）；写入按 `tail` Promise 串行（`:1201-1209`）；`revision` 是乐观并发控制，Host 端 revision 不一致抛 `SettingsConflictError`；失败会自动重读 Host 值（`:1184-1189`）并让 UI 的快照回弹。

### 4.3 快照内容与 `derive()`

```js
// dsh-client-ui-settings/lib/client.js:1210-1232（节选，合并了 writable 赋值）
derive() {
  const mirrored = this.mirror.getSnapshot();
  if (mirrored.view === undefined) return;
  const view = mirrored.view.namespaces.find((c) => c.ns === this.spec.namespace);
  if (view === undefined) { this.store.update((d) => { d.status = "unavailable"; d.writable = mirrored.view.writable; }); return; }
  const decoded = this.decode(view);
  this.store.update((d) => {
    d.revision = view.revision; d.base = view.base; d.user = view.user; d.writable = mirrored.view.writable;
    if (decoded !== undefined) { d.status = "ready"; d.value = decoded; }
  });
}
```

- `status`：`"loading" | "ready" | "unavailable"`；`value` 是 **有效值**（Host 端 `projectForm(form, plainConfig(entry.fiber.config))`，即默认值已合并后的结果），`base` 是继承层，`user` 是用户覆盖层，`writable` 来自 `describe().writable`。
- 命名空间不再被服务时控制器转 `unavailable`——本卡片对它有兜底文案（`client.js:364`），但 `whileServed` 已经先一步撤卡，所以正常路径看不到。

### 4.4 `whileServed(['notix'], register)` 的门控逻辑（精确版）

```js
// dsh-client-ui-settings/lib/client.js:1316-1335
whileServed(namespaces, register) {
  let off;
  const sync = () => {
    const served = new Set(this.mirror.getSnapshot().view?.namespaces.map((v) => v.ns) ?? []);
    const watched = namespaces.some((ns) => served.has(ns));
    if (watched && off === undefined) off = register(served);
    else if (!watched && off !== undefined) { off(); off = undefined; }
  };
  const unsubscribe = this.mirror.subscribe(sync);
  this.mirror.ensure();
  sync();
  return () => { unsubscribe(); off?.(); off = undefined; };
}
```

- `register` 收到**当前被服务的全部命名空间集合** `served`；官方 shell 页就用它决定注入 bash 还是 pwsh 的控制器（`dsh-client-ui-settings-shell/lib/client.js:183-189`）。本包只有一个命名空间，直接忽略参数、固定注入 `notix` 的控制器。
- `whileServed` 本身**不在调用方 ctx 上注册任何东西**（注释 `:1303-1314`），调用方必须把返回的 disposer 包进 `ctx.effect`——本包正是这么做的（`client.js:631-638`）。
- 门控触发条件：`!watched && off===undefined` 时**不**注册；一旦命名空间出现才 `register`。所以「Host 未安装 / Host 未把字段标 volatile / Host schema 构建失败」→ `settings.describe()` 不返回 `notix` → `whileServed` 永不注册 → **卡片完全不出现，页面无任何痕迹**。`client.js:630` 的 `configForms.get(NOTIX_NS)` 是 apply 时无条件执行的，但它只创建控制器 + `mirror.ensure()`，不注册 slot，所以不违反门控。

### 4.5 "schema 驱动表单"的真实情况（与任务预期不同，务必按事实写）

- Host 端确实把 schema 送下来了：`settings.describe()` 返回的 namespace view 里有 `schema: form.toJSON()`（`dsh-settings/lib/index.js:419-446`，`schema = volatileForm(schema)`，并带 `applies:"live"`）。
- 但 **`ConfigFormController` 的快照里没有 schema**，`get()` 也不接收 schema；浏览器侧另有 `ctx.settingsSchema` 服务负责 schema 重建/校验/嵌套编辑（`dsh-client-ui-settings` README.zh「Schema 服务」）。
- 本卡片**没有一个字段是从 schema 生成的**：5 组触发器、静默时段、内容、渠道全部手写 JSX；字段名/嵌套路径/默认值在 `client.js:314-326` 手抄了一份 `DEFAULTS`。
- 所以准确说法是：**Host schema 决定「这个命名空间能不能出现在设置里」以及写入合法性；UI 自己重复定义字段结构与默认值，schema 不驱动表单生成。** `docs/ui-settings-design.md:10`、`DESIGN.md:97` 的「schema 驱动配置表单 / schema 即单一事实源」是设计意图，不是当前实现（见 §8）。

---

## 5. `lib/client.js` 逐段走读（648 行）

### 5.1 骨架分段速览

1-8 bundle 外壳 · 9-128 字典（en 11-68 / zh 70-127，各约 57 key）· 129-142 CSS · 143-311 控件原语与 hooks · 313-344 默认值与摘要 · 345-605 `NotixCard` · 607-639 插件入口 · 641-644 导出。

### 5.2 字典（11-127）

中英各一份纯对象，key 覆盖标题、摘要词、状态文案、分区标题、字段标签、hint、枚举文案、错误文案。`testNotify` 的 en/zh 都把「测试按钮是后续能力」写进了 hint（`:65-66`/`:124-125`），和禁用态按钮呼应。字典内嵌是硬约束：client bundle 不能 require 相对文件（设计文档 §9.6 也承认）。

### 5.3 样式（129-142）

```js
// client.js:131-140（节选）
const CSS = ".notix-card .notix-summary{...}.notix-card .notix-status-error{color:var(--dsw-alias-state-error-primary,#d03050)}...";
const CSS_TAG = "notix-dsh-ui/card.css";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") !== null) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "notix-dsh-ui"; tag.dataset.pluginCss = CSS_TAG;
  tag.textContent = CSS; document.head.appendChild(tag);
}
```

- 单文件、单次注入、`data-plugin-css` 幂等标记；类名全部 `.notix-*` 前缀隔离；只写布局（flex/gap/缩进/透明度），颜色只引用主题变量 `--dsw-alias-state-error-primary`（带 hex 回退），跟随明暗主题。
- 注入时机在 `NotixCard` 的 `useEffect`（`:355-357`），即首次渲染后；模块系统的样式归属在 factory 物化时采集（`dsh-client-modules/lib/client.js:618-631`），因此热替换/停用时的样式回收对这条 tag 不是强保证——小事，但可作「手写 bundle 与构建产物差异」的谈资。

### 5.4 状态管理：React hooks + 外部 store 订阅，没有 signal/自研 store

```js
// client.js:146-151
/** Subscribe to the config form snapshot and re-render on every change. */
function useSnapshot(form) {
  const [snap, setSnap] = react.useState(() => form.getSnapshot());
  react.useEffect(() => form.subscribe(() => setSnap(form.getSnapshot())), [form]);
  return snap;
}
```

- 唯一的全局状态是 `ConfigFormController` 的快照；组件用 `useState` 镜像 + `subscribe` 返回的 disposer 清理（`useEffect` 返回值即 disposer）。
- 组件内另有 `pending` 计数与 `result` 状态（`:353-354`）用于写入中/结果提示，都是局部 `useState`。
- 草稿模型：`useDraft(display)` 用 `useState + useRef(editing)`，未聚焦时跟随外部快照（`:152-164`），避免 Host 回写覆盖正在输入的用户。

### 5.5 控件原语（143-311）

- `SwitchRow`（166-173）：复用 primitives 的 `Switch`（`checked/label/disabled/onChange(next)`），可带 hint。
- `NumberField`（178-222）：draft 文本，失焦/Enter 才 commit；`parse` 返回 null 即非法——保留输入、`aria-invalid` + `aria-describedby` + `role="alert"` 就地报错，不写配置。
- `MinutesField`（224-235）：毫秒↔分钟，显示两位小数（`:228`），提交 `Math.round(min*60000)`（`:229-233`）。
- `CountField`（237-252）：整数 0–10、step 1，对齐 Host `maxReminders` 的 `.min(0).max(10)`；越界当非法。
- `TimeField`（254-266）：原生 `<input type="time">`，`/^\d{2}:\d{2}$/` 通过即 onChange 提交（无失焦缓冲）。
- `SelectField`（268-276）/ `TextField`（278-306）：枚举写死（zh/en、minimal/normal）；文本 draft + 失焦/Enter 提交，空串合法。
- `Section`（308-310）：`<section><h3>` 分区。

### 5.6 `NotixCard`（350-605）

结构：
```js
// client.js:350-367（节选）
function NotixCard(props) {
  const { t, form } = props;
  const snap = useSnapshot(form);
  const [pending, setPending] = react.useState(0);
  const [result, setResult] = react.useState("idle");
  react.useEffect(() => { injectStyles(); }, []);
  if (props.view === "summary") {
    if (snap.status !== "ready" || snap.value === undefined) return t("description");
    const s = summarize(snap.value);
    return `${t("summaryTriggers")}: ${s.enabledCount}/5 · ...`;
  }
  if (snap.status === "loading") return h("div", { className: "notix-card" }, t("loading"));
  if (snap.status === "unavailable") return h("div", { className: "notix-card" }, t("unavailable"));
  const v = snap.value || {};
  const writable = snap.writable !== false;
  const disabled = pending > 0 || !writable;
```

- **摘要态**（`:358-362`）：`已启用触发器 n/5 · 免打扰 开/关 · macOS 渠道 开/关`；快照未 ready 时退化为静态 description。详情页顶部也常驻同一行摘要（`:390`）。
- **提交函数**（`:368-377`）：`commit(path, value)` 用计数器包住 `form.mutate([{op:"set",path,value}])`，`true→"saved"`、`false/reject→"failed"`，`finally` 减计数。**每次修改一次写、没有合并/防抖**。
- **默认值兜底**（`:313-343`）：`DEFAULTS` 镜像 Host schema，`group(value, fallback)` 做浅合并，`summarize` 统计启用组数；`TRIGGER_GROUP_KEYS`（`:344`）固定 5 组。
- **五个触发器分区**（`:390-516`）：每组「组开关 + 缩进子项」；子项 `disabled = disabled || !group.enabled`，容器带 `notix-sub-disabled` 降透明度（`:387-389`）。审批：提醒间隔、最多提醒次数；提问：提醒间隔、持续提醒；长任务：轮次/任务阈值；错误：冷却、工具错误、工具超时；完成：任务完成通知最短时长、包含后台任务。
- **静默时段**（`:516-541`）：启用开关 + 两个 `TimeField`（from/to）+ `allowUrgent`。**不校验 from>to**，跨午夜语义交给 Host（设计文档 §9.5 承认）。
- **通知内容**（`:542-561`）：语言下拉 zh/en、详略程度 minimal/normal，值来自 `v.language/verbosity`。
- **macOS 渠道**（`:562-599`）：enabled/sound/clickToOpen 开关 + baseUrl 文本 + **禁用态测试按钮**（`disabled: true`，`title` 说明需要 Host 侧接口，`:591-599`）。Host 没有暴露 Remote 能力（`grep -rn "remote\|typert" packages/notix-dsh/lib` 无结果），UI 不臆造 API。
- **状态区**（`:600-604`）：`role="status" aria-live="polite"`；优先级 `!writable → readOnly` > `pending>0 → saving` > `failed(role=alert)` > `saved`；writable 时常驻「修改即时生效」。

### 5.7 交互细节汇总

| 维度 | 实现 |
| --- | --- |
| 乐观更新 | **没有**。没有本地覆盖值，显示值永远来自快照；写入期间只禁用控件并显示「保存中…」，成功后靠快照/镜像回显。设计文档称「即改即存」，不是「乐观更新」。 |
| 并发写 | `pending` 计数器禁用全部控件；控制器本身也会把写排队（`mutate` 的 `tail`），双保险。 |
| 校验失败 | 不写配置；draft 保留 + `aria-invalid` + `role="alert"`（`:183-192`、`:221`）。 |
| 服务端拒绝 | `mutate` resolve `false` 或 reject → `result="failed"` → 文案 + `role="alert"`；Host 快照回弹，draft 不被清掉（未聚焦时同步 effect 会更新，但值本来就没变）。 |
| 只读部署 | `writable === false`：所有控件禁用 + 只读文案。 |
| 键盘 | 原生可聚焦元素；Enter 提交并 blur（`:214-220`、`:298-304`）；Tab 顺序即文档顺序。 |
| 标签/播报 | `<label htmlFor>` + `aria-label`；`invalid` 消息 `id` 与 `aria-describedby` 关联；状态区 `aria-live="polite"`、保存失败 `role="alert"`。 |
| i18n | 所有文案走 `t()`；`en`/`zh` 字典注册在 `"settings.notix"`；`label: () => t("title")` 让卡片标题随语言变化。 |
| 样式 | 单串 CSS + 主题变量 + `notix-` 前缀；共享 `Switch` 原语保证与全局开关一致。 |

---

## 6. 保存链路端到端（UI 改值 → Host 生效 → UI 回显）

以「用户关闭审批提醒」为例：`commit(["triggers","approval","enabled"], false)`。

| # | 跳 | 位置（行号） | 发生了什么 |
| --- | --- | --- | --- |
| 1 | UI 事件 | `client.js:390-395` → `:368-377` | `Switch.onChange(false)` 调 `commit(...)`，`pending+1`，`form.mutate([{op:"set",path:["triggers","approval","enabled"],value:false}])`。 |
| 2 | 控制器写队列 | `dsh-client-ui-settings/lib/client.js:1166-1183` | `structuredClone(ops)`；`revision = snapshot.revision`；`ctx.remote.settings.mutate("notix", ops, revision)` 串行入队。 |
| 3 | Remote → Host 控制器 | `dsh-api-settings-controller/lib/index.js:434-436` → `:462-477` | Typert `settings.mutate` 进 `settingsController.write`，校验 ns 形状后调 `settings.mutate(namespace, ops, expectedRevision)`，成功返回该 namespace 的新视图（已脱敏）。 |
| 4 | Host settings 校验/合并 | `dsh-settings/lib/index.js:489-538` | 找到 entry（`:503`）、schema（`:504`）、`volatileForm`（`:506`，为空直接报错 `:507`）；逐 path 检查 `isVolatilePath`（`:508`）；`configEditor.edit` 内用 `applyPathOp` 按**多段嵌套 path** 合并（`:490-500`）；revision 不符抛 `SettingsConflictError`（`:512`）；`validatePaths` 禁止非 volatile（`:514-524`）；`strip` 掉普通字段后 `mergeLayers`（`:525-535`）。 |
| 5 | 写 profile patch | `dsh-config-editor/lib/index.js:70-136` | `withFileLock(profile/package.json)`（`:73`）；重读/校验补丁（`:75-77`）；`internal/config` waterfall + `resolveConfig` 校验候选（`:83-84`）；解析 profile `cordis.patch.yml`，找到该 entry 最后一行（`:99`），无变化则删 config 行（`:100-105`），否则写/替换 `config`（`:106-111`）；核对 compose 结果一致（`:123`）；`writeFileAtomic`（`:124`）；`reconcileProfilePatches([entry.id])` 触发 Loader 重载（`:126`），失败回滚（`:127-130`）；整段与 HMR 串行（`:134-135`）。 |
| 6 | Loader 热提交（不重载插件） | `cordis-plugin-loader/lib/index.js:378-389`、`:396-428` | 检测到变更只有 `config` 且 `equalExceptVolatile` 为真（`:383`，`equal()` 遇 `schema.meta.volatile` 直接返回 true → `:261`）→ `fiber._config = config`（`:384`）→ `_commitVolatile()`：`internal/config` 解析候选（`:403`）、逐个 volatile ref 比较并 `updateVolatile`（`:413-418`）、`fiber.ctx.emit(self, "loader/volatile-update", paths)`（`:423`）。**fiber 不 dispose、不重启。** |
| 7 | Host 插件重读配置 | `packages/notix-dsh/lib/index.js:61-69` | `ctx.on("loader/volatile-update", () => core.replaceConfig(readConfig(rawConfig)))`；`readConfig` 先 `unwrapVolatile` 再 `resolveConfig` 合并默认值（`packages/notix-dsh/lib/config.js:105-124`）。`rawConfig` 里的叶子是 `{get()}` 引用，`unwrapVolatile` 逐个 `get()`。 |
| 8 | UI 回显 | 两路汇合：写应答 + 事件 | ① 写应答 `response.value` 被 `mirror.acceptView` 折进共享镜像（`dsh-client-ui-settings/lib/client.js:1177-1180`）。② Host `settings.describe()` 每次写后重算并 emit `settings/document-updated`（`dsh-settings/lib/index.js:436`、`:462`）；浏览器镜像订阅它并 `mirror.load()`（`dsh-client-ui-settings/lib/client.js:1486-1499`），`connection/reset` 也刷新（`:1492-1494`）。③ 镜像变化 → `ConfigFormController.derive()` 更新快照（`:1210-1232`）→ `subscribe` 回调 → `useSnapshot` `setSnap` → React 重渲染。 |

关键结论：

- **唯一的写通道是 `mutate`**；`set/unset` 只是顶层单字段的语法糖，嵌套结构必须 `path` 数组（设计文档 §3「提交路径」正确）。
- **volatile 是整条链路的前提**：没有 `.volatile()` → step 4 的 `volatileForm` 早退 → 命名空间根本不进 `describe()` → 既写不动也没有卡片。
- **没有「保存按钮」也能持久化**：每次交互直接写 profile patch；Loader 对 volatile-only 变更走热提交，所以「即改即存 + 不重载插件」。
- 写入是**服务端权威**：UI 不乐观改本地值；成功/失败都靠快照刷新，因此多客户端/外部 YAML 编辑也能收敛（revision 冲突时失败重读）。

---

## 7. Host ↔ UI 契约与失败模式

### 7.1 身份契约

| 契约 | 值 | 不匹配后果 |
| --- | --- | --- |
| Host entry id = 配置命名空间 | `notix`（Host `cordis.patch.yml` 第 5 行 `id: notix`；`packages/notix-dsh/lib/index.js:16` `export const name='notix'`） | `whileServed(['notix'])` 找不到命名空间 → 卡片永不出现；`get('notix')` 的命名空间写请求会被 Host 拒。 |
| UI 注册 id | `notix`（`client.js:633`） | 只是列表/详情身份；改它不影响配置，但会影响 `only` 过滤与账本。 |
| 字典命名空间 | `settings.notix`（`client.js:615`） | 与 Host entry 无关，只影响文案；`label`/`t` 都依赖它注册成功。 |
| locale meta 文件名 | `locale/{zh,en}.json` 的 `meta.title/description` | 只影响清单展示；缺 en 会回退包名/描述。 |

### 7.2 字段名/默认值契约（UI 手抄 vs Host schema）

UI 的 `DEFAULTS`（`client.js:314-326`）与 Host schema（`packages/notix-dsh/lib/schema.js:22-93`）/运行时默认值（`lib/config.js:11-59`）对照：

| 字段 | Host schema 默认 | UI DEFAULTS | 一致？ |
| --- | --- | --- | --- |
| `language` / `verbosity` | `zh` / `minimal` | 同 | ✅ |
| `quietHours` | `false / "23:00" / "08:00" / true` | 同 | ✅ |
| `triggers.approval` | `true / 300000 / maxReminders 2` | 同 | ✅ |
| `triggers.userQuestion` | `enabled/remindAfterMs 300000/remindOnContinued true` **+ Host 还有 `maxReminders:2`** | 无 `maxReminders` | ⚠️ UI 不暴露该字段（上滑值保留，但用户改不到） |
| `triggers.longTask` | `600000 / 900000` | 同 | ✅ |
| `triggers.error` | `60000 / toolErrors false / toolTimeout false` | 同 | ✅ |
| `triggers.completion` | `180000 / jobs true` | 同 | ✅ |
| `channels.macos` | `enabled/sound/clickToOpen true, baseUrl ""，**另有 `notifierApp`/`appIcon`**` | 无后两项 | ⚠️ UI 不暴露两个隐藏字段 |
| （未使用） | — | `DEFAULTS` 是普通对象、未冻结，也不是导入 Host schema | 说明「镜像」是手工维护，schema 变更时容易漂移 |

**字段名拼错会怎样**：`settings.write` 先按 schema 校验 path 是否 volatile（`dsh-settings/lib/index.js:508`），`validatePaths` 再确认新值里每个 key 都属于 volatile form（`:514-524`）。拼错/越权字段会抛错 → Remote 返回 `ok:false` → UI `mutate` 得到 `false` → 显示「本部署没有接受这些值…」并回读 Host 快照。**不会静默写坏 YAML，但用户只能看到笼统失败文案**（没有字段级错误映射）。

### 7.3 volatile 契约（最容易踩的坑）

- Host 每个可编辑叶子都 `.volatile()`（`schema.js:27-32`、`:42-88`）。`dsh-settings` 的 `volatileForm(schema)` 递归收集带 volatile 的叶子，若一个都没有则整个命名空间不暴露（`dsh-settings/lib/types/schema.js:43-57`；`lib/index.js:419-420`）。
- 所以：**不是 volatile → `settings.describe()` 不返回 notix → `whileServed` 不注册卡片 → 不只是「表单不可编辑」，而是整张卡片凭空消失。** `DESIGN.md:100` 把这条列为「实现期踩到的坑，已修复」，与代码一致。
- volatile 也是 Loader 热提交的条件（`equalExceptVolatile`，`cordis-plugin-loader/lib/index.js:286-288`、`:383-386`）；非 volatile 字段的修改会退回普通重载路径（fiber 重建），那就违背「即时生效不重载」的设计目标。

### 7.4 失败/降级矩阵

| 场景 | 用户看到 | 依据 |
| --- | --- | --- |
| Host 未安装（没组合 `notix-dsh`） | 完全看不到卡片 | `whileServed` 不注册（`dsh-client-ui-settings/lib/client.js:1316-1335`）；README 与设计文档都强调这点。 |
| Host 装了但 schema 构建失败（schemastery 解析不到） | 同上（卡片消失），Host 仍用 `resolveConfig` 默认值工作 | `packages/notix-dsh/lib/index.js:21-33`：`Config=undefined` → `settings.describe()` 里 `schema(entry)` 返回 undefined（`dsh-settings/lib/index.js:539-542`）→ 该行被跳过（`:416-420`）。 |
| Host 字段漏标 volatile | 同上 + 写请求报“no volatile fields” | 见 §7.3。 |
| 只读部署 | 卡片在、字段全禁用、状态区显示只读原因 | `snap.writable === false`（`client.js:366-367`、`:604`）。 |
| 连续点击/快速改写 | 控件禁用 + 「保存中…」，写队列串行 | `pending` 计数器（`:353`、`:367-377`）+ 控制器 `tail`（`dsh-client-ui-settings/lib/client.js:1201-1209`）。 |
| revision 冲突（另一个客户端/手改 YAML） | 「保存失败」+ 快照回弹到 Host 最新值 | `SettingsConflictError`（`dsh-settings/lib/index.js:164-178`、`:512`）→ `ok:false` → `_recover` 重读（`dsh-client-ui-settings/lib/client.js:1184-1189`）→ UI `failed` 文案（`:600-604`）。 |
| 数字非法/越界 | 不写配置，就地红字 + `aria-invalid` | `client.js:183-192`、`:221`。 |
| Host 侧缺少 Remote 测试通知能力 | 按钮禁用 + hint 说明 | `client.js:591-599`；Host 无 remote/typert（设计文档 §9.2 的 grep 结论）。 |
| 版本不匹配（dsh < 0.2.1-rc.2 或 0.3.x） | 轻则卡片不出现，重则 render 抛错后被 slot 错误边界兜住（只显示一个错误占位，不白屏） | 契约来自 0.2.1-rc.2；renderer 每个 entry 有 `SlotErrorBoundary`（`dsh-client-ui-renderer/lib/client.js:632-647`、`:1152-1172`）。 |
| UI 包被停用/卸载 | 卡片消失、字典注销、slot 注册随 fiber 销毁 | `register` 包 `ctx.effect`（renderer `:1814-1817`）；`ctx.locale.register` 同样在 `ctx.effect` 里（`client.js:626-629`）。 |

### 7.5 版本不匹配风险（面试可讲的「契约面」）

本包强依赖 0.2.1-rc.2 的三个事实：
1. `ctx.configForms.get(entryId)` 返回带 `mutate(ops, revision)` 的控制器（`dsh-client-ui-settings`）。
2. `plugins.item` 是 list slot，`view` 取 `"summary" | "page"`，详情页会把 `form` 放进 ownerProps。
3. `dsh.client` 清单形态（`platform:"web"` + `exports["./client"]`）。

`engines.dsh` 只覆盖前两个大版本窗口。若上游把控制器改成官方 `SettingsFormModel` 风格（agent-loop 页已用 `SettingsForm`/`SettingsValueField`），本卡片需要重写；若 slot props 契约变化（例如不再覆盖 inject），也可能反向破坏。**建议在指南里写成「以解包源码为事实基线、以 engines 为兼容声明」**。

### 7.6 ⚠️ 静态分析发现的高危缺陷：详情页 `props.form` 被页面覆盖

**结论**：列表页的折叠卡片（summary）正常；**点进详情页（view === "page"）时 `NotixCard` 收到的 `props.form` 不是 `ConfigFormController`，而是 plugin-manager 传的 `{ state, mutate }` 投影对象；`client.js:352` 立刻调用 `form.getSnapshot()` → TypeError → 该 slot 条目被错误边界替换成错误占位。**

证据链（全部来自 0.2.1-rc.2 解包源码）：

1. 详情页把 `form` 作为 ownerProps 传给 `plugins.item`：
```js
// dsh-client-ui-plugin-manager/lib/client.js:2743-2753（节选）
children: [jsx("section", {
  "data-plugin-config": true,
  children: renderSlot("plugins.item", {
    view: "page",
    form
  }, { only: item.id })
}), renderSlot("plugins.detail.section", { subject })]
```
2. `form` 的构造是 `{ state, mutate }`，不是控制器：
```js
// dsh-client-ui-plugin-manager/lib/client.js:3834-3841
const formFor = (id) => {
  if (!configurations?.some((view) => view.ns === id)) return void 0;
  const form = props.configForm(id);            // 真正的 ConfigFormController
  return {
    state: form.getSnapshot(),
    mutate: (ops, revision) => form.mutate(ops, revision)
  };
};
```
3. renderer 合并 props 时 ownerProps **最后**展开，覆盖 entry 的 `inject()`（`dsh-client-ui-renderer/lib/client.js:785-791`）。
4. 本卡片在读取 `view` 之前就解构并使用了 `form`：
```js
// packages/notix-dsh-ui/lib/client.js:350-354
function NotixCard(props) {
  const { t, form } = props;
  const snap = useSnapshot(form);     // ← page 视图下 form = {state, mutate}
  const [pending, setPending] = react.useState(0);
  const [result, setResult] = react.useState("idle");
```
`useSnapshot` 第一行就是 `form.getSnapshot()`（`:148`）→ 不存在 → 抛 TypeError。

影响与旁证：
- renderer 对普通 entry 有错误边界，`getDerivedStateFromError` 返回失败态并渲染 `<div data-slot-error="plugins.item">`（`dsh-client-ui-renderer/lib/client.js:632-647`），所以是「详情页配置区变成错误占位 + 控制台报错」，不是整页白屏。
- 官方四页都不读 `props.form`：agent-loop 用 `props.useAgentLoopCard`/`props.save`，shell/subagent/web-search 用 `inject()` 注入的 hooks/actions（例如 `dsh-client-ui-settings-agent-loop/lib/client.js:63-90`、shell `:183-190`）。本卡片是全仓唯一「同时用 inject 的 form、又撞上 ownerProps.form」的写法。
- `scripts/smoke-client.mjs` 完全不渲染组件，因此**发现不了**这个问题（§9）。
- 复现成本低：装好两个包 → Plugins 页 → 点 Notix 卡片。设计文档 §8 明确写了「未在运行中的 GUI 实测」，所以这是文档已承认的验证空白，不是文档撒谎。
- 修复方向（交给 Lead/作者，不在本任务改源码）：① 卡片改用 `props.form?.state` + `props.form?.mutate`（页面契约）；或 ② inject 换成不冲突的名字（如 `controller`），页面态/摘要态都自己订阅控制器；或 ③ 两种都兼容（`typeof form.getSnapshot === "function" ? form : ...`）。按官方先例，①/② 都可，但 ③ 最稳。

---

## 8. `docs/ui-settings-design.md` 要点与实现对照

### 8.1 文档要点（结构复述）

138 行，9 节（挂载、信息架构、控件选型、状态设计、文案表、可访问性、视觉一致性、实现依据、已知限制）。核心断言：id `notix-dsh-ui`、patch 以 `ui-notix` 插入；挂载 = `slots.inject` + `effect(whileServed(['notix']))`；唯一读写通道是 `ConfigFormController`（因配置嵌套而不用 `SettingsFormModel`）；6 段信息架构；快照 `{status,value,base,user,revision,writable}` 状态机；共享 `Switch`、`<style data-plugin-css>` 注入、状态区措辞与内置页对齐；有意差异 = 即改即存、无保存按钮；已知限制 8 条（热更新不重载 / 无测试通知 / 无恢复默认 / 分钟精度 / 跨午夜不校验 / 字典内嵌 / bundle 首行 `>` / 未 GUI 实测）。

### 8.2 与代码一致的地方（抽查结果）

| 文档断言 | 代码证据 | 判定 |
| --- | --- | --- |
| 挂载结构 / 摘要/加载/不可用/只读/保存中/失败 | `client.js:631-638`、`:358-367`、`:600-604` | ✅ |
| 只有 `configForms.get('notix')` 读写 | `client.js:630`、`:370` | ✅（详情页会被覆盖，见 §7.6） |
| 分钟两位小数、maxReminders 0–10、time `HH:MM` | `client.js:228-233`、`:237-252`、`:254-266` | ✅ |
| 嵌套 path `mutate` / 快照字段 / `pending` 禁用 / 失败保留草稿 | `client.js:370`、`:367`、`:157-164`；`dsh-client-ui-settings/lib/client.js:1109-1116` | ✅ |
| locale 字典 `settings.notix` / 共享 `Switch` / CSS 单次注入 | `client.js:615`、`:626-629`、`:167`、`:131-141` | ✅ |
| 文案表 | `client.js:11-127` | ✅ 基本逐字一致 |
| 热更新链路 / 无测试通知 / 无恢复默认 / 未 GUI 实测 | 见 §6、`:591-599`（Host 无 remote）、全文件无 `unset` | ✅（未实测与 §7.6 相符） |

### 8.3 偏差/需要修正的地方

| # | 文档说法 | 代码/事实 | 建议写法 |
| --- | --- | --- | --- |
| 1 | §1/§8：「`configForms.get` 得到 **schema 驱动**的配置表单；schema 即单一事实源」 | 控制器快照没有 schema；卡片字段全部手写，默认值手抄 `DEFAULTS`（`client.js:314-326`）；schema 只负责「命名空间是否可服务 + 写入校验」 | 改成「Host schema 决定可用性与写入合法性；UI 手工镜像字段结构」 |
| 2 | §2/§3 只描述卡片内容 | 卡片实际出现在 Plugins 页的 **「内置插件配置」分组**（plugin-manager `t("basicTitle")`），不是「已安装 bundle」列表 | 补一句挂载位置 |
| 3 | §3：「所有输入都带显式 id + `<label htmlFor>`」 | 数字/时间/文本/下拉是；`SwitchRow` 用的是 primitives 的 `Switch`，自身不渲染 `<label htmlFor>`，依赖原语内部（`client.js:166-173`） | 加限定词「原生 input/select」 |
| 4 | §4：「快照值渲染使用与 schema.js **完全一致**的默认值」 | 渲染字段一致；但缺 `userQuestion.maxReminders` 与 `macos.notifierApp/appIcon`（Host 有、UI 没有），所以「完全一致」偏强 | 改为「对已渲染字段一致」 |
| 5 | §7：「与内置设置页相同的注册结构，折叠/展开行为与内置页无异」 | 结构一致；详情页存在 §7.6 的 props 覆盖缺陷，静态分析判定会崩溃 | 加风险注记或先修代码 |
| 6 | §9.7：「官方 bundle 首行有一个孤立 `>`，服务端下发前剥离；本包不写该前缀」 | **假象**：`.guide-work/asar-extract.py` 的 `BASE_OFFSET` 偏移 2 字节，所有解包文件首部多出前一个文件末尾 2 字节；以 offset+2 复读，`window.__ModuleLoader__.load({` / `import {` 才是真正首行。官方 bundle 并没有 `>`，本包写法正确 | 删掉这条限制，避免误导 |
| 7 | §8 引用的 `/tmp/dsh-asar/...` 路径 | 当前环境无此目录；应以 `app.asar` 解包/`dsh-client-ui-*` 包源码为准 | 改成可复现的解包步骤 |
| 8 | §9.8 未实测 | 与 §7.6 一致；建议把它升级为「已知未验证风险」而不是泛泛的「未实测」 | 见 §7.6 |
| 9 | §1 说不用 `SettingsFormModel` 因为「只覆盖顶层单字段」 | 方向正确（`settingsNumberField` 是顶层字段封装），但严格说 `SettingsFormModel` 能配合 `ConfigField` 做嵌套；真正原因是手写更快、且要复刻 host 默认值兜底 | 表述可弱化为「取舍」而非「不能」 |
| 10 | 设计文档未提 `order: 40` 与内置 shell 撞序 | `client.js:634`；shell 也是 40（`dsh-client-ui-settings-shell/lib/client.js:186`） | 指南可点出「并列 40，实际次序由到达顺序决定」 |

---

## 9. `scripts/smoke-client.mjs` 与 UI README

### 9.1 冒烟的是什么契约（不是渲染）

94 行，做的事：

```js
// scripts/smoke-client.mjs:1-10（节选注释）
/**
 * Smoke-test a dsh client plugin bundle without a browser.
 * Evaluates `lib/client.js` in a VM with a stubbed `window.__ModuleLoader__`
 * and a stub `require`, then asserts the bundle registers the expected plugin
 * id and exposes `apply`/`inject`. This catches syntax errors, missing module
 * ids, and factory-shape regressions — not rendering behavior.
 */
```

具体断言（`:87-94`）：① VM 内执行 bundle，语法合法且不依赖浏览器全局（本包 `injectStyles` 有 `typeof document === "undefined"` 守卫，Node 下不炸）；② 必须且只能调用一次 `window.__ModuleLoader__.load({id,factory})`（`:78-85`、`:89`）；③ `registered.id === "notix-dsh-ui"`；④ factory 返回对象必须有 `apply` 函数且 `inject` 是数组（`:91-93`）；⑤ `require` 只允许 `react`、`react/jsx-runtime`、`dsh-client-ui-primitives`、`dsh-client-store` 四个模块（`:65-75`），本 bundle 只命中前两个——**未来若 bundle 依赖未列出的平台模块，冒烟会以 `client bundle requires an unavailable module` 失败，这是它最有价值的防线（构建期 externals 漂移）**；⑥ 输出 `OK … id=… apply=function inject=[…]`（本次实测结果）。

它**故意不覆盖**：React 渲染、hooks 行为、slot 装配、configForms 交互、i18n。因此 §7.6 这类「运行时 props 契约」缺陷冒烟发现不了。面试时可用它说明「静态冒烟 vs 装配契约」的边界。

### 9.2 根 `package.json` 脚本

- `"smoke": "node scripts/smoke-client.mjs"`
- `"test:ui": "node scripts/smoke-client.mjs"`
- `"test": "node --test packages/notix-dsh/test/*.test.js"`（只跑 Host 测试；UI 没有单测）

### 9.3 `packages/notix-dsh-ui/README.md`（39 行）的安装/验证说明

- 依赖前提：Host 插件 `notix-dsh` 已安装（它通过 bundle patch 以 entry id `notix` 注入并提供配置 schema）——`README.md:15`。
- 安装方式：本包自己的 `cordis.patch.yml` 以 `ui-notix` 插入 client 插件（`:16-22`）；在 profile 的 `cordis.patch.yml` 引用本包，或把 `packages/notix-dsh-ui` 加入 bundle 列表，重载后打开「设置 → 插件」看到卡片（`:24`）。
- 门控/保存行为：卡片仅在 Host 组合了 `notix` 时出现（`configForms.whileServed(['notix'])`）；写入由 Host 的 dsh-config-editor 落到 profile patch 并即时生效，Notix 随之重载（`:25`）。注意「Notix 随之重载」这句不精确：volatile-only 变更走热提交，插件**不重载**，只是 `replaceConfig` 原地换引用（§6 step 6-7）。指南引用时要改成「配置原地生效」。
- 结构说明（`:29-32`）：index.js Host 半 no-op；client.js 浏览器半单文件 bundle（`__ModuleLoader__.load`），inject `["slots","locale","configForms"]`；locale json 只是市场/清单 meta，卡片完整字典内嵌在 client.js 的 `ctx.locale.register`；patch 是 bundle 层插入项。
- 开发自检（`:36-39`）：`node --check lib/client.js` + `node -e "JSON.parse(...package.json...)"`；**README 没提 `scripts/smoke-client.mjs`**，根 package.json 才有。可建议补一条 `pnpm smoke`。

---

## 10. 关键位置速查表

### 10.1 本仓库

| 概念 | 位置 |
| --- | --- |
| bundle 协议入口 / 模块 id / 平台模块 require | `client.js:1-3`、`:7-8`；`scripts/smoke-client.mjs:65-75` |
| 中英字典 / CSS / hooks / 控件 | 字典 `client.js:11-68`、`:70-127`；CSS `:131-141`；`useSnapshot/useDraft` `:147-164`；控件 `:178-306` |
| 默认值镜像 / 摘要 / Card / 提交 | `:314-326`、`:334-343`、`:350-362`、`:368-377` |
| 表单五段 | 触发器 `:390-516`、静默 `:516-541`、内容 `:542-561`、渠道 `:562-599`、状态区 `:600-604` |
| 插件入口 / 门控 / 注册 / slot 参数 / 导出 | `:624-639`、`:631-638`、`:641-644` |
| Host 半 / 清单字段 / bundle 补丁 | `packages/notix-dsh-ui/lib/index.js:1-8`；`package.json:7-13`、`:21-33`；`cordis.patch.yml:1-5` |
| Host entry id / schema / volatile-update / readConfig | `packages/notix-dsh/cordis.patch.yml:5`；`lib/index.js:16`、`:61-69`；`lib/schema.js:22-93`；`lib/config.js:105-124` |
| 设计文档 / 冒烟 / 开发期 patch | `docs/ui-settings-design.md`；`scripts/smoke-client.mjs:87-94`；`dev/notix.patch.yml:5-12` |

### 10.2 dsh 侧（0.2.1-rc.2，asar 解包）

| 概念 | 位置 |
| --- | --- |
| `dsh.client` 校验 / platform 必须 web / exports["./client"] / Loader 行→package.json | `dsh-client-modules/lib/index.js:62-76`、`:720-750`、`:171-182`、`:762-780` |
| 浏览器到达顺序（external/inject）/ 模块表报错 | `dsh-client-modules/lib/client.js:777-795`、`:841` |
| `slots` 服务 / register 绑定 effect / inject / locale t 座位 | `dsh-client-ui-renderer/lib/client.js:1349`、`:1814-1817`、`:436-460`、`:743-746` |
| props 合并顺序（ownerProps 最后）/ list 排序+only / 错误边界 | 同文件 `:785-791`、`:1204-1222`、`:632-647` |
| plugin-manager 声明 `plugins.item` / 账本 / 详情页传 form / basicTitle / 图标白名单 | `dsh-client-ui-plugin-manager/lib/client.js:4433-4436`、`:49-64`、`:2711`+`:2743-2753`+`:3834-3841`、`:103`、`:2274-2283` |
| `ConfigFormController` 快照/订阅/set/unset/mutate/derive | `dsh-client-ui-settings/lib/client.js:1109-1116`、`:1166-1232` |
| `ConfigForms.get` / `whileServed` / describe 镜像 / 失效订阅 | 同文件 `:1291-1335`、`:1338-1504`、`:1486-1499` |
| Host settings describe / mutate+write / volatileForm | `dsh-settings/lib/index.js:414-464`、`:489-538`；`lib/types/schema.js:43-83` |
| Remote settings 控制器 / config-editor 写 patch / Loader 热提交 | `dsh-api-settings-controller/lib/index.js:434-477`；`dsh-config-editor/lib/index.js:70-136`；`cordis-plugin-loader/lib/index.js:260-288`、`:378-428` |
| `loader/volatile-update` 声明 / 插件清单 locale/icon | `cordis-plugin-loader/src/index.ts:35`；`dsh-app-boot/lib/index.js:2200-2245` |

---

> 交接：本文件只写 `.guide-work/ui-code-map.md`，未改源码；验证命令均为只读（`node --check`、`node scripts/smoke-client.mjs`）。§7.6 是唯一需要决策的高危项（指南正文按「静态分析发现、未 GUI 实测」措辞）；§8.3 第 6 条（bundle 首行 `>` 假象）建议反馈作者；与 `host-code-map.md` 的衔接见 Host `lib/index.js:61-69`、`schema.js`、`lib/config.js`。
