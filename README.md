<div align="center">

# ✨ OpenClaw Compact Telegram Progress

**让工具进度少刷屏：同类操作合并更新，只保留最近三类普通进度。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-8b5cf6.svg)](./package.json)
[![Node.js tests: >=22](https://img.shields.io/badge/Node.js_tests-%3E%3D22-5FA04E?logo=nodedotjs&logoColor=white)](#requirements)
[![OpenClaw baseline: 2026.10.1](https://img.shields.io/badge/OpenClaw_baseline-2026.10.1-0078D4.svg)](#compatibility)

同类合并 · 最近优先 · 显示与执行分离 · 原生消息生命周期

</div>

> [!IMPORTANT]
> **这是显示插件，不是独立 Telegram 机器人，也不是配置即用的官方扩展。**
> 它需要匹配宿主提供 `ordinaryToolProgress.v1`。官方未修改的 OpenClaw 2026.10.1 没有这个接口；仅安装插件会告警并保持 inactive，不会偷偷接管消息或改用回复修改 Hook。
> 本仓附带可复现的 [宿主源码补丁](./integration/host.patch) 和 [构建说明](./integration/README.md)。

## 目录

- [效果示意](#demo)
- [核心行为](#behavior)
- [兼容性与运行要求](#compatibility)
- [安装与配置](#install)
- [验证、测试与本地演示](#tests)
- [纯 reducer API](#api)
- [实现与安全边界](#security)
- [回滚与关联项目](#related)

<a id="demo"></a>

## 效果示意

工具越来越多，不代表进度卡也应该越来越长。

**未按类别合并时的普通进度，示意：**

```text
⏳ Read · 读取资料 · 进行中
⏳ Exec · 执行操作 · 进行中
⏳ Search · 检索信息 · 进行中
⏳ Read · 读取资料 · 进行中
⏳ Write · 更新文件 · 进行中
```

**同类合并后，示意：**

```text
⏳ Search · 检索信息 · 进行中
⏳ Read · 读取资料 · 进行中
⏳ Write · 更新文件 · 进行中
```

最新的 Read 完成后，该类别更新并移动到最后：

```text
⏳ Search · 检索信息 · 进行中
⏳ Write · 更新文件 · 进行中
✅ Read · 读取资料 · 已完成
```

以上是纯 reducer 的演示输出，**不是实投截图或真实 Telegram 回执**。插件只替换普通工具进度行；审批、错误提示、计划、标题、推理、commentary 及最终回答不属于“三行裁剪”范围。整个原生预览因此仍可能超过三行。

<a id="behavior"></a>

## 核心行为

| 行为 | 规则 |
| --- | --- |
| 同类合并 | Read、Exec、Search、Write、Fetch、Browser、Delegate、Other 使用固定类别摘要 |
| 最近优先 | 最新有效活动移到末尾；插件适配器固定保留最近 **3** 类普通行 |
| 并发不串线 | 同类最新启动的调用拥有该行；旧调用迟到完成不会覆盖它 |
| 精确事件 | 按调用 ID 和序号处理 start / status / end，拒绝重复、过期或不匹配事件 |
| 回合隔离 | 宿主 opaque lease 绑定账号、聊天、topic、会话 incarnation 和 run |
| 终态封闭 | 取消、失败、结束、重载及 dispose 后，迟到事件不能重新唤醒预览 |
| 保留重要提示 | 只精简普通进度；审批和错误等原生车道不被吞掉 |
| 不干预答案 | 最终回答不经过 reducer，不修改回答内容或用量统计 |

**它不做什么：**不改变工具执行顺序、并发或权限，不保证减少模型 Token 或 Telegram API 调用次数，不清理历史聊天，也不自行发送、编辑或删除消息。

<a id="compatibility"></a>

## 兼容性与运行要求

| 宿主 | 结果 |
| --- | --- |
| 官方未修改的 OpenClaw 2026.10.1 | 缺少 `ordinaryToolProgress.v1`；告警并 inactive，保留原生行为 |
| 2026.10.1 + 本仓匹配宿主补丁 | 可注册 display-only reducer，由原生 Telegram compositor 使用 |
| 其他版本 / 不同宿主补丁 | 未验证；缺少有效能力或生命周期时拒绝注册 |

本仓 [`integration/host.patch`](./integration/host.patch) 固定适配：

```text
OpenClaw tag: v2026.10.1
Upstream commit: e178c39e9aae3fa440735217f9aef9574f286677
Capability: ordinaryToolProgress.v1
Reviewed plugin owner: compact-telegram-progress
```

这是**实验性宿主扩展，不是官方 2026.10.1 已发布的 SDK 能力**。配置、插件重载或安装更高版本本身，不能证明接口存在；需要重新核对对应源码和实际注册结果。

<a id="requirements"></a>

### Node.js 与宿主是两套要求

- 插件独立测试与纯 reducer：**Node.js ≥22**，不需要第三方项目依赖。
- 完整 OpenClaw 2026.10.1 宿主：`>=24.16.0 <25 || >=26.1.0`，按上游 `engines.node` 执行。
- 需要正常工作的 Telegram 通道、匹配宿主接口与可用的插件生命周期。

**Node 22 能通过插件测试，不代表 OpenClaw 宿主支持 Node 22。**

<a id="install"></a>

## 安装与配置

### 1. 审核并准备宿主

先阅读 [宿主集成说明](./integration/README.md)，在固定基线的独立源码候选中应用补丁、构建和测试。保留原安装与回滚入口，部署由 Gateway 主机的 operator 通过受支持流程完成。

不要直接覆写运行中的 pnpm 全局存储、hashed bundle 或从承载当前聊天的 agent exec 自动替换 / 重启 Gateway。

### 2. 克隆与本地 link 安装

以下命令供 operator 执行；安装原生插件意味着让代码在 Gateway 进程中运行，请先审查源码并固定到已审核提交。

```bash
git clone https://github.com/cnklpz/openclaw-compact-telegram-progress.git
cd openclaw-compact-telegram-progress

npm run check
npm test

# 记录本地安装，稍后按官方流程启用。
openclaw plugins install --link "$PWD" --no-enable
```

`--link` 持续引用这个目录，勿删除或随意移动。`--no-enable` 不会禁用已经启用的旧安装；已有安装应先检查状态。安装可能要求来源信任或能力审核，请读完整结果，不要为了让它加载而覆盖已有 allow / deny 策略。

此仓库不是 npm / ClawHub 发布声明，也不依赖未经验证的 GitHub 直装参数。命令依据：[2026.10.1 插件 CLI](https://github.com/openclaw/openclaw/blob/v2026.10.1/docs/cli/plugins.md)。

### 3. 合并配置

> [!WARNING]
> 以下是**局部配置片段，不是完整 `openclaw.json`**。通过 Control UI 或支持的官方配置管理合并字段，保留账号、凭据、其他插件和通道策略。

```json5
{
  channels: {
    telegram: {
      streaming: {
        mode: "partial",
        block: { enabled: false },
      },
    },
  },
  plugins: {
    entries: {
      "compact-telegram-progress": {
        config: { enabled: true },
      },
    },
  },
}
```

- 外层插件启用策略由官方 `enable` 操作设置；`config.enabled` 只是本插件开关。
- 本插件适配器固定最多三类普通进度，目前**没有**配置项修改这个数量。纯 reducer API 的容量参数不等于 Gateway 插件选项。
- 配套用量插件应显式用 `deliveryMode: "preview-safe"`。任何其他已注册的回复修改 Hook 仍可能抑制原生 Telegram preview，本插件不会放宽这条宿主规则。
- 多账号或 topic 路由应检查对应覆盖值与受支持范围；匹配补丁不为配置的多代理 `GroupThread` 路径创建 display lease。

### 4. 启用与应用

```bash
openclaw plugins enable compact-telegram-progress
openclaw plugins reload compact-telegram-progress --wait --json
openclaw plugins list --json
openclaw plugins inspect compact-telegram-progress --runtime --json
```

reload 不会自动启用禁用的插件，也不会补上宿主接口。检查管理返回的应用结果、告警和 generation；运行中的回合可能保留旧设置，应用后用**新回合**验证。

`inspect --runtime` 是 CLI 进程的注册检查，不足以独自证明 Gateway 已使用同一版本。还需 Gateway 端应用结果以及真实消息效果。

<a id="tests"></a>

## 验证、测试与本地演示

```bash
npm run check         # JavaScript 语法检查
npm test              # reducer、契约模拟器与注册适配器测试
npm run test:coverage # Node 自带覆盖率报告
npm run demo          # 只打印到本地终端，不发送 Telegram 消息
```

测试覆盖同类合并、最近顺序、旧并发调用、重复 / 过期事件、未知工具映射、账号 / topic / session / run 隔离、容量限制、终态封闭、回调释放以及临时卡片契约模拟。

| 验证层级 | 边界 |
| --- | --- |
| 插件单元测试 / 本地演示 | 真实 reducer 与注册代码；没有模型或 Telegram 网络传输 |
| `lifecycle.mjs` 契约测试 | 独立模拟临时卡片端口；**不是实际 Telegram SDK adapter** |
| 匹配宿主补丁集成测试 | 真实宿主 registry、事件生产与 Telegram compositor / lifecycle；使用假传输，需在宿主源码项目运行 |
| 真实 Telegram 验收 | 需要真实 receipts / 脱敏截图，才能证明显示、最终化及清理结果 |

CI 仅运行插件语法与单元测试，不做 live Telegram 验收。正式使用前应测试长消息、并发同类操作、审批 / 错误、多账号 / topic、取消 / supersede、mid-turn reload 及失败 / 部分交付。不能把 fake transport 测试当作真实送达证据。

<a id="api"></a>

## 纯 reducer API

无需启动 OpenClaw 或 Telegram，就可以使用纯聚合器：

```js
import { CompactProgress } from "./aggregator.mjs";

const scope = {
  accountId: "demo-account",
  chatId: "demo-chat",
  threadId: "",
  sessionId: "demo-session",
  runId: "demo-run",
};
const reducer = new CompactProgress({ maxCategories: 3 });

reducer.begin(scope);
reducer.apply(scope, {
  callId: "call-1",
  toolName: "read",
  phase: "start",
  seq: 1,
});
reducer.apply(scope, {
  callId: "call-1",
  phase: "end",
  status: "completed",
  seq: 2,
});
console.log(reducer.snapshot(scope).text);
// ✅ Read · 读取资料 · 已完成

reducer.close(scope); // 后续该 scope 的迟到事件会被拒绝
```

直接使用的容量参数是 `maxCategories`（默认 3，范围 1–8）、`maxRuns`（默认 512）和 `maxCallsPerRun`（默认 4096）。reducer 不驱逐终态 tombstone 去重新接纳旧回合；容量达到上限时拒绝新输入，消费者应明确管理实例生命周期。

真实插件为每个 opaque lease 创建独立 reducer，并通过 `WeakMap` 保存，因此不是把所有历史聊天塞进一个全局“最近 run”映射。

<a id="security"></a>

## 实现与安全边界

```text
宿主接纳的 Telegram 回合
  → 原生工具事件：调用 / 名称 / 阶段 / 状态
  → ordinaryToolProgress.v1 · 实例绑定的显示回调
  → 最多三类固定短摘要
  → 原生 compositor 合成预览
  → 宿主拥有创建 / 编辑 / 最终化 / 清理与回执
```

- **无 Bot Token、Telegram client 或通用消息权限**；不注册 `reply_payload_sending`、`message_sending` 或 run takeover Hook。
- **不展示工具参数、结果、路径、自由文本错误或内部 ID**；未知工具统一为 Other，摘要使用固定类别和状态。
- **不猜身份**：宿主精确提供账号、聊天、topic、会话 incarnation、run 与 opaque lease，不靠 transcript、`message_sent` 或“最后一次工具调用”推断。
- **原生托管**：`createLivePreviewLifecycle` 是实际消息生命周期 owner；`lifecycle.mjs` 只是契约模拟器，不会叠加第二个物理消息 owner。
- **fail-closed**：能力缺失、scope 错误、已终结或 dispose 后保持原生行为，迟到回调不能收养旧回合或误删最终回答。
- display-only 描述本实现及扩展接口的行为边界，**不是原生第三方插件代码的沙箱保证**。

### 仓库结构

```text
.
├── index.mjs               # OpenClaw 插件入口
├── registration.mjs        # 宿主能力注册与 lease adapter
├── aggregator.mjs          # 纯类别 reducer
├── lifecycle.mjs           # 独立临时卡片契约模拟器
├── *.test.mjs              # 单元测试
├── demo.mjs                # 终端演示
├── openclaw.plugin.json    # 插件 ID 与 schema
├── integration/host.patch  # 两个显示能力共用的宿主补丁
├── integration/README.md   # 构建、验收与回滚说明
└── LICENSE
```

<a id="related"></a>

## 回滚与关联项目

通过支持的插件管理停用可选的进度精简：

```bash
openclaw plugins disable compact-telegram-progress
```

按原配置恢复之前修改的 streaming 字段；撤除宿主扩展则由 operator 恢复保留的安装入口。不要猜测 message ID、删除最终回复或直接改 live pnpm 存储。

- [🧮 OpenClaw Token & Speed Footer](https://github.com/cnklpz/openclaw-token-speed-footer)：官方回合用量与墙钟平均输出速度，preview-safe 路径需要 `finalUsageFooter.v1`。
- [OpenClaw 官方项目](https://github.com/openclaw/openclaw)
- [本仓宿主集成说明](./integration/README.md)

两仓库的宿主补丁相同，**应用一次即可同时支持两个插件**；两个插件独立启用，不会互相安装。

本插件采用 [MIT License](./LICENSE)。宿主补丁所涉及的上游代码保留 [OpenClaw MIT 许可](./integration/LICENSE.openclaw)。
