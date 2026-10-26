# Notix

[English](https://github.com/QiangXian/notix-dsh/blob/main/README.md) | [中文](https://github.com/QiangXian/notix-dsh/blob/main/README.zh.md)

[![npm version](https://img.shields.io/npm/v/notix-dsh)](https://www.npmjs.com/package/notix-dsh)
[![npm downloads](https://img.shields.io/npm/dm/notix-dsh)](https://www.npmjs.com/package/notix-dsh)
[![verify](https://github.com/QiangXian/notix-dsh/actions/workflows/verify.yml/badge.svg)](https://github.com/QiangXian/notix-dsh/actions/workflows/verify.yml)
[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-5B8DEF)](#平台支持)
[![node](https://img.shields.io/badge/node-%5E22.18%20%7C%7C%20%3E%3D24-339933?logo=node.js&logoColor=white)](#环境要求)
[![license](https://img.shields.io/badge/license-MIT-green)](https://github.com/QiangXian/notix-dsh/blob/main/LICENSE)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供桌面通知：agent **需要你输入**、**运行过久**、**执行出错**或**任务完成**时，以原生 **macOS / Windows** 通知提醒你。一个包即可使用，无需额外 UI 包，不参与审批逻辑，不阻塞 agent。

Notix 是纯观察者：不注册审批/回答者、不向会话日志追加事件、不阻塞 agent。它只订阅共享事件面，通过可插拔的渠道注册表投递通知，内置 macOS 与 Windows 系统通知渠道。

> **状态：** `v0.3.0` —— 首个公开版本，支持 macOS 与 Windows。
>
> **npm 发布状态：** 包名为 `notix-dsh`。如果 `npm view notix-dsh version` 仍返回 404，说明该版本尚未进入 npm registry，请先按[从仓库克隆安装](#从仓库克隆安装)使用。

## 目录

- [为什么选择 Notix](#为什么选择-notix)
- [平台支持](#平台支持)
- [安装](#安装)
- [快速开始](#快速开始)
- [监听内容](#监听内容)
- [通知样式](#通知样式)
- [投递机制](#投递机制)
- [配置](#配置)
- [服务接口](#服务接口)
- [安全与隐私](#安全与隐私)
- [常见问题](#常见问题)
- [环境要求](#环境要求)
- [开发](#开发)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 为什么选择 Notix

- **一个包，两个半。** Host 插件与 Plugins 设置界面放在同一个 npm 包里，不需要再安装第二个 `notix-dsh-ui` 并保持版本同步。
- **纯观察者。** 不代替你审批、不写入会话事件、不阻塞 agent；投递失败被隔离，不会进入 agent 执行路径。
- **两个桌面平台都是原生通知。** macOS 走通知中心（签名 Helper、`terminal-notifier`、`alerter` 或 `osascript`），Windows 走操作中心（由随包 PowerShell 助手发送 WinRT toast）。
- **平台隔离是结构性的。** 只注册与当前 `process.platform` 匹配的渠道，因此一份 profile 配置在 macOS 与 Windows 上都可用，另一平台的工具永远不会被启动。
- **五类触发，全部可实时调整。** 审批、待回答问题、长 turn 与后台任务、错误与工具失败、完成事件，都可以在设置卡片里开关，并调整阈值、重复提醒与免打扰。
- **默认克制。** 去重键、按会话的错误冷却、带紧急放行的免打扰时段、按渠道重试与熔断器。
- **可扩展。** 其他插件可以通过 `ctx.notix` 发送通知、注册自己的投递渠道。

## 平台支持

| 平台 | 渠道 | 投递后端 | 说明 |
|---|---|---|---|
| macOS | `macos-system` | 已签名 Notix Helper → `terminal-notifier` → `alerter` → `osascript` | 通知中心；只有 Helper 使用 Notix 自己的 bundle 身份 |
| Windows 10/11 | `windows-system` | 由随包 PowerShell 助手发送 WinRT `ToastNotification` | 操作中心；使用系统自带 Windows PowerShell 5.1，无额外运行时依赖；已在 Windows 11 验证 |
| Linux 及其他平台 | —（不注册） | — | 插件可正常加载，但不注册任何渠道：通知只写入历史，投递为空操作 |

只注册 Host 所在平台的渠道，因此同一份配置文件在两端通用。两个渠道配置块都可以配置：卡片只编辑 GUI 所在平台的渠道并即时生效，另一平台的块保持不生效，也不会启动任何进程。

## 安装

Notix 只发布一个 npm 包 `notix-dsh`，其中同时包含 Node/Host 插件与浏览器/Client 界面。选择一种安装方式即可。

### 从 Web GUI 安装

1. 打开 Web GUI，进入 **插件（Plugins）** 页。
2. 用 **添加插件（Add plugin）** 安装 `notix-dsh`；GUI 会自动更新当前 profile 并把 bundle 加入列表。
3. 重启 DSH 实例。新的 Host 插件只在进程启动时加载；GUI 重新加载后设置卡片才会出现。

### 从 CLI 安装

`dsh plugin --profile <name> add <package>` 会把剩余参数转发给 profile 目录里的 pnpm 完成安装。由于 `notix-dsh` 声明了 `dsh.bundle`，DSH 还会同步 profile 的 `dsh.profile.bundles` 列表并把 `notix-dsh` 加入其中，因此下次启动就会组装它的 patch 层。

```bash
# 桌面 App 的 profile：先退出 App（运行中的 App 会在内存里保留已加载的插件）
dsh plugin --profile desktop add notix-dsh

# Web GUI 的 profile（dsh web / 浏览器 GUI）
dsh plugin --profile web add notix-dsh
```

随后重启该 DSH 实例。想确认安装结果，或在使用较旧的 `dsh`、手动/`link:` 方式未能同步时自行补上，可以检查 profile manifest 是否列出了该 bundle：

```jsonc
// ~/.dsh/profiles/<name>/package.json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "notix-dsh"
      ]
    }
  }
}
```

同样的命令适用于任何 profile 名（`headless`、自定义 profile 等）：Host 半与 profile 无关，在 macOS 或 Windows 上都能从任意 profile 投递；设置卡片只出现在 GUI profile 中。

### 从仓库克隆安装

适用于版本尚未进入 registry，或需要本地开发插件时：

```bash
git clone https://github.com/QiangXian/notix-dsh.git
cd notix-dsh
pnpm install --frozen-lockfile
pnpm build      # 生成 lib/，package.json 的入口指向该目录

# 再把当前 checkout 装进某个 profile
dsh plugin --profile web add link:/绝对路径/notix-dsh
```

按上文把 `"notix-dsh"` 加入 `dsh.profile.bundles` 后重启。`link:` 安装使用的是 checkout 里生成好的 `lib/`，因此拉取更新后需要重新执行 `pnpm build`。

### 包内容

发布的 npm 包只含运行时产物：由发布时 `prepack` 钩子生成的 `lib/`（`lib/` 由 `src/` 构建，Git 中不跟踪）、随包 `assets/`（通知图标与 Helper 的 `.icns`）、`locale/`、`cordis.patch.yml`、`icon.png`、中英文 README、`LICENSE`，以及 macOS Helper 的构建材料（`scripts/build-notifier-app.sh`、`scripts/notifier/`）。其余内容——`src/`、`test/`、`docs/`、`dev/`、构建配置和 `notify-test` 脚本——只存在于仓库克隆中；需要这些文件的命令在文中标注为**仓库克隆**。

### 升级

- **从 npm 升级**（先退出桌面 App）：`dsh plugin --profile <name> add notix-dsh@latest`，然后重启实例。
- **从仓库克隆升级**：`git pull && pnpm install --frozen-lockfile && pnpm build`，然后重启。
- **设置会保留**：配置写在 profile 的 `cordis.patch.yml` 中 `id: notix` 条目下，启动时重新读取。
- **从双包版本迁移**：如果 profile 中还有旧的独立 `notix-dsh-ui` 包，请从 bundle 列表里移除。`v0.3.0` 已内置 UI，已有 `id: notix` 配置保持兼容。

### 卸载

- 在 Web GUI 的 **插件** 页移除或停用 Notix；或者
- 用 CLI：`dsh plugin --profile <name> remove notix-dsh`，再删除 `dsh.profile.bundles` 中的 `"notix-dsh"`，最后重启。

卸载只从 profile 中移除该包，但会留下：通知历史（Host 提供 storage domain 时位于 `~/.dsh/storages/notix`）、已安装的 macOS Helper（`~/Applications/Notix.app`），以及 Windows 上 `HKCU\Software\Classes\AppUserModelId\<appId>` 下的 per-user AppUserModelId 键。如需彻底清理，请手动删除这些内容。

## 快速开始

1. 安装并重启 DSH，然后打开 **插件 → Notix**（同一个卡片也在 **设置 → 插件 → Notix**）。
2. 选择通知语言与详略程度，开关触发项，调整阈值、重复提醒与免打扰，并配置 GUI 所在平台的渠道。卡片直接修改 profile 的 patch 文件，Host 立即生效。
3. 验证投递：
   - **仓库克隆，macOS**：`pnpm build && pnpm notify-test`
   - **仓库克隆，Windows**：`pnpm build && pnpm notify-test:win`
   - **npm 安装**：这些脚本未随包发布，请改为触发真实事件（例如让 agent 发起一次审批）。
4. macOS 上，第一条通过签名 Helper 发送的通知会请求权限：点一次 **允许**。

![Web GUI 插件页中的 Notix 设置卡片](https://raw.githubusercontent.com/QiangXian/notix-dsh/main/docs/test-evidence/notix-settings-detail.png)

*Web GUI 中的 Notix 卡片（插件 → Notix；截图来自隔离的 macOS 测试 profile，界面为中文）。*

## 监听内容

| 通知 | 监听的表面 | 默认 | 配置项 |
|---|---|---|---|
| 审批请求 | `approval/asked`；未决期间按计划重复提醒，直到 `approval/decided` | 开 · 5 分钟后提醒，最多 2 次 | `triggers.approval` |
| 待回答问题 | `userQuestions` 投影（`open` 状态），`continued` 时可选再提醒 | 开 · 5 分钟后提醒，最多 2 次 | `triggers.userQuestion` |
| 长 turn | `turn/start` 看门狗；agent 正在等待你时延后 | 开 · 10 分钟阈值 | `triggers.longTask` |
| 长后台任务 | `job/registered` → `job/settled` 看门狗 | 关 · 开启后 15 分钟阈值 | `triggers.longTask.jobs` / `jobThresholdMs` |
| 运行失败 | `turn/end` 的错误 reason，以及 `agent/error`（同一去重键） | 开 · 按会话 60 秒冷却 | `triggers.error` |
| 工具失败 | `tool/result` 带 `isError`；`TOOL_TIMEOUT` 有独立开关 | 关（两个开关均关） | `triggers.error.toolErrors` / `toolTimeout` |
| turn 完成 | `turn/end` 且 reason 为 `completed` | 开 · 仅 ≥3 分钟的 turn | `triggers.completion` |
| 后台任务结束 | `job/settled` | 关 | `triggers.completion.jobs` |

所有通知走同一条管线：免打扰 → 去重 → 错误冷却 → 本地化渲染 → 按渠道投递。去重键按触发类型划分并保留 24 小时，因此重复事件不会反复提醒；同一会话在 `triggers.error.cooldownMs` 内的错误会被抑制。最近最多 200 条通知记录保存在 `notix` storage domain（Host 未提供 storage domain 时仅在内存中），可通过 `ctx.notix.history()` 读取。被免打扰、去重或冷却抑制的通知不会写入记录。

## 通知样式

### macOS

使用 `osascript` 后端时，通知是标准横幅：加粗标题 + 多行正文：

![macOS 通知横幅](https://raw.githubusercontent.com/QiangXian/notix-dsh/main/docs/assets/macos-notification-banner.png)

macOS 会把横幅图标分配给发送进程，因此 `osascript` 发出的通知显示系统 **脚本编辑器** 图标——这是预期行为，不是 Notix 的问题：

![osascript 通知显示的脚本编辑器图标](https://raw.githubusercontent.com/QiangXian/notix-dsh/main/docs/assets/macos-notification-icon.png)

安装 `terminal-notifier`，或按[在 macOS 上启用鲸鱼图标](#在-macos-上启用鲸鱼图标)构建签名 Helper，即可改为显示 Notix 鲸鱼图标。

### Windows

![Windows toast 通知](https://raw.githubusercontent.com/QiangXian/notix-dsh/main/docs/assets/windows-notification.png)

操作中心原生 toast，归属显示为 **Notix** 并带鲸鱼图标：加粗标题、最多三行正文，可选声音与点击跳转。

## 投递机制

### 一个包，两个运行时入口

manifest 同时声明 `dsh.bundle.patch` 与 `dsh.client`，因此一次安装即可提供两半：

- `lib/index.js` 是 Node/Host 入口：触发规则、渠道注册表、历史、配置与 `ctx.notix` 服务。
- `lib/client.js` 是浏览器入口：插件页与「设置 → 插件」中的 Notix 卡片。
- `cordis.patch.yml` 只插入一个 Loader 条目 `id: notix`。该条目加载 Host 半，同时让 Client 加载器发现本包的 `dsh.client` 声明。

两半各自保留运行时生命周期，合并的只是打包与安装方式。

### 渠道注册表

投递适配器注册在 `ChannelRegistry` 中，会收到管线产生的每一条通知。对每个适配器，注册表为单次尝试设置 10 秒超时，失败后最多重试 3 次（退避 1 秒 / 5 秒 / 15 秒），连续 3 次投递失败后打开 5 分钟的熔断器。失败只写日志，不会抛进 agent 执行路径。

平台选择是数据驱动的：`BUILTIN_CHANNELS` 把 `darwin → macos`、`win32 → windows`，只注册与当前 Host 平台匹配且 `enabled` 为开的条目。在卡片中修改渠道设置会重新注册适配器，因此声音与点击跳转的改动立即生效。新增平台 = 一个新模块 + 一个 `BUILTIN_CHANNELS` 条目，检查清单见[开发指南](https://github.com/QiangXian/notix-dsh/blob/main/docs/DEVELOPMENT.md)。

### macOS 后端

渠道只探测一次后端并缓存结果（探测失败不会缓存，下次通知会重试）：

| # | 后端 | 选用条件 | 横幅图标 | 点击跳转 | 声音 |
|---|---|---|---|---|---|
| 1 | Notix Helper（`~/Applications/Notix.app`，或 `channels.macos.notifierApp`） | Helper 可执行文件存在 | Notix 鲸鱼图标，归属显示为 Notix | 不支持 | `default` / `silent` |
| 2 | `terminal-notifier` | 在 `PATH` 中 | 通过 `-appIcon` 使用随包鲸鱼图标 | `clickToOpen` 与 `baseUrl` 均有效时传 `-open <baseUrl>` | `-sound default` |
| 3 | `alerter` | 在 `PATH` 中 | 无 | 不支持 | `--sound default` |
| 4 | `osascript` | 始终可用 | 脚本编辑器 | 不支持 | Glass，或静音 |

选中的后端失败时**不会**自动降级到下一个后端：请修复日志中的错误，或移除该后端，让探测选中下一个。

### 在 macOS 上启用鲸鱼图标

macOS 只允许**有有效代码签名**的 App 申请通知权限；ad-hoc 签名或未签名 App 会在弹出授权框之前就被拒绝（`requestAuthorization` 返回 denied）。用真实签名身份构建随包 Helper：

```bash
# 在仓库克隆中
NOTIX_SIGN_IDENTITY="Apple Development: 你的名字 (TEAMID)" \
  ./scripts/build-notifier-app.sh --install

# 从 npm 安装的包中
cd "$(node -p "require.resolve('notix-dsh/package.json')" | sed 's#/package.json##')"
NOTIX_SIGN_IDENTITY="Apple Development: 你的名字 (TEAMID)" \
  ./scripts/build-notifier-app.sh --install
```

- 构建需要 Xcode Command Line Tools（`swiftc`）。脚本会自行解析根目录，因此在任何目录下执行 `sh node_modules/notix-dsh/scripts/build-notifier-app.sh --install` 也可以。
- 默认先把中间产物写到包内的 `build/Notix.app`，再由 `--install` 复制到 `~/Applications/Notix.app`——除非 `channels.macos.notifierApp` 覆盖，否则渠道查找的就是这个路径。想直接构建到该路径、避免写入 `node_modules`，可设置 `NOTIX_APP_OUTPUT="$HOME/Applications/Notix.app"` 并省去 `--install`。
- 只有 Helper 的可执行文件存在时才会使用它；否则依次回退到 `terminal-notifier`、`alerter`、`osascript`。
- 首条通知时点 **允许**，之后横幅左侧即为 Notix 鲸鱼图标。
- 没有证书时脚本会退回 ad-hoc 签名并打印警告。macOS 会拒绝 ad-hoc Helper 的通知授权，因此只要该 Helper 已安装并被选中，投递就会失败：请用有效签名重新构建，或删除 `~/Applications/Notix.app`，让其他后端被选中。
- 安装 `terminal-notifier` 也能在不用 Helper 的情况下显示随包鲸鱼图标；`osascript` 无法更换图标。Helper 的构建材料随 npm 包发布，因此 npm 安装同样可以构建。

### Windows toast 细节

内置 `windows-system` 渠道通过 Windows PowerShell 与 WinRT Toast API 发送原生 toast。Host 在 Windows 上运行时自动注册该渠道；macOS 上不注册 Windows 渠道，Windows 上也不注册 macOS 渠道，因此一份共享配置是安全的。

<details>
<summary>Toast 助手的工作方式</summary>

Host 以无 shell 方式启动 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`，运行随包助手：

```text
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <包内路径>/lib/channels/toast.ps1
```

通知内容通过 `NOTIX_*` 环境变量传递（`NOTIX_TITLE`、`NOTIX_BODY`、`NOTIX_APP_ID`、`NOTIX_DISPLAY_NAME`、`NOTIX_ICON`、`NOTIX_URL`、`NOTIX_SOUND`、`NOTIX_TAG`、`NOTIX_GROUP`），标题和正文不经过 shell 引号处理。脚本对所有用户文本做 XML 转义，生成 `ToastGeneric` toast：标题 + 最多 3 行正文（最多 4 个 `<text>`；正文为空时只有 1 个）。

Windows 通过 `HKCU\Software\Classes\AppUserModelId\<appId>` 识别未打包应用的 toast 身份。助手写入 `DisplayName = "Notix"`，并在图标文件存在时写入随包鲸鱼图标的 `IconUri`，于是横幅显示 Notix 名称与图标，而不是 PowerShell 宿主。注册是幂等的：每次发送都重写相同值，不会产生重复键。可用 `channels.windows.appId` 与 `channels.windows.icon` 覆盖 id 与图标路径。

`channels.windows.sound` 为开时使用 `ms-winsoundevent:Notification.Default`，否则发送静音 toast。点击跳转通过 WinRT 协议激活实现（`activationType="protocol" launch="<baseUrl>"`），仅在 `clickToOpen` 开启且 `baseUrl` 非空时生效。重复通知把去重键当作 toast 的 tag/group，因此同一事件的新通知会替换旧通知。

</details>

## 配置

所有字段均可选，默认值开箱可用。在 profile 的 `cordis.patch.yml` 中、相同 entry id 下覆盖字段。设置卡片提供除 `triggers.userQuestion.maxReminders`、`channels.macos.notifierApp` 与 `channels.macos.appIcon` 之外的所有字段（这三项只能改 profile 文件）；卡片也只编辑 GUI 所在平台的渠道。两个渠道配置块可以同时存在——只有当前平台的块会被注册和使用。

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- id: notix
  name: notix-dsh
  config:
    language: zh
    triggers:
      longTask:
        turnThresholdMs: 300000
      error:
        toolErrors: true
    quietHours:
      enabled: true
      from: "23:00"
      to: "08:00"
      allowUrgent: true
    channels:
      macos:
        sound: false
      windows:
        sound: true
        clickToOpen: true
        baseUrl: "http://127.0.0.1:<端口>"   # 使用 `dsh web` 实际打印的地址
```

YAML 中的时长单位是毫秒；设置卡片里按分钟编辑。

### 通用

| 字段 | 默认 | 说明 |
|---|---|---|
| `language` | `zh` | 通知文案语言：`zh` / `en`。GUI 界面语言与之独立。 |
| `verbosity` | `minimal` | `minimal` 正文只保留上下文；`normal` 还会附带截断后的错误消息。 |

### 触发时机

| 字段 | 默认 | 说明 |
|---|---|---|
| `triggers.approval.enabled` | `true` | 工具调用等待审批时通知 |
| `triggers.approval.remindAfterMs` | `300000` | 审批未处理时的重复提醒间隔 |
| `triggers.approval.maxReminders` | `2` | 单次审批的重复提醒上限（0–10） |
| `triggers.userQuestion.enabled` | `true` | agent 向你提问时通知 |
| `triggers.userQuestion.remindAfterMs` | `300000` | 问题未回答时的重复提醒间隔 |
| `triggers.userQuestion.maxReminders` | `2` | 单个问题的重复提醒上限（0–10） |
| `triggers.userQuestion.remindOnContinued` | `true` | 超时问题转为 `continued` 时再提醒一次 |
| `triggers.longTask.enabled` | `true` | 长 turn / 后台任务看门狗 |
| `triggers.longTask.turnThresholdMs` | `600000` | 长 turn 阈值 |
| `triggers.longTask.jobs` | `false` | 同时看门后台任务 |
| `triggers.longTask.jobThresholdMs` | `900000` | 长后台任务阈值（`jobs` 开启时使用） |
| `triggers.error.enabled` | `true` | 运行失败与可选的工具失败 |
| `triggers.error.cooldownMs` | `60000` | 按会话的错误抑制窗口 |
| `triggers.error.toolErrors` | `false` | 通知工具失败 |
| `triggers.error.toolTimeout` | `false` | 单独通知 `TOOL_TIMEOUT`（与 `toolErrors` 独立） |
| `triggers.completion.enabled` | `true` | 完成通知 |
| `triggers.completion.minDurationMs` | `180000` | 只有不短于该时长的 turn 才播报完成 |
| `triggers.completion.jobs` | `false` | 播报已结束的后台任务 |

### 免打扰

| 字段 | 默认 | 说明 |
|---|---|---|
| `quietHours.enabled` | `false` | 启用免打扰时段 |
| `quietHours.from` | `"23:00"` | 时段开始（`HH:MM`，本地时间） |
| `quietHours.to` | `"08:00"` | 时段结束；可跨午夜，`from == to` 视为关闭 |
| `quietHours.allowUrgent` | `true` | 时段内放行紧急通知（审批与提问） |

### 渠道

| 字段 | 默认 | 说明 |
|---|---|---|
| `channels.macos.enabled` | `true` | Host 运行在 macOS 上时注册 macOS 渠道 |
| `channels.macos.sound` | `true` | 播放通知声音 |
| `channels.macos.clickToOpen` | `true` | 在支持点击的后端上启用点击跳转 |
| `channels.macos.baseUrl` | `""` | 点击跳转打开的 GUI 地址 |
| `channels.macos.notifierApp` | `""` → `~/Applications/Notix.app` | 签名 Helper App bundle |
| `channels.macos.appIcon` | `""` → 随包鲸鱼图标 | 传给 `terminal-notifier` 的横幅图标 |
| `channels.windows.enabled` | `true` | Host 运行在 Windows 上时注册 Windows 渠道 |
| `channels.windows.sound` | `true` | 播放默认通知声音；`false` 发送静音 toast |
| `channels.windows.clickToOpen` | `true` | 点击 toast 时打开 `baseUrl` |
| `channels.windows.baseUrl` | `""` | 点击跳转打开的 GUI 地址；为空时 toast 不带点击动作 |
| `channels.windows.appId` | `""` → `Notix.DSH` | 注册到 `HKCU` 并用于 toast 归属的 AppUserModelId；不匹配 `[\w.-]{1,128}` 时回退默认值 |
| `channels.windows.icon` | `""` → 随包鲸鱼图标 | 用于 `appLogoOverride` 并注册为应用图标的 PNG |

## 服务接口

其他插件可以使用 `ctx.notix` 服务：

```js
// 通过正常管线发送通知（免打扰、去重、渠道投递）
ctx.notix.notify({
  title: '部署完成',
  body: 'main 分支已绿',
  urgency: 'normal',         // 'urgent' | 'normal' | 'low'
  sessionId: 'session-id',   // 可选；默认 'manual'
  dedupeKey: 'deploy:main',  // 可选；默认使用唯一键
  sessionTitle: 'Deploy',
})

// 注册投递渠道；同样享有重试与熔断隔离
const dispose = ctx.notix.registerChannel({
  id: 'my-channel',
  send: async (notification) => {
    // notification：渲染后的 title/body，以及 kind、urgency、sessionId、payload
  },
})

ctx.notix.history(20)   // 最新在前；最多保留 200 条
ctx.notix.config        // 当前生效的解析后配置
```

`notify()` 返回已记录的通知；若被管线抑制则返回 `undefined`。

## 安全与隐私

- **不参与决策。** Notix 不注册审批回答者，审批保持 fail-closed 语义；所有决策仍在 GUI 完成。
- **不碰会话日志。** 只观察事件与投影，不向会话追加事件；投递失败不会阻塞或改变 agent 执行结果。
- **默认最少内容。** 通知文案只包含会话标题、工具名，以及截断后的问题或原因（问题截断到 160 字；最终标题最多 120、正文最多 500）。`verbosity: normal` 会额外附带截断后的错误消息（最多 200 字）。命令行与文件内容永远不会进入通知。
- **纯本地。** 无网络请求：投递只启动本地系统工具（`osascript`、`terminal-notifier`、`alerter`、`powershell.exe`）。
- **失败隔离。** 重试与按渠道熔断器保证一个坏后端不会影响 agent 或其他渠道。
- **本地状态。** 去重键与通知历史保存在 Host 的 `notix` storage domain（若提供）。Windows 渠道只写入 per-user AppUserModelId 键（`DisplayName` 与 `IconUri`）；macOS Helper 只是 `~/Applications` 下的普通 App bundle。

## 常见问题

### macOS

| 现象 | 排查方式 |
|---|---|
| 完全看不到横幅 | 系统设置 → 通知：为发送方 App 打开通知——Helper 是 **Notix**，`osascript` 是 **脚本编辑器**；并检查专注模式/免打扰 |
| 横幅显示脚本编辑器图标 | `osascript` 后端的预期行为；安装 `terminal-notifier` 或构建签名 Helper |
| 构建 Helper 后通知反而失败 | Helper 未获授权（在系统设置 → 通知中允许 Notix），或它是 ad-hoc/未签名；用有效身份重新构建，或删除 `~/Applications/Notix.app` |
| 点击通知无反应 | 仅 `terminal-notifier` 支持点击跳转，且需要 `clickToOpen: true` 与非空 `baseUrl` |
| 没有声音 | 检查 `channels.macos.sound`、系统音量与免打扰；声音开启时 `osascript` 播放 Glass |
| 修改 `notifierApp` / `appIcon` 不生效 | 这两个字段只能在 profile 文件中配置（设置卡片不提供）；改完 YAML 后重启 DSH |

### Windows

| 现象 | 排查方式 |
|---|---|
| 完全没有 toast | Windows 设置 → 系统 → 通知：为 **Notix** 打开通知，并检查专注助手（Focus Assist）/免打扰 |
| 没有声音 | 即使 `channels.windows.sound` 为 `true`，Windows 也可能在全局或按应用静音通知声音 |
| 投递报 PowerShell 错误 | 需要 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` 存在；PowerShell 缺失或安装位置异常会在 Host 日志中报错 |
| toast 能弹出但点击无反应 | 点击跳转需要 `clickToOpen: true` 与非空 `baseUrl`；协议激活也可能被系统策略或安全软件拦截 |
| 名称或图标不对 | 修正 `channels.windows.appId` / `channels.windows.icon`；下次发送会重写注册表值 |
| 重复通知替换了上一条 | 设计如此：去重键同时作为 toast 的 tag/group。需要多条并存时，通过 `ctx.notix.notify()` 为每条通知指定不同的 `dedupeKey` |

### 通用

- **Linux 或其他平台完全没有通知**：预期行为。插件会加载，但不注册渠道；Host 日志会输出 `no built-in notification channel for platform "<name>"`。
- **安装或升级后通知不工作**：重启 DSH——Host 插件在进程启动时加载——并确认 `notix-dsh` 同时出现在 `dsh.profile.bundles` 与 profile 的 `node_modules` 中。
- **某个渠道按配置被静音**：`channels.<key>.enabled` 为关时，Host 日志会输出 `the <key> notification channel is disabled`。
- **排查投递结果**：storage 可用时，通知记录（含 `delivered` 与 `channels`）位于 `~/.dsh/storages/notix`，也可通过 `ctx.notix.history()` 读取。`delivered: false` 表示没有渠道接受该通知。
- **点击跳转地址**：使用 GUI 实际打印的地址（`dsh web` 启动时会打印），不存在固定端口。

## 环境要求

| 要求 | 值 |
|---|---|
| DeepSeek Harness | `>=0.2.1-rc.2 <0.3.0`（`engines.dsh`） |
| Node.js | `^22.18.0 \|\| >=24.0.0`（`engines.node`）；用于从仓库克隆构建与运行插件 |
| macOS | 通知中心；可选 `terminal-notifier` / `alerter`；显示鲸鱼图标需要签名 Helper 或 `terminal-notifier` |
| Windows | Windows 10/11，系统自带 Windows PowerShell 5.1（`powershell.exe`）；已在 Windows 11 验证 |
| Linux / 其他 | 插件可加载，但不注册渠道，投递为空操作 |

## 开发

所有手写源码位于 `src/host/`（Node）与 `src/client/`（浏览器）。`lib/` 由 `node scripts/build.mjs` 全量生成，已加入 `.gitignore`，发布时由 `prepack` 钩子重建。Host 模块逐字节复制；Client 由 tsdown 打成单个 classic-script factory。Windows toast 助手是 `src/host/channels/toast.ps1`，必须保持 ASCII-only：构建逐字节复制该文件，而 PowerShell 5.1 在无 BOM 时会按 ANSI 代码页解码脚本。

```bash
pnpm install --frozen-lockfile
pnpm build            # 清理并重建完整的 lib/ 目录
pnpm build:check      # 在临时目录重建并逐文件比较 lib/ 全量产物
pnpm test             # 先构建，再运行单元/集成/打包测试
pnpm smoke            # 校验浏览器 bundle 的模块 id 与导出契约
pnpm verify           # test + smoke + 全目录可复现检查
pnpm notify-test      # 仓库克隆，macOS：通过构建后的渠道发送一条真实通知
pnpm notify-test:win  # 仓库克隆，Windows：通过构建后的渠道发送一条真实 toast
```

用入库的 overlay 模板让 DSH 直接加载本 checkout（本地副本被 Git 忽略）：

```bash
cp dev/notix.patch.example.yml dev/notix.patch.local.yml
# 把 name 改成当前 checkout 中 lib/index.js 的绝对路径
pnpm build
dsh --profile web --patch ./dev/notix.patch.local.yml --dump-config
```

发布为手工操作：改 `version`，然后在干净的 checkout 中执行 `pnpm publish`。npm 生命周期会先跑 `prepublishOnly`（`pnpm verify`），再跑 `prepack`（`pnpm build`）然后打包，因此 tarball 总是从仓库重新构建并验证。发布文件集为运行时产物加 macOS Helper 构建材料，详见[包内容](#包内容)。

发布用的 tarball 也做过端到端验证：对打包产物执行 `dsh plugin add` 会同步 bundle 列表，`dsh --dump-config` 能组装出 `notix` 条目。

统一源码结构、渠道适配器契约、DSH 模块边界、source map 保证与发布流程见[开发指南](https://github.com/QiangXian/notix-dsh/blob/main/docs/DEVELOPMENT.md)。

## 参与贡献

欢迎在 [QiangXian/notix-dsh](https://github.com/QiangXian/notix-dsh) 提交 Issue 或 Pull Request。动手前请先读[贡献指南](https://github.com/QiangXian/notix-dsh/blob/main/CONTRIBUTING.md)与[开发指南](https://github.com/QiangXian/notix-dsh/blob/main/docs/DEVELOPMENT.md)，提交 PR 前运行 `pnpm verify`；请勿提交 `lib/`（它由 `src/` 全量生成）。

版本变更记录见 [CHANGELOG.md](https://github.com/QiangXian/notix-dsh/blob/main/CHANGELOG.md)；发版由维护者按[发布手册](https://github.com/QiangXian/notix-dsh/blob/main/docs/PUBLISHING.md)执行。安全问题请按 [SECURITY.md](https://github.com/QiangXian/notix-dsh/blob/main/SECURITY.md) 私下报告；所有项目空间遵循[行为准则](https://github.com/QiangXian/notix-dsh/blob/main/CODE_OF_CONDUCT.md)。

## 许可证

[MIT](https://github.com/QiangXian/notix-dsh/blob/main/LICENSE) © Notix contributors
