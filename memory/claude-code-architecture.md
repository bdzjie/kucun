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

## 十九、Keybindings 快捷键系统 — `keybindings/`

### 19.1 文件清单

```
keybindings/
├── defaultBindings.ts     — 默认按键绑定定义
├── resolver.ts           — 按键解析 + Chord 状态管理
├── parser.ts             — 按键字符串解析（ctrl+shift+k）
├── match.ts              — Ink Key 与 ParsedKeystroke 匹配
├── useKeybinding.ts       — React Hook（单/多按键处理）
├── KeybindingContext.tsx  — Context Provider（Chord 拦截）
├── KeybindingProviderSetup.tsx — Provider 配置
├── loadUserBindings.ts   — 用户自定义绑定加载
├── defaultBindings.ts    — 默认绑定表
├── schema.ts             — 绑定 JSON Schema
├── template.ts           — 绑定模板生成
├── shortcutFormat.ts     — 快捷键格式化
├── reservedShortcuts.ts  — 保留快捷键（不可重绑）
├── validate.ts           — 绑定验证
└── useShortcutDisplay.ts — 快捷键展示
```

### 19.2 按键解析流程

```typescript
// 1. 字符串解析: "ctrl+shift+k" → ParsedKeystroke
export function parseKeystroke(input: string): ParsedKeystroke

// 2. Chord 解析: "ctrl+k ctrl+s" → Chord
export function parseChord(input: string): Chord

// 3. Ink Key 匹配
export function matchesKeystroke(input: string, key: Key, target: ParsedKeystroke): boolean

// 4. Chord 状态解析（支持多键序列）
export function resolveKeyWithChordState(
  input, key, activeContexts, bindings, pending
): ChordResolveResult

// 5. 动作解析
export function resolveKey(input, key, activeContexts, bindings): ResolveResult
```

### 19.3 Context 上下文

| Context | 场景 |
|---------|------|
| `Global` | 全局快捷键 |
| `Chat` | 对话输入框 |
| `Autocomplete` | 自动补全 |
| `Settings` | 设置面板 |
| `Confirmation` | 确认对话框 |
| `Tabs` | 标签页导航 |
| `Transcript` | 转录视图 |
| `HistorySearch` | 历史搜索 |
| `Task` | 任务背景 |
| `ThemePicker` | 主题选择 |
| `Scroll` | 滚动 |
| `Help` | 帮助 |
| `Attachments` | 附件导航 |
| `Footer` | 底部状态栏 |
| `MessageSelector` | 消息选择器 |
| `DiffDialog` | Diff 对话框 |
| `ModelPicker` | 模型选择器 |
| `Select` | 选择组件 |
| `Plugin` | 插件对话框 |

### 19.4 核心快捷键

```typescript
// Global
'ctrl+c': 'app:interrupt'
'ctrl+d': 'app:exit'
'ctrl+l': 'app:redraw'
'ctrl+t': 'app:toggleTodos'
'ctrl+o': 'app:toggleTranscript'
'ctrl+r': 'history:search'
'ctrl+shift+f': 'app:globalSearch'  // feature: QUICK_SEARCH

// Chat
'escape': 'chat:cancel'
'ctrl+x ctrl+k': 'chat:killAgents'
'shift+tab': 'chat:cycleMode'
'meta+p': 'chat:modelPicker'
'enter': 'chat:submit'
'up/down': 'history:previous/next'
'ctrl+_': 'chat:undo'
'space': 'voice:pushToTalk'  // feature: VOICE_MODE
```

---

## 二十、魔法文档 MagicDocs — `services/MagicDocs/`

### 20.1 核心概念

Magic Docs 自动维护标记了特殊头的 Markdown 文件。当文件包含 `# MAGIC DOC: [title]` 头时，系统会在后台定期运行 subagent 更新文档。

### 20.2 工作流程

```typescript
// 1. 检测 Magic Doc 头
detectMagicDocHeader(content: string): { title, instructions? } | null

// 2. 注册追踪
registerMagicDoc(filePath: string): void

// 3. Post-Sampling Hook 更新
registerPostSamplingHook(updateMagicDocs)

// 4. 使用 runAgent 执行更新（只允许 Edit 工具）
runAgent({
  agentDefinition: getMagicDocsAgent(),
  canUseTool: (tool) => tool.name === 'Edit' && filePath === docPath ? allow : deny
})
```

### 20.3 文件清单

```
MagicDocs/
├── magicDocs.ts      — 核心逻辑
└── prompts.ts       — 更新提示词模板
```

### 20.4 规则

- Magic Doc 头必须保留：`# MAGIC DOC: {{docTitle}}`
- 斜体行紧随标题后的指令必须保留
- 只更新实质新内容；无实质更新则不调用工具
- 文档哲学：简洁、高信号、概述 > 细节

---

## 二十一、LSP 语言服务器协议 — `services/lsp/`

### 21.1 文件清单

```
lsp/
├── manager.ts                — 单例管理 + 生命周期
├── config.ts                 — 配置加载（从插件）
├── LSPClient.ts             — JSON-RPC 客户端封装
├── LSPServerInstance.ts     — 单个服务器实例
├── LSPServerManager.ts      — 多服务器路由
├── LSPDiagnosticRegistry.ts — 诊断注册 + 去重
└── passiveFeedback.ts       — publishDiagnostics 处理
```

### 21.2 架构

```
Plugin LSP Config
    ↓
config.ts: getAllLspServers()
    ↓
LSPServerManager (单例)
    ↓
LSPServerInstance (每个服务器)
    ↓
LSPClient (vscode-jsonrpc)
    ↓
StdioProcess / StreamableHTTP / SSE / WebSocket
```

### 21.3 LSPServerInstance 状态机

```
stopped → starting → running
running → stopping → stopped
any → error (crash)
error → starting (retry, 最多 maxRestarts=3)
```

### 21.4 文件同步

```typescript
// 文件打开
manager.openFile(filePath, content)
  → textDocument/didOpen

// 文件变更
manager.changeFile(filePath, content)
  → textDocument/didChange

// 文件保存
manager.saveFile(filePath)
  → textDocument/didSave

// 文件关闭
manager.closeFile(filePath)
  → textDocument/didClose
```

### 21.5 诊断去重

```typescript
// MAX_DIAGNOSTICS_PER_FILE = 10
// MAX_TOTAL_DIAGNOSTICS = 30
// MAX_DELIVERED_FILES = 500 (LRU)

// 跨会话去重：deliveredDiagnostics LRU Cache
// 诊断唯一键：message + severity + range + source + code
```

### 21.6 重试机制

```typescript
// ContentModified (-32801) 自动重试
MAX_RETRIES_FOR_TRANSIENT_ERRORS = 3
RETRY_BASE_DELAY_MS = 500
// 延迟序列: 500ms, 1000ms, 2000ms
```

---

## 二十二、新增 Services 模块

### 22.1 extractMemories — 记忆提取

```typescript
// 从对话中提取重要信息写入 MEMORY.md
```

### 22.2 toolUseSummary — 工具使用摘要

```typescript
// 工具使用统计和摘要生成
toolUseSummaryGenerator.ts
```

### 22.3 PromptSuggestion — 提示词建议

```typescript
// promptSuggestion.ts — 提示词补全
// speculation.ts — 推测性补全
```

### 22.4 autoDream — 自动 Dream

```typescript
// autoDream.ts — 自动记忆整合触发
// consolidationLock.ts — 整合锁
// consolidationPrompt.ts — 整合提示词
```

### 22.5 settingsSync — 设置同步

```typescript
// 用户设置跨设备同步
```

### 22.6 remoteManagedSettings — 远程托管设置

```typescript
// 远程管理的企业设置
// securityCheck.tsx — 安全检查
```

### 22.7 teamMemorySync — 团队记忆同步

```typescript
// 团队共享记忆同步
// secretScanner.ts — 秘密扫描
// teamMemSecretGuard.ts — 团队记忆安全守卫
```

### 22.8 oauth — OAuth 处理

```typescript
// OAuth 授权流程
```

### 22.9 tips — 提示系统

```typescript
// 用户提示和技巧
```

---

## 二十三、Assistant 系统 — `assistant/`

### 23.1 文件清单

```
assistant/
├── sessionHistory.ts  — Session 历史管理
├── handlers/          — 消息处理器
└── transports/        — 传输层（Hybrid/SSE/WS/Batch）
```

### 23.2 Remote Transports

```typescript
// HybridTransport — 混合传输
// SSETransport — Server-Sent Events
// WebSocketTransport — WebSocket
// SerialBatchEventUploader — 批量事件上传
// WorkerStateUploader — Worker 状态上传
```

---

## 二十四、CLI 系统 — `cli/`

### 24.1 文件清单

```
cli/
├── agents.ts         — Agent CLI
├── auth.ts          — 认证
├── autoMode.ts      — 自动模式
├── mcp.tsx         — MCP CLI
├── plugins.ts       — 插件 CLI
└── util.tsx        — 工具函数
```

---

## 二十五、Bootstrap 系统 — `bootstrap/`

```typescript
// 首次运行引导
// 环境检测
```

---

## 二十六、Server DirectConnect — `server/`

```typescript
// createDirectConnectSession.ts — 创建直连会话
// directConnectManager.ts — 会话管理
// types.ts — 类型定义
```

---

---

## 二十七、ExtractMemories 记忆提取 — `services/extractMemories/`

### 27.1 工作流程

```
对话结束（无 tool calls）
  → executeExtractMemories()
  → runForkedAgent() — Forked 子 Agent
  → 共享父 prompt cache
  → 写文件到 auto-memory 目录
```

### 27.2 工具限制（canUseTool）

| 允许 | 限制 |
|------|------|
| Read/Grep/Glob | 无限制 |
| Bash | 只读命令（isReadOnly） |
| Edit/Write | 只允许 auto-memory 路径 |

### 27.3 节流机制

```typescript
// tengu_bramble_lintel 控制每 N 轮执行一次
turnsSinceLastExtraction < getFeatureValue('tengu_bramble_lintel', 1)
```

### 27.4 互斥保护

- 主 Agent 已写入 memory → 跳过 forked extraction
- 防止重复写入

---

## 二十八、PromptSuggestion 提示词建议 — `services/PromptSuggestion/`

### 28.1 提示词生成

```typescript
// 使用 Haiku 生成用户可能输入的提示词
const SUGGESTION_PROMPT = `[SUGGESTION MODE: Suggest what the user might naturally type next...]`

// 规则：
// - 预测用户意图，不是建议应该做什么
// - 2-12 个词，匹配用户风格
// - 不要建议：评价性、问题、Claude 风格、新想法
```

### 28.2 过滤器

| 过滤 | 条件 |
|------|------|
| `done` | 精确匹配 "done" |
| `meta_text` | "nothing found", "silence" |
| `evaluative` | "thanks", "looks good" |
| `claude_voice` | "Let me...", "I'll..." |
| `too_few_words` | 单词数 < 2（非斜杠命令） |
| `too_many_words` | 单词数 > 12 |

### 28.3 缓存优化

```typescript
// 关键：不 override API 参数（tools/thinking/effort/maxOutputTokens）
// 否则 cache hit 率从 92.7% 暴跌至 61%
// 唯一安全 override：abortController, skipTranscript, skipCacheWrite
```

---

## 二十九、toolUseSummary 工具使用摘要 — `services/toolUseSummary/`

### 29.1 功能

使用 Haiku 为完成的工具批次生成人类可读的摘要标签。

### 29.2 示例

```
- Searched in auth/
- Fixed NPE in UserService
- Created signup endpoint
- Read config.json
- Ran failing tests
```

### 29.3 规则

- 动词过去式 + 最 distinctive 名词
- 删除冠词、连接词
- 截断约 30 字符

---

## 三十、autoDream 自动记忆整合 — `services/autoDream/`

### 30.1 触发条件（Gate 顺序）

| 顺序 | Gate | 阈值 |
|------|------|------|
| 1 | 时间 | 距离上次 >= minHours（默认 24h） |
| 2 | 会话数 | mtime > lastConsolidatedAt 的会话 >= minSessions（默认 5） |
| 3 | 锁 | 无其他进程正在整合 |

### 30.2 锁定机制

```typescript
// consolidationLock.ts
tryAcquireConsolidationLock()
  → 成功 → 继续
  → 失败（已有锁） → 跳过

// rollbackConsolidationLock(priorMtime)
  → 失败后回滚 mtime
```

### 30.3 与 DreamTask 集成

```typescript
const taskId = registerDreamTask(setAppState, {
  sessionsReviewing: sessionIds.length,
  priorMtime,
  abortController,
})

// 进度追踪
addDreamTurn(taskId, { text, toolUseCount }, touchedPaths, setAppState)

// 完成/失败
completeDreamTask(taskId, setAppState)
failDreamTask(taskId, setAppState)
```

---

## 三十一、Bootstrap 引导系统 — `bootstrap/`

### 31.1 CLI 入口 — `entrypoints/cli.tsx`

```
cli.tsx
  → --version: 零加载，输出版本
  → --dump-system-prompt: 输出系统提示词
  → --claude-in-chrome-mcp: Chrome MCP 服务器
  → --chrome-native-host: Chrome 原生主机
  → --computer-use-mcp: 计算机使用 MCP
  → --daemon-worker: Daemon Worker
  → remote-control/rc/remote/sync/bridge: 桥接模式
  → daemon: 长运行 Daemon
  → ps/logs/attach/kill: 会话管理
  → templates: 模板作业
  → environment-runner: BYOC Runner
  → self-hosted-runner: 自托管 Runner
  → --worktree --tmux: Tmux Worktree
  → 默认: 加载完整 CLI
```

### 31.2 初始化 — `entrypoints/init.ts`

```typescript
init()
  → enableConfigs()
  → applySafeConfigEnvironmentVariables()
  → setupGracefulShutdown()
  → initialize1PEventLogging()
  → populateOAuthAccountInfoIfNeeded()
  → initJetBrainsDetection()
  → detectCurrentRepository()
  → initializeRemoteManagedSettingsLoadingPromise()
  → configureGlobalMTLS()
  → configureGlobalAgents()
  → preconnectAnthropicApi()
  → initUpstreamProxy() (CCR only)
  → ensureScratchpadDir()
```

### 31.3 状态管理 — `bootstrap/state.ts`

```typescript
// 全局状态
getIsRemoteMode()      // 远程模式
getIsNonInteractiveSession()  // 非交互会话
getKairosActive()      // KAIROS 模式
getOriginalCwd()      // 原始工作目录
getSessionId()        // 会话 ID
```

---

## 三十二、Entrypoints 入口点 — `entrypoints/`

### 32.1 文件清单

| 文件 | 职责 |
|------|------|
| `cli.tsx` | CLI 入口 + 特殊标志处理 |
| `init.ts` | 初始化主逻辑 |
| `mcp.ts` | MCP 服务器入口 |
| `sandboxTypes.ts` | 沙箱类型定义 |
| `agentSdkTypes.ts` | Agent SDK 类型 |

### 32.2 Feature 门控

```typescript
feature('BRIDGE_MODE')        // 桥接模式
feature('DAEMON')             // Daemon 模式
feature('BG_SESSIONS')        // 后台会话
feature('TEMPLATES')          // 模板系统
feature('BYOC_ENVIRONMENT_RUNNER')  // BYOC Runner
feature('SELF_HOSTED_RUNNER') // 自托管 Runner
feature('CHICAGO_MCP')        // Chicago MCP
```

---

## 三十三、Agent SDK 类型 — `assistant/agentSdkTypes.ts`

```typescript
// SDK 类型定义
interface AgentConfig {
  model?: string
  systemPrompt?: string
  tools?: Tool[]
  maxTokens?: number
  temperature?: number
}

interface AgentSession {
  id: string
  input(messages: Message[]): Promise<Message>
  stop(): void
}
```

---

## 三十四、CLI 传输层 — `cli/transports/`

### 34.1 HybridTransport — 混合传输（WebSocket + HTTP POST）

```
写入流程：
write(stream_event) → 100ms 缓冲 → 批量 POST
write(other) → uploader.enqueue() → 串行 POST + 重试

特点：
- WebSocket 读取，HTTP POST 写入
- stream_event 延迟缓冲（减少 POST 次数）
- 串行化 + 背压（maxQueueSize: 100_000）
- 指数退避 + 抖动重试
```

### 34.2 SSETransport — Server-Sent Events 传输

```
读取：SSE 流（/events/stream）
写入：HTTP POST（/events）

特性：
- 自动重连（指数退避，最多 10 分钟）
- Last-Event-ID 续传
- 心跳检测（45s 无活动判定死亡）
- 重复帧去重（seenSequenceNums Set）
```

### 34.3 WebSocketTransport — WebSocket 传输

```
读取 + 写入：WebSocket

特性：
- 自动重连（可配置关闭）
- Ping/Pong 心跳
- keep_alive 数据帧（防止代理空闲超时）
- 消息缓冲 + 重连重放
- 睡眠/唤醒检测（60s 间隔异常）
```

### 34.4 传输比较

| 传输 | 读取 | 写入 | 适用场景 |
|------|------|------|----------|
| HybridTransport | WebSocket | HTTP POST | CCR 桥接 |
| SSETransport | SSE | HTTP POST | 远程会话 |
| WebSocketTransport | WebSocket | WebSocket | 标准远程 |

---

## 三十五、StructuredIO — SDK 协议 — `cli/structuredIO.ts`

### 35.1 协议消息类型

```typescript
type StdinMessage =
  | { type: 'user_message', message: SDKUserMessage }
  | { type: 'interrupt' }
  | { type: 'ping' }

type StdoutMessage =
  | { type: 'assistant_message', message: AssistantMessage }
  | { type: 'tool_result', tool_use_id, result }
  | { type: 'stream_event', ... }
  | { type: 'permission_request', ... }
```

### 35.2 核心机制

| 机制 | 说明 |
|------|------|
| pendingRequests Map | 请求/响应跟踪 |
| resolvedToolUseIds Set | 去重已处理工具调用 |
| outbound Stream | 控制请求优先队列 |
| prependedLines | 队首插入（抢先处理） |

### 35.3 RemoteIO 扩展

```typescript
// RemoteIO 在 StructuredIO 基础上添加：
- RemoteSessionManager 连接管理
- 权限请求转发
- 会话状态同步
```

---

## 三十六、常量定义 — `constants/`

### 36.1 API 限制 — `apiLimits.ts`

```typescript
// 图片
API_IMAGE_MAX_BASE64_SIZE = 5 MB
IMAGE_TARGET_RAW_SIZE = 3.75 MB
IMAGE_MAX_WIDTH/HEIGHT = 2000px

// PDF
PDF_TARGET_RAW_SIZE = 20 MB
API_PDF_MAX_PAGES = 100
PDF_EXTRACT_SIZE_THRESHOLD = 3 MB

// 媒体
API_MAX_MEDIA_PER_REQUEST = 100

// 工具结果
DEFAULT_MAX_RESULT_SIZE_CHARS = 50,000
MAX_TOOL_RESULT_TOKENS = 100,000
MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200,000
```

### 36.2 Beta 头部 — `betas.ts`

```typescript
CLAUDE_CODE_20250219_BETA_HEADER = 'claude-code-20250219'
INTERLEAVED_THINKING_BETA_HEADER = 'interleaved-thinking-2025-05-14'
CONTEXT_1M_BETA_HEADER = 'context-1m-2025-08-07'
WEB_SEARCH_BETA_HEADER = 'web-search-2025-03-05'
TASK_BUDGETS_BETA_HEADER = 'task-budgets-2026-03-13'
PROMPT_CACHING_SCOPE_BETA_HEADER = 'prompt-caching-scope-2026-01-05'
FAST_MODE_BETA_HEADER = 'fast-mode-2026-02-01'
ADVISOR_BETA_HEADER = 'advisor-tool-2026-03-01'
```

### 36.3 系统常量 — `system.ts`

```typescript
// CLI 前缀
DEFAULT_PREFIX = "You are Claude Code, Anthropic's official CLI..."
AGENT_SDK_PREFIX = "You are a Claude agent, built on Anthropic's..."

// 归因头部
getAttributionHeader()
  → cc_version: 版本 + 指纹
  → cc_entrypoint: 入口点
  → cch: Native 客户端证明（可选）
  → cc_workload: 工作负载提示
```

---

## 三十七、Doctor 诊断 — `screens/Doctor.tsx`

### 37.1 诊断检查项

```typescript
type DiagnosticCheck = {
  // 版本信息
  stable/latest 版本标签
  
  // 环境验证
  BASH_MAX_OUTPUT_LENGTH
  TASK_MAX_OUTPUT_LENGTH
  
  // Agent 定义
  activeAgents
  userAgentsDir/projectAgentsDir
  
  // MCP 服务器
  mcpTools
  
  // 插件错误
  pluginsErrors
  
  // 锁文件状态
  LockInfo[] (PID-based locking)
  
  // 验证错误
  validationErrors
}
```

### 37.2 诊断信息类型

```typescript
getDoctorDiagnostic()
  → npmDistTags (stable/latest)
  → lockInfo (stale locks cleanup)
  → contextWarnings
  → agentInfo
```

---

## 三十八、Remote Session 远程会话 — `remote/`

### 38.1 RemoteSessionManager

```typescript
class RemoteSessionManager {
  websocket: SessionsWebSocket
  pendingPermissionRequests: Map<string, SDKControlPermissionRequest>
  
  connect()
  sendMessage(message: SDKMessage)
  requestPermission(request: SDKControlPermissionRequest)
  resolvePermission(requestId: string, response: PermissionUpdate)
}
```

### 38.2 SessionsWebSocket

```
连接：wss://api.anthropic.com/v1/sessions/ws/{sessionId}/subscribe
认证：{ type: 'auth', credential: { type: 'oauth', token: '...' } }

重连策略：
- 指数退避（最多 5 次）
- 4001 错误有限重试（最多 3 次）
- Ping 心跳（30s 间隔）
```

### 38.3 DirectConnect — `server/createDirectConnectSession.ts`

```typescript
createDirectConnectSession({
  serverUrl,
  authToken,
  cwd,
  dangerouslySkipPermissions
})
→ POST /sessions
→ 返回 { session_id, ws_url, work_dir }
```

---

## 三十九、UpstreamProxy 上游代理 — `upstreamproxy/`

### 39.1 CCR 容器内代理

```
用途：在 CCR 会话容器中转发 HTTPS流量

流程：
1. 读取 session token (/run/ccr/session_token)
2. 设置 prctl(PR_SET_DUMPABLE, 0) 阻止 ptrace
3. 下载 MITM CA 证书
4. 启动 CONNECT→WebSocket relay
5. 暴露 HTTPS_PROXY/SSL_CERT_FILE
```

### 39.2 NO_PROXY 列表

```
localhost, 127.0.0.1, ::1
169.254.0.0/16 (IMDS)
10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
anthropic.com (直连，不走 MITM)
github.com, *.github.com
npm/pypi/crates 注册表
```

### 39.3 CONNECT-over-WebSocket Relay

```
协议：UpstreamProxyChunk protobuf
  tag = 0x0a, varint length, data

中继：localhost TCP → WebSocket → CCR egress gateway
用途：git push, npm install 等需要 MITM 的流量
```

---

## 四十、OutputStyles 输出样式 — `outputStyles/`

### 40.1 加载流程

```typescript
getOutputStyleDirStyles(cwd)
  → loadMarkdownFilesForSubdir('output-styles', cwd)
  → 解析 frontmatter (name, description)
  → 返回 OutputStyleConfig[]
```

### 40.2 样式配置

```typescript
interface OutputStyleConfig {
  name: string
  description: string
  prompt: string      // markdown 内容
  source: 'project' | 'user'
  keepCodingInstructions?: boolean
}
```

### 40.3 优先级

```
项目样式 (.claude/output-styles/*.md) > 用户样式 (~/.claude/output-styles/*.md)
```

---

## 四十一、优雅退出 — `utils/gracefulShutdown.ts`

### 41.1 退出信号处理

```typescript
SIGINT  → gracefulShutdown(0)
SIGTERM → gracefulShutdown(143)  // 128 + 15
SIGHUP  → gracefulShutdown(129)  // 128 + 1
孤儿检测 → 30s 间隔检查 stdin/stdout 可用性
```

### 41.2 退出流程

```
1. cleanupTerminalModes()
   → 禁用鼠标追踪
   → 退出 alt screen
   → 恢复光标
   → 清除 iTerm2 进度

2. printResumeHint()
   → 显示 claude --resume 提示

3. runCleanupFunctions()
   → 最多 2s 超时

4. executeSessionEndHooks()
   → SessionEnd hooks
   → 超时：sessionEndHookTimeoutMs

5. analytics flush
   → 最多 500ms

6. forceExit()
   → process.exit() 或 SIGKILL
```

### 41.3 Failsafe 定时器

```
超时 = max(5s, sessionEndTimeoutMs + 3.5s)
→ 保证即使 cleanup 挂起也能退出
```

---

## 四十二、命令系统 — `commands/`

### 42.1 命令结构

```
commands/
├── doctor/         # 诊断检查
├── resume/         # 恢复会话
├── mcp/           # MCP 服务器管理
│   ├── addCommand.ts
│   └── xaaIdpCommand.ts
├── config/         # 配置管理
├── agent/          # Agent 管理
├── session/        # 会话管理
└── ...（共 80+ 子命令）
```

### 42.2 命令类型

```typescript
type LocalJSXCommandCall = (
  onDone: (result?: string) => void,
  context: CommandContext,
  args: string[]
) => Promise<React.ReactNode>
```

### 42.3 MCP Add 命令

```typescript
claude mcp add <name> <commandOrUrl> [args]
  --scope <scope>      // local/user/project
  --transport <type>  // stdio/sse/http
  --env <KEY=value>   // 环境变量
  --header <header>   // WebSocket 头
  --client-id          // OAuth 客户端 ID
  --xaa               // 启用 XAA
```

---

*最后更新: 2026-04-17*
