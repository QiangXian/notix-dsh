# notix-dsh-ui

Notix（`notix-dsh`）通知插件的 Settings UI（浏览器端 client 插件）。在 DeepSeek Harness Web GUI 的「插件」设置页中渲染「Notix 通知」卡片，直接读写 Host 插件 `notix` 的配置命名空间。

## 功能

- **触发时机**：审批请求、待回答问题、长任务、错误、轮次完成 5 组开关与阈值（时间字段以「分钟」输入，底层存毫秒）。
- **免打扰**：时段开关、`HH:MM` 起止时间、是否放行紧急（审批）通知。
- **通知内容**：语言（中文/English）、详略程度（简洁/常规）。
- **macOS 渠道**：启用、声音、点击打开、自定义 Harness 地址。
- 底部状态区显示 保存中 / 已保存 / 保存失败 / 只读原因；写入期间禁用控件。

## 安装与启用

1. 本包与 `notix-dsh` 处于同一仓库（`packages/notix-dsh-ui`）。确保 Host 插件 `notix-dsh` 已安装（它通过 bundle 层的 `cordis.patch.yml` 以 entry id `notix` 注入并提供配置 schema）。
2. 本包的 `cordis.patch.yml` 以 `ui-notix` 插入 client 插件：

   ```yaml
   - insert:
       - id: ui-notix
         name: notix-dsh-ui
   ```

   在 profile 的 `cordis.patch.yml` 中引用本包（或在 bundle 配置中把 `packages/notix-dsh-ui` 加入插件列表），重载后打开「设置 → 插件」即可看到「Notix 通知」卡片。
3. 卡片仅在 Host 组合了 `notix` 插件时出现（`configForms.whileServed(['notix'])`）；配置写入由 Host 的 dsh-config-editor 落到 profile patch 并即时生效，Notix 插件会随之重载。

## 结构

- `lib/index.js` — Host 半，no-op。
- `lib/client.js` — 浏览器半，单文件 bundle（`window.__ModuleLoader__.load`），inject `["slots", "locale", "configForms"]`。
- `locale/zh.json` / `locale/en.json` — 插件市场/清单用的 meta 文案；卡片内完整文案字典内嵌于 `lib/client.js`（`ctx.locale.register`）。
- `cordis.patch.yml` — bundle 层插入项。

## 开发自检

```sh
node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```
