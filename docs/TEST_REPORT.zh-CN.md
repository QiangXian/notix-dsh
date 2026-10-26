# Notix DSH 测试执行报告

> 目录说明（2026-10-25 后续）：手写源码已统一迁至 `src/host/` 与 `src/client/`，`lib/` 现为全量生成目录。本文记录的是此前快照的执行结果；后续目录迁移后的验证以当前开发指南和最新命令输出为准。
>
> 2026-10-26 追加：Windows 支持轮次（新增 Windows 通知渠道、渠道层跨平台模块化）的执行结果见[第 10 节](#10-windows-支持轮次执行报告2026-10-26)；该轮环境为 Windows 实机，与第 2 节的 macOS 环境不同。

> 执行日期：2026-10-25（Asia/Shanghai）
>
> 状态：本轮自动化、真实 DSH UI 与真实 macOS 通知验证完成；涉及模型/长时等待的高成本 E2E 尚未执行。
>
> 对应计划：[全链路测试计划](TEST_PLAN.zh-CN.md)

## 1. 执行结论

**结论：发现并修复了 1 个阻断级 UI 缺陷、5 个体验/文案问题和 4 个脚本/文档/配置问题；修复后 41/41 条自动化测试通过，真实 DSH 设置页在隔离实例中正常渲染，真实 macOS 通知横幅可送达。**

| 项目 | 结果 |
|---|---|
| 自动化测试 | 41 / 41 通过 |
| 浏览器 bundle smoke | 通过 |
| 发布包内容干跑 | 通过，34 个文件，无测试、build、`.tmp`、缓存或密钥 |
| 真实 DSH UI（隔离实例） | 通过；详情页、设置页两个入口、保存与刷新持久化、无效输入、窄屏均验证 |
| 真实 macOS 通知 | 通过；`osascript` 后端，标题与正文正确、声音正常 |
| 控制台异常 | 修复后 Notix 卡片无异常 |

**注意：** 当前用户已打开的 DSH 桌面实例在进程内缓存了旧客户端 bundle，本轮修复需要在重启 DSH 后才会在当前窗口生效；隔离实例已用新 bundle 完整复验。

## 2. 执行环境

| 项 | 值 |
|---|---|
| OS | macOS 27.0.1，Apple Silicon |
| DSH | 桌面运行时 0.2.1-rc.3 |
| Node / pnpm（项目命令） | Node 22.23.2 / pnpm 10.26.2 |
| 浏览器自动化 | Chrome Headless 155，CDP，隔离临时 profile |
| 测试实例 | 隔离 `DSH_HOME=.tmp/ux-home`，独立 profile `notix-ux`，127.0.0.1:62200 |
| 真实通知后端 | `osascript`（未安装 terminal-notifier/alerter/签名 Helper） |
| 受测代码 | 当前工作区文件快照（目录无 Git 元数据） |

UI 测试没有改动当前用户的 DSH profile、没有启动替代 GUI；使用隔离 profile 启动独立测试实例，并通过 Headless Chrome 访问。

## 3. 自动化执行结果

命令：`pnpm test`、`pnpm smoke`、`npm pack --dry-run`、脚本语法检查。

| 测试文件 | 数量 | 结果 | 覆盖重点 |
|---|---:|---|---|
| `test/core.test.js` | 9 | 通过 | 配置默认/解引用、渲染、去重、错误冷却、免打扰、历史 |
| `test/triggers.test.js` | 11 | 通过 | 审批、问题、长任务、错误去重、完成、后台任务开关 |
| `test/integration.test.js` | 5 | 通过 | 真实 Cordis、`ctx.notix`、Schema、dispose、存储重开 |
| `test/package.test.js` | 4 | 通过 | manifest、后台任务默认值一致性、单 Loader、旧 UI 排除、图标 |
| `test/ui.test.js` | 5 | 通过（本轮新增） | 注入契约、完整卡片、摘要、URL 联动、缺失表单降级 |
| `test/macos.test.js` | 4 | 通过（本轮新增） | 三种后端 argv、声音/图标/URL、失败不自动降级 |
| `test/error.test.js` | 3 | 通过（本轮新增） | 工具错误/超时开关、minimal 隐私、禁用分支 |
| **合计** | **41** | **全部通过** | |

补充结果：

- `pnpm smoke`：`OK lib/client.js: id=notix-dsh apply=function inject=[slots, locale, configForms]`
- 发布包干跑：34 files；包含 Host/Client、locale、assets、scripts、docs 图片；不包含 `test/`、`build/`、`.tmp/`、`node_modules`。
- `scripts/test-macos-notification.mjs` 已修复不存在的方法调用，执行输出 `[notix] delivered through osascript`。
- 覆盖率（Node test coverage）：行 95.62%，分支 82.09%，函数 83.00%；`lib/triggers/error.js` 分支从 56.52% 提升到 70.00%。全项目分支仍未达到计划建议的 90%，渠道重试/熔断和部分生命周期分支仍是主要缺口。

## 4. 真实 DSH UI 验证

> 截图口径：本节截图来自 2026-10-25 本轮隔离实例快照。文件名含 `before` 的图片是修复前/UX 清理前的**历史证据**，不代表当前界面；当前界面以 `notix-settings-detail.png`、`notix-settings-narrow.png` 与本轮源码为准。客户端源码在该轮之后仍有编辑，发布前需用当前 HEAD 重拍 UI 证据。

| 检查项 | 结果 | 证据 |
|---|---|---|
| Plugins 页发现 Notix | 通过；显示“已启用触发器 5/5 · 免打扰关 · macOS 渠道开” | `notix-plugin-list.png` |
| 点击进入详情 | **修复前失败**：只有图标/标题，无表单，控制台 `form.getSnapshot is not a function` | `notix-settings-before-fix.png` |
| 修复后详情 | 通过；4 个分组、15 个开关、12 个输入/选择器全部渲染 | `notix-settings-detail.png` |
| Settings → Plugins 页签 | 通过；同一设置卡片可访问 | 实机 DOM 检查 |
| 摘要去重 | 通过；完整页不再重复显示摘要 | `notix-settings-detail.png` |
| 关闭“点击打开 Harness” | 通过；URL 输入立即禁用，重开恢复；刷新后值保持 | 实机 DOM 检查 |
| 非法数字输入 | 通过；显示 `请输入范围内不小于 0 的数字。`，不写入配置 | 实机 DOM 检查 |
| 保存持久化 | 通过；修改落入隔离 profile 的 `cordis.patch.yml`，刷新后仍为 false | 配置文件 + 刷新验证 |
| 窄窗口 | 通过；视口 756px 时无横向溢出，内容宽度自适应 | `notix-settings-narrow.png` |
| 可访问性基础 | 通过；所有开关有 `role=switch` + `aria-checked` + 名称，输入有 label/aria-label | DOM 审计 |
| 前端异常 | 修复后 Notix 详情无异常日志 | CDP console 捕获 |

发现的环境残留（非当前包代码问题）：用户当前 desktop profile 的 Plugins 页提示 `包元信息错误 ... notice-dsh/locale`。隔离 profile 的同一页面没有该错误。建议通过插件页刷新安装元信息或重新安装清理旧链接；本轮未改动用户 profile。

## 5. 真实 macOS 通知

通过 `node scripts/test-macos-notification.mjs` 发送一条真实通知，系统横幅显示：

- 标题：`Notix 渠道自检`
- 正文：`如果你看到这条通知，macOS 通知通道可用。`
- 后端：`osascript`
- 声音：开启
- 图标：系统分配给“脚本编辑器”的图标，符合 osascript 后端限制

![真实 macOS 通知横幅](test-evidence/notix-macos-notification.png)

## 6. 缺陷与修复记录

| ID | 级别 | 问题 | 修复 | 状态 |
|---|---|---|---|---|
| DEF-001 | P0 | Plugins 详情页整卡空白，控制台 `form.getSnapshot is not a function`；设置入口实际不可用 | 将配置表单注入名从易冲突的 `form` 改为 `notixForm`；对缺失表单增加 loading 降级，不再抛异常 | 已修复并回归 |
| DEF-002 | P1 | 完整设置页顶部摘要重复显示，信息噪音 | 仅在折叠 summary 视图显示摘要，完整卡片移除重复行 | 已修复并回归 |
| DEF-003 | P1 | 空 URL 提示“使用默认地址”，实际空值直接禁用点击跳转；关闭 clickToOpen 后 URL 输入仍可编辑 | 提示改为“留空则不启用点击跳转”；URL 跟随 clickToOpen 禁用 | 已修复并回归 |
| DEF-004 | P1 | 永久禁用的“发送测试通知”按钮及“保存即验证通知链路”说明构成错误引导 | 移除死控件及误导文案；不在 UI 宣称尚未提供的 Host API；修复前证据见 `notix-settings-before-ux-cleanup.png`（历史） | 已修复并回归 |
| DEF-005 | P2 | 错误开关说明只提工具失败；免打扰紧急文案只提审批，实际也放行提问 | 改为“Agent 或工具执行失败时通知”；改为“审批和提问” | 已修复 |
| DEF-006 | P2 | 长任务和轮次完成各有一个同名“包含后台任务”，用户难以区分；完成时长术语混用 | 拆分说明为“后台任务超时也提醒”“后台任务结束时也提醒”；统一“轮次完成”措辞 | 已修复并回归 |
| DEF-007 | P2 | 真实通知自检脚本调用不存在的 `detectHelper()`，成功发出通知后仍报 TypeError | 改用 `detectBackend()` 并输出实际后端 | 已修复并验证 |
| DEF-008 | P2 | 后台任务提醒默认值在 README、Schema、UI、随包 patch 间不一致 | 统一为默认关闭（opt-in），同步中英文 README、随包 patch，并新增默认值回归测试 | 已修复并回归 |
| DEF-009 | P2 | 文档声称 ad-hoc helper 会回退脚本编辑器、alerter 支持点击，与实际不符 | 修正 README 与构建警告：ad-hoc helper 被选中后投递失败且不自动降级；仅 terminal-notifier 支持点击 | 已修复 |
| DEF-010 | P2 | 开发 patch 指向旧 checkout | 更新为当前 checkout 路径 | 已修复 |

## 7. UX 最终评价

**达到可用标准，建议随本轮修复发布。**

- 入口：Plugins → Notix 一次点击进入，Settings → Plugins 中也可达。
- 信息架构：触发时机、免打扰、通知内容、macOS 渠道四段清晰；主开关与子字段层级合理。
- 控件：15 个开关 + 12 个输入/选择器均有可读名称；依赖字段禁用态正确；无死按钮。
- 反馈：保存成功可见；刷新后值保留；非法值有原地错误且不落盘。
- 视觉：1440px 与 756px 均无横向溢出；Light 主题和现有 DSH 卡片样式一致。
- 渠道：真实通知可送达，标题/正文可读，声音有效；osascript 图标限制已在文档说明。

仍建议后续处理，不阻塞本轮：

1. 没有真正的“发送测试通知”入口，用户无法在设置页内确认权限/后端。需要 Host 侧接口后再补一个有效按钮。
2. Helper 授权失败或后端不可用时，UI 不能显示渠道健康状态，只能依赖通知失败日志；建议增加渠道探测/状态提示。
3. 设置页自动保存，但长表单没有粘性保存状态条；用户滚动到底部后才能看到保存反馈。可考虑在视口底部固定状态。
4. 3 个高级字段（userQuestion.maxReminders、notifierApp、appIcon）仍只能通过 profile 配置。

## 8. 尚未执行的计划项

本报告不把以下项目标记为通过：

- 真实 Agent 审批、提问、长任务、后台任务、错误的完整 E2E（需要受控测试账号/长时间等待）。
- 有效签名 Helper、terminal-notifier 实机点击、alerter、系统 Focus/锁屏组合。
- 24 小时长稳、事件风暴、真实多会话并发。
- 228 条计划中的全部边界组合；本轮覆盖 P0/P1 的核心自动化与关键 UI/渠道路径。
- 当前已打开 DSH 窗口的修复生效验证（需重启 DSH，重启后会使用新 bundle）。

## 9. 变更清单

| 文件 | 变更 |
|---|---|
| `lib/client.js` | 修复表单注入冲突、loading 降级、摘要去重、URL 联动、移除死控件、文案与标签优化、删除废弃样式 |
| `cordis.patch.yml` | 后台任务结束提醒默认改为关闭，与其他默认口径一致 |
| `README.md` / `README.zh.md` | 修正后台任务默认值、限流描述、macOS 点击/签名降级能力、隐私说明 |
| `scripts/test-macos-notification.mjs` | 修复后端识别方法 |
| `scripts/build-notifier-app.sh` | 修正 ad-hoc 签名警告 |
| `dev/notix.patch.example.yml` / `dev/notix.patch.local.yml` | 模板入库（占位路径），含绝对路径的本机实例改为本地文件并由 `.gitignore` 忽略 |
| `test/ui.test.js` | 新增 5 条 UI 契约/渲染回归测试 |
| `test/macos.test.js` | 新增 4 条渠道参数与失败隔离测试 |
| `test/error.test.js` | 新增 3 条工具错误/超时开关与隐私测试 |
| `test/package.test.js` | 新增随包后台任务默认值一致性测试 |
| `docs/TEST_PLAN.zh-CN.md` | 增加 UX 验收与 UI-23～26，用例总数 228 |
| `docs/test-evidence/*` | 本轮 UI 证据：修复前/UX 清理前（均为历史，不代表当前界面）、完整设置页、窄屏、插件入口、真实通知截图 |

## 10. Windows 支持轮次执行报告（2026-10-26）

> 本轮修复「notix-dsh 在 Windows 上无法触发通知」，并在同一次改动中把通知渠道层重构为跨平台模块化结构。环境为 Windows 11 实机 + DSH 桌面运行时；macOS 后端本轮未做实机回归，仅保留原自动化保护。

### 10.1 问题与根因

| 项 | 内容 |
|---|---|
| 现象 | Windows 上触发器正常产生历史记录（`~/.dsh/storages/notix/history`），但每条记录都是 `delivered: false`、`channels: []`，桌面没有任何通知。 |
| 根因 | 内置渠道只有 `channels/macos.js`，且 `channels.macos.enabled` 默认为 `true`。Windows 上它照常被注册，`send()` 里先抛 "macos-system channel is only available on macOS"，通知随后被 ChannelRegistry 的重试/熔断吞掉；代码里没有任何 Windows 通知后端。 |
| 维护问题 | 注册逻辑直接写死 macOS；渠道公共能力（配置读取、声音/点击跳转、后端探测缓存、进程执行、平台守卫）无法复用，新增平台需要复制整套逻辑。 |

### 10.2 修复内容

- **渠道层模块化**：新增 `SystemChannel` 基类（`base.js`：实时配置、`sound`/`clickUrl` 派生、平台守卫、后端只探测一次且失败不缓存、可注入进程 runner）与共享工具（`shared.js`：包资源定位 `findPackageRoot`、带超时/隐藏窗口的 `runTool`）；`macos.js` 与 `windows.js` 只保留平台差异。
- **平台注册表**：`channels/index.js` 提供 `BUILTIN_CHANNELS`（`darwin → macos`、`win32 → windows`）与 `createPlatformChannels()`；`core/notix.js` 只注册当前平台且配置启用的渠道，配置变更时销毁重建，其他平台不注册、不探测、不启动任何进程。
- **新增 Windows 渠道 `windows-system`**：通过随包 `toast.ps1` 调 Windows PowerShell 5.1 的 WinRT `ToastNotification`。标题/正文等经 `NOTIX_*` 环境变量传入（不经命令行拼接），脚本用 `SecurityElement::Escape` 转义后生成 `ToastGeneric`；支持声音开关、默认/自定义图标（`appLogoOverride`）、正文多行、同 tag 替换与点击跳转（protocol activation）。通过 `HKCU\Software\Classes\AppUserModelId\Notix.DSH` 注册应用标识，使横幅显示 **Notix** 名称与鲸鱼图标而不是 PowerShell。`toast.ps1` 全 ASCII，经 `-File` 执行。
- **配置与 UI**：新增 `channels.windows { enabled, sound, clickToOpen, baseUrl, appId, icon }` 默认值、Loader schema 与随包 `cordis.patch.yml`；设置卡片按 `navigator.userAgent` 只渲染当前平台渠道，Windows 额外显示 AppID/图标输入；中英文文案同步。
- **测试与文档**：新增 `test/channels.test.js`、`test/windows.test.js`（注入 runner，绝不在测试中真发通知）、`scripts/test-windows-notification.mjs` 与 `pnpm notify-test:win`；`test/ui.test.js` 增加按 UA 平台感知的回归用例（Windows UA 渲染 AppID/图标字段）；core/integration 测试显式关闭两个内置渠道；修正 `.gitignore` 断言在 CRLF 工作区失败的问题；README/README.zh/DEVELOPMENT/TEST_PLAN 增加 Windows 与渠道架构说明。

### 10.3 验证结果

| 项 | 结果 |
|---|---|
| 完整本地门禁 | `pnpm verify` 通过：`pnpm test`（`pretest` 重建 `lib/`）→ 68 条用例 **63 通过 / 0 失败 / 5 跳过**（4 条 macOS 后端用例按 `darwin` 跳过、1 条 Windows 真机 toast 需 `NOTIX_TOAST_E2E=1`）→ `pnpm smoke` 通过 → `pnpm build:check` 通过。 |
| 构建产物 | `lib/` 与 `src/host/` 逐字节一致（含 `channels/toast.ps1`）；`lib/client.js` 由 tsdown 重新生成。 |
| 发布包 | `npm pack --dry-run` 通过：66 个文件，含 `lib/channels/toast.ps1`、`src/host/channels/toast.ps1`、`scripts/test-windows-notification.mjs`；不含 `test/`、`.tmp/`。 |
| 真实通知（通道自检） | `node scripts/test-windows-notification.mjs --no-sound` 输出 `[notix] delivered through powershell-toast (C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe)`，横幅实际显示。 |
| 真实通知（完整管线） | 直接使用构建产物 `lib/`：`NotixCore` + 默认 `channels.windows` 投递后，历史记录为 `delivered: true, channels: ["windows-system"]`，桌面 toast 实际显示标题、两行正文、Notix 名称与鲸鱼图标。 |
| 文本与转义 | 中文标题/正文、引号 `"`、`& < >`、CRLF 多行正文均正确显示；`toast.ps1` 自身保持 ASCII，构建产物与源一致。 |
| 平台隔离 | 非 win32 不注册 Windows 渠道、不探测 PowerShell、不写注册表、不弹 toast（`test/channels.test.js`、`test/windows.test.js` 注入平台断言）；非 darwin 的 macOS 渠道同样在启动进程前拒绝。 |

环境：Windows 11（10.0.26200），Windows PowerShell 5.1.26100.9711，Node.js 24.18.0，pnpm 10.26.2，DSH 桌面运行时（本机安装，profile 以 `link:` 指向本仓库）。

### 10.4 遗留与注意

1. **需要重启 DSH 才能生效**：当前正在运行的 DSH 桌面实例在进程内缓存了旧 Host 插件模块；重启 DSH 后才会加载新的 `lib/`（Windows 渠道会在启动时自动注册）。
2. 点击跳转依赖 toast protocol activation；若系统策略/安全软件拦截协议激活，toast 仍正常显示，仅点击可能无动作（README 排障已说明）。
3. Focus Assist / 通知总开关 / 应用通知开关由 Windows 控制，Notix 无法绕过；README 排障已列出检查路径。
4. 本轮未在 Windows 上实测 macOS 后端（`isMac=false` 用例跳过），也未覆盖睡眠恢复、通知风暴等长稳场景。
