# Claude Code 架构知识库

> 基于 `E:\claude-code-main` 源码的完整分析（约 1,900 文件，512,000+ 行 TypeScript）

---

## 一、核心架构总览

```
src/
├── main.tsx                    # Bun + Ink 渲染入口
├── App.tsx                     # React 组件树根
├── query.ts                   # 查询执行器
├── QueryEngine.ts             # 查询引擎抽象（3种查询路径）
├── context.ts                 # 上下文收集（7种上下文）
├── tools.ts                   # 工具注册中心（16个内置工具）
├── coordinator/               # 多 Agent 协调模式
├── bridge/                    # IDE 远程桥接
├── commands/                  # 内置命令（/commit /review 等）
├── hooks/                     # 100+ React Hooks
├── skills/                    # 技能系统
├── plugins/                   # 插件加载器
├── memdir/                    # MEMORY.md 管理
├── migrations/                # 11 个数据迁移脚本
├── voice/                     # 语音模式
├── buddy/                     # 伙伴系统
├── tasks/                     # 7 种任务类型
├── services/
│   ├── api/                   # Claude API 客户端
│   ├── compact/               # 上下文压缩系统
│   ├── mcp/                   # MCP 协议客户端
│   ├── analytics/             # 遥测分析
│   └── tools/                 # 工具执行管道
├── state/                     # Zustand 状态管理
├── types/                     # TypeScript 类型定义
├── components/                # 439 个 React UI 组件
├── screens/                   # 屏幕组件
├── utils/                     # ~400 工具函数
└── ink/                       # Ink 终端 UI 封装
```

---

## 二、状态管理层 — `state/`

### AppStateStore — 全局状态类型

```typescript
interface AppState {
  // Session 身份
  sessionId: string
  agentId: string
  agentSessionId: string
  
  // 对话
  messages: Message[]
  
  // MCP
  mcpServers: Map<string, MCPServerConnection>
  
  // 任务
  taskHistory: AgentTask[]
  activeTask: AgentTask | null
  tasks: Record<string, TaskState>
  foregroundedTaskId: string | undefined
  
  // 权限
  permissions: {
    mode: 'safe' | 'skipDev' | 'bypassPermissions'
    context: ToolPermissionContext
  }
  
  // Companion
  companion: CompanionState
  
  // Feature Flags
  featureFlags: Record<string, boolean>
  
  // UI 状态
  mainLoopModel: string
  mainLoopModelForSession: string | null
  expandedView: 'tasks' | 'teammates' | null
  viewingAgentTaskId: string | null
  viewSelectionMode: 'idle' | 'viewing-agent'
  promptSuggestion: PromptSuggestionState
}
```

### Zustand Middleware

```typescript
// persistMiddleware — 持久化到磁盘
// immunoMiddleware — 关键字段免疫清除
```

---

## 三、查询引擎 — `QueryEngine.ts` + `query.ts`

### 三种查询路径

| 查询类型 | 触发条件 | 路径 |
|----------|----------|------|
| `baseQuery` | 普通对话 | API → Streaming 响应 |
| `localQuery` | 本地任务 | Bun 进程内 Agent |
| `remoteQuery` | 远程 Agent | 外部 API |

### 查询执行流程

```
query(userMessage)
  → acquireTaskId()
  → collectContext()        // 7 种上下文收集
  → QueryEngine.execute()   // 选择查询路径
  → processStopSignals()    // 处理中断信号
  → consumeToolResults()    // 消费工具结果
```

---

## 四、上下文系统 — `context.ts`

### collectContext() 流水线

```typescript
collectContext({ task, options })
  ├── buildMessageContext()       // 消息历史（截断后）
  ├── fetchDirectoryContext()    // 目录树（getdirs）
  ├── fetchGitContext()          // Git 状态（branch/stash/diff）
  ├── fetchIDEContext()          // IDE 状态（open files/selection）
  ├── fetchToolContext()         // 工具特定上下文
  ├── fetchMcpContext()         // MCP resources/prompts
  └── fetchAgentTaskContext()    // Agent 任务状态
```

---

## 五、工具系统 — `tools/` + `services/tools/`

### 5.1 工具注册表 — `tools.ts`

| 工具名 | 类 | 路径 | 权限 |
|--------|-----|------|------|
| `Bash` | `BashTool` | `tools/BashTool/` | 高危 |
| `Read` | `FileReadTool` | `tools/FileReadTool/` | 低 |
| `Write` | `FileWriteTool` | `tools/FileWriteTool/` | 高危 |
| `Edit` | `FileEditTool` | `tools/FileEditTool/` | 高危 |
| `Glob` | `GlobTool` | `tools/GlobTool/` | 低 |
| `Grep` | `GrepTool` | `tools/GrepTool/` | 低 |
| `WebSearch` | `WebSearchTool` | `tools/WebSearchTool/` | 中 |
| `WebFetch` | `WebFetchTool` | `tools/WebFetchTool/` | 中 |
| `NotebookEdit` | `NotebookEditTool` | `tools/NotebookEditTool/` | 高危 |
| `Agent` | `AgentTool` | `tools/AgentTool/` | 高危 |
| `MCP` | `MCPTool` | `tools/MCPTool/` | 可变 |
| `Skill` | `SkillTool` | `tools/SkillTool/` | 中 |

### 5.2 工具执行管道 — `services/tools/`

```
toolHooks.pre() → Tool.use() → toolExecution.onResult() → toolHooks.post()

StreamingToolExecutor.ts  — 流式执行器，解析 SSE/MCP 流
toolExecution.ts          — 工具结果后处理（analytics、blob 存储）
toolHooks.ts             — pre/post 工具钩子
toolOrchestration.ts      — 工具编排（并行/串行策略）
```

### 5.3 BashClassifier — `tools/BashTool/bashPermissions.ts`

```typescript
// 高置信度自动允许
const ALLOW_RULES = [
  /^git (status|log|diff|branch)$/,
  /^npm (install|test|run)$/,
  /^ls -la$/,
]

// 高置信度自动拒绝
const DENY_RULES = [
  /^rm -rf \//,
  /^dd if=.*of=\/dev/,
]
```

---

## 六、权限系统 — `hooks/toolPermission/` + `utils/permissions/`

### 6.1 权限决策状态机

```
hasPermissionsToUseTool()
  ├── behavior = 'allow' → 直接执行
  ├── behavior = 'deny' → 直接拒绝
  └── behavior = 'ask'
        ├── BashClassifier 检查
        ├── Coordinator 决策
        ├── Swarm Worker 决策
        └── InteractiveUI (PermissionRequest)
```

### 6.2 权限处理器

| 处理器 | 文件 | 场景 |
|--------|------|------|
| `allowHandler` | `allowHandler.ts` | 配置允许 |
| `denyHandler` | `denyHandler.ts` | 配置拒绝 |
| `askHandler` | `askHandler.ts` | 进入询问流 |
| `interactiveHandler` | `interactiveHandler.ts` | 主交互对话框 |
| `coordinatorHandler` | `coordinatorHandler.ts` | Coordinator 模式 |
| `swarmWorkerHandler` | `swarmWorkerHandler.ts` | Swarm Worker |

---

## 七、压缩系统 — `services/compact/`

### 阈值配置

```typescript
AUTOCOMPACT_BUFFER_TOKENS     = 13_000  // 触发自动压缩
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000 // 警告阈值
ERROR_THRESHOLD_BUFFER_TOKENS  = 20_000 // 错误阈值
MANUAL_COMPACT_BUFFER_TOKENS   =  3_000 // 手动压缩保留
MAX_OUTPUT_TOKENS_FOR_SUMMARY  = 20_000 // 摘要输出预留
```

### 文件清单

```
compact.ts           — 核心压缩算法
autoCompact.ts       — 自动压缩触发器
microCompact.ts       — 微压缩（tool result 清理）
sessionMemoryCompact.ts — Session Memory 压缩
postCompactCleanup.ts  — 压缩后清理
compactWarningState.ts — 警告状态
cachedMicrocompact.ts  — 缓存式微压缩（ant-only）
```

---

## 八、MCP 系统 — `services/mcp/`

### 支持的传输协议

```typescript
StdioClientTransport           // 本地进程
StreamableHTTPClientTransport // HTTP 长连接
SSEClientTransport            // Server-Sent Events
WebSocketTransport            // WebSocket（自定义）
```

### OAuth 刷新流程

```typescript
checkAndRefreshOAuthTokenIfNeeded()
  → getClaudeAIOAuthTokens()
  → 过期前 5 分钟刷新
  → McpAuthError → needs-auth 状态
```

---

## 九、桥接系统 — `bridge/`

| 文件 | 职责 |
|------|------|
| `bridgeMain.ts` | Main Process 桥接 |
| `bridgeRenderer.ts` | Renderer 桥接 |
| `ideBridge.ts` | IDE RPC 抽象 |
| `ideProtocol.ts` | 协议定义 |
| `bridgePermissionCallbacks.ts` | 权限回调 |

---

## 十、任务系统 — `tasks/`

### 7 种任务类型

| 类型 | 实现 | 运行时 |
|------|------|--------|
| `LocalAgentTask` | `LocalAgentTask.tsx` | Bun 进程 |
| `RemoteAgentTask` | `RemoteAgentTask.ts` | 远程 API |
| `InProcessTeammateTask` | `InProcessTeammateTask.ts` | 同进程 Swarm |
| `DreamTask` | `DreamTask.ts` | Marble 规划 |
| `QueueAgentTask` | `QueueAgentTask.ts` | 队列调度 |
| `SuspendedAgentTask` | `SuspendedAgentTask.ts` | 暂停恢复 |
| `BackgroundTask` | `BackgroundTask.ts` | 后台任务 |

---

## 十一、命令系统 — `commands/`

| 命令 | 文件 | 功能 |
|------|------|------|
| `/commit` | `commit.ts` | Git 提交自动化 |
| `/review` | `review.ts` | 代码审查（UltraReview） |
| `/compact` | `compact.ts` | 手动压缩 |
| `/plan` | `plan.ts` | 进入规划模式 |
| `/fast` | `fast/fast.ts` | Fast Mode 切换 |
| `/buddy` | `buddy.ts` | Buddy 交互 |
| `/model` | `model.ts` | 模型切换 |
| `/permissions` | `permissions.ts` | 权限管理 |

---

## 十二、Hooks 系统 — `hooks/`

### 核心 Hooks

| Hook | 文件 | 职责 |
|------|------|------|
| `useCanUseTool` | `useCanUseTool.tsx` | 工具权限决策 |
| `useInputBuffer` | `useInputBuffer.ts` | 输入缓冲（Undo/Redo） |
| `usePromptSuggestion` | `usePromptSuggestion.ts` | 补全建议 |
| `useArrowKeyHistory` | `useArrowKeyHistory.tsx` | 历史导航 |
| `useHistorySearch` | `useHistorySearch.ts` | 历史搜索 |
| `useIdeSelection` | `useIdeSelection.ts` | IDE 选择 |
| `useCancelRequest` | `useCancelRequest.ts` | 取消/中断处理 |
| `useMainLoopModel` | `useMainLoopModel.ts` | 模型选择 |
| `useApiKeyVerification` | `useApiKeyVerification.ts` | API Key 验证 |
| `useCommandQueue` | `useCommandQueue.ts` | 命令队列 |
| `useDiffData` | `useDiffData.ts` | Git Diff 数据 |
| `useClipboardImageHint` | `useClipboardImageHint.ts` | 粘贴板提示 |

---

## 十三、Components 组件库 — `components/`（439 文件）

### 顶级组件

| 组件 | 职责 |
|------|------|
| `App.tsx` | 应用根组件 |
| `PromptInput.tsx` | 主输入框（2000+ 行） |
| `GlobalSearchDialog.tsx` | 全局搜索（Ctrl+Shift+F） |
| `BackgroundTasksDialog.tsx` | 后台任务（Shift+Down） |
| `ThinkingToggle.tsx` | 思考模式开关 |
| `ModelPicker.tsx` | 模型选择器 |
| `AgentProgressLine.tsx` | Agent 进度行 |
| `Spinner.tsx` | 旋转动画 |

### 子目录

```
components/
├── agents/           — Agent UI
├── design-system/    — FuzzyPicker, Dialog, Pane
├── diff/            — Diff 展示
├── mcp/             — MCP UI
├── permissions/     — 权限对话框
├── PromptInput/     — 输入框
├── Spinner/        — 动画
├── tasks/           — 任务 UI
├── teams/           — 团队 UI
└── ui/              — 基础组件
```

---

## 十四、Buddy 伙伴系统 — `buddy/`

```typescript
// 伙伴生成（确定性随机）
roll(userId: string): Roll

// 属性
interface CompanionBones {
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  species: string
  eye: string
  hat: string
  shiny: boolean
  stats: Record<StatName, number>
}

// 稀有度权重
const RARITY_WEIGHTS = {
  common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1
}
```

---

## 十五、迁移系统 — `migrations/`

| 迁移 | 用途 |
|------|------|
| `migrateOpusToOpus1m.ts` | Opus → Opus[1m] |
| `migrateAutoUpdatesToSettings.ts` | 自动更新配置 |
| `migrateBypassPermissionsAcceptedToSettings.ts` | 权限设置 |
| `migrateEnableAllProjectMcpServersToSettings.ts` | MCP 服务器 |
| `migrateFennecToOpus.ts` | Fennec → Opus |
| `migrateLegacyOpusToCurrent.ts` | 旧版 Opus |
| `migrateSonnet1mToSonnet45.ts` | Sonnet 1m → 4.5 |
| `migrateSonnet45ToSonnet46.ts` | Sonnet 4.5 → 4.6 |

---

## 十六、特性开关 — `feature('FLAG')`

```typescript
COORDINATOR_MODE    // 多 Agent 协调
KAIROS             // 实时模式
VOICE_MODE         // 语音输入
PROACTIVE          // 主动模式
AGENT_TRIGGERS     // Agent 触发器
TRANSCRIPT_CLASSIFIER // 转录分类器
WEB_BROWSER_TOOL   // 网页浏览工具
TOKEN_BUDGET       // Token 预算显示
CONTEXT_COLLAPSE   // 上下文折叠
TERMINAL_PANEL      // 终端面板
REACTIVE_COMPACT   // 反应式压缩
BASH_CLASSIFIER    // Bash 分类器
MCP_SKILLS         // MCP 技能
REVIEW_ARTIFACT    // 审查产物
WORKFLOW_SCRIPTS   // 工作流脚本
MONITOR_TOOL       // 监控工具
```

---

## 十七、设计模式

| 模式 | 应用 |
|------|------|
| 管道模式 | 工具执行：pre-hook → tool → post-hook → analytics |
| 策略模式 | 查询引擎：local/remote/base |
| 观察者模式 | AppState → React 组件重渲染 |
| 中介者模式 | Coordinator 管理多 Agent |
| 状态机 | Buddy 伙伴动画 |
| 承诺流 | 流式工具执行（SSE → AsyncIterable） |
| 墓碑重写 | Session 存储 OOM 保护 |

---

## 十八、React Compiler 模式

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

*最后更新: 2026-04-17*
