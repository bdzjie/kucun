# Claude Code 架构速查

## 源码位置
`E:\claude-code-main`

## 核心入口
- `main.tsx` — Bun + Ink 渲染入口
- `App.tsx` — React 组件树根
- `query.ts` + `QueryEngine.ts` — 查询执行

## 工具系统
- `tools.ts` — 16 个内置工具注册
- `services/tools/StreamingToolExecutor.ts` — 流式执行
- `tools/BashTool/` — Bash 命令 + 分类器
- `tools/MCPTool/` — MCP 协议工具

## 权限系统
- `hooks/toolPermission/PermissionContext.ts` — 权限上下文
- `hooks/toolPermission/handlers/` — 5 种处理器
- `utils/permissions/permissions.ts` — 权限规则引擎

## 上下文压缩
- `services/compact/compact.ts` — 核心压缩
- `services/compact/autoCompact.ts` — 自动触发
- 阈值: 13k buffer / 20k warning / 20k error

## MCP 系统
- `services/mcp/client.ts` — MCP 客户端 (3149 行)
- 4 种传输: stdio / HTTP / SSE / WebSocket
- OAuth 支持 + 自动刷新

## 状态管理
- `state/AppStateStore.ts` — AppState 类型
- `state/store.ts` — Zustand store

## 任务系统
7 种任务: LocalAgent / RemoteAgent / InProcessTeammate / Dream / Queue / Suspended / Background

## Hooks (核心)
- `useCanUseTool` — 权限决策
- `useInputBuffer` — Undo/Redo
- `useCancelRequest` — Escape/Ctrl+C
- `usePromptSuggestion` — 补全建议
- `useHistorySearch` — 历史搜索

## 组件 (439 文件)
- `PromptInput/` — 输入框 (2000+ 行)
- `GlobalSearchDialog.tsx` — 全局搜索
- `BackgroundTasksDialog.tsx` — 后台任务
- `Spinner.tsx` — 旋转动画

## Keybindings 快捷键系统
- `keybindings/resolver.ts` — 按键解析 + Chord 状态
- `keybindings/parser.ts` — 按键字符串解析
- `keybindings/match.ts` — Ink Key 匹配
- `keybindings/useKeybinding.ts` — React Hook
- `keybindings/defaultBindings.ts` — 默认绑定表

## MagicDocs 文档系统
- `services/MagicDocs/magicDocs.ts` — 核心逻辑
- `# MAGIC DOC: [title]` 头检测
- Post-Sampling Hook 自动更新

## LSP 语言服务器
- `services/lsp/manager.ts` — 单例管理
- `services/lsp/LSPClient.ts` — JSON-RPC 客户端
- `services/lsp/LSPServerInstance.ts` — 服务器实例
- `services/lsp/LSPServerManager.ts` — 多服务器路由
- `services/lsp/LSPDiagnosticRegistry.ts` — 诊断去重
- `services/lsp/passiveFeedback.ts` — publishDiagnostics 处理

## 新增 Services 模块
- `extractMemories/` — 记忆提取
- `toolUseSummary/` — 工具使用摘要
- `PromptSuggestion/` — 提示词建议
- `autoDream/` — 自动 Dream
- `settingsSync/` — 设置同步
- `remoteManagedSettings/` — 远程托管设置
- `teamMemorySync/` — 团队记忆同步
- `oauth/` — OAuth 处理
- `tips/` — 提示系统

## Assistant + CLI
- `assistant/sessionHistory.ts` — Session 历史
- `assistant/transports/` — Hybrid/SSE/WS 传输
- `cli/` — CLI 命令

## Bootstrap + Server
- `bootstrap/` — 首次运行引导
- `server/` — DirectConnect 会话管理

## ExtractMemories 记忆提取
- `services/extractMemories/extractMemories.ts`
- runForkedAgent() — Forked 子 Agent
- canUseTool 限制：Read/Grep/Glob 无限制，Bash 只读，Edit/Write 只允许 auto-memory

## PromptSuggestion 提示词建议
- `services/PromptSuggestion/promptSuggestion.ts`
- Haiku 生成用户意图预测
- 过滤器：done/meta_text/evaluative/claude_voice

## toolUseSummary 工具摘要
- `services/toolUseSummary/toolUseSummaryGenerator.ts`
- Haiku 生成工具完成摘要
- 规则：动词过去式 + distinctive 名词，~30 字符

## autoDream 自动记忆整合
- `services/autoDream/autoDream.ts`
- Gate：时间 + 会话数 + 锁
- consolidationLock.ts — 分布式锁
- DreamTask 集成进度追踪

## Entrypoints 入口点
- `entrypoints/cli.tsx` — CLI 入口 + 特殊标志
- `entrypoints/init.ts` — 初始化主逻辑
- Feature 门控：BRIDGE_MODE/DAEMON/BG_SESSIONS/TEMPLATES

## CLI Transport System
- `cli/transports/HybridTransport.ts` — WebSocket 读 + HTTP POST 写
- `cli/transports/SSETransport.ts` — SSE 读 + HTTP POST 写
- `cli/transports/WebSocketTransport.ts` — WebSocket 全双工
- 特性：自动重连 + 心跳 + 背压 + 消息缓冲

## StructuredIO SDK 协议
- `cli/structuredIO.ts` — SDK 协议实现
- StdinMessage/StdoutMessage 类型
- pendingRequests Map + resolvedToolUseIds Set

## 常量定义
- `constants/apiLimits.ts` — API 限制（图片/PDF/工具结果）
- `constants/betas.ts` — Beta 头部
- `constants/system.ts` — CLI 前缀 + 归因头部

## Remote Session 远程会话
- `remote/RemoteSessionManager.ts` — 远程会话管理
- `remote/SessionsWebSocket.ts` — WebSocket 订阅
- `server/createDirectConnectSession.ts` — DirectConnect 会话创建

## UpstreamProxy 上游代理
- `upstreamproxy/upstreamproxy.ts` — CCR 容器代理初始化
- `upstreamproxy/relay.ts` — CONNECT-over-WebSocket 中继
- NO_PROXY 列表 + MITM CA 证书

## OutputStyles 输出样式
- `outputStyles/loadOutputStylesDir.ts` — 加载 .md 样式文件
- frontmatter 解析（name/description）

## Graceful Shutdown
- `utils/gracefulShutdown.ts` — 优雅退出
- 信号处理：SIGINT/SIGTERM/SIGHUP
- 退出流程：cleanup → hooks → analytics → forceExit

## Doctor 诊断
- `screens/Doctor.tsx` — 诊断检查 UI
- 检查项：版本/Agent/MCP/插件/锁/验证错误

## 特性开关
`COORDINATOR_MODE` / `KAIROS` / `VOICE_MODE` / `PROACTIVE` / `BASH_CLASSIFIER` / `CONTEXT_COLLAPSE` / `REACTIVE_COMPACT` / `MCP_SKILLS` / `QUICK_SEARCH` / `TERMINAL_PANEL` / `MESSAGE_ACTIONS`

## 设计模式
管道模式 / 策略模式 / 观察者模式 / 中介者模式 / 状态机 / React Compiler 缓存

## 详细文档
- `memory/claude-code-architecture.md` — 完整知识库
- `memory/2026-04-17-claude-code-analysis.md` — 深度笔记
