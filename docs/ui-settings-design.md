# Notix Settings UI 设计文档

本文档描述 `packages/notix-dsh-ui`（Notix 通知插件的浏览器端 Settings UI）的信息架构、控件选型、状态设计、文案与可访问性，并列出实现依据与已知限制。

## 1. 定位与挂载

- 客户端插件，id `notix-dsh-ui`，通过 `cordis.patch.yml` 以 `ui-notix` 插入。
- 浏览器半（`lib/client.js`）向插件设置页的 `plugins.item` 插槽注册一张卡片；外层用 `ctx.slots.inject('plugins.item', ...)` + `ctx.effect(() => ctx.configForms.whileServed(['notix'], ...))`，仅当 Host 组合了 `notix` 插件时卡片才出现。
- 卡片折叠态（`view === 'summary'`）显示动态状态摘要（`已启用触发器 n/5 · 免打扰 开/关 · macOS 渠道 开/关`）；快照未就绪时回退为静态 description。展开态渲染完整表单，页内顶部同样常驻该摘要行。
- 配置读写唯一通道是 `ctx.configForms.get('notix')` 返回的 **ConfigFormController**。不使用 `SettingsFormModel`/`settingsNumberField`，因为它们只覆盖顶层单字段，而 Notix 配置大量是嵌套对象（`triggers.*`、`quietHours.*`、`channels.macos.*`）。

## 2. 信息架构

卡片自上而下：

1. **状态摘要行**：`已启用触发器 n/5 · 免打扰 开/关 · macOS 渠道 开/关`，让用户不展开分组也能看到整体状态。
2. **触发时机**（5 组，结构一致：组开关 + 缩进的子项；组关闭时子项禁用并降透明度）：
   - 审批请求：提醒间隔（分钟）、最多提醒次数（0–10 整数）
   - 待回答问题：提醒间隔（分钟）、未回答时持续提醒（schema 无 maxReminders，UI 不提供）
   - 长任务：轮次阈值（分钟）、任务阈值（分钟）
   - 错误：冷却时间（分钟）、工具错误、工具超时
   - 轮次完成：最短时长（分钟）、包含后台任务
3. **免打扰**：启用开关 + `from`/`to` 时间 + 允许紧急通知开关（子项随开关禁用）。
4. **通知内容**：语言下拉（zh/en）、详略程度下拉（minimal/normal）。
5. **macOS 渠道**：启用/声音/点击打开开关 + baseUrl 文本（子项随渠道开关禁用），以及「发送测试通知」**占位按钮**——禁用态并附说明，标注为后续能力（见 §8）。
6. **底部状态区**：保存中 / 已保存 / 保存失败 / 只读原因 + 「修改即时生效」的常驻提示。

分组顺序与用户心智一致：先「什么时候打扰我」，再「什么时候别打扰我」，然后「通知长什么样」，最后「发到哪儿」。

## 3. 控件选型

| 数据类型 | 控件 | 理由 |
| --- | --- | --- |
| 布尔开关 | primitives `Switch`（`checked/label/disabled/onChange(next)`） | 已确认存在于共享 primitives，且与 settings-general 的用法一致 |
| 毫秒时长 | 数字输入，单位「分钟」 | 分钟是人类心智单位；显示 `ms/60000`（保留两位小数），提交 `Math.round(min*60000)`。失焦/Enter 提交；**非法值保留输入文本并就地报错**（不写配置） |
| maxReminders | 数字输入，step 1，0–10 | 与 schema 的 `step(1).min(0).max(10)` 对齐，超出范围视为非法并就地报错 |
| quietHours.from/to | `<input type="time">` | 原生时间控件直接产出 `HH:MM`，与 schema 字符串格式一致；`onChange` 即提交并做格式校验 |
| language/verbosity | `<select>` | 枚举值固定（zh/en、minimal/normal），下拉避免非法值 |
| baseUrl | 文本输入，失焦/Enter 提交 | 自由字符串，空串合法（schema 默认 `''`，表示用默认地址） |

所有输入都带显式 `id` + `<label htmlFor>` 包裹，并设置 `aria-label`。

### 草稿-提交模型（NumberField/TextField）

输入过程不直接写配置：组件内维护 draft 文本，**失焦或 Enter 才提交**；未聚焦时 draft 跟随外部快照值，因此 Host 侧写入（或写入被拒后的快照回弹）会正确覆盖显示，而不会打断正在输入的用户。`input type=number` 允许中间态（空串、`-`），用受控 draft 规避受控 number input 的诸多坑。提交时解析失败（非数字、负数、超出 0–10）**不回退**：保留用户输入、置 `aria-invalid` 并以 `role="alert"` 就地显示 `invalidNumber` 文案，用户继续输入即清除错误态。

### 提交路径

每次修改调用 `form.mutate([{ op: 'set', path: [...], value }])`，使用**嵌套 path**（如 `['triggers','approval','remindAfterMs']`），这是改嵌套配置的正确方式（`set/unset` 快捷方式仅支持顶层单字段）。本 UI 没有「撤销/恢复默认」按钮：schema 对每个字段都有默认值，如需恢复可将来追加 `{ op: 'unset' }` 支持，本期不做。

## 4. 状态设计

快照：`form.getSnapshot()` → `{ status, value, base, user, revision, writable }`；`form.subscribe` 在快照变化时触发，组件 `useEffect` 订阅并在卸载时调用返回的 disposer 清理。

- `status === 'loading'`：显示加载提示，不渲染表单。
- `status === 'unavailable'`：显示「插件未加载」提示（`whileServed` 已尽量避免此态，但保留兜底）。
- `writable === false`：显示只读原因，所有控件禁用。
- 写入中（`pending > 0`，以计数器支持并发提交）：所有控件禁用，避免连点产生乱序写入；状态区显示「保存中…」。
- `mutate` resolve `false` 或 reject：状态区显示保存失败文案（`role="alert"`）；输入控件的 draft 文本不会因失败被清掉（快照值未变，draft 同步 effect 不触发），用户可修正后重试。
- **校验失败**（数字非法/超范围）：不发起写入；字段保留输入并就地显示 `invalidNumber`（`aria-invalid` + `role="alert"`）。
- 写入成功：显示「已保存」；下一次修改覆盖该状态。
- 快照值渲染时使用与 `packages/notix-dsh/lib/schema.js` 完全一致的默认值做兜底（`DEFAULTS` 常量），保证在部分快照/缺字段时 UI 不崩溃。

控件禁用优先级：`pending>0 || !writable` 为全局禁用；组内子项再叠加 `!group.enabled`。

## 5. 中英文案表

字典内嵌于 `lib/client.js`，通过 `ctx.locale.register('settings.notix', { zh, en })` 注册；`locale/zh.json`、`locale/en.json` 仅存 `meta.title`/`meta.description` 供清单/市场展示。

| key | zh | en |
| --- | --- | --- |
| title | Notix 通知 | Notix notifications |
| description | 为审批、待回答问题、长任务、错误和完成事件发送系统通知。 | System notifications for approvals, pending questions, long tasks, errors and completions. |
| summaryTriggers / summaryQuietHours / summaryChannel | 已启用触发器 / 免打扰 / macOS 渠道 | Triggers on / quiet hours / macOS channel |
| summaryOn / summaryOff | 开 / 关 | on / off |
| loading | 正在加载设置… | Loading settings… |
| unavailable | Notix 插件当前未加载，暂时无法配置。 | The Notix plugin is not loaded, so it cannot be configured right now. |
| readOnly | 本部署的设置为只读，以下字段不可编辑。 | This deployment stores settings read-only; the fields below are not editable. |
| saving / saved | 保存中… / 已保存。 | Saving… / Saved. |
| saveFailed | 本部署没有接受这些值，已保留供你修改。 | The deployment did not accept these values; they were left for you to correct. |
| reloadNote | 修改即时生效。 | Changes take effect immediately. |
| sectionTriggers / sectionQuietHours / sectionContent / sectionChannel | 触发时机 / 免打扰 / 通知内容 / macOS 渠道 | When to notify / Quiet hours / Notification content / macOS channel |
| triggerApproval(+Hint) | 审批请求 / 工具调用等待你批准时通知。 | Approval requests / Notify when a tool call waits for your approval. |
| triggerUserQuestion(+Hint) | 待回答问题 / Agent 向你提问并等待回答时通知。 | Pending questions / Notify when the Agent asks you a question. |
| triggerLongTask(+Hint) | 长任务 / 轮次或后台任务运行超过阈值时通知。 | Long-running tasks / Notify when a turn or background job runs longer than the thresholds. |
| triggerError(+Hint) | 错误 / 工具调用失败时通知。 | Errors / Notify when a tool call fails. |
| triggerCompletion(+Hint) | 轮次完成 / 较长的轮次结束时通知。 | Turn completion / Notify when a long turn finishes. |
| fieldRemindAfter / fieldMaxReminders / fieldRemindOnContinued | 提醒间隔（分钟）/ 最多提醒次数 / 未回答时持续提醒 | Remind after (min) / Max reminders / Keep reminding while unanswered |
| fieldTurnThreshold / fieldJobThreshold | 轮次阈值（分钟）/ 任务阈值（分钟） | Turn threshold (min) / Job threshold (min) |
| fieldCooldown / fieldToolErrors / fieldToolTimeout | 冷却时间（分钟）/ 工具错误 / 工具超时 | Cooldown (min) / Tool errors / Tool timeouts |
| fieldMinDuration / fieldJobs | 最短时长（分钟）/ 包含后台任务 | Minimum duration (min) / Include background jobs |
| quietEnabled / quietFrom / quietTo / quietAllowUrgent | 启用免打扰时段 / 开始 / 结束 / 允许紧急通知（审批） | Enable quiet hours / From / To / Allow urgent notifications (approvals) |
| fieldLanguage / languageZh / languageEn | 语言 / 中文 / English | Language / 中文 / English |
| fieldVerbosity / verbosityMinimal / verbosityNormal | 详略程度 / 简洁 / 常规 | Verbosity / Minimal / Normal |
| channelEnabled / channelSound / channelClickToOpen | 启用 macOS 通知 / 播放声音 / 点击打开 Harness | Enable macOS notifications / Play sound / Click to open Harness |
| channelBaseUrl(+Hint) | 点击跳转的 Harness 地址 / 留空使用默认地址。 | Harness URL for click-to-open / Leave blank to use the default address. |
| testNotify / testNotifyHint | 发送测试通知 / 该能力需要 Host 侧接口，将在后续版本提供；当前可先保存任一修改，由 Host 侧验证通知链路。 | Send test notification / Needs a Host-side API and ships in a later release. For now, save any change to let the Host verify the delivery path. |
| invalidNumber | 请输入范围内不小于 0 的数字。 | Enter a non-negative number, within the allowed range. |

## 6. 可访问性

- **键盘**：所有控件均为原生可聚焦元素（`Switch` 为共享原语，数字/时间/文本/下拉为原生 input/select）；Enter 提交草稿并 blur，Tab 顺序即文档顺序。
- **标签**：每个输入都有可见文本标签（`<label htmlFor>`）+ `aria-label`；分组用 `<section>` + `<h3>` 标题，屏幕阅读器可按标题跳转。
- **状态播报**：底部状态区 `role="status" aria-live="polite"`，保存失败单独 `role="alert"`。
- **禁用态**：组开关关闭时子项同时禁用（`disabled`）并降低不透明度，避免「看起来能改但改了无效」。
- **对比度**：颜色仅使用主题变量（`--dsw-alias-state-error-primary`）与透明度，不硬编码前景色。

## 7. 与 dsh 现有 Settings 视觉语言的一致性

- **挂载契约完全一致**：与内置设置页（agent-loop、web-search、subagent、shell）相同的 `plugins.item` 插槽注册结构、`view: "summary" | "page"` 双视图、字典经 `ctx.locale.register` 注册——卡片在插件列表里的折叠/展开行为与内置页无异。
- **复用共享原语**：开关使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Switch`（与 settings-general 同款，`onChange(next: boolean)`），而不是自绘样式，保证与全局开关的视觉/交互一致。
- **CSS 注入模式一致**：`<style data-plugin-css>` 单次注入（与 ui-jobs、ui-settings-web-search 的打包产物相同的方式）；类名全部以 `notix-` 前缀隔离，只定义布局（flex/gap/缩进/透明度），颜色只引用主题变量（`--dsw-alias-state-error-primary`）不硬编码，自动跟随明暗主题。
- **状态区语言一致**：只读/保存中/保存失败文案与内置页措辞对齐（如 saveFailed 直接沿用「本部署没有接受这些值，已保留供你修改。」），避免同一界面里两套说法。
- **有意的差异（取舍）**：内置页多用 `SettingsForm` 框架 + 显式「保存」按钮；本卡片选择**即改即存**（见 §1 的取舍说明），因此没有底部保存按钮，改为常驻状态区 + 行内错误提示。这是基于 configForms 写队列事实的选择，而非视觉偏离：字体、间距、控件仍全部来自共享原语与主题变量。

## 8. 实现依据（实际引用的源码）

- `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-agent-loop/lib/client.js` — 客户端插件骨架（`window.__ModuleLoader__.load`、`inject` 数组、`ctx.locale.bind/register`、`ctx.effect` + `configForms.whileServed` + `slots.inject/register` 的挂载结构、`view === "summary"` 的折叠态约定）。
- `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js` — `ConfigForms` 服务与 `ConfigFormController` 的真实契约：`getSnapshot()` 返回 `{ status: "loading" | "ready" | "unavailable", value, base, user, revision, writable }`；`subscribe(listener)` 返回 disposer；`mutate(ops, expectedRevision?)` 串行化写入、失败时自动 `mirror.load()` 恢复并 resolve `false`；`whileServed(namespaces, register)` 按 describe 镜像注册/注销；`ConfigFormController.set/unset` 只写顶层单段路径。
- `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js` — Host 侧 `mutate` 事实：`applyPathOp` 支持**多段嵌套 path** 的 `set`/`unset`（本卡片嵌套写入的依据）；revision 冲突抛 `SettingsConflictError` 并向客户端返回 `ok: false`。
- `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`（约 695–735 行）与 `dsh-client-ui-settings-web-search/lib/client.js` — `Switch` 的实际用法（`onChange` 收到 `next: boolean`）、`<style data-plugin-css>` 单次 CSS 注入模式。
- `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js` 与 `lib/client.js` — `window.__ModuleLoader__.load({ id, factory })` 注册契约、bundle 以 classic script 加载、`require` 只能引用模块表内已注册的包（react、react/jsx-runtime、dsh-client-ui-primitives 等）。
- `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-agent-loop/package.json` — `dsh.client: { inject: [...], platform: "web" }` 声明格式、`exports["./client"]` 约定、`locale/*.json` 的 `meta.title/description` 惯例。
- `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml` — client UI 包以 `- insert: [{ id, name }]` 行插入 Cordis 树的先例（`ui-agent-team`）。
- `/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/index.js`（`bundlePatchPaths`、`installBundle`）— bundle 补丁经 package.json 的 `dsh.bundle.patch` 声明并被插件管理器读取。
- `packages/notix-dsh/lib/schema.js` — 配置 schema 唯一事实来源：字段名、嵌套结构、默认值、取值范围（`maxReminders` 0–10、时长非负毫秒、quietHours 为 `HH:MM` 字符串）；`userQuestion` 组**没有** `maxReminders`。
- `packages/notix-dsh/cordis.patch.yml` — Host 插件 entry id 为 `notix`（即 `configForms.get('notix')` 的命名空间）。

## 9. 已知限制

1. **保存为热更新**：`mutate` 由 Host 的 dsh-config-editor 落到 profile patch，Loader 将 volatile-only 变更提交进运行中的 fiber（插件不重载），Notix 监听 `loader/volatile-update` 原地更新配置。卡片通过快照订阅自然回弹；连续快速输入仍受写入期全局禁用限制（设计使然）。
2. **无法发送测试通知**：Host 侧没有暴露 Remote 能力（`grep -rn "remote\|typert" packages/notix-dsh/lib` 无结果），UI 不臆造 API；渠道分组内放置了**禁用态占位按钮**并注明「后续版本提供」，当前只能通过修改配置后等待真实触发来验证链路。
3. **无「恢复默认」**：未实现 `unset` 入口，恢复默认需手动改回 schema 默认值或编辑 profile patch。
4. **分钟换算精度**：时长以分钟输入、两位小数显示；亚秒级毫秒值（非 60000 的倍数）在 UI 中不可表达，但快照回显会四舍五入展示，不改写底层值（只有用户提交时才换算）。
5. **quietHours 跨午夜**：`from > to`（如 23:00–08:00）的语义由 Host 触发逻辑解释，UI 不做额外校验或提示。
6. **文案字典内嵌**：完整 zh/en 字典内嵌在 `client.js`（client bundle 不能 require 相对文件），`locale/*.json` 仅含 meta；两处文案若扩展需同步维护。
7. **bundle 首行 `>` 标记**：官方产物的 `lib/client.js` 首行有一个孤立的 `>`（所有 shipped bundle 均如此，直接 `node --check` 会报 SyntaxError，说明服务端在下发前剥离）。本包的 `lib/client.js` **不写**该前缀：它是手工产物而非 tsdown 构建产物，且任务要求 `node --check` 通过。若未来证实加载器要求该前缀，需在构建期补上。
8. **未在运行中的 GUI 实测**：本环境没有对包含 Notix 的 profile 做端到端加载验证；`Switch`、slots、`configForms` 契约均来自 0.2.1-rc.2 解包源码的静态阅读。
