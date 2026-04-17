# MEMORY.md — 长期记忆

---

## 关于 Claude Code 源码分析

**补充学习日期**: 2026-04-17（Keybindings + LSP + MagicDocs）

**分析日期**: 2026-04-17
**源码位置**: `E:\claude-code-main`
**规模**: ~1,900 文件，~512,000+ 行 TypeScript
**运行时**: Bun + React + Ink (终端 UI)

---

## 核心架构总结

Claude Code 是一个**流式 AI Agent + 工具化 + 分层权限 + 智能上下文管理**的系统。

### 五大核心支柱

1. **工具化 Agent**: 16 个内置工具（Bash/File/WebSearch/WebFetch/MCP 等）
2. **权限 gating**: 3 层权限模式（safe/skipDev/bypassPermissions）
3. **上下文管理**: Token 预算 + 自动压缩 + 微压缩
4. **流式执行**: AsyncIterable 工具结果 + SSE/MCP 协议
5. **多任务协调**: 7 种任务类型 + Coordinator 模式

### 设计模式

- 管道模式：工具执行（pre-hook → tool → post-hook → analytics）
- 策略模式：查询引擎（local/remote/base）
- 观察者模式：AppState → React 组件
- 中介者模式：Coordinator 管理多 Agent
- 状态机：Buddy 伙伴动画

---

## 详细文档

更多内容存储在：

## 新增覆盖模块

### Keybindings 系统
- 14 个文件：resolver/parser/match/useKeybinding/defaultBindings
- 支持 Chord 多键序列（ctrl+k ctrl+s）
- 19 个 Context（Global/Chat/Settings/Confirmation 等）

### MagicDocs 系统
- `# MAGIC DOC: [title]` 头自动检测
- Post-Sampling Hook 自动更新文档
- 只允许 Edit 工具，限制文件路径

### LSP 系统
- 7 个文件：manager/config/LSPClient/LSPServerInstance/LSPServerManager/LSPDiagnosticRegistry/passiveFeedback
- 插件驱动配置（getAllLspServers 从插件加载）
- 诊断去重：LRU Cache 跨会话去重
- ContentModified 自动重试（最多 3 次）

### 新增 Services
- extractMemories / toolUseSummary / PromptSuggestion
- autoDream / settingsSync / remoteManagedSettings
- teamMemorySync / oauth / tips

### Assistant + CLI
- HybridTransport / SSETransport / WebSocketTransport
- DirectConnect 会话管理

---

更多内容存储在：

- `memory/claude-code-architecture.md` — 完整架构知识库
- `memory/2026-04-17-claude-code-analysis.md` — 深度分析笔记

---

## 项目结构

```
src/
├── main.tsx, App.tsx, query.ts, QueryEngine.ts, context.ts, tools.ts
├── coordinator/     — 多 Agent 协调
├── bridge/          — IDE 远程桥接
├── commands/        — /commit, /review 等命令
├── hooks/           — 100+ React Hooks
├── skills/          — 技能系统
├── plugins/         — 插件加载器
├── memdir/          — MEMORY.md 管理
├── migrations/      — 11 个数据迁移脚本
├── voice/           — 语音模式
├── buddy/           — 伙伴系统
├── tasks/           — 7 种任务类型
├── services/
│   ├── api/         — Claude API 客户端
│   ├── compact/     — 上下文压缩
│   ├── mcp/         — MCP 协议客户端
│   ├── analytics/   — 遥测
│   └── tools/       — 工具执行管道
├── state/           — Zustand 状态管理
├── components/      — 439 个 React UI 组件
└── utils/           — ~400 工具函数
```

---

## 关键实现

### 工具执行管道

```
toolHooks.pre() → Tool.use() → toolExecution.onResult() → toolHooks.post()

StreamingToolExecutor.ts — 流式执行器
toolExecution.ts — analytics + blob 存储
toolHooks.ts — pre/post 钩子
```

### 权限决策

```
hasPermissionsToUseTool()
  ├── allow → 直接执行
  ├── deny → 直接拒绝
  └── ask
        ├── BashClassifier
        ├── Coordinator
        ├── Swarm Worker
        └── InteractiveUI
```

### 压缩阈值

```
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD = 20_000
ERROR_THRESHOLD = 20,000
MANUAL_COMPACT_BUFFER = 3,000
```

### MCP 传输

```
StdioClientTransport      — 本地进程
StreamableHTTP — HTTP 长连接
SSEClientTransport — Server-Sent Events
WebSocketTransport — WebSocket
```

### 7 种任务类型

```
LocalAgentTask      — Bun 进程内 Agent
RemoteAgentTask     — 远程 API
InProcessTeammate  — 同进程 Swarm
DreamTask          — Marble 规划
QueueAgentTask     — 队列调度
SuspendedAgentTask  — 暂停恢复
BackgroundTask     — 后台任务
```

---

## 特性开关（feature('FLAG')）

```
COORDINATOR_MODE    — 多 Agent 协调
KAIROS             — 实时模式
VOICE_MODE         — 语音输入
PROACTIVE          — 主动模式
BASH_CLASSIFIER    — Bash 命令分类器
CONTEXT_COLLAPSE   — 上下文折叠
REACTIVE_COMPACT   — 反应式压缩
TRANSCRIPT_CLASSIFIER — 转录分类器
MCP_SKILLS         — MCP 技能
REVIEW_ARTIFACT    — 审查产物
WORKFLOW_SCRIPTS   — 工作流脚本
MONITOR_TOOL       — 监控工具
```

---

## React Compiler 模式

所有组件使用 `c as _c` 缓存模式：

```typescript
function Component(t0) {
  const $ = _c(N)  // N = 缓存槽数量
  
  if ($[0] !== dep1 || $[1] !== dep2) {
    $[0] = dep1; $[1] = dep2
    $[2] = compute(dep1, dep2)
  }
  return $[2]
}
```

---

## 学习总结

Claude Code 的设计亮点：

1. **完整性**: 从源码可见一个生产级 AI Agent 的完整工程实现
2. **模块化**: 高度解耦，工具/权限/压缩/MCP 均可独立演进
3. **容错性**: 多层重试、墓碑机制、优雅退出
4. **可观测性**: 完整的 analytics + telemetry
5. **用户可控**: 细粒度权限控制、透明度高

---

*最后更新: 2026-04-17*
