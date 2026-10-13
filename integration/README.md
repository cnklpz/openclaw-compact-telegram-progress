# Telegram display bridge · 宿主补丁

> **实验性宿主扩展，不是 OpenClaw 官方已发布接口。**这份补丁让用量尾注和紧凑进度插件接入原生 Telegram 显示生命周期。仅修改配置或重载插件，不能为原版宿主增加这些接口。

## 精确适配版本

| 项目 | 固定值 |
| --- | --- |
| 上游项目 | [openclaw/openclaw](https://github.com/openclaw/openclaw) |
| 基线 tag | `v2026.10.1` |
| 基线 commit | `e178c39e9aae3fa440735217f9aef9574f286677` |
| 补丁 | [`host.patch`](./host.patch) |
| SHA-256 | `b23f736b7e034a88fe0e8c2cc5f6a9bbef5b682c2a22a50d049a4ac604393083` |
| 上游许可 | [MIT · LICENSE.openclaw](./LICENSE.openclaw) |
| 宿主 Node 要求 | `>=24.16.0 <25` 或 `>=26.1.0`，来自该基线 `package.json` |
| 包管理器 | 该基线锁定 `pnpm@12.5.1` |

插件的纯 JavaScript 测试可在 Node 22+ 运行，**不代表完整 OpenClaw 宿主支持 Node 22**。不要把此补丁直接应用于其他 OpenClaw 版本，也不要依据相同版本字符串跳过 commit 检查。

## 补丁提供什么

- **`finalUsageFooter.v1`**：把官方整回合 usage 与宿主墙钟时长交给只返回文本的格式化回调；结果在原生最终尾注、渲染和分页之前处理。缺少精确 usage、终止或失败等条件下跳过或回落原生行为，不估算 tokens。
- **`ordinaryToolProgress.v1`**：把宿主已接纳回合的普通工具事件交给显示 reducer，最多返回三类短摘要。审批、错误提示、计划、标题、推理和 commentary 车道仍由宿主保留。
- **窄权限**：插件实例/代际、opaque lease、账号、会话 incarnation、回合和 topic 绑定；取消、迟到、重载、dispose 后的回调不能重新接管显示。
- **原生托管**：Telegram 消息创建、编辑、分页、最终化、receipt 和清理仍由宿主拥有；不会给插件 Bot Token 或通用 send/edit 权限。

这些 capability 有固定的已审插件 owner：`token-speed-footer` 与 `compact-telegram-progress`。不要把“能加载本地插件”解释为自动具备任意宿主权限。

## 从干净源码复现

以下只在**独立源码候选目录**构建和测试，不操作运行中的 Gateway。先克隆任一插件仓库，并把 `PLUGIN_ROOT` 设为其真实绝对目录。

```bash
# 当前目录：已克隆的插件仓库
PLUGIN_ROOT="$PWD"

# 在旁边创建新的上游源码候选，不覆盖已安装的 OpenClaw
cd ..
git clone --branch v2026.10.1 https://github.com/openclaw/openclaw.git openclaw-display-candidate
cd openclaw-display-candidate
git checkout --detach e178c39e9aae3fa440735217f9aef9574f286677

git rev-parse HEAD
sha256sum "$PLUGIN_ROOT/integration/host.patch"
git apply --check --whitespace=error-all "$PLUGIN_ROOT/integration/host.patch"
git apply --whitespace=error-all "$PLUGIN_ROOT/integration/host.patch"

# 使用该源码 package.json 锁定的 pnpm 版本
pnpm install --frozen-lockfile --ignore-scripts
pnpm build

# 完成构建后再串行运行宿主测试；传输为假 Telegram API
node --import ./scripts/tsx.mjs scripts/test-projects.mts \
  src/channels/turn-display-extensions.test.ts \
  extensions/telegram/src/bot-message-dispatch.turn-display.test.ts --maxWorkers=1

# 核对反向补丁可用；这里只检查，不回滚
git apply --reverse --check "$PLUGIN_ROOT/integration/host.patch"
```

首次构建与宿主测试不要并行准备，以免源码/产物拓扑变更被构建 owner 拒绝。该源码的依赖安装和完整构建比插件纯单元测试重得多。

## 安装与切换边界

1. 保留现有包、服务入口和可用的回滚路径，审核补丁后在候选中完成构建与测试。
2. 通过你自己的受支持 operator/服务管理流程部署候选。**不要在仍被运行中 Gateway 引用的 pnpm 全局存储内直接覆写文件**；不要从当前聊天的 agent exec 或其 detached job 替换、停止或重启承载该聊天的 Gateway。
3. 使用对应版本的 CLI/Control UI 安装并审核插件；两个插件 README 提供本地 link 安装步骤。加载、capability 注册和最终消息验收是三件不同的事。
4. 用量插件显式选择 `deliveryMode: "preview-safe"`；原生 Telegram 预览保留 `streaming.mode: "partial"`，`streaming.block.enabled: false`。保留原生 usage 作为 formatter 不可用时的回退，检查会话级 `/usage` 覆盖。
5. 若外部插件声明 `openclaw` peer dependency，切换安装根后应核对它的 peer link；旧根链接失效属于单独的兼容问题，不应通过扩大信任或绕过审核解决。

## 验收：不要把测试等同上线

插件单元测试和宿主假传输测试不发送真实 Telegram 消息，不能证明某个模型提供了精确 usage、某个 topic 正确投递或某次最终尾注已被用户收到。

完整实投验收至少检查：

- 单回合原生预览编辑，以及最终尾注出现一次；长文本分页与 HTML/Markdown 字面量正确。
- 多个模型请求、成功 fallback、缺少 usage 与零时长；速度必须是整回合墙钟吞吐，不是生成速度。
- 并发同类工具、不同账号/topic、审批和错误提示不被折叠掉。
- 取消、supersede、插件重载、迟到事件，以及失败/部分/未确认最终交付。
- 用真实 receipts 与脱敏截图确认无重复、无残留过程消息、不会误删已经最终化的消息。

## 回滚

在支持的插件管理界面禁用相关插件，可撤去它们的可选显示行为；宿主回滚则通过 operator 恢复先前的安装和服务入口。

只在独立源码候选里撤去本补丁：

```bash
git apply --reverse --check "$PLUGIN_ROOT/integration/host.patch"
git apply --reverse "$PLUGIN_ROOT/integration/host.patch"
```

宿主补丁及其测试派生自 OpenClaw 上述基线。保留本目录的上游 MIT 许可；两仓库中的 `host.patch` 是同一份补丁，**应用一次即可同时支持两个插件**。
